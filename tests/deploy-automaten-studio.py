"""Offline release preflight and rollback tests; no SSH, credentials or services."""
from contextlib import nullcontext
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('deploy_automaten', ROOT / '.server-tools/deploy-automaten-studio.py')
deploy = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(deploy)


def digest(data):
    return hashlib.sha256(data).hexdigest()


class ReleaseTests(unittest.TestCase):
    def fixture(self, directory):
        directory = Path(directory)
        web = directory / 'www';web.mkdir()
        server = directory / 'server.py';server.write_bytes(b'old server')
        conf = directory / 'apache.conf'
        conf.write_text('<VirtualHost *:80>\n</VirtualHost>\n<VirtualHost *:443>\n    Include /opt/klappkarten-studio/apache-klappkarten-studio.conf\n    Include /opt/problem-reports/apache-problem-reports.conf\n</VirtualHost>\n')
        snippet = directory / 'snippet.conf'
        (web / 'index.html').write_bytes(b'<meta name="workshop-build" content="abc123">old landing')
        files = {'index.html': b'new landing', 'service/server.py': b'new server', 'automaten-studio/index.html': b'new studio'}
        manifest = {'baseline': {'index.html': digest(b'old landing'), 'service/server.py': digest(b'old server')}, 'files': {name: digest(data) for name, data in files.items()}}
        preflight = deploy.PREFLIGHT.replace("Path('/var/www/html')", repr(web)).replace("Path('/etc/apache2/sites-available/limescope.conf')", repr(conf)).replace("Path('/opt/automaten-studio/apache-automaten-studio.conf')", repr(snippet)).replace("Path('/opt/problem-reports/server.py')", repr(server))
        # repr(Path) requires the class name to be present in the executed namespace.
        scope = {'PosixPath': Path, 'MANIFEST': manifest, 'CONFIGURATION': deploy.CONFIGURATION}
        return web, server, conf, snippet, files, manifest, preflight, scope

    def test_package_contains_only_reviewed_runtime_and_public_readme(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in deploy.BASELINES:
                path = root / ('.server-tools/problem-reports/server.py' if name == 'service/server.py' else 'website/' + name)
                path.parent.mkdir(parents=True, exist_ok=True);path.write_text('fixture')
            studio = root / 'website/automaten-studio';studio.mkdir()
            names = ('index.html', 'style.css', 'app.mjs', 'project.mjs', 'geometry.mjs', 'export.mjs', 'README.md')
            for name in names:
                (studio / name).write_text('public fixture')
            (studio / 'credentials.json').write_text('DO NOT PUBLISH')
            with patch.object(deploy, 'ROOT', root):
                sources = deploy.sources()
            self.assertEqual(sorted(name for name in sources if name.startswith('automaten-studio/')), sorted('automaten-studio/' + name for name in names))
            self.assertNotIn(b'DO NOT PUBLISH', sources.values())

    def test_preflight_preserves_build_meta_and_rejects_unreviewed_drift(self):
        with tempfile.TemporaryDirectory() as directory, patch('subprocess.run'):
            web, _, _, _, _, _, preflight, scope = self.fixture(directory)
            exec(preflight, scope)
            self.assertEqual(scope['state']['files']['index.html'], digest((web / 'index.html').read_bytes()))
            (web / 'index.html').write_text('unknown server edit')
            with self.assertRaisesRegex(AssertionError, 'Unreviewed server drift'):
                exec(preflight, scope)

    def test_failed_public_smoke_restores_every_file_and_removes_new_studio(self):
        with tempfile.TemporaryDirectory() as directory, patch('subprocess.run'):
            web, server, conf, snippet, files, manifest, preflight, scope = self.fixture(directory)
            original_conf = conf.read_bytes();original_landing = (web / 'index.html').read_bytes()
            exec(preflight, scope)
            archive = Path(directory) / 'release.tgz'
            with tarfile.open(archive, 'w:gz') as package:
                for name, raw in {**files, 'manifest.json': json.dumps(manifest).encode(), 'apache-automaten-studio.conf': deploy.CONFIGURATION.encode()}.items():
                    info = tarfile.TarInfo(name);info.size = len(raw);package.addfile(info, io.BytesIO(raw))
            backups = Path(directory) / 'backups';backups.mkdir()
            scope.update(EXPECTED=scope['state'], ARCHIVE=str(archive), TOKEN='test', PUBLIC='https://studio.test')
            remote = deploy.REMOTE.replace("Path('/var/backups')", repr(backups))
            def request(url, **kwargs):
                if isinstance(url, str) and url.endswith('/health'):
                    return nullcontext(io.BytesIO(b'{"status":"ok"}'))
                raise HTTPError('https://studio.test/', 500, 'Deliberate smoke failure', {}, io.BytesIO(b''))
            with patch('urllib.request.urlopen', side_effect=request):
                with self.assertRaisesRegex(AssertionError, 'HTTP checksum'):
                    exec(remote, scope)
            self.assertEqual((web / 'index.html').read_bytes(), original_landing)
            self.assertEqual(server.read_bytes(), b'old server')
            self.assertEqual(conf.read_bytes(), original_conf)
            self.assertFalse(snippet.exists())
            self.assertFalse((web / 'automaten-studio').exists())
            self.assertEqual(len(list(backups.glob('*/restore.json'))), 1)


if __name__ == '__main__':
    unittest.main(verbosity=2)
