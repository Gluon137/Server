"""Publish shared studio features with backups, auth checks and rollback.

Only explicitly listed website files are changed. Existing issue data is preserved.
"""
from pathlib import Path
import hashlib
import json
import os
import re
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]
HOST = 'root@v2202606364772466585.supersrv.de'
PUBLIC = 'https://v2202606364772466585.supersrv.de'
FILES = ['website/index.html']
for studio in ('baustein-studio', 'box-studio', 'klappkarten-studio', 'drehscheiben-studio', 'zahnrad-studio'):
    FILES.append(f'website/{studio}/index.html')
for studio in ('baustein-studio', 'box-studio', 'klappkarten-studio'):
    FILES.extend((f'website/{studio}/app.mjs', f'website/{studio}/scene.mjs'))
FILES.append('website/klappkarten-studio/editor.mjs')
for directory in ('website/shared', 'website/problem-reports'):
    FILES.extend(str(path.relative_to(ROOT)) for path in sorted((ROOT / directory).iterdir()) if path.is_file())

REMOTE = r'''
from pathlib import Path
import base64,hashlib,json,os,re,shutil,socket,sqlite3,subprocess,tarfile,tempfile,time,uuid
from urllib.error import HTTPError
from urllib.request import Request,urlopen,build_opener,HTTPRedirectHandler

public = 'https://v2202606364772466585.supersrv.de'
staging = Path(__STAGING__)
release = staging/'release'
release.mkdir()
with tarfile.open(staging/'release.tgz') as package:
    package.extractall(release,filter='data')
manifest = json.loads((release/'manifest.json').read_text())
for relative,expected in manifest['files'].items():
    assert hashlib.sha256((release/relative).read_bytes()).hexdigest()==expected, relative
conf=Path('/etc/apache2/sites-available/limescope.conf')
unit=Path('/etc/systemd/system/problem-reports.service')
root=Path('/opt/problem-reports')
authfile=Path('/etc/apache2/.htpasswd-workshop-zuordnung')
assert authfile.is_file(), 'Existing Workshop password file is required'
subprocess.run(['apache2ctl','configtest'],check=True)
active=subprocess.run(['systemctl','is-active','--quiet','problem-reports']).returncode==0
enabled=subprocess.run(['systemctl','is-enabled','--quiet','problem-reports'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0
if not active:
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',8770))
backup=Path('/var/backups')/time.strftime('workshop-features-%Y%m%d-%H%M%S',time.gmtime())
backup.mkdir(mode=0o700)
destinations={relative:Path('/var/www/html')/relative.removeprefix('website/') for relative in manifest['web']}
destinations.update({'config':conf,'unit':unit,'server':root/'server.py','snippet':root/'apache-problem-reports.conf','readme':root/'README.md'})
existed={}
for key,path in destinations.items():
    existed[key]=path.exists()
    if path.exists():
        target=backup/'files'/key
        target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(path,target)
(backup/'restore.json').write_text(json.dumps({'paths':{key:str(path) for key,path in destinations.items()},'existed':existed,'active':active,'enabled':enabled,'release':manifest['build']},indent=2))
test_id=None

def http(path,method='GET',body=None,authenticated=False,headers=None,origin=None):
    fields=dict(headers or {})
    if authenticated: fields['Authorization']='Basic '+base64.b64encode((__AUTH__['username']+':'+__AUTH__['password']).encode()).decode()
    if body is not None:
        fields['Content-Type']='application/json'
        fields['Origin']=origin or public
    request=Request(public+path,data=body,method=method,headers=fields)
    try: response=urlopen(request,timeout=30)
    except HTTPError as error: response=error
    with response: return response.status,dict(response.headers),response.read()

def remove_test_report():
    if test_id and Path('/var/lib/problem-reports/reports.sqlite3').is_file():
        with sqlite3.connect('/var/lib/problem-reports/reports.sqlite3',timeout=10) as connection:
            connection.execute('DELETE FROM reports WHERE id=? AND description=?',(test_id,'Automatischer Veröffentlichungstest '+manifest['build']))

try:
    root.mkdir(mode=0o755,exist_ok=True)
    for name in ('server.py','apache-problem-reports.conf','README.md'):
        shutil.copy2(release/'service'/name,root/name)
    shutil.copy2(release/'service/problem-reports.service',unit)
    # Install access control before publishing the archive's static files.
    text=conf.read_text()
    include='    Include /opt/problem-reports/apache-problem-reports.conf'
    if include not in text:
        marker='    Include /opt/klappkarten-studio/apache-klappkarten-studio.conf'
        assert text.count(marker)==1, 'Expected HTTPS VirtualHost include not found'
        text=text.replace(marker,marker+'\n'+include)
    redirect=r'    RedirectMatch 308 ^/(|index\.html|(?:problem-reports|shared|drehscheiben-studio|zahnrad-studio)(?:/.*)?|api/problem-reports)$ https://v2202606364772466585.supersrv.de/$1'
    if redirect not in text:
        assert text.count('</VirtualHost>')>=2
        text=text.replace('</VirtualHost>',redirect+'\n</VirtualHost>',1)
    conf.write_text(text)
    subprocess.run(['apache2ctl','configtest'],check=True)
    subprocess.run(['systemctl','daemon-reload'],check=True)
    subprocess.run(['systemctl','restart','problem-reports'],check=True)
    for attempt in range(100):
        try:
            with urlopen('http://127.0.0.1:8770/health',timeout=1) as response:
                assert json.load(response)['status']=='ok'
            break
        except OSError: time.sleep(.1)
    else: raise RuntimeError('Report service did not become healthy')
    subprocess.run(['systemctl','reload','apache2'],check=True)
    for relative in manifest['web']:
        target=destinations[relative]
        target.parent.mkdir(parents=True,exist_ok=True)
        temporary=target.with_name(target.name+'.release-new')
        shutil.copy2(release/relative,temporary)
        temporary.chmod(0o644)
        os.replace(temporary,target)
    for relative in manifest['web']:
        path='/'+relative.removeprefix('website/')
        status,headers,raw=http(path,authenticated=path.startswith('/problem-reports/'))
        assert status==200 and hashlib.sha256(raw).hexdigest()==manifest['files'][relative], (status,path)
    for path in ('/problem-reports/','/problem-reports/app.mjs','/problem-reports/style.css','/problem-reports/api/reports','/problem-reports/api/reports/'+str(uuid.uuid4())+'/download'):
        for method in ('GET','HEAD'):
            assert http(path,method=method)[0]==401, (path,method,'must require authentication')
    public_status,_,public_body=http('/api/problem-reports')
    assert public_status in (403,405), ('Public read endpoint must not exist',public_status,public_body[:180])
    assert http('/api/problem-reports',method='POST',body=b'{}',origin='https://foreign.example')[0]==403
    assert http('/api/problem-reports',method='POST',body=b'{}')[0]==422
    test_id=str(uuid.uuid4())
    from datetime import datetime,timezone
    test={'version':1,'id':test_id,'app':'landing','capturedAt':datetime.now(timezone.utc).isoformat(),'description':'Automatischer Veröffentlichungstest '+manifest['build'],'snapshot':{},'diagnostics':{},'environment':{'build':manifest['build']}}
    payload=json.dumps(test).encode()
    status,_,raw=http('/api/problem-reports',method='POST',body=payload)
    assert status==201,(status,raw[:200])
    receipt=json.loads(raw)
    assert receipt['id']==test_id
    status,_,raw=http('/api/problem-reports',method='POST',body=payload)
    assert status==201 and json.loads(raw)==receipt,'Retry must preserve report number'
    status,_,raw=http('/problem-reports/api/reports/'+test_id+'/download',authenticated=True)
    assert status==200 and json.loads(raw)['snapshot']=={},'Protected JSON round-trip'
    remove_test_report()
    class NoRedirect(HTTPRedirectHandler):
        def redirect_request(self,*args,**kwargs): return None
    redirects=build_opener(NoRedirect())
    for path in ('/problem-reports/','/','/drehscheiben-studio/','/zahnrad-studio/'):
        try: response=redirects.open('http://v2202606364772466585.supersrv.de'+path,timeout=15)
        except HTTPError as error: response=error
        with response:
            assert response.status==308 and response.headers['Location']==public+path, path+' must redirect to HTTPS'
    for path,expected in (('/workshop-zuordnung/',401),('/limescope/',200),('/box-studio/api/health',200),('/baustein-studio/api/health',200)):
        assert http(path)[0]==expected,(path,'existing app health')
    for path in ('/.server-tools/problem-reports/server.py','/shared/../problem-reports/api/reports'):
        assert http(path)[0] in (401,403,404),path
    subprocess.run(['systemctl','enable','problem-reports'],check=True)
except BaseException:
    try: remove_test_report()
    except (sqlite3.Error,OSError): print('Testbericht konnte nicht entfernt werden; Rücksetzung wird fortgesetzt.')
    subprocess.run(['systemctl','stop','problem-reports'],check=False)
    if not enabled: subprocess.run(['systemctl','disable','problem-reports'],check=False,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    for key,path in destinations.items():
        if existed[key]:
            path.parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(backup/'files'/key,path)
        else: path.unlink(missing_ok=True)
    subprocess.run(['systemctl','daemon-reload'],check=False)
    if active: subprocess.run(['systemctl','restart','problem-reports'],check=False)
    subprocess.run(['apache2ctl','configtest'],check=True)
    subprocess.run(['systemctl','reload','apache2'],check=True)
    raise
print(json.dumps({'url':public+'/','reports':public+'/problem-reports/','build':manifest['build'],'backup':str(backup),'files':len(manifest['web']),'verified':'checksums, protected GET/HEAD, origin, idempotent POST/download, HTTPS redirects, existing app health'}))
'''


