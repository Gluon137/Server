"""Publish the box studio with a backup, smoke checks and automatic rollback."""
from pathlib import Path
import hashlib
import json
import os
import re
import subprocess
import tarfile
import tempfile
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
HOST = 'root@v2202606364772466585.supersrv.de'
env = os.environ.copy()
env.update(SSH_ASKPASS=str(ROOT / '.server-tools/askpass.py'), SSH_ASKPASS_REQUIRE='force', DISPLAY=':0')

REMOTE = r'''
from pathlib import Path
import hashlib, json, shutil, subprocess, tarfile, time
from urllib.request import Request, urlopen

root = Path('/opt/box-studio')
web = Path('/var/www/html/box-studio')
landing = Path('/var/www/html/index.html')
conf = Path('/etc/apache2/sites-available/limescope.conf')
unit = Path('/etc/systemd/system/box-studio.service')
backup = Path('/var/backups') / time.strftime('box-studio-%Y%m%d-%H%M%S', time.gmtime())
backup.mkdir()
for name, path in [('config',conf),('landing',landing),('unit',unit)]:
    if path.exists(): shutil.copy2(path, backup/name)
for name, path in [('web',web),('source',root/'website'),('tests',root/'tests')]:
    if path.exists(): shutil.copytree(path, backup/name)
active = subprocess.run(['systemctl','is-active','--quiet','box-studio']).returncode == 0
enabled = subprocess.run(['systemctl','is-enabled','--quiet','box-studio']).returncode == 0
try:
    root.mkdir(exist_ok=True)
    with tarfile.open(Path(__DEPLOY_DIRECTORY__) / 'studio.tgz') as archive:
        archive.extractall(root, filter='data')
    manifest = json.loads((root/'box-manifest.json').read_text())
    for relative, expected in manifest.items():
        assert hashlib.sha256((root/relative).read_bytes()).hexdigest() == expected, relative
    # The two studios intentionally share an identical pinned runtime.
    shared = Path('/opt/baustein-studio/venv')
    assert (shared/'bin/python').exists(), 'Existing Boxes.py runtime is required'
    if not (root/'venv').exists(): (root/'venv').symlink_to(shared, target_is_directory=True)
    python = str(root/'venv/bin/python')
    subprocess.run([python,'-m','pip','check'],check=True)
    subprocess.run([python,'-c',"import importlib.metadata,json; d=json.loads(importlib.metadata.distribution('boxes').read_text('direct_url.json')); assert d['vcs_info']['commit_id']=='b82a6c9f84ab4b9ee91f5621b95d80b1b4fadf8d', 'Unexpected Boxes.py revision'"],check=True)
    for test in ('box-geometry.py','box-motion.py'):
        subprocess.run([python,str(root/'tests'/test)],check=True)
    backend = root/'website/box-studio/backend'
    shutil.copy2(backend/'box-studio.service', unit)
    subprocess.run(['systemctl','daemon-reload'],check=True)
    subprocess.run(['systemctl','restart','box-studio'],check=True)
    for attempt in range(60):
        try:
            with urlopen('http://127.0.0.1:8767/api/health',timeout=1) as response:
                assert json.load(response)['status']=='ok'
            break
        except OSError: time.sleep(.1)
    else: raise RuntimeError('Service did not start')
    if web.exists(): shutil.rmtree(web)
    shutil.copytree(root/'website/box-studio',web,ignore=shutil.ignore_patterns('backend','__pycache__','*.pyc','tests'))
    shutil.copy2(backend/'BOXES-LICENSE.txt',web/'BOXES-LICENSE.txt')
    shutil.copy2(root/'website/index.html',landing)
    text = conf.read_text()
    include = '    Include /opt/box-studio/website/box-studio/backend/apache-box-studio.conf'
    if include not in text:
        marker = '    Include /opt/baustein-studio/website/baustein-studio/backend/apache-baustein-studio.conf'
        assert text.count(marker)==1, 'Expected HTTPS virtual host not found'
        text=text.replace(marker,marker+'\n'+include)
    redirect = '    RedirectMatch 308 ^/box-studio(?:/(.*))?$ https://v2202606364772466585.supersrv.de/box-studio/$1'
    if redirect not in text: text=text.replace('</VirtualHost>',redirect+'\n</VirtualHost>',1)
    conf.write_text(text)
    subprocess.run(['apache2ctl','configtest'],check=True)
    subprocess.run(['systemctl','reload','apache2'],check=True)
    public='https://v2202606364772466585.supersrv.de'
    with urlopen(public+'/box-studio/api/defaults',timeout=15) as response: project=json.load(response)
    request=Request(public+'/box-studio/api/build',data=json.dumps(project).encode(),headers={'Content-Type':'application/json','Origin':public})
    with urlopen(request,timeout=45) as response: result=json.load(response)
    assert result['valid'] and result['sheets'], result.get('errors')
    for relative in manifest:
        if relative.startswith('website/box-studio/') and '/backend/' not in relative and '/tests/' not in relative:
            with urlopen(public+'/'+relative.removeprefix('website/'),timeout=15) as response: raw=response.read()
            assert hashlib.sha256(raw).hexdigest()==manifest[relative], relative
    with urlopen(public+'/index.html',timeout=15) as response:
        assert hashlib.sha256(response.read()).hexdigest()==manifest['website/index.html']
    for dependency in ('/baustein-studio/vendor/three.module.js','/klappkarten-studio/svg.mjs','/klappkarten-studio/vendor/NotoSans.ttf'):
        with urlopen(public+dependency,timeout=15) as response: assert response.status==200
    subprocess.run(['systemctl','enable','box-studio'],check=True)
except Exception:
    for name,path in [('config',conf),('landing',landing),('unit',unit)]:
        if (backup/name).exists(): shutil.copy2(backup/name,path)
        elif name=='unit': path.unlink(missing_ok=True)
    for name,path in [('web',web),('source',root/'website'),('tests',root/'tests')]:
        if path.exists(): shutil.rmtree(path)
        if (backup/name).exists(): shutil.copytree(backup/name,path)
    subprocess.run(['systemctl','stop','box-studio'])
    if not enabled: subprocess.run(['systemctl','disable','box-studio'])
    subprocess.run(['systemctl','daemon-reload'])
    if active: subprocess.run(['systemctl','restart','box-studio'])
    subprocess.run(['systemctl','reload','apache2'])
    raise
print(json.dumps({'url':public+'/box-studio/','backup':str(backup),'parts':len(result['parts']),'sheets':len(result['sheets'])}))
'''

