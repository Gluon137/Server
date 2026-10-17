"""Run the browser/report/archive flow against disposable real SQLite + HTTP services."""
from contextlib import ExitStack
from functools import partial
import http.client
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import threading

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('problem_reports', ROOT / '.server-tools/problem-reports/server.py')
backend = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(backend)
PLAYWRIGHT = Path('/Users/Rauh/.npm/_npx/31e32ef8478fbf80/node_modules/playwright/index.mjs')


class Proxy(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.mjs': 'text/javascript', '.js': 'text/javascript'}

    def log_message(self, *args):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        if self.path.startswith('/problem-reports/') and not self.path.startswith('/problem-reports/api/'):
            self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'")
        super().end_headers()

    def forward(self):
        length = int(self.headers.get('Content-Length', '0'))
        body = self.rfile.read(length) if length else None
        connection = http.client.HTTPConnection('127.0.0.1', self.server.backend_port, timeout=15)
        headers = {name: value for name, value in self.headers.items() if name.lower() not in {'host', 'connection', 'x-problem-report-client'}}
        headers['X-Problem-Report-Client'] = '203.0.113.15'
        connection.request(self.command, self.path, body, headers)
        response = connection.getresponse()
        status, response_headers, content = response.status, response.getheaders(), response.read()
        connection.close()
        with self.server.drop_lock:
            lose_response = self.command == 'POST' and status == 201 and self.server.drop_first_receipt
            if lose_response:
                self.server.drop_first_receipt = False
        if lose_response:
            # SQLite committed; simulate the browser never receiving that successful receipt.
            self.close_connection = True
            try:
                self.connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            return
        self.send_response(status)
        for key, value in response_headers:
            if key.lower() not in {'server', 'date', 'connection'}:
                self.send_header(key, value)
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(content)

    def do_GET(self):
        if self.path.startswith('/problem-reports/api/'):
            return self.forward()
        return super().do_GET()

    def do_POST(self):
        if self.path == '/api/problem-reports':
            return self.forward()
        self.send_error(404)


def start(server, stack):
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    stack.callback(thread.join)
    stack.callback(server.server_close)
    stack.callback(server.shutdown)


def main():
    if not PLAYWRIGHT.is_file() or not shutil.which('node'):
        raise SystemExit('This test requires the existing cached Playwright module and Node; no dependencies are installed.')
    browsers = list((Path.home() / 'Library/Caches/ms-playwright').glob('chromium_headless_shell-*/chrome-headless-shell-mac-arm64/chrome-headless-shell'))
    if not browsers:
        raise SystemExit('No existing cached Chromium headless shell found; this test does not download browsers.')
    executable = max(browsers, key=lambda path: int(path.parents[1].name.rsplit('-', 1)[1]))
    with ExitStack() as stack:
        directory = stack.enter_context(tempfile.TemporaryDirectory(prefix='report-integration-'))
        archive = backend.Archive(directory)
        service = backend.Server(('127.0.0.1', 0), archive)
        proxy = ThreadingHTTPServer(('127.0.0.1', 0), partial(Proxy, directory=str(ROOT / 'website')))
        proxy.daemon_threads = True
        proxy.backend_port = service.server_port
        proxy.drop_first_receipt = True
        proxy.drop_lock = threading.Lock()
        origin = f'http://127.0.0.1:{proxy.server_port}'
        service.public_origin = origin
        start(service, stack)
        start(proxy, stack)
        runner = '''
const { chromium } = await import(process.argv[1]);
const { runProblemReportsArchiveBrowserTests } = await import(process.argv[2]);
const browser = await chromium.launch({executablePath:process.argv[4],headless:true,args:['--enable-unsafe-swiftshader','--use-gl=angle','--use-angle=swiftshader']});
try {
  const context = await browser.newContext({viewport:{width:1400,height:1000},acceptDownloads:true});
  const page = await context.newPage();
  console.log(JSON.stringify(await runProblemReportsArchiveBrowserTests(page,process.argv[3])));
} finally { await browser.close(); }
'''
        completed = subprocess.run(['node', '--input-type=module', '-e', runner, PLAYWRIGHT.as_uri(), (ROOT / 'tests/problem-reports-archive-browser.mjs').as_uri(), origin, str(executable)], capture_output=True, text=True, timeout=120)
        if completed.stdout:
            print(completed.stdout.strip())
        if completed.stderr:
            print(completed.stderr.strip())
        if completed.returncode:
            raise SystemExit(completed.returncode)
        print(json.dumps({'status': 'passed', 'storedReports': archive.listing(50, 0)['total'], 'temporaryDatabaseRemovedOnExit': True}))


if __name__ == '__main__':
    main()
