"""Deploy the studio only, retaining a server-side rollback snapshot."""
from pathlib import Path
import os
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]
HOST = "root@v2202606364772466585.supersrv.de"
env = os.environ.copy()
env.update(SSH_ASKPASS=str(ROOT / ".server-tools/askpass.py"), SSH_ASKPASS_REQUIRE="force", DISPLAY=":0")

remote = r'''
from pathlib import Path
import json, shutil, subprocess, tarfile, time
from urllib.request import urlopen

root = Path('/opt/baustein-studio')
backup = Path('/var/backups') / time.strftime('baustein-studio-%Y%m%d-%H%M%S', time.gmtime())
backup.mkdir()
conf = Path('/etc/apache2/sites-available/limescope.conf')
web = Path('/var/www/html/baustein-studio')
landing = Path('/var/www/html/index.html')
unit = Path('/etc/systemd/system/baustein-studio.service')
for path in (conf, landing, unit):
    if path.exists(): shutil.copy2(path, backup / path.name)
if web.exists(): shutil.copytree(web, backup / 'baustein-studio')
if (root / 'website').exists(): shutil.copytree(root / 'website', backup / 'website')
was_active = subprocess.run(['systemctl', 'is-active', '--quiet', 'baustein-studio']).returncode == 0

try:
    with tarfile.open('/tmp/baustein-studio-deploy.tgz') as package:
        package.extractall(root, filter='data')
    backend = root / 'website/baustein-studio/backend'
    subprocess.run([str(root / 'venv/bin/python'), '-m', 'pip', 'check'], check=True)
    for test in ('bausteine.py', 'baustein-complex.py', 'baustein-assembly.py'):
        subprocess.run([str(root / 'venv/bin/python'), str(root / 'tests' / test)], check=True)
    shutil.copy2(backend / 'baustein-studio.service', unit)
    subprocess.run(['systemctl', 'daemon-reload'], check=True)
    subprocess.run(['systemctl', 'restart', 'baustein-studio'], check=True)
    for attempt in range(50):
        try:
            with urlopen('http://127.0.0.1:8766/api/health', timeout=1) as response:
                assert json.load(response)['status'] == 'ok'
            break
        except OSError:
            time.sleep(.1)
    else: raise RuntimeError('Service did not become ready')
    if web.exists(): shutil.rmtree(web)
    shutil.copytree(root / 'website/baustein-studio', web, ignore=shutil.ignore_patterns('backend', '__pycache__', '*.pyc'))
    shutil.copy2(backend / 'BOXES-LICENSE.txt', web / 'BOXES-LICENSE.txt')
    shutil.copy2(root / 'website/index.html', landing)
    text = conf.read_text()
    include = '    Include /opt/baustein-studio/website/baustein-studio/backend/apache-baustein-studio.conf'
    if include not in text:
        marker = '    Include /opt/workshop-zuordnung-server/deploy/apache-workshop-zuordnung.conf'
        assert marker in text, 'Expected HTTPS virtual host not found'
        text = text.replace(marker, marker + '\n' + include)
    redirect = '    RedirectMatch 308 ^/baustein-studio(?:/(.*))?$ https://v2202606364772466585.supersrv.de/baustein-studio/$1'
    if redirect not in text: text = text.replace('</VirtualHost>', redirect + '\n</VirtualHost>', 1)
    conf.write_text(text)
    subprocess.run(['apache2ctl', 'configtest'], check=True)
    subprocess.run(['systemctl', 'reload', 'apache2'], check=True)
    subprocess.run(['systemctl', 'enable', 'baustein-studio'], check=True)
except Exception:
    shutil.copy2(backup / conf.name, conf)
    shutil.copy2(backup / landing.name, landing)
    if web.exists(): shutil.rmtree(web)
    if (backup / 'baustein-studio').exists(): shutil.copytree(backup / 'baustein-studio', web)
    subprocess.run(['systemctl', 'stop', 'baustein-studio'])
    if (backup / 'website').exists():
        shutil.rmtree(root / 'website')
        shutil.copytree(backup / 'website', root / 'website')
    if (backup / unit.name).exists(): shutil.copy2(backup / unit.name, unit)
    else: unit.unlink(missing_ok=True)
    subprocess.run(['systemctl', 'daemon-reload'])
    if was_active: subprocess.run(['systemctl', 'restart', 'baustein-studio'])
    subprocess.run(['systemctl', 'reload', 'apache2'])
    raise
print('Deployment ready; rollback snapshot:', backup)
'''

with tempfile.TemporaryDirectory(prefix="baustein-deploy-") as temporary:
    archive = Path(temporary) / "studio.tgz"
    with tarfile.open(archive, "w:gz") as package:
        files = [ROOT / "website/index.html"]
        files += [path for path in (ROOT / "website/baustein-studio").rglob("*") if path.is_file() and "__pycache__" not in path.parts and path.suffix != ".pyc"]
        files += [ROOT / "tests" / name for name in ("bausteine.py", "baustein-complex.py", "baustein-assembly.py")]
        for path in files:
            package.add(path, arcname=str(path.relative_to(ROOT)), recursive=False)
    subprocess.run(["scp", str(archive), HOST + ":/tmp/baustein-studio-deploy.tgz"], env=env, check=True)
    subprocess.run(["ssh", HOST, "python3 -"], input=remote, text=True, env=env, check=True)
