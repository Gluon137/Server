"""Real loopback HTTP tests; no production server, credentials or persistent files."""
import base64
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import hashlib
import http.client
import importlib.util
import json
from pathlib import Path
import socket
import struct
import tempfile
import threading
import unittest
from unittest.mock import patch
import uuid
import zlib

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('problem_reports', ROOT / '.server-tools/problem-reports/server.py')
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)
ORIGIN = 'https://studio.example.test'


def png(width=1, height=1, pixels=None):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    pixels = pixels if pixels is not None else b'\x00\xff\x00\x00\xff' * height
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(pixels)) + chunk(b'IEND', b'')


def report(**changes):
    data = {'version': 1, 'id': str(uuid.uuid4()), 'app': 'box-studio', 'capturedAt': '2026-10-16T10:00:00.000Z', 'description': '', 'snapshot': {'project': {'name': 'Original', 'svg': '<svg onload="alert(1)"><script>bad()</script></svg>'}, 'draft': {'points': [[1, 2]]}, 'invalidControl': '-'}, 'diagnostics': {'errors': ['<img src=x onerror=alert(1)>']}, 'environment': {'url': 'https://studio.example.test/box-studio/'}}
    data.update(changes)
    return data


@contextmanager
def service(public_origin=ORIGIN):
    with tempfile.TemporaryDirectory(prefix='problem-reports-test-') as directory:
        archive = module.Archive(directory)
        server = module.Server(('127.0.0.1', 0), archive, public_origin)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield server
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


def request(server, method='POST', path=module.PUBLIC_PATH, data=None, raw=None, headers=None, client='203.0.113.9'):
    connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=5)
    body = raw if raw is not None else json.dumps(data if data is not None else report()).encode()
    fields = {'Content-Type': 'application/json', 'Origin': ORIGIN, 'Sec-Fetch-Site': 'same-origin', 'X-Problem-Report-Client': client}
    fields.update(headers or {})
    connection.request(method, path, body if method == 'POST' else None, fields)
    response = connection.getresponse()
    status, response_headers, content = response.status, dict(response.getheaders()), response.read()
    connection.close()
    return status, response_headers, content


