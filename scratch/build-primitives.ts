import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {Jukebox} from '../src/model.ts';
import {parseTracklist} from '../src/parser.ts';

const corpusDir=process.argv[2]??'corpus/lost-lands-2018';
const outFile=process.argv[3]??'data/lostlands-2018.jukebox.json.gz';

function splitSelectorMembers(text:string){
  const truncated=/\+\s*More\b/i.test(text);
  const cleaned=text.replace(/\s*\+\s*More\b.*$/i,'').trim();
  const members=cleaned.split(/\s+(?:&|x|vs\.?|b2b)\s+/i).map(x=>x.trim()).filter(Boolean);
  return {members:members.length?members:[cleaned],truncated};
}
function dateFromFile(file:string){return file.match(/(20\d\d-\d\d-\d\d)(?=\.csv$)/)?.[1]??null;}
function selectorFromFile(file:string){return file.split('_')[0].trim();}

const files=fs.readdirSync(corpusDir).filter(f=>f.endsWith('.csv')).sort();
const jb=new Jukebox();
const parsed:{file:string;selector:string;date:string|null;tracklist:ReturnType<typeof parseTracklist>}[]=[];
for(const file of files){
  const selector=selectorFromFile(file);
  const date=dateFromFile(file);
  const tracklist=parseTracklist(fs.readFileSync(path.join(corpusDir,file),'utf8'),selector);
  jb.addTracklist(tracklist);
  parsed.push({file,selector,date,tracklist});
}

const artistNames=new Set(jb.listArtists().map(a=>a.name));
for(const p of parsed) for(const m of splitSelectorMembers(p.selector).members) artistNames.add(m);
const artists=[...artistNames].sort((a,b)=>a.localeCompare(b));
const artistId=new Map(artists.map((a,i)=>[a,i]));
const tracks=jb.listTracks();
const trackId=new Map(tracks.map((t,i)=>[t.pk,i]));
const trackRows=tracks.map(t=>[t.pk,t.title,t.originalArtists.map(a=>artistId.get(a.name)),t.featuredArtists.map(a=>artistId.get(a.name)),t.variation?.type??null,t.variation?.creditArtists.map(a=>artistId.get(a.name))??[]]);
const dates=[...new Set(parsed.map(p=>p.date).filter((x):x is string=>!!x))].sort();
const dateId=new Map(dates.map((d,i)=>[d,i]));
const selectorGroups:{members:number[];label:string;truncated:boolean}[]=[];
const selectorGroupId=new Map<string,number>();
function groupFor(label:string){let id=selectorGroupId.get(label);if(id!==undefined)return id;const s=splitSelectorMembers(label);id=selectorGroups.length;selectorGroupId.set(label,id);selectorGroups.push({members:s.members.map(m=>artistId.get(m)!),label,truncated:s.truncated});return id;}

// Derived primitives only: no raw source lines, URLs, set titles, or complete ordered tracklists.
const selections:number[][]=[];
const transitions:number[][]=[];
let rejectedRows=0;
for(const p of parsed){
  const g=groupFor(p.selector),d=p.date?dateId.get(p.date)!:-1;
  const ids:number[]=[];
  for(const e of p.tracklist.entries){const t=jb.findTrack(e);if(!t)throw new Error(`resolved track missing for ${p.file}`);const id=trackId.get(t.pk)!;ids.push(id);selections.push([id,g,d]);}
  for(let i=1;i<ids.length;i++)transitions.push([ids[i-1],ids[i],g,d]);
  rejectedRows+=p.tracklist.rejectedLines.length;
}
const payload={schema:'jukebox-primitives/v1',meta:{corpus:'lost-lands-2018',sourceFiles:files.length,rejectedRows,tracks:tracks.length,selectionEvents:selections.length,transitionEvents:transitions.length},artists,tracks:trackRows,selectorGroups:selectorGroups.map(g=>[g.members,g.label,g.truncated?1:0]),dates,selections,transitions};
const json=Buffer.from(JSON.stringify(payload));
const gz=zlib.gzipSync(json,{level:9});
fs.mkdirSync(path.dirname(outFile),{recursive:true});
fs.writeFileSync(outFile,gz);
console.log(JSON.stringify({rawJsonBytes:json.length,gzipBytes:gz.length,...payload.meta}));