# Startseite und Studio laden die gemeinsame Gestaltung aus /shared/.
# Sie wird nur von deploy-workshop-updates.py veröffentlicht und muss vorher aktuell sein.
SHARED_DEPENDENCIES = ('shared/werkstatt.css', 'shared/werkstatt.mjs', 'shared/studios.mjs', 'shared/icons.svg')


def require_published_shared(public='https://v2202606364772466585.supersrv.de'):
    for name in SHARED_DEPENDENCIES:
        try:
            with urlopen(public + '/' + name, timeout=15) as response:
                published = hashlib.sha256(response.read()).hexdigest()
        except OSError as error:
            raise SystemExit(f'{name} ist auf dem Server nicht erreichbar ({error}). Zuerst .server-tools/deploy-workshop-updates.py ausführen.')
        if published != hashlib.sha256((ROOT / 'website' / name).read_bytes()).hexdigest():
            raise SystemExit(f'{name} ist auf dem Server nicht aktuell. Zuerst .server-tools/deploy-workshop-updates.py ausführen.')


require_published_shared()
with tempfile.TemporaryDirectory(prefix='box-studio-deploy-') as temporary:
    archive = Path(temporary)/'studio.tgz'
    files=[ROOT/'website/index.html']
    for directory in ('website/box-studio','website/baustein-studio/backend'):
        files.extend(path for path in (ROOT/directory).rglob('*') if path.is_file() and '__pycache__' not in path.parts and path.suffix!='.pyc')
    files.extend(ROOT/'tests'/name for name in ('box-geometry.py','box-motion.py'))
    manifest={str(path.relative_to(ROOT)):hashlib.sha256(path.read_bytes()).hexdigest() for path in files}
    manifest_file=Path(temporary)/'box-manifest.json'
    manifest_file.write_text(json.dumps(manifest))
    with tarfile.open(archive,'w:gz') as package:
        for path in files: package.add(path,arcname=str(path.relative_to(ROOT)),recursive=False)
        package.add(manifest_file,arcname='box-manifest.json')
    remote_dir=subprocess.check_output(['ssh',HOST,'mktemp -d /tmp/box-studio-deploy.XXXXXXXX'],env=env,text=True).strip()
    if not re.fullmatch(r'/tmp/box-studio-deploy\.[a-zA-Z0-9]{8}',remote_dir):
        raise RuntimeError('Invalid remote staging directory')
    try:
        subprocess.run(['scp',str(archive),HOST+':'+remote_dir+'/studio.tgz'],env=env,check=True)
        subprocess.run(['ssh',HOST,'python3 -'],input=REMOTE.replace('__DEPLOY_DIRECTORY__',repr(remote_dir)),text=True,env=env,check=True)
    finally:
        subprocess.run(['ssh',HOST,'python3 -'],input='import shutil\nshutil.rmtree('+repr(remote_dir)+')\n',text=True,env=env,check=True)
