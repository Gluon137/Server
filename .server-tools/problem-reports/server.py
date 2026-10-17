"""Append-only issue archive. Apache owns HTTPS and authentication for all reads."""
from __future__ import annotations

import argparse
import base64
import binascii
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import struct
import threading
import time
from urllib.parse import parse_qs, urlsplit
import uuid
import zlib

MAX_BODY = 32 * 1024 * 1024
MAX_STORAGE = 2 * 1024 * 1024 * 1024
STORAGE_RESERVE = 128 * 1024 * 1024
MAX_PNG = 12 * 1024 * 1024
APPS = {'automaten-studio', 'landing', 'zahnrad-studio', 'drehscheiben-studio', 'baustein-studio', 'box-studio', 'klappkarten-studio'}
PUBLIC_PATH = '/api/problem-reports'
ADMIN_PATH = '/problem-reports/api/reports'
PNG_PREFIX = 'data:image/png;base64,'


class ReportError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


def png_bytes(value):
    """Validate the actual bounded PNG stream, not merely its claimed MIME type."""
    if not isinstance(value, str) or not value.startswith(PNG_PREFIX):
        raise ValueError('Die Vorschau muss eine PNG-Datei sein.')
    if len(value) > MAX_PNG * 4 // 3 + len(PNG_PREFIX) + 4:
        raise ValueError('Die PNG-Vorschau ist zu groß.')
    try:
        raw = base64.b64decode(value[len(PNG_PREFIX):], validate=True)
    except (ValueError, binascii.Error) as error:
        raise ValueError('Die PNG-Vorschau ist ungültig.') from error
    if len(raw) > MAX_PNG or not raw.startswith(b'\x89PNG\r\n\x1a\n'):
        raise ValueError('Die PNG-Vorschau ist ungültig.')
    position, header, ended, compressed, palette = 8, None, False, bytearray(), False
    safe = bytearray(raw[:8])
    idat_ended = False
    while position < len(raw):
        if position + 12 > len(raw):
            raise ValueError('Unvollständige PNG-Datei.')
        length = struct.unpack('>I', raw[position:position + 4])[0]
        kind = raw[position + 4:position + 8]
        end = position + 12 + length
        if end > len(raw) or not re.fullmatch(b'[A-Za-z]{4}', kind):
            raise ValueError('Ungültiger PNG-Block.')
        data = raw[position + 8:position + 8 + length]
        crc = struct.unpack('>I', raw[position + 8 + length:end])[0]
        if zlib.crc32(kind + data) & 0xffffffff != crc:
            raise ValueError('Die PNG-Prüfsumme stimmt nicht.')
        if header is None and kind != b'IHDR':
            raise ValueError('Der PNG-Kopf fehlt.')
        if kind == b'IHDR':
            if header is not None or length != 13:
                raise ValueError('Ungültiger PNG-Kopf.')
            header = struct.unpack('>IIBBBBB', data)
            width, height, depth, color, compression, filtering, interlace = header
            depths = {0: {1, 2, 4, 8, 16}, 2: {8, 16}, 3: {1, 2, 4, 8}, 4: {8, 16}, 6: {8, 16}}
            if not (0 < width <= 2048 and 0 < height <= 2048) or depth not in depths.get(color, set()) or (compression, filtering, interlace) != (0, 0, 0):
                raise ValueError('Die PNG-Vorschau braucht höchstens 2048 × 2048 Pixel und keine Verschachtelung.')
        elif kind == b'PLTE':
            if compressed or palette or not 0 < length <= 768 or length % 3 or header[3] in {0, 4} or header[3] == 3 and length // 3 > 2 ** header[2]:
                raise ValueError('Ungültige PNG-Palette.')
            palette = True
        elif kind == b'tRNS':
            color = header[3]
            if compressed or not ((color == 0 and length == 2) or (color == 2 and length == 6) or (color == 3 and palette and 0 < length <= 256)):
                raise ValueError('Ungültige PNG-Transparenz.')
        elif kind == b'IDAT':
            if idat_ended or header[3] == 3 and not palette:
                raise ValueError('Ungültige PNG-Bilddaten.')
            compressed.extend(data)
        elif kind == b'IEND':
            if length or not compressed or end != len(raw):
                raise ValueError('Ungültiges PNG-Ende.')
            ended = True
        elif kind in {b'acTL', b'fcTL', b'fdAT'} or kind[0] & 32 == 0:
            raise ValueError('Unbekannter kritischer PNG-Block.')
        if compressed and kind != b'IDAT':
            idat_ended = True
        # Browsers receive pixels only, never compressed ICC/text metadata from uploads.
        if kind in {b'IHDR', b'PLTE', b'tRNS', b'IDAT', b'IEND'}:
            safe.extend(raw[position:end])
        position = end
    if not header or not ended:
        raise ValueError('Unvollständige PNG-Datei.')
    width, height, depth, color, *_ = header
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[color]
    row_bytes = (width * depth * channels + 7) // 8 + 1
    expected = height * row_bytes
    if expected > 34 * 1024 * 1024:
        raise ValueError('Die entpackte Vorschau ist zu groß.')
    try:
        decoder = zlib.decompressobj()
        pixels = decoder.decompress(compressed, expected + 1)
        if len(pixels) != expected or not decoder.eof or decoder.unused_data or decoder.unconsumed_tail or any(pixels[index] > 4 for index in range(0, expected, row_bytes)):
            raise ValueError('Ungültige entpackte PNG-Bilddaten.')
    except zlib.error as error:
        raise ValueError('Ungültige komprimierte PNG-Bilddaten.') from error
    return bytes(safe)


