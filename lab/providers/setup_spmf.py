"""Fetch pinned upstream source and compile only the bridge's dependency closure.
Upstream stays local; no third-party source or binaries are added to Git.
"""
import argparse,hashlib,json,shutil,subprocess,urllib.request
from pathlib import Path
COMMIT='ffda99181e8ffa71a51a41792c568931f8573d19'
p=argparse.ArgumentParser();p.add_argument('--source');p.add_argument('--output',default='lab/.tools/spmf-classes');p.add_argument('--ecj',help='Optional Eclipse ECJ compiler jar when javac is absent');args=p.parse_args()
source=Path(args.source or 'lab/.tools/spmf-source').resolve();output=Path(args.output).resolve()
if not source.exists():
 subprocess.run(['git','clone','https://github.com/philfv9/spmf-software.git',str(source)],check=True)
subprocess.run(['git','-C',str(source),'checkout','--detach',COMMIT],check=True)
if subprocess.check_output(['git','-C',str(source),'status','--porcelain']).strip():raise SystemExit('Expected unmodified pinned upstream source')
output.mkdir(parents=True,exist_ok=True)
bridge=Path(__file__).with_name('SpmfBridge.java').resolve()
compiler=['java','-jar',str(Path(args.ecj).resolve()),'-17','-nowarn','-proc:none'] if args.ecj else ['javac']
subprocess.run(compiler+['-d',str(output),'-sourcepath',str(source),str(bridge)],check=True)
files=sorted(output.rglob('*.class'));digest=hashlib.sha256()
for f in files:digest.update(str(f.relative_to(output)).encode());digest.update(f.read_bytes())
manifest={'upstream_commit':COMMIT,'source':'https://github.com/philfv9/spmf-software','license':'GPL-3.0 (upstream retained separately)','bridge_sha256':hashlib.sha256(bridge.read_bytes()).hexdigest(),'classes_sha256':digest.hexdigest(),'class_files':len(files)}
(output/'build.json').write_text(json.dumps(manifest,indent=2));print(json.dumps(manifest))
