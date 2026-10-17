"""Publish only the popup studio and its landing card, with rollback on failure."""
from pathlib import Path
import hashlib
import json
import os
import re
import subprocess
import tarfile
import tempfile
import uuid

ROOT = Path(__file__).resolve().parents[1]
HOST = 'root@v2202606364772466585.supersrv.de'
PUBLIC = 'https://v2202606364772466585.supersrv.de'
env = os.environ.copy()
env.update(SSH_ASKPASS=str(ROOT / '.server-tools/askpass.py'), SSH_ASKPASS_REQUIRE='force', DISPLAY=':0')
configuration = '''# Included inside the HTTPS virtual host only.
RedirectMatch 308 ^/klappkarten-studio$ /klappkarten-studio/
<Directory "/var/www/html/klappkarten-studio">
    Options -Indexes -ExecCGI
    AllowOverride None
    Require all granted
    AddType text/javascript .mjs .js
    Header set X-Content-Type-Options "nosniff"
    Header set X-Frame-Options "SAMEORIGIN"
    Header set Cache-Control "no-cache"
    Header set Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; frame-src 'self'; object-src 'none'; frame-ancestors 'self'; base-uri 'self'"
</Directory>
<LocationMatch "^/klappkarten-studio/(?:tests(?:/|$)|(?:.*/)?\\.[^/]+)">
    Require all denied
</LocationMatch>
'''
remote = r'''
from pathlib import Path
import hashlib,json,os,shutil,subprocess,tarfile,tempfile,time
from urllib.request import urlopen
from urllib.parse import quote
config=Path('/etc/apache2/sites-available/limescope.conf')
webroot=Path('/var/www/html')
web=webroot/'klappkarten-studio'
landing=webroot/'index.html'
snippet=Path('/opt/klappkarten-studio/apache-klappkarten-studio.conf')
backup=Path('/var/backups')/('klappkarten-studio-'+time.strftime('%Y%m%d-%H%M%S',time.gmtime()))
backup.mkdir()
for source,name in [(config,'limescope.conf'),(landing,'index.html'),(snippet,'apache-klappkarten-studio.conf')]:
 if source.exists():shutil.copy2(source,backup/name)
old_web=web.exists()
if old_web:shutil.copytree(web,backup/'klappkarten-studio')

def atomic_file(source,destination):
 temp=destination.with_name(destination.name+'.klappkarten-next')
 shutil.copyfile(source,temp);temp.chmod(0o644);os.replace(temp,destination)

with tempfile.TemporaryDirectory(prefix='.klappkarten-stage-',dir=webroot) as stage:
 stage=Path(stage)
 try:
  with tarfile.open(ARCHIVE) as package:package.extractall(stage,filter='data')
  manifest=json.loads((stage/'manifest.json').read_text())
  assert hashlib.sha256(landing.read_bytes()).hexdigest()==manifest['landing_before'],'Startseite hat sich seit der Vorprüfung geändert.'
  for relative,digest in manifest['files'].items():assert hashlib.sha256((stage/relative).read_bytes()).hexdigest()==digest,relative
  for name,digest in manifest['three'].items():assert hashlib.sha256((webroot/'baustein-studio/vendor'/name).read_bytes()).hexdigest()==digest,'3D-Bibliothek geändert: '+name
  for path in (stage/'klappkarten-studio').rglob('*'):path.chmod(0o755 if path.is_dir() else 0o644)
  (stage/'klappkarten-studio').chmod(0o755)
  snippet.parent.mkdir(parents=True,exist_ok=True)
  atomic_file(stage/'apache-klappkarten-studio.conf',snippet)
  text=config.read_text()
  include='    Include /opt/klappkarten-studio/apache-klappkarten-studio.conf'
  marker='    Include /opt/baustein-studio/website/baustein-studio/backend/apache-baustein-studio.conf'
  if include not in text:
   assert marker in text,'Erwarteter HTTPS-VirtualHost fehlt.'
   text=text.replace(marker,marker+'\n'+include,1)
  redirect='    RedirectMatch 308 ^/klappkarten-studio(?:/(.*))?$ https://v2202606364772466585.supersrv.de/klappkarten-studio/$1'
  if redirect not in text:text=text.replace('</VirtualHost>',redirect+'\n</VirtualHost>',1)
  staged_config=stage/'limescope.conf';staged_config.write_text(text);atomic_file(staged_config,config)
  subprocess.run(['apache2ctl','configtest'],check=True)
  if old_web:shutil.rmtree(web)
  os.replace(stage/'klappkarten-studio',web)
  atomic_file(stage/'index.html',landing)
  subprocess.run(['systemctl','reload','apache2'],check=True)
  for relative,digest in manifest['files'].items():
   with urlopen(PUBLIC+'/'+quote(relative),timeout=20) as response:
    body=response.read();assert response.status==200,relative
    assert hashlib.sha256(body).hexdigest()==digest,'Öffentlicher Inhalt abweichend: '+relative
    if relative.endswith(('.mjs','.js')):assert response.headers.get_content_type() in ('text/javascript','application/javascript'),relative+' falscher MIME-Typ'
  print(json.dumps({'status':'deployed','public':PUBLIC+'/klappkarten-studio/','backup':str(backup),'verified_files':len(manifest['files'])}))
 except Exception:
  atomic_file(backup/'limescope.conf',config);atomic_file(backup/'index.html',landing)
  if (backup/'apache-klappkarten-studio.conf').exists():atomic_file(backup/'apache-klappkarten-studio.conf',snippet)
  else:snippet.unlink(missing_ok=True)
  if web.exists():shutil.rmtree(web)
  if old_web:shutil.copytree(backup/'klappkarten-studio',web)
  subprocess.run(['apache2ctl','configtest'],check=True)
  subprocess.run(['systemctl','reload','apache2'],check=True)
  raise
Path(ARCHIVE).unlink(missing_ok=True)
'''