class ReportTests(unittest.TestCase):
    def test_round_trip_idempotency_order_download_and_preview(self):
        with service() as server:
            first = report(preview=module.PNG_PREFIX + base64.b64encode(png()).decode())
            status, _, body = request(server, data=first)
            self.assertEqual(status, 201)
            receipt = json.loads(body)
            self.assertEqual(receipt['id'], first['id'])
            again = request(server, raw=json.dumps(first, indent=3, sort_keys=True).encode())
            self.assertEqual(json.loads(again[2]), receipt)
            self.assertEqual(request(server, data={**first, 'description': 'changed'})[0], 409)
            second = report(app='landing', description='A new report')
            self.assertEqual(request(server, data=second)[0], 201)
            status, _, body = request(server, 'GET', module.ADMIN_PATH + '?limit=1&offset=0')
            listing = json.loads(body)
            self.assertEqual(status, 200)
            self.assertEqual(listing['total'], 2)
            self.assertEqual(listing['reports'][0]['id'], second['id'])
            self.assertNotIn('snapshot', listing['reports'][0])
            detail_path = module.ADMIN_PATH + '/' + first['id']
            status, headers, body = request(server, 'GET', detail_path + '/download')
            stored = json.loads(body)
            self.assertEqual(status, 200)
            self.assertEqual(stored['snapshot'], first['snapshot'])
            self.assertEqual(stored['diagnostics'], first['diagnostics'])
            self.assertEqual(stored['createdAt'], receipt['createdAt'])
            self.assertTrue(headers['Content-Disposition'].startswith('attachment;'))
            self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')
            self.assertEqual(headers['Cache-Control'], 'no-store')
            status, headers, body = request(server, 'GET', detail_path + '/preview')
            self.assertEqual((status, headers['Content-Type'], body), (200, 'image/png', png()))
            self.assertEqual(request(server, 'HEAD', detail_path)[2], b'')

    def test_automaten_report_acceptance_and_download(self):
        with service() as server:
            snapshot = {'document': {'version': 1, 'mechanism': 'slider-crank', 'figure': {'kind': 'bird'}}, 'angle': 90}
            submitted = report(app='automaten-studio', snapshot=snapshot)
            status, _, body = request(server, data=submitted)
            self.assertEqual(status, 201)
            receipt = json.loads(body)
            downloaded = request(server, 'GET', module.ADMIN_PATH + '/' + receipt['id'] + '/download')
            self.assertEqual(downloaded[0], 200)
            self.assertEqual(json.loads(downloaded[2])['app'], 'automaten-studio')
            self.assertEqual(json.loads(downloaded[2])['snapshot'], snapshot)
            self.assertEqual(request(server, data=report(app='unknown-studio'))[0], 422)

    def test_boundaries_and_host_origin_checks(self):
        with service() as server:
            cases = [({'Origin': 'https://evil.test'}, 403), ({'Origin': ''}, 403), ({'Host': 'evil.test'}, 403), ({'Sec-Fetch-Site': 'cross-site'}, 403), ({'Content-Type': 'text/plain'}, 415), ({'Transfer-Encoding': 'chunked'}, 415), ({'Content-Length': str(module.MAX_BODY + 1)}, 413), ({'Content-Length': '0'}, 413), ({'X-Problem-Report-Client': 'spoofed'}, 403)]
            for headers, expected in cases:
                with self.subTest(headers=headers):
                    self.assertEqual(request(server, headers=headers)[0], expected)
            self.assertEqual(request(server, path=module.PUBLIC_PATH + 'extra')[0], 404)
            self.assertEqual(request(server, 'GET')[0], 405)
            self.assertEqual(request(server, 'HEAD')[0], 405)
            self.assertEqual(request(server, 'OPTIONS')[0], 405)
            self.assertEqual(request(server, 'DELETE', module.ADMIN_PATH)[0], 405)
            self.assertEqual(request(server, 'GET', '/health')[0], 200)
            self.assertEqual(request(server, 'GET', module.ADMIN_PATH + '?limit=51')[0], 400)
            self.assertEqual(request(server, 'GET', module.ADMIN_PATH + '?offset=-1')[0], 400)
            self.assertEqual(request(server, 'GET', module.ADMIN_PATH + '?limit=1&limit=2')[0], 400)

    def test_invalid_json_schema_numbers_and_preview(self):
        with service() as server:
            invalid = [b'{', b'{"version":1,"version":2}', b'{"n":NaN}', b'[]', json.dumps(report(id='bad')).encode(), json.dumps(report(snapshot=[])).encode(), json.dumps(report(capturedAt='2026-10-16')).encode(), json.dumps(report(description='x' * 12001)).encode(), json.dumps(report(preview='data:image/svg+xml;base64,PHN2Zz4=')).encode(), json.dumps(report(snapshot={'bad': float('inf')})).encode(), json.dumps(report(number=99)).encode()]
            for index, raw in enumerate(invalid):
                with self.subTest(index=index):
                    self.assertEqual(request(server, raw=raw, client=f'203.0.113.{index + 20}')[0], 422)
            self.assertEqual(json.loads(request(server, 'GET', module.ADMIN_PATH)[2])['total'], 0)

    def test_png_validation_rejects_crc_dimensions_trailing_and_bomb(self):
        good = png()
        self.assertEqual(module.png_bytes(module.PNG_PREFIX + base64.b64encode(good).decode()), good)
        damaged = bytearray(good)
        damaged[-1] ^= 1
        candidates = [bytes(damaged), good + b'<script>', png(width=2049), png(pixels=b'\x00' * 1000000), png(pixels=b'\x05' + b'\x00' * 4)]
        for raw in candidates:
            with self.subTest(digest=hashlib.sha256(raw).hexdigest()[:8]):
                with self.assertRaises(ValueError):
                    module.png_bytes(module.PNG_PREFIX + base64.b64encode(raw).decode())
        metadata = b'profile\0\0' + zlib.compress(b'X' * 1000000)
        chunk = struct.pack('>I', len(metadata)) + b'iCCP' + metadata + struct.pack('>I', zlib.crc32(b'iCCP' + metadata) & 0xffffffff)
        with_metadata = good[:33] + chunk + good[33:]
        self.assertEqual(module.png_bytes(module.PNG_PREFIX + base64.b64encode(with_metadata).decode()), good)

    def test_storage_limit_disk_full_and_retries_preserve_existing(self):
        with service() as server:
            first = report()
            receipt = request(server, data=first)
            self.assertEqual(receipt[0], 201)
            server.archive.storage_limit = module.STORAGE_RESERVE + server.archive.path.stat().st_size + 100
            self.assertEqual(request(server, data=report())[0], 507)
            self.assertEqual(request(server, data=first)[2], receipt[2])
            server.archive.storage_limit = module.MAX_STORAGE
            with patch.object(module.shutil, 'disk_usage', return_value=type('Disk', (), {'free': 1})()):
                self.assertEqual(request(server, data=report())[0], 507)
            self.assertEqual(json.loads(request(server, 'GET', module.ADMIN_PATH)[2])['total'], 1)

    def test_concurrent_identical_posts_and_bounded_uploads(self):
        with service() as server:
            data = report()
            with ThreadPoolExecutor(max_workers=2) as pool:
                responses = list(pool.map(lambda _: request(server, data=data), range(2)))
            self.assertEqual([result[0] for result in responses], [201, 201])
            self.assertEqual(responses[0][2], responses[1][2])
            self.assertEqual(json.loads(request(server, 'GET', module.ADMIN_PATH)[2])['total'], 1)
            server.upload_slots.acquire()
            server.upload_slots.acquire()
            try:
                self.assertEqual(request(server)[0], 503)
            finally:
                server.upload_slots.release()
                server.upload_slots.release()

    def test_proxy_identity_rate_limit_and_local_origin(self):
        with service() as server:
            for _ in range(6):
                self.assertEqual(request(server)[0], 201)
            self.assertEqual(request(server, headers={'X-Forwarded-For': '192.0.2.200'})[0], 429)
            self.assertEqual(request(server, client='2001:db8::1')[0], 201)
            self.assertEqual(request(server, headers={'X-Problem-Report-Client': ''})[0], 403)
        with service(public_origin=None) as server:
            self.assertEqual(request(server)[0], 403)
            self.assertEqual(request(server, headers={'Origin': f'http://127.0.0.1:{server.server_port}'})[0], 201)

    def test_duplicate_framing_headers(self):
        with service() as server:
            body = json.dumps(report()).encode()
            request_bytes = (f'POST {module.PUBLIC_PATH} HTTP/1.1\r\nHost: 127.0.0.1:{server.server_port}\r\nOrigin: {ORIGIN}\r\nX-Problem-Report-Client: 203.0.113.9\r\nContent-Type: application/json\r\nContent-Length: {len(body)}\r\nContent-Length: {len(body)}\r\nConnection: close\r\n\r\n').encode() + body
            with socket.create_connection(('127.0.0.1', server.server_port), timeout=5) as connection:
                connection.sendall(request_bytes)
                self.assertIn(b' 413 ', connection.recv(1024).split(b'\r\n')[0])


if __name__ == '__main__':
    unittest.main(verbosity=2)