def main():
    env = os.environ.copy()
    env.update(SSH_ASKPASS=str(ROOT / '.server-tools/askpass.py'), SSH_ASKPASS_REQUIRE='force', DISPLAY=':0')
    sources = {name: (ROOT / name).read_bytes() for name in FILES}
    for name in ('server.py', 'problem-reports.service', 'apache-problem-reports.conf', 'README.md'):
        sources['service/' + name] = (ROOT / '.server-tools/problem-reports' / name).read_bytes()
    build = hashlib.sha256(''.join(name + hashlib.sha256(data).hexdigest() for name, data in sorted(sources.items())).encode()).hexdigest()[:20]
    for name in FILES:
        if name.endswith('.html'):
            source = sources[name].decode()
            source, changed = re.subn(r'(<meta\s+charset=[^>]+>)', lambda match: match[0] + '<meta name="workshop-build" content="' + build + '">', source, count=1, flags=re.I)
            assert changed == 1, name
            sources[name] = source.encode()
    # Revalidation ensures all browsers load shared features and new adapter code.
    sources['service/apache-problem-reports.conf'] += b'\n<Directory "/var/www/html/shared">\n    Options -Indexes -ExecCGI\n    AllowOverride None\n    Require all granted\n    AddType text/javascript .mjs .js\n    Header set Cache-Control "no-cache"\n    Header set X-Content-Type-Options "nosniff"\n</Directory>\n'
    manifest = {'build': build, 'web': FILES, 'files': {name: hashlib.sha256(data).hexdigest() for name, data in sources.items()}}
    access = json.loads((ROOT / 'workshop-zugang.json').read_text())
    with tempfile.TemporaryDirectory(prefix='workshop-features-deploy-') as directory:
        staging = Path(directory)
        for name, data in sources.items():
            target = staging / name; target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(data)
        (staging / 'manifest.json').write_text(json.dumps(manifest))
        archive = staging / 'release.tgz'
        with tarfile.open(archive, 'w:gz') as package:
            for name in [*sources, 'manifest.json']:
                package.add(staging / name, arcname=name, recursive=False)
        remote = subprocess.check_output(['ssh', '-o', 'ConnectTimeout=15', HOST, 'mktemp -d /tmp/workshop-features.XXXXXXXX'], env=env, text=True).strip()
        if not re.fullmatch(r'/tmp/workshop-features\.[a-zA-Z0-9]{8}', remote):
            raise RuntimeError('Invalid remote staging directory')
        try:
            subprocess.run(['scp', str(archive), HOST + ':' + remote + '/release.tgz'], env=env, check=True)
            script = REMOTE.replace('__STAGING__', repr(remote)).replace('__AUTH__', repr({'username': access['username'], 'password': access['password']}))
            subprocess.run(['ssh', HOST, 'python3 -'], input=script, env=env, text=True, check=True)
        finally:
            subprocess.run(['ssh', HOST, 'python3 -'], input='import shutil\nshutil.rmtree(' + repr(remote) + ')\n', env=env, text=True, check=True)


if __name__ == '__main__':
    main()