def validate_report(report):
    if not isinstance(report, dict) or type(report.get('version')) is not int or report['version'] != 1:
        raise ValueError('Unbekanntes Meldungsformat.')
    if set(report) - {'version', 'id', 'app', 'capturedAt', 'description', 'snapshot', 'diagnostics', 'environment', 'preview'}:
        raise ValueError('Unbekannte Felder im Meldungsformat.')
    identifier = report.get('id')
    if not isinstance(identifier, str) or str(uuid.UUID(identifier)) != identifier:
        raise ValueError('Die Meldungs-ID ist ungültig.')
    if report.get('app') not in APPS:
        raise ValueError('Das Studio ist unbekannt.')
    captured = report.get('capturedAt')
    if not isinstance(captured, str) or len(captured) > 64:
        raise ValueError('Der Aufnahmezeitpunkt fehlt.')
    moment = datetime.fromisoformat(captured.replace('Z', '+00:00'))
    if moment.tzinfo is None:
        raise ValueError('Der Aufnahmezeitpunkt braucht eine Zeitzone.')
    description = report.get('description', '')
    if not isinstance(description, str) or len(description) > 12000:
        raise ValueError('Der Freitext darf höchstens 12000 Zeichen enthalten.')
    for name in ('snapshot', 'diagnostics', 'environment'):
        if not isinstance(report.get(name), dict):
            raise ValueError('Der Meldung fehlt ein Datenabschnitt: ' + name)
    if 'preview' in report:
        png_bytes(report['preview'])