with tempfile.TemporaryDirectory(prefix='klappkarten-deploy-') as temp:
    temp = Path(temp)
    archive = temp / 'studio.tgz'
    files = {'index.html': ROOT / 'website/index.html'}
    for path in (ROOT / 'website/klappkarten-studio').rglob('*'):
        if path.is_file() and 'tests' not in path.relative_to(ROOT / 'website/klappkarten-studio').parts and not any(part.startswith('.') for part in path.relative_to(ROOT / 'website/klappkarten-studio').parts):
            files['klappkarten-studio/' + str(path.relative_to(ROOT / 'website/klappkarten-studio'))] = path
    live_landing = subprocess.run(['ssh','-o','ConnectTimeout=15',HOST,'cat /var/www/html/index.html'],env=env,capture_output=True,check=True).stdout
    local_landing = (ROOT / 'website/index.html').read_text()
    previous_landing = re.sub(r'<section class="project" aria-labelledby="popup-title">[\s\S]*?</section>\n?', '', local_landing)
    live_without_card = re.sub(r'<section class="project" aria-labelledby="popup-title">[\s\S]*?</section>\n?', '', live_landing.decode())
    if live_landing.decode() != local_landing and live_without_card != previous_landing:
        raise RuntimeError('Die Startseite enthält weitere Serveränderungen; vor Veröffentlichung abgleichen.')
    manifest = {
        'landing_before': hashlib.sha256(live_landing).hexdigest(),
        'files': {name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in files.items()},
        'three': {name: hashlib.sha256((ROOT / 'website/baustein-studio/vendor' / name).read_bytes()).hexdigest() for name in ('three.module.js','three.core.js','OrbitControls.js')},
    }
    manifest_path=temp/'manifest.json';manifest_path.write_text(json.dumps(manifest))
    snippet=temp/'apache-klappkarten-studio.conf';snippet.write_text(configuration)
    with tarfile.open(archive,'w:gz') as package:
        for name,path in files.items():package.add(path,arcname=name,recursive=False)
        package.add(manifest_path,arcname='manifest.json');package.add(snippet,arcname='apache-klappkarten-studio.conf')
    remote_archive='/tmp/klappkarten-studio-'+uuid.uuid4().hex+'.tgz'
    subprocess.run(['scp',str(archive),HOST+':'+remote_archive],env=env,check=True)
    code='ARCHIVE='+repr(remote_archive)+'\nPUBLIC='+repr(PUBLIC)+'\n'+remote
    subprocess.run(['ssh','-o','ConnectTimeout=15',HOST,'python3 -'],input=code,text=True,env=env,check=True)
