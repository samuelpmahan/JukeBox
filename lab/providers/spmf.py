"""Process adapters for original upstream SPMF SKOPUS and ClaSP implementations."""
from __future__ import annotations
import hashlib,json,os,re,subprocess
from collections import Counter
from pathlib import Path
from lab.core import MethodAdapter,MethodResult,RunStatus
UPSTREAM='ffda99181e8ffa71a51a41792c568931f8573d19'

def _witness(sequence,pattern):
 positions=[];start=0
 for item in pattern:
  try:i=sequence.index(item,start)
  except ValueError:return None
  positions.append(i+1);start=i+1
 return positions

def execute(method,corpus,config):
 classes=Path(str(config.get('spmf_classes') or os.environ.get('JUKEBOX_SPMF_CLASSES','lab/.tools/spmf-classes'))).resolve()
 if not (classes/'SpmfBridge.class').exists():
  return MethodResult(RunStatus.UNSUPPORTED,error='Build upstream SPMF bridge with python3 lab/providers/setup_spmf.py; set JUKEBOX_SPMF_CLASSES if using another build directory.')
 work=Path(str(config['workdir'])).resolve();work.mkdir(parents=True,exist_ok=True)
 counts=Counter(t for s in corpus.sets for t in set(s.tracks))
 minimum=int(config.get('item_min_sets',10 if method=='skopus' else 1))
 if minimum<1:raise ValueError('item_min_sets must be >=1')
 vocab=sorted(t for t,n in counts.items() if n>=minimum);ids={t:i+1 for i,t in enumerate(vocab)}
 if not vocab:return MethodResult(RunStatus.NO_DATA,summary={'item_min_sets':minimum})
 # Preserve every sequence, including those emptied by vocabulary projection.
 inp=work/'input.spmf';out=work/'output.spmf'
 inp.write_text(''.join(' '.join(str(ids[t])+' -1' for t in s.tracks if t in ids)+' -2\n' for s in corpus.sets))
 (work/'dictionary.json').write_text(json.dumps({i:t for t,i in ids.items()},indent=2))
 if method=='skopus':params=[str(int(config.get('top_k',10))),str(int(config.get('max_length',3)))]
 else:
  minsup=float(config.get('min_support',0.01))
  if not 0<minsup<=1:raise ValueError('min_support must be in (0,1]')
  params=[str(minsup)]
 command=['java','-Xmx512m','-cp',str(classes),'SpmfBridge',method,str(inp),str(out),*params]
 try:
  process=subprocess.run(command,capture_output=True,text=True,timeout=float(config.get('timeout_seconds',90)))
 except subprocess.TimeoutExpired:
  return MethodResult(RunStatus.TIMED_OUT,summary={'effective_parameters':params,'item_min_sets':minimum,'vocabulary_size':len(vocab)},error='SPMF run exceeded configured timeout; no completed results.')
 (work/'process.log').write_text(process.stdout+process.stderr)
 if process.returncode:
  return MethodResult(RunStatus.FAILED,error=f'Upstream SPMF exited {process.returncode}; inspect local process.log')
 if not out.exists():return MethodResult(RunStatus.FAILED,error='Upstream produced no output file')
 rows=[];compact=[]
 for line in out.read_text().splitlines():
  if not line.strip() or line.startswith('@'):continue
  raw=line.split('#',1)[0];numbers=[int(v) for v in raw.split() if int(v)>0]
  pattern=[vocab[i-1] for i in numbers];support=re.search(r'#SUP:\s*(\d+)',line)
  if not support:raise ValueError('Missing upstream support')
  witnesses=[]
  for s in corpus.sets:
   positions=_witness(s.tracks,pattern)
   if positions is not None:witnesses.append({'set_id':s.id,'rows':positions})
  if len(witnesses)!=int(support.group(1)):
   raise ValueError(f'Upstream support {support.group(1)} disagrees with independent occurrence scan {len(witnesses)}')
  lev=re.search(r'#LEVERAGE:\s*([^\s]+)',line)
  record={'pattern_ids':[hashlib.sha256(t.encode()).hexdigest()[:16] for t in pattern],'length':len(pattern),'support_sets':len(witnesses)}
  if lev:record['leverage']=float(lev.group(1))
  compact.append(record);rows.append(dict(record,tracks=pattern,occurrences=witnesses))
 (work/'patterns.local.json').write_text(json.dumps(rows,indent=2))
 summary={'implementation':'upstream SPMF '+('SKOPUS' if method=='skopus' else 'ClaSP'),'upstream_commit':UPSTREAM,'set_count':len(corpus.sets),'item_min_sets':minimum,'vocabulary_size':len(vocab),'excluded_vocabulary_size':len(counts)-len(vocab),'gap_semantics':'unbounded ordered subsequence; singleton itemsets','effective_parameters':params,'pattern_count':len(compact),'patterns':compact[:50],'preview_limit':50,'occurrence_support_checked':True,'input_encoding_sha256':hashlib.sha256(inp.read_bytes()).hexdigest(),'output_sha256':hashlib.sha256(out.read_bytes()).hexdigest()}
 manifest=classes/'build.json'
 if manifest.exists():summary['build']=json.loads(manifest.read_text())
 return MethodResult(RunStatus.SUCCESS,summary=summary,artifacts=['patterns.local.json'],algorithm_identity=f'upstream:SPMF/{"SKOPUS" if method=="skopus" else "ClaSP"}@{UPSTREAM}')

def register(registry):
 for method in ['skopus','closed']:
  registry.register(MethodAdapter('skopus-original' if method=='skopus' else 'closed-sequential-spmf',f'upstream:SPMF/{method}@{UPSTREAM}',lambda corpus,config,m=method:execute(m,corpus,config),'Original SPMF process; explicit scoped vocabulary and independently checked support'))
