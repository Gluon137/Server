"""Loopback HTTP bridge, optionally behind an HTTPS proxy; no stored projects."""
from __future__ import annotations

import argparse
import json
import mimetypes
import multiprocessing
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import threading
from urllib.parse import unquote, urlsplit

WEBSITE = Path(__file__).resolve().parents[2]
MAX_BODY = 256 * 1024
BUILD_TIMEOUT = 20
BUILD_SLOTS = threading.BoundedSemaphore(2)
MIME = {".mjs": "text/javascript", ".js": "text/javascript", ".md": "text/plain"}
EXTENSIONS = {".html", ".css", ".mjs", ".js", ".svg", ".png", ".jpg", ".jpeg", ".ico", ".txt", ".md"}


def build_worker(project, connection):
    try:
        from geometry import build_project
        result = build_project(project)
        connection.send((200, result))
    except ValueError as error:
        connection.send((422, {"valid": False, "errors": [{"code": "INPUT", "message": str(error)}]}))
    except Exception:
        # Internal traces stay on the local terminal, never enter exported projects.
        import traceback
        traceback.print_exc()
        connection.send((500, {"valid": False, "errors": [{"code": "BUILD", "message": "Die Berechnung ist fehlgeschlagen. Bitte den Entwurf prüfen oder den lokalen Dienst neu starten."}]}))
    finally:
        connection.close()


class Handler(BaseHTTPRequestHandler):
    server_version = "BausteinStudio/1.0"

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'")
        super().end_headers()

    def permitted_host(self):
        host = self.headers.get("Host", "")
        return host in {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}"}

    def api_route(self):
        route = urlsplit(self.path).path
        return route.removeprefix("/baustein-studio") if route.startswith("/baustein-studio/api/") else route

    def reply(self, status, data, content_type="application/json; charset=utf-8"):
        raw = json.dumps(data, ensure_ascii=False, allow_nan=False).encode() if not isinstance(data, bytes) else data
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        try:
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        if not self.permitted_host():
            return self.reply(403, {"error": "Nur localhost ist erlaubt."})
        route = self.api_route()
        if route == "/api/health":
            return self.reply(200, {"status": "ok", "engine": "Boxes.py", "localOnly": not getattr(self.server, "public_origin", None)})
        if route == "/api/defaults":
            from geometry import default_project
            return self.reply(200, default_project())
        decoded = unquote(route)
        parts = Path(decoded).parts
        if "backend" in parts or any(p.startswith(".") for p in parts if p not in {"/"}):
            return self.reply(404, {"error": "Nicht gefunden."})
        target = (WEBSITE / decoded.lstrip("/")).resolve()
        if not target.is_relative_to(WEBSITE):
            return self.reply(404, {"error": "Nicht gefunden."})
        if target.is_dir():
            if not route.endswith("/"):
                self.send_response(301)
                self.send_header("Location", route + "/")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            target = target / "index.html"
        if not target.is_file() or target.suffix not in EXTENSIONS:
            return self.reply(404, {"error": "Nicht gefunden."})
        return self.reply(200, target.read_bytes(), MIME.get(target.suffix, mimetypes.guess_type(target)[0] or "application/octet-stream"))

    def do_POST(self):
        if not self.permitted_host():
            return self.reply(403, {"error": "Nur localhost ist erlaubt."})
        if self.api_route() != "/api/build":
            return self.reply(404, {"error": "Nicht gefunden."})
        origin = self.headers.get("Origin")
        if origin and origin not in {f"http://{self.headers['Host']}", getattr(self.server, "public_origin", None)}:
            return self.reply(403, {"error": "Anfragen sind nur von der zugehörigen Oberfläche erlaubt."})
        if self.headers.get("Sec-Fetch-Site") not in {None, "same-origin", "none"}:
            return self.reply(403, {"error": "Fremde Webseiten dürfen keine Berechnung auslösen."})
        if self.headers.get_content_type() != "application/json" or self.headers.get("Transfer-Encoding"):
            return self.reply(415, {"error": "Bitte JSON senden."})
        length = self.headers.get("Content-Length", "")
        if not length.isdigit() or not 0 < int(length) <= MAX_BODY:
            return self.reply(413, {"error": "Projektdatei fehlt oder ist zu groß."})
        self.connection.settimeout(10)
        try:
            project = json.loads(self.rfile.read(int(length)), parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Zahlen müssen endlich sein.")))
        except (ValueError, UnicodeError, TimeoutError, RecursionError):
            return self.reply(422, {"valid": False, "errors": [{"code": "JSON", "message": "Die Projektdatei enthält kein gültiges JSON."}]})
        if not BUILD_SLOTS.acquire(blocking=False):
            return self.reply(429, {"valid": False, "errors": [{"code": "BUSY", "message": "Die Berechnung läuft noch. Bitte kurz warten und erneut versuchen."}]})
        context = multiprocessing.get_context("spawn")
        reader, writer = context.Pipe(duplex=False)
        process = context.Process(target=build_worker, args=(project, writer), daemon=True)
        try:
            process.start()
            writer.close()
            if reader.poll(BUILD_TIMEOUT):
                try:
                    status, result = reader.recv()
                except EOFError:
                    status, result = 500, {"valid": False, "errors": [{"code": "BUILD", "message": "Die Berechnung wurde unerwartet beendet."}]}
            else:
                status, result = 422, {"valid": False, "errors": [{"code": "TIMEOUT", "message": "Der Entwurf ist für diese Berechnung zu komplex. Bitte vereinfachen."}]}
        except OSError:
            status, result = 503, {"valid": False, "errors": [{"code": "BUSY", "message": "Die Berechnung ist momentan nicht verfügbar. Bitte erneut versuchen."}]}
        finally:
            try:
                if process.pid is not None:
                    if process.is_alive():
                        process.terminate()
                    process.join(timeout=2)
                reader.close()
                writer.close()
            finally:
                BUILD_SLOTS.release()
        self.reply(status, result)


def main():
    parser = argparse.ArgumentParser(description="Baustein-Studio lokal starten")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--public-origin", help="Exakter HTTPS-Ursprung für den vorgeschalteten Proxy")
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("Port muss zwischen 1024 und 65535 liegen.")
    if args.public_origin:
        origin = urlsplit(args.public_origin)
        if origin.scheme != "https" or not origin.hostname or origin.username or origin.password or origin.path or origin.query or origin.fragment:
            parser.error("Der öffentliche Ursprung muss eine HTTPS-Adresse ohne Pfad oder Zugangsdaten sein.")
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.public_origin = args.public_origin
    print(f"Baustein-Studio: http://127.0.0.1:{args.port}/baustein-studio/", flush=True)
    print("Beenden mit Strg+C. Entwürfe bleiben im Browser oder in deiner Projektdatei.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
