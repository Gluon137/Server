"""Publish Automaten plus its four integration files; preserve all report data.

--dry-run is local only. --check-remote is read-only. Run without either only
when ready to publish. Unknown live changes abort before any server mutation.
"""
from pathlib import Path
import argparse
import hashlib
import json
import os
import subprocess
import tarfile
import tempfile
import uuid

ROOT = Path(__file__).resolve().parents[1]
HOST = 'root@v2202606364772466585.supersrv.de'
PUBLIC = 'https://v2202606364772466585.supersrv.de'
BASELINES = {
    'index.html': '58dd143914da2aef2f21ffd2ff09d9570be33292b5630edf53740a5dd661a086',
    'shared/hero-copy-data.mjs': '9c691841681f285cc4388d2e2f7d7690d47709568b6f9a70e2e21de81aa509e3',
    'problem-reports/app.mjs': '0e83fc70cd9782ddb360a208205c438fe55985934116405b84fdcf61804a569c',
    'service/server.py': '8f9d8026faf33ef89268f704afe995911b3b47d6cb8e0b9e112c9bd1c8f43500',
}
CONFIGURATION = '''# Included only within the existing HTTPS virtual host.
RedirectMatch 308 ^/automaten-studio$ /automaten-studio/
<Directory "/var/www/html/automaten-studio">
    Options -Indexes -ExecCGI
    AllowOverride None
    Require all granted
    AddType text/javascript .mjs .js
    Header set X-Content-Type-Options "nosniff"
    Header set Cache-Control "no-cache"
    Header set Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'self'; base-uri 'self'"
</Directory>
<LocationMatch "^/automaten-studio/(?:tests(?:/|$)|(?:.*/)?\\.[^/]+)">
    Require all denied
</LocationMatch>
'''

# This preflight runs identically during inspection and immediately before install.
PREFLIGHT = r'''
from pathlib import Path
import hashlib,json,re,subprocess
webroot=Path('/var/www/html')
conf=Path('/etc/apache2/sites-available/limescope.conf')
snippet=Path('/opt/automaten-studio/apache-automaten-studio.conf')
server=Path('/opt/problem-reports/server.py')
def digest(path):
 return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None
def destination(name):
 return server if name=='service/server.py' else webroot/name
before={}
for name,expected in MANIFEST['files'].items():
 path=destination(name)
 before[name]=digest(path)
 if name in MANIFEST['baseline']:
  assert path.is_file(),'Required existing file missing: '+name
  normalized=re.sub(br'<meta name="workshop-build" content="[a-f0-9]+">',b'',path.read_bytes()) if name.endswith('.html') else path.read_bytes()
  assert hashlib.sha256(normalized).hexdigest() in (MANIFEST['baseline'][name],expected),'Unreviewed server drift: '+name
 elif before[name] is not None:
  assert before[name]==expected,'Unreviewed existing studio file: '+name
studio=webroot/'automaten-studio'
assert not studio.is_symlink(),'Studio root symlink is unsupported'
for name,expected in MANIFEST.get('dependencies',{}).items():
 assert digest(webroot/name)==expected,'Shared dependency differs: '+name
if studio.exists():
 for path in studio.rglob('*'):
  assert not path.is_symlink(),'Studio symlinks are unsupported'
  if path.is_file():assert str(path.relative_to(webroot)) in MANIFEST['files'],'Unknown studio file: '+str(path)
assert conf.is_file() and server.is_file(),'Existing workshop/report deployment required'
assert not any(destination(name).is_symlink() for name in MANIFEST['files']),'Symlink destination is unsupported'
if snippet.exists():assert snippet.read_text()==CONFIGURATION,'Existing Automaten Apache config differs'
assert 'Include /opt/problem-reports/apache-problem-reports.conf' in conf.read_text(),'Existing report protection missing'
assert conf.read_text().count('    Include /opt/klappkarten-studio/apache-klappkarten-studio.conf')==1,'Expected HTTPS include missing'
subprocess.run(['apache2ctl','configtest'],check=True,stdout=subprocess.DEVNULL)
subprocess.run(['systemctl','is-active','--quiet','problem-reports'],check=True)
state={'files':before,'config':digest(conf),'snippet':digest(snippet)}
'''

