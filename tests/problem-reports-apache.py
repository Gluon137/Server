"""Regression check against a disposable Apache and real backend; no credentials."""
from contextlib import ExitStack
import grp
import http.client
import importlib.util
import json
import os
from pathlib import Path
import pwd
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import uuid

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('problem_reports', ROOT / '.server-tools/problem-reports/server.py')
backend = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(backend)


def request(port, method, path, body=None):
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=5)
    connection.request(method, path, body, {'Content-Type': 'application/json', 'Origin': 'https://studio.example.test', 'X-Problem-Report-Client': 'forged-client'})
    response = connection.getresponse()
    result = response.status, response.read()
    connection.close()
    return result


def main():
    httpd = shutil.which('httpd') or '/usr/sbin/httpd'
    modules = next((path for path in (Path('/usr/libexec/apache2'), Path('/usr/lib/apache2/modules')) if path.is_dir()), None)
    if not Path(httpd).is_file() or modules is None:
        raise SystemExit('An existing Apache installation is required; nothing is installed by this test.')
    with ExitStack() as stack:
        directory = Path(stack.enter_context(tempfile.TemporaryDirectory(prefix='report-apache-test-')))
        directory.chmod(0o755)
        archive = backend.Archive(directory / 'data')
        service = backend.Server(('127.0.0.1', 0), archive, 'https://studio.example.test')
        thread = threading.Thread(target=service.serve_forever, daemon=True)
        thread.start()
        stack.callback(thread.join)
        stack.callback(service.server_close)
        stack.callback(service.shutdown)
        with socket.socket() as temporary:
            temporary.bind(('127.0.0.1', 0))
            port = temporary.getsockname()[1]
        snippet = (ROOT / '.server-tools/problem-reports/apache-problem-reports.conf').read_text().replace('127.0.0.1:8770', f'127.0.0.1:{service.server_port}')
        # No production credential file is read, copied or created.
        snippet = snippet.replace('/etc/apache2/.htpasswd-workshop-zuordnung', str(directory / 'unused-test-auth-file'))
        (directory / 'snippet.conf').write_text(snippet)
        web = directory / 'www'
        web.mkdir(mode=0o755)
        config = [f'ServerRoot "{directory}"', f'DefaultRuntimeDir "{directory}"', f'Mutex file:{directory} default', 'ServerName localhost', f'PidFile "{directory}/httpd.pid"', f'ErrorLog "{directory}/error.log"', f'Listen 127.0.0.1:{port}']
        for name in ('mpm_prefork', 'unixd', 'authn_core', 'authn_file', 'authz_core', 'authz_host', 'authz_user', 'auth_basic', 'headers', 'proxy', 'proxy_http', 'alias', 'mime'):
            library = modules / f'mod_{name}.so'
            if library.is_file():
                config.append(f'LoadModule {name}_module "{library}"')
        user, group = pwd.getpwuid(os.getuid()).pw_name, grp.getgrgid(os.getgid()).gr_name
        if os.getuid() == 0:
            user = '_www' if modules == Path('/usr/libexec/apache2') else 'www-data'
            group = user
        config += ['TypesConfig /dev/null', f'User {user}', f'Group {group}', f'<VirtualHost 127.0.0.1:{port}>', f'DocumentRoot "{web}"', f'<Directory "{web}">', 'Require all granted', '</Directory>', f'Include "{directory}/snippet.conf"', '</VirtualHost>']
        (directory / 'httpd.conf').write_text('\n'.join(config) + '\n')
        subprocess.run([httpd, '-t', '-f', str(directory / 'httpd.conf')], check=True, capture_output=True)
        apache = subprocess.Popen([httpd, '-X', '-f', str(directory / 'httpd.conf')], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            for _ in range(50):
                if apache.poll() is not None:
                    raise AssertionError((directory / 'error.log').read_text())
                try:
                    with socket.create_connection(('127.0.0.1', port), timeout=.1):
                        break
                except OSError:
                    time.sleep(.05)
            else:
                raise AssertionError('Temporary Apache did not start.')
            results = []
            for method, path, expected in [('GET', '/api/problem-reports', 403), ('HEAD', '/api/problem-reports', 403), ('GET', '/api/problem-reportsXYZ', 404), ('GET', '/problem-reports/', 401), ('HEAD', '/problem-reports/', 401), ('GET', '/problem-reports/api/reports', 401), ('GET', '/problem-reports/api/reports/example/download', 401), ('GET', '/problem-reports/api/reports/example/preview', 401)]:
                status, content = request(port, method, path)
                assert status == expected, (method, path, status, content[:200])
                results.append(f'{method} {path}: {status}')
            report = {'version': 1, 'id': str(uuid.uuid4()), 'app': 'landing', 'capturedAt': '2026-10-16T11:00:00Z', 'description': '', 'snapshot': {}, 'diagnostics': {}, 'environment': {}}
            status, content = request(port, 'POST', '/api/problem-reports', json.dumps(report).encode())
            assert status == 201, (status, content[:200])
            receipt = json.loads(content)
            assert receipt['id'] == report['id'] and archive.listing(50, 0)['total'] == 1
            results.append('POST exact route: 201; forged client header overwritten')
            print(json.dumps({'status': 'passed', 'checks': results}))
        finally:
            apache.terminate()
            apache.wait(timeout=5)


if __name__ == '__main__':
    main()