class Archive:
    def __init__(self, directory, storage_limit=MAX_STORAGE):
        self.directory = Path(directory)
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.directory.chmod(0o700)
        self.path = self.directory / 'reports.sqlite3'
        self.lock = threading.Lock()
        self.storage_limit = storage_limit
        with self.connect() as connection:
            connection.execute('PRAGMA journal_mode=DELETE')
            connection.execute('CREATE TABLE IF NOT EXISTS reports (number INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, app TEXT NOT NULL, captured_at TEXT NOT NULL, created_at TEXT NOT NULL, description TEXT NOT NULL, has_preview INTEGER NOT NULL, digest TEXT NOT NULL, body BLOB NOT NULL)')
        self.path.chmod(0o600)

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.path, timeout=5)
        try:
            connection.row_factory = sqlite3.Row
            page_size = connection.execute('PRAGMA page_size').fetchone()[0]
            max_pages = max(1, (self.storage_limit - STORAGE_RESERVE) // page_size)
            connection.execute(f'PRAGMA max_page_count={max_pages}')
            with connection:
                yield connection
        finally:
            connection.close()

    def insert(self, report, body):
        digest = hashlib.sha256(body).hexdigest()
        with self.lock, self.connect() as connection:
            previous = connection.execute('SELECT id, number, created_at, digest FROM reports WHERE id=?', (report['id'],)).fetchone()
            if previous:
                if previous['digest'] != digest:
                    raise ReportError(409, 'Diese Meldungs-ID wurde bereits mit anderem Inhalt verwendet.')
                return {'id': previous['id'], 'number': previous['number'], 'createdAt': previous['created_at']}
            used = sum(path.stat().st_size for path in self.directory.iterdir() if path.is_file())
            required = len(body) * 3 + 1024 * 1024
            if used + required + STORAGE_RESERVE > self.storage_limit or shutil.disk_usage(self.directory).free < required + STORAGE_RESERVE:
                raise ReportError(507, 'Der Meldungsspeicher ist voll. Bitte die Meldung als Datei sichern.')
            created = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
            cursor = connection.execute('INSERT INTO reports (id,app,captured_at,created_at,description,has_preview,digest,body) VALUES (?,?,?,?,?,?,?,?)', (report['id'], report['app'], report['capturedAt'], created, report.get('description', ''), int('preview' in report), digest, body))
            return {'id': report['id'], 'number': cursor.lastrowid, 'createdAt': created}

    def listing(self, limit, offset):
        with self.lock, self.connect() as connection:
            total = connection.execute('SELECT COUNT(*) FROM reports').fetchone()[0]
            rows = connection.execute('SELECT id,number,app,captured_at,created_at,description,has_preview FROM reports ORDER BY number DESC LIMIT ? OFFSET ?', (limit, offset)).fetchall()
        return {'reports': [{'id': row['id'], 'number': row['number'], 'app': row['app'], 'capturedAt': row['captured_at'], 'createdAt': row['created_at'], 'description': row['description'], 'hasPreview': bool(row['has_preview'])} for row in rows], 'total': total}

    def detail(self, identifier):
        with self.lock, self.connect() as connection:
            row = connection.execute('SELECT number,created_at,body FROM reports WHERE id=?', (identifier,)).fetchone()
        if not row:
            raise ReportError(404, 'Die Meldung wurde nicht gefunden.')
        report = json.loads(row['body'])
        report.update(number=row['number'], createdAt=row['created_at'])
        return report


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, archive, public_origin=None):
        self.archive, self.public_origin = archive, public_origin
        self.slots = threading.BoundedSemaphore(12)
        self.upload_slots = threading.BoundedSemaphore(2)
        self.rate_lock, self.requests = threading.Lock(), {}
        super().__init__(address, Handler)

    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(10)
        return connection, address

    def process_request(self, request, address):
        if not self.slots.acquire(blocking=False):
            try:
                request.sendall(b'HTTP/1.0 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
            except OSError:
                pass
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.slots.release()

    def allow_request(self, client):
        now = time.monotonic()
        with self.rate_lock:
            self.requests = {key: stamps for key, stamps in self.requests.items() if stamps[-1] > now - 3600}
            stamps = [stamp for stamp in self.requests.get(client, []) if stamp > now - 3600]
            if sum(stamp > now - 60 for stamp in stamps) >= 6 or len(stamps) >= 60 or client not in self.requests and len(self.requests) >= 10000:
                return False
            self.requests[client] = stamps + [now]
            return True


class Handler(BaseHTTPRequestHandler):
    server_version = 'ProblemReports/1.0'

    def log_message(self, format, *args):
        # Paths, report content, and browser-supplied headers do not enter access logs.
        pass

    def reply(self, status, data, content_type='application/json; charset=utf-8', attachment=None):
        raw = data if isinstance(data, bytes) else json.dumps(data, ensure_ascii=False, allow_nan=False).encode()
        self.close_connection = True
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; sandbox")
        self.send_header('Connection', 'close')
        if attachment:
            self.send_header('Content-Disposition', f'attachment; filename="{attachment}"')
        if status == 429:
            self.send_header('Retry-After', '60')
        self.end_headers()
        if self.command != 'HEAD':
            try:
                self.wfile.write(raw)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def permitted_host(self):
        hosts = self.headers.get_all('Host', [])
        return len(hosts) == 1 and hosts[0] in {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}

    def do_POST(self):
        if not self.server.upload_slots.acquire(blocking=False):
            return self.reply(503, {'error': 'Der Meldungsdienst ist beschäftigt. Bitte erneut versuchen oder als Datei sichern.'})
        try:
            return self.post_report()
        finally:
            self.server.upload_slots.release()

    def post_report(self):
        if not self.permitted_host():
            return self.reply(403, {'error': 'Nur der lokale Proxy ist erlaubt.'})
        if self.path != PUBLIC_PATH:
            return self.reply(404, {'error': 'Nicht gefunden.'})
        origin = self.server.public_origin or f'http://{self.headers["Host"]}'
        if self.headers.get_all('Origin', []) != [origin] or self.headers.get('Sec-Fetch-Site') not in {None, 'same-origin', 'none'}:
            return self.reply(403, {'error': 'Anfragen sind nur von der zugehörigen Oberfläche erlaubt.'})
        if self.headers.get_content_type() != 'application/json' or self.headers.get_all('Transfer-Encoding'):
            return self.reply(415, {'error': 'Bitte JSON senden.'})
        lengths = self.headers.get_all('Content-Length', [])
        if len(lengths) != 1 or len(lengths[0]) > 10 or not lengths[0].isdigit() or not 0 < int(lengths[0]) <= MAX_BODY:
            return self.reply(413, {'error': 'Die Meldung fehlt oder ist größer als 32 MiB.'})
        if self.server.public_origin:
            clients = self.headers.get_all('X-Problem-Report-Client', [])
            try:
                client = str(ipaddress.ip_address(clients[0])) if len(clients) == 1 else None
            except ValueError:
                client = None
            if client is None:
                return self.reply(403, {'error': 'Die vertrauenswürdige Proxy-Adresse fehlt.'})
        else:
            client = self.client_address[0]
        if not self.server.allow_request(client):
            return self.reply(429, {'error': 'Zu viele Meldungen. Bitte später erneut versuchen oder die Meldung herunterladen.'})
        try:
            raw = self.rfile.read(int(lengths[0]))
            if len(raw) != int(lengths[0]):
                raise ValueError('Die Meldung wurde unvollständig übertragen.')
            def finite(_):
                raise ValueError('Nicht endliche Zahlen sind nicht erlaubt.')
            def unique_fields(pairs):
                result = {}
                for key, value in pairs:
                    if key in result:
                        raise ValueError('Doppelte JSON-Feldnamen sind nicht erlaubt.')
                    result[key] = value
                return result
            report = json.loads(raw, parse_constant=finite, object_pairs_hook=unique_fields)
            validate_report(report)
            body = json.dumps(report, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()
            if len(body) > MAX_BODY:
                raise ReportError(413, 'Die gespeicherte Meldung wäre größer als 32 MiB. Bitte als Datei sichern.')
            result = self.server.archive.insert(report, body)
            return self.reply(201, result)
        except ReportError as error:
            return self.reply(error.status, {'error': error.message})
        except (ValueError, TypeError, UnicodeError, RecursionError):
            return self.reply(422, {'error': 'Die Meldung enthält ungültige Daten oder eine ungültige PNG-Vorschau.'})
        except TimeoutError:
            return self.reply(408, {'error': 'Die Übertragung hat zu lange gedauert. Die Meldung kann erneut gesendet werden.'})
        except (sqlite3.Error, OSError):
            return self.reply(507, {'error': 'Die Meldung konnte nicht gespeichert werden. Bitte erneut versuchen oder als Datei sichern.'})

    def do_GET(self):
        if not self.permitted_host():
            return self.reply(403, {'error': 'Nur der lokale Proxy ist erlaubt.'})
        route = urlsplit(self.path)
        try:
            if route.path == '/health' and not route.query:
                return self.reply(200, {'status': 'ok'})
            if route.path == PUBLIC_PATH:
                return self.reply(405, {'error': 'Hier ist nur POST erlaubt.'})
            if route.path == ADMIN_PATH:
                query = parse_qs(route.query, keep_blank_values=True)
                if set(query) - {'limit', 'offset'} or any(len(values) != 1 for values in query.values()):
                    raise ReportError(400, 'Ungültige Seitenauswahl.')
                try:
                    limit, offset = int(query.get('limit', ['50'])[0]), int(query.get('offset', ['0'])[0])
                except (ValueError, OverflowError):
                    raise ReportError(400, 'Ungültige Seitenauswahl.')
                if not 1 <= limit <= 50 or not 0 <= offset <= 2147483647:
                    raise ReportError(400, 'Ungültige Seitenauswahl.')
                return self.reply(200, self.server.archive.listing(limit, offset))
            match = re.fullmatch(re.escape(ADMIN_PATH) + r'/([0-9a-f-]{36})(?:/(download|preview))?', route.path)
            if not match or route.query:
                raise ReportError(404, 'Nicht gefunden.')
            identifier, action = match.groups()
            if str(uuid.UUID(identifier)) != identifier:
                raise ReportError(404, 'Nicht gefunden.')
            report = self.server.archive.detail(identifier)
            if action == 'preview':
                if 'preview' not in report:
                    raise ReportError(404, 'Die Meldung enthält keine Vorschau.')
                return self.reply(200, png_bytes(report['preview']), 'image/png')
            return self.reply(200, report, attachment=f'problem-report-{identifier}.json' if action == 'download' else None)
        except ReportError as error:
            return self.reply(error.status, {'error': error.message})
        except (ValueError, TypeError, RecursionError):
            return self.reply(400, {'error': 'Ungültige Anfrage.'})
        except (sqlite3.Error, OSError):
            return self.reply(503, {'error': 'Der Meldungsspeicher ist momentan nicht erreichbar.'})

    def do_HEAD(self):
        self.do_GET()

    def do_OPTIONS(self):
        self.reply(405, {'error': 'Diese Methode wird nicht unterstützt.'})

    do_PUT = do_DELETE = do_PATCH = do_OPTIONS


def main():
    parser = argparse.ArgumentParser(description='Zentraler Meldungsspeicher hinter Apache')
    parser.add_argument('--port', type=int, default=8770)
    parser.add_argument('--data-dir', type=Path, required=True)
    parser.add_argument('--public-origin')
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error('Port muss zwischen 1024 und 65535 liegen.')
    if args.public_origin:
        origin = urlsplit(args.public_origin)
        if origin.scheme != 'https' or not origin.hostname or origin.username or origin.password or origin.path or origin.query or origin.fragment or origin.netloc != origin.netloc.lower():
            parser.error('Der öffentliche Ursprung muss eine exakte HTTPS-Adresse ohne Pfad sein.')
    os.umask(0o077)
    server = Server(('127.0.0.1', args.port), Archive(args.data_dir), args.public_origin)
    print(f'Meldungsdienst: http://127.0.0.1:{args.port} (Archivzugriff durch Apache schützen)', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