REMOTE = r'''
import os,shutil,tarfile,tempfile,time
from urllib.request import urlopen,Request,build_opener,HTTPRedirectHandler
from urllib.error import HTTPError
from urllib.parse import quote
assert state==EXPECTED,'Server changed after preflight'
backup=Path('/var/backups')/('automaten-studio-'+time.strftime('%Y%m%d-%H%M%S',time.gmtime())+'-'+TOKEN)
backup.mkdir(mode=0o700)
paths={name:destination(name) for name in MANIFEST['files']}
paths.update({'apache-config':conf,'apache-snippet':snippet})
existed={name:path.exists() for name,path in paths.items()}
for name,path in paths.items():
 if existed[name]:
  target=backup/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(path,target)
(backup/'restore.json').write_text(json.dumps({'paths':{name:str(path) for name,path in paths.items()},'existed':existed},indent=2))
def atomic_file(source,target):
 target.parent.mkdir(parents=True,exist_ok=True)
 temp=target.with_name(target.name+'.automaten-next')
 shutil.copyfile(source,temp);temp.chmod(0o644);os.replace(temp,target)
def http(path,method='GET',data=None):
 request=Request(PUBLIC+path,method=method,data=data,headers={'Origin':PUBLIC,'Content-Type':'application/json'})
 try: response=urlopen(request,timeout=30)
 except HTTPError as error:response=error
 with response:return response.status,response.headers,response.read()
def health():
 for _ in range(100):
  try:
   with urlopen('http://127.0.0.1:8770/health',timeout=1) as response:assert json.load(response)['status']=='ok'
   return
  except OSError:time.sleep(.1)
 raise RuntimeError('Report service did not recover')
with tempfile.TemporaryDirectory(prefix='automaten-stage-') as directory:
 stage=Path(directory)
 with tarfile.open(ARCHIVE) as archive:archive.extractall(stage,filter='data')
 assert json.loads((stage/'manifest.json').read_text())==MANIFEST,'Archive manifest differs'
 for name,expected in MANIFEST['files'].items():assert digest(stage/name)==expected,'Archive checksum: '+name
 assert (stage/'apache-automaten-studio.conf').read_text()==CONFIGURATION
 changed=False
 try:
  changed=True
  atomic_file(stage/'apache-automaten-studio.conf',snippet)
  text=conf.read_text()
  include='    Include /opt/automaten-studio/apache-automaten-studio.conf'
  marker='    Include /opt/klappkarten-studio/apache-klappkarten-studio.conf'
  if include not in text:text=text.replace(marker,marker+'\n'+include,1)
  redirect='    RedirectMatch 308 ^/automaten-studio(?:/(.*))?$ '+PUBLIC+'/automaten-studio/$1'
  if redirect not in text:text=text.replace('</VirtualHost>',redirect+'\n</VirtualHost>',1)
  staged_conf=stage/'next-apache.conf';staged_conf.write_text(text);atomic_file(staged_conf,conf)
  subprocess.run(['apache2ctl','configtest'],check=True)
  for name,target in paths.items():
   if name in MANIFEST['files']:atomic_file(stage/name,target)
  # Parent directories must remain traversable after tempfile staging.
  for path in (webroot/'automaten-studio').rglob('*'):
   if path.is_dir():path.chmod(0o755)
  (webroot/'automaten-studio').chmod(0o755)
  subprocess.run(['systemctl','restart','problem-reports'],check=True);health()
  subprocess.run(['systemctl','reload','apache2'],check=True)
  for name,expected in MANIFEST['files'].items():
   assert digest(destination(name))==expected,'Installed checksum: '+name
   if name=='service/server.py':continue
   status,headers,body=http('/'+quote(name))
   if name.startswith('problem-reports/'):
    assert status==401,'Report archive lost authentication'
   else:
    assert status==200 and hashlib.sha256(body).hexdigest()==expected,'HTTP checksum: '+name
    if name.endswith(('.mjs','.js')):assert headers.get_content_type() in ('text/javascript','application/javascript'),'Module MIME: '+name
  assert http('/automaten-studio/')[0]==200
  assert http('/api/problem-reports',method='POST',data=b'{}')[0]==422
  assert http('/problem-reports/api/reports')[0]==401
  for path in ('/workshop-zuordnung/','/limescope/','/box-studio/api/health','/baustein-studio/api/health'):
   assert http(path)[0]==(401 if path=='/workshop-zuordnung/' else 200),'Existing application: '+path
  class NoRedirect(HTTPRedirectHandler):
   def redirect_request(self,*args,**kwargs):return None
  try: response=build_opener(NoRedirect()).open(PUBLIC.replace('https:','http:')+'/automaten-studio/',timeout=20)
  except HTTPError as error:response=error
  with response:assert response.status==308 and response.headers['Location']==PUBLIC+'/automaten-studio/','HTTPS redirect'
 except BaseException:
  if changed:
   for name,path in paths.items():
    if existed[name]:atomic_file(backup/name,path)
    else:path.unlink(missing_ok=True)
   if not any(existed[name] for name in MANIFEST['files'] if name.startswith('automaten-studio/')):
    shutil.rmtree(webroot/'automaten-studio',ignore_errors=True)
   subprocess.run(['systemctl','restart','problem-reports'],check=True);health()
   subprocess.run(['apache2ctl','configtest'],check=True)
   subprocess.run(['systemctl','reload','apache2'],check=True)
  raise
print(json.dumps({'status':'deployed','url':PUBLIC+'/automaten-studio/','backup':str(backup),'verified_files':len(MANIFEST['files']),'report_data':'untouched'}))
'''


