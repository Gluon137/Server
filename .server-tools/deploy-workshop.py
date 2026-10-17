from pathlib import Path
import json, secrets, os, subprocess
access=Path('/Users/Rauh/Projekte/Server/workshop-zugang.json')
if not access.exists():
    with open(access,'x',opener=lambda path,flags:os.open(path,flags,0o600)) as f:
        json.dump({'url':'https://v2202606364772466585.supersrv.de/workshop-zuordnung/','username':'workshop-admin','password':secrets.token_urlsafe(24)},f,indent=2)
pw=json.loads(access.read_text())['password']
script='''import pathlib, shutil, subprocess, os
base=pathlib.Path('/var/backups/landing-tools-2026-10-09')
base.mkdir(exist_ok=True)
conf=pathlib.Path('/etc/apache2/sites-available/limescope.conf')
shutil.copy2(conf,base/'limescope.conf')
shutil.copy2('/var/www/html/index.html',base/'index.html')
auth=pathlib.Path('/etc/apache2/.htpasswd-workshop-zuordnung')
if auth.is_symlink():
    shutil.copy2(auth,base/'workshop-auth-link',follow_symlinks=False)
newauth=str(auth)+'.new'
subprocess.run(['htpasswd','-iBc',newauth,'workshop-admin'],input=PASSWORD+'\\n',text=True,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
shutil.chown(newauth,user='root',group='www-data')
os.chmod(newauth,0o640)
os.replace(newauth,auth)
s=conf.read_text()
include='    Include /opt/workshop-zuordnung-server/deploy/apache-workshop-zuordnung.conf'
if include not in s:
    s=s.replace('    Include /opt/limescope/deploy/apache-limescope.conf','    Include /opt/limescope/deploy/apache-limescope.conf\\n'+include)
    s=s.replace('</VirtualHost>','    RedirectMatch 308 ^/workshop-zuordnung(?:/(.*))?$ https://v2202606364772466585.supersrv.de/workshop-zuordnung/$1\\n</VirtualHost>',1)
conf.write_text(s)
try:
    subprocess.run(['apache2ctl','configtest'],check=True)
    subprocess.run(['systemctl','reload','apache2'],check=True)
except Exception:
    shutil.copy2(base/'limescope.conf',conf)
    subprocess.run(['systemctl','reload','apache2'],check=True)
    raise
print('Workshop route enabled; backup:',base)
'''
env=os.environ.copy();env.update(SSH_ASKPASS='/Users/Rauh/Projekte/Server/.server-tools/askpass.py',SSH_ASKPASS_REQUIRE='force',DISPLAY=':0')
subprocess.run(['ssh','root@v2202606364772466585.supersrv.de','python3 -'],input='PASSWORD='+repr(pw)+'\n'+script,text=True,env=env,check=True)
