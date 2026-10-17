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
        command = [sys.executable, str(ROOT / "website/baustein-studio/backend/server.py"), "--port", str(cls.port)]
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
            response = urlopen(request, timeout=25)
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
        self.assertEqual(self.request("/baustein-studio/api/health")[0], 200)
        project = json.loads(self.request("/baustein-studio/api/defaults")[2])
        status, _, body = self.request("/baustein-studio/api/build", json.dumps(project).encode(), {"Content-Type": "application/json", "Origin": self.public_origin or self.url})
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(body)["valid"])
        if not self.public_origin:
            self.assertEqual(self.request("/api/build", b'{}', {"Content-Type": "application/json", "Origin": "https://studio.example"})[0], 403)

    def test_process_start_failure_releases_slot(self):
        import importlib.util
        from io import BytesIO
        from unittest.mock import Mock, patch
        spec = importlib.util.spec_from_file_location("studio_http", ROOT / "website/baustein-studio/backend/server.py")
        server = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(server)
        handler = object.__new__(server.Handler)
        from email.message import Message
        handler.headers = Message()
        for key, value in {"Host": "127.0.0.1:8765", "Content-Type": "application/json", "Content-Length": "2"}.items():
            handler.headers[key] = value
        handler.path = "/api/build"
        handler.server = Mock(server_port=8765, public_origin=None)
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
        for path in ("/baustein-studio/backend/server.py", "/baustein-studio/backend/requirements.txt", "/%2e%2e/credentials.md", "/.git/config", "/baustein-studio/vendor/"):
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
        self.assertEqual(self.request("/api/build", b' ' * (256 * 1024 + 1), {"Content-Type": "application/json"})[0], 413)
        self.assertEqual(self.request("/api/build", b'{}', {"Content-Type": "application/json"})[0], 422)

    def test_real_build(self):
        project = json.loads(self.request("/api/defaults")[2])
        status, _, body = self.request("/api/build", json.dumps(project).encode(), {"Content-Type": "application/json", "Origin": self.url})
        self.assertEqual(status, 200)
        result = json.loads(body)
        self.assertTrue(result["valid"], result.get("errors"))
        self.assertEqual(result["metrics"]["panelCount"], 6)
        self.assertTrue(result["sheets"])

    def test_extended_assembly_builds(self):
        for name, sizes, heights in (
            ("four_towers", 100, [2, 1, 2, 1, 1, 1, 2, 1, 2]),
            ("preassembly", 60, [2, 3, 1, 1, 1, 1, 3, 2, 3]),
        ):
            with self.subTest(model=name):
                project = json.loads(self.request("/api/defaults")[2])
                project["axes"] = {axis: [sizes] * 3 for axis in "xyz"}
                project["cells"] = [[x, y, z] for x in range(3) for y in range(3)
                                    for z in range(heights[x * 3 + y])]
                status, _, body = self.request("/api/build", json.dumps(project).encode(), {"Content-Type": "application/json"})
                self.assertEqual(status, 200)
                result = json.loads(body)
                self.assertTrue(result["valid"], result.get("errors"))
                self.assertTrue(result["sheets"])
                operations = result["assemblyOperations"]
                self.assertTrue(all(len(op["translation"]) == 3 for op in operations))
                active = {panel["id"] for panel in result["panels"] if not panel["omitted"]}
                self.assertEqual(set(result["assembly"]), active)
                if name == "four_towers":
                    self.assertEqual(result["metrics"]["panelCount"], 18)
                    self.assertTrue(any(sum(value != 0 for value in op["translation"]) > 1 for op in operations))
                else:
                    self.assertTrue(any(op["kind"] == "group" for op in operations))
                    self.assertTrue(any(op["kind"] == "preassembly" for op in operations))


class PublicServiceTests(LocalServiceTests):
    public_origin = "https://studio.example"

    def test_public_origin_exact_match(self):
        for origin in ("http://studio.example", "https://studio.example.evil", "https://studio.example/", "https://evil.example"):
            self.assertEqual(self.request("/baustein-studio/api/build", b'{}', {"Content-Type": "application/json", "Origin": origin})[0], 403)


if __name__ == "__main__":
    unittest.main()
