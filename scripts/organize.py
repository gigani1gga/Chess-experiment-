# Unzips uploads, renames "file (1).js"-style copies, files everything where it belongs, newest copy wins.
import os,re,shutil,subprocess,zipfile,time
from datetime import datetime
PAT=os.environ.get('HAS_PAT')=='true'
KNOWN={'index.html':'','engine.js':'','worker.js':'','train.js':'','pages.yml':'.github/workflows','train.yml':'.github/workflows','organize.yml':'.github/workflows','organize.py':'scripts','brain.aienc':'brain'}
CP=re.compile(r'(?<=.)\s*(\(\d+\)|[-_]?\s*copy(\s*\(\d+\))?)(?=\.[^.]+$)',re.I)
clean=lambda n:CP.sub('',n)
def sh(*a):return subprocess.run(a,capture_output=True,text=True).stdout.strip()
def ctime(p):return int(sh('git','log','-1','--format=%ct','--',p) or time.time())
cands,remove,log=[],[],[]
def add(path,mt,data,strip=False):
    parts=[p for p in path.replace('\\','/').split('/') if p not in('','.')]
    if not parts or '__MACOSX' in parts or parts[-1]=='.DS_Store':return
    parts[-1]=clean(parts[-1]);cands.append((parts,mt,data,strip))
def dest(parts,strip):
    for i in range(len(parts)):
        sub='/'.join(parts[i:])
        if sub.startswith(('.github/workflows/','brain/','scripts/')):return sub
    n=parts[-1]
    if n in KNOWN:return (KNOWN[n]+'/' if KNOWN[n] else '')+n
    return '/'.join(parts[1:] if strip and len(parts)>1 else parts)
def addzip(p):
    with zipfile.ZipFile(p) as z:
        for i in z.infolist():
            if not i.is_dir():add(i.filename,datetime(*i.date_time).timestamp(),z.read(i),True)
    remove.append(p);log.append('unzipped '+p)
for f in os.listdir('.'):
    if os.path.isfile(f):
        if f.lower().endswith('.zip'):addzip(f)
        elif not f.startswith('.') and (clean(f) in KNOWN or clean(f)!=f):
            add(f,ctime(f),open(f,'rb').read());remove.append(f)
for d,_,fs in os.walk('inbox'):
    for f in fs:
        p=os.path.join(d,f)
