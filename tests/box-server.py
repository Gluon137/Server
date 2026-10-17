"""HTTP boundary checks for the local service (run with the studio venv)."""
import json
from pathlib import Path
import socket
import subprocess
import sys
import time
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]


class LocalServiceTests(unittest.TestCase):
    public_origin = None
    @classmethod
    def setUpClass(cls):
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            cls.port = sock.getsockname()[1]
        cls.url = f"http://127.0.0.1:{cls.port}"
        command = [sys.executable, str(ROOT / "website/box-studio/backend/server.py"), "--port", str(cls.port)]
        if cls.public_origin:
            command += ["--public-origin", cls.public_origin]
        cls.process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(100):
            try:
                with urlopen(cls.url + "/api/health", timeout=1):
                    return
            except OSError:
                time.sleep(.05)
        cls.process.terminate()
        raise RuntimeError("Lokaler Dienst startet nicht.")

    @classmethod
    def tearDownClass(cls):
        cls.process.terminate()
        cls.process.wait(timeout=5)

    def request(self, path, data=None, headers=None):
        request = Request(self.url + path, data=data, headers=headers or {})
        try:
            response = urlopen(request, timeout=40)
        except HTTPError as error:
            response = error
        with response:
            return response.code, response.headers, response.read()

    def test_health_and_defaults(self):
        status, _, body = self.request("/api/health")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["localOnly"], not bool(self.public_origin))
        self.assertEqual(json.loads(self.request("/api/defaults")[2])["version"], 1)

    def test_namespaced_api(self):
        self.assertEqual(self.request("/box-studio/api/health")[0], 200)
        project = json.loads(self.request("/box-studio/api/defaults")[2])
        status, _, body = self.request("/box-studio/api/build", json.dumps(project).encode(), {"Content-Type": "application/json", "Origin": self.public_origin or self.url})
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(body)["valid"])
        if not self.public_origin:
            self.assertEqual(self.request("/api/build", b'{}', {"Content-Type": "application/json", "Origin": "https://studio.example"})[0], 403)

    def test_process_start_failure_releases_slot(self):
        import importlib.util
        from io import BytesIO
        from unittest.mock import Mock, patch
        spec = importlib.util.spec_from_file_location("studio_http", ROOT / "website/box-studio/backend/server.py")
        server = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(server)
        handler = object.__new__(server.Handler)
        from email.message import Message
        handler.headers = Message()
        for key, value in {"Host": "127.0.0.1:8767", "Content-Type": "application/json", "Content-Length": "2"}.items():
            handler.headers[key] = value
        handler.path = "/api/build"
        handler.server = Mock(server_port=8767, public_origin=None)
        handler.connection = Mock()
        handler.rfile = BytesIO(b'{}')
        handler.reply = Mock()
        process = Mock(pid=None)
        process.start.side_effect = OSError("Resource limit")
        context = Mock()
        context.Process.return_value = process
        context.Pipe.return_value = (Mock(), Mock())
        with patch.object(server.multiprocessing, "get_context", return_value=context), patch.object(server, "BUILD_SLOTS") as slots:
            slots.acquire.return_value = True
            handler.do_POST()
            slots.release.assert_called_once()
            process.join.assert_not_called()
            self.assertEqual(handler.reply.call_args.args[0], 503)

    def test_site_modules_and_boundary(self):
        status, headers, _ = self.request("/baustein-studio/vendor/three.module.js")
        self.assertEqual(status, 200)
        self.assertIn("javascript", headers["Content-Type"])
        self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
        self.assertEqual(self.request('/klappkarten-studio/vendor/NotoSans.ttf')[0],200)
        for path in ("/box-studio/backend/server.py", "/box-studio/backend/requirements.txt", "/%2e%2e/credentials.md", "/.git/config", "/box-studio/vendor/"):
            with self.subTest(path=path):
                self.assertEqual(self.request(path)[0], 404)

    def test_foreign_origin_and_host_blocked(self):
        raw = b'{}'
        self.assertEqual(self.request("/api/health", headers={"Host": "evil.example"})[0], 403)
        self.assertEqual(self.request("/api/build", raw, {"Content-Type": "application/json", "Origin": "https://evil.example"})[0], 403)
        self.assertEqual(self.request("/api/build", raw, {"Content-Type": "application/json", "Sec-Fetch-Site": "cross-site"})[0], 403)

    def test_bad_json_types_size_and_content_type(self):
        self.assertEqual(self.request("/api/build", b'{}', {"Content-Type": "text/plain"})[0], 415)
        for raw in (b'{', b'{"a":NaN}', b'[' * 1500 + b']' * 1500):
            self.assertEqual(self.request("/api/build", raw, {"Content-Type": "application/json"})[0], 422)
        self.assertEqual(self.request("/api/build", b'{}', {"Content-Type": "application/json", "Content-Length": str(4 * 1024 * 1024 + 1)})[0], 413)
        self.assertEqual(self.request("/api/build", b'{}', {"Content-Type": "application/json", "Content-Length": '9' * 5000})[0], 413)
        self.assertEqual(self.request("/api/build", b'{}', {"Content-Type": "application/json"})[0], 422)

    def test_real_build(self):
        project = json.loads(self.request("/api/defaults")[2])
        status, _, body = self.request("/api/build", json.dumps(project).encode(), {"Content-Type": "application/json", "Origin": self.url})
        self.assertEqual(status, 200)
        result = json.loads(body)
        self.assertTrue(result["valid"], result.get("errors"))
        self.assertEqual(len(result["parts"]), 7)
        self.assertTrue(result["sheets"])



class PublicServiceTests(LocalServiceTests):
    public_origin = "https://studio.example"

    def test_public_origin_exact_match(self):
        for origin in ("http://studio.example", "https://studio.example.evil", "https://studio.example/", "https://evil.example"):
            self.assertEqual(self.request("/box-studio/api/build", b'{}', {"Content-Type": "application/json", "Origin": origin})[0], 403)


if __name__ == "__main__":
    unittest.main()