def sources():
    result = {name: (ROOT / ('website/' + name)).read_bytes() for name in BASELINES if name != 'service/server.py'}
    result['service/server.py'] = (ROOT / '.server-tools/problem-reports/server.py').read_bytes()
    studio = ROOT / 'website/automaten-studio'
    assert studio.is_dir() and not studio.is_symlink(), 'Studio directory missing or symlinked'
    # Publish only reviewed runtime files and optional public documentation.
    for name in ('index.html', 'style.css', 'app.mjs', 'project.mjs', 'geometry.mjs', 'export.mjs', 'README.md'):
        path = studio / name
        if name == 'README.md' and not path.exists():
            continue
        assert path.is_file() and not path.is_symlink(), 'Studio file missing or symlinked: ' + name
        result['automaten-studio/' + name] = path.read_bytes()
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--dry-run', action='store_true', help='Validate and list local package only; no server connection')
    mode.add_argument('--check-remote', action='store_true', help='Check live drift and service state without changing server files')
    args = parser.parse_args()
    files = sources()
    manifest = {'baseline': BASELINES, 'files': {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}, 'dependencies': {name: hashlib.sha256((ROOT / 'website' / name).read_bytes()).hexdigest() for name in ('shared/hero-copy.mjs', 'shared/problem-reporter.js', 'shared/problem-reporter.css')}}
    compile(PREFLIGHT, '<preflight>', 'exec');compile(REMOTE, '<deploy>', 'exec')
    if args.dry_run:
        print(json.dumps({'status': 'dry-run', 'files': sorted(files), 'bytes': sum(map(len, files.values())), 'report_data': 'never included'}, indent=2))
        return
    env = os.environ.copy()
    env.update(SSH_ASKPASS=str(ROOT / '.server-tools/askpass.py'), SSH_ASKPASS_REQUIRE='force', DISPLAY=':0')
    ssh = ['ssh', '-o', 'ConnectTimeout=15', HOST, 'python3 -']
    initial = 'MANIFEST='+repr(manifest)+'\nCONFIGURATION='+repr(CONFIGURATION)+'\n'
    result = subprocess.run(ssh, input=initial+PREFLIGHT+'\nprint(json.dumps(state))\n', text=True, capture_output=True, env=env)
    if result.returncode:
        raise SystemExit(result.stderr.strip() or 'Remote preflight failed')
    state = json.loads(result.stdout)
    if args.check_remote:
        print(json.dumps({'status': 'preflight-passed', 'checked_files': len(files), 'server_changed': False}))
        return
    token = uuid.uuid4().hex
    remote_archive = '/tmp/automaten-release-'+token+'.tgz'
    with tempfile.TemporaryDirectory(prefix='automaten-deploy-') as directory:
        directory = Path(directory)
        for name, data in files.items():
            path = directory / name;path.parent.mkdir(parents=True, exist_ok=True);path.write_bytes(data)
        (directory / 'manifest.json').write_text(json.dumps(manifest))
        (directory / 'apache-automaten-studio.conf').write_text(CONFIGURATION)
        archive = directory / 'release.tgz'
        with tarfile.open(archive, 'w:gz') as package:
            for name in [*files, 'manifest.json', 'apache-automaten-studio.conf']:
                package.add(directory / name, arcname=name, recursive=False)
        try:
            subprocess.run(['scp', str(archive), HOST+':'+remote_archive], env=env, check=True)
            script = initial+'EXPECTED='+repr(state)+'\nARCHIVE='+repr(remote_archive)+'\nTOKEN='+repr(token)+'\nPUBLIC='+repr(PUBLIC)+'\n'+PREFLIGHT+REMOTE
            subprocess.run(ssh, input=script, text=True, env=env, check=True)
        finally:
            subprocess.run(ssh, input='from pathlib import Path\nPath('+repr(remote_archive)+').unlink(missing_ok=True)\n', text=True, env=env, check=True)


if __name__ == '__main__':
    main()
