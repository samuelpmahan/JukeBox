export type CreditRole = 'PRIMARY'|'FEATURED'|'VARIATION';
export type VariationType = 'REMIX'|'REWORK'|'MASHUP'|'EDIT'|'RE_BURST'|'VIP'|'FLIP'|'BOOTLEG'|'MIX'|'DUB'|'OTHER';
export class Variation { readonly type:VariationType; readonly creditArtists:Artist[]; readonly sourceText:string; constructor(type:VariationType,creditArtists:Artist[]=[],sourceText=''){this.type=type;this.creditArtists=creditArtists;this.sourceText=sourceText;} }
export class Artist { readonly name:string; constructor(name:string){this.name=name;} }
export class Track {
  readonly pk:string; readonly title:string; readonly version?:string; readonly originalArtists:Artist[]; readonly featuredArtists:Artist[]; readonly variation?:Variation;
  readonly selectedBy=new Set<string>(); selectionCount=0;
  constructor(pk:string,title:string,originalArtists:Artist[],featuredArtists:Artist[]=[],version?:string,variation?:Variation){Object.assign(this,{pk,title,originalArtists,featuredArtists,version,variation});}
  get display():string { const a=this.originalArtists.map(x=>x.name).join(' & '); return `${a} - ${this.title}${this.version?` (${this.version})`:''}`; }
}
export class Transition { count=1; readonly pk:string; readonly from:Track; readonly to:Track; constructor(pk:string,from:Track,to:Track){this.pk=pk;this.from=from;this.to=to;} }
export type ParsedVariation={type:VariationType;creditArtists:string[];sourceText:string};
export type ParsedTrack={source:string;artistText:string;title:string;version?:string;primary:string[];featured:string[];variation?:ParsedVariation;assumptions:string[];signals:string[]};
export class Tracklist { readonly playedBy:string; readonly entries:ParsedTrack[]; readonly rejectedLines:string[]; constructor(playedBy:string,entries:ParsedTrack[],rejectedLines:string[]=[]){this.playedBy=playedBy;this.entries=entries;this.rejectedLines=rejectedLines;} }
export type Emission={stage:string;ordinal?:number;lines:string[]};
export class Jukebox {
 private trackKey(e:ParsedTrack){return [e.primary.join('|'),e.featured.join('|'),e.title,e.version??''].join('\0');}
 private artists=new Map<string,Artist>(); private tracks=new Map<string,Track>(); private transitions=new Map<string,Transition>(); private trackNameCounts=new Map<string,number>(); private transitionNameCounts=new Map<string,number>();
 artist(name:string){const k=name.trim(); let a=this.artists.get(k); if(!a){a=new Artist(k);this.artists.set(k,a);} return a;}
 addTracklist(t:Tracklist):Emission[]{const out:Emission[]=[]; let prev:Track|undefined;
  t.entries.forEach((e,i)=>{const ordinal=i+1; out.push({stage:'SOURCE',ordinal,lines:[e.source]}); out.push({stage:'PARSE',ordinal,lines:[`title=${JSON.stringify(e.title)}`,`version=${JSON.stringify(e.version??null)}`,`primary=[${e.primary.join(', ')}]`,`featured=[${e.featured.join(', ')}]`,`variation=${e.variation?`${e.variation.type}[${e.variation.creditArtists.join(', ')}]`:null}`]});
   const key=this.trackKey(e); let tr=this.tracks.get(key); const created=!tr;
   if(!tr){const n=(this.trackNameCounts.get(e.title)??0)+1;this.trackNameCounts.set(e.title,n);tr=new Track(`${e.title}#${String(n).padStart(3,'0')}`,e.title,e.primary.map(x=>this.artist(x)),e.featured.map(x=>this.artist(x)),e.version,e.variation?new Variation(e.variation.type,e.variation.creditArtists.map(x=>this.artist(x)),e.variation.sourceText):undefined);this.tracks.set(key,tr);}
   tr.selectedBy.add(t.playedBy); tr.selectionCount++;
   out.push({stage:'RESOLVE',ordinal,lines:[`${tr.pk} ${created?'CREATED':'REUSED'}`,tr.display]});
   out.push({stage:'ATTRIBUTION',ordinal,lines:[...tr.originalArtists.map(a=>`${a.name} PRIMARY`),...tr.featuredArtists.map(a=>`${a.name} FEATURED`),...(tr.variation?[`variation=${tr.variation.type}`,...tr.variation.creditArtists.map(a=>`${a.name} VARIATION`)]:[]),...(e.assumptions.length?['assumptions:',...e.assumptions.map(x=>`  - ${x}`)]:[])]}); if(e.signals.length) out.push({stage:'SURPRISE',ordinal,lines:e.signals});
   if(prev){const k=`${prev.pk}>${tr.pk}`;let tx=this.transitions.get(k);const before=tx?.count??0;if(tx)tx.count++;else{const base=`${prev.title}->${tr.title}`;const n=(this.transitionNameCounts.get(base)??0)+1;this.transitionNameCounts.set(base,n);tx=new Transition(`${base}#${String(n).padStart(3,'0')}`,prev,tr);this.transitions.set(k,tx);}out.push({stage:'TRANSITION',ordinal,lines:[`${tx.pk} ${prev.pk} -> ${tr.pk}`,`count ${before} -> ${tx.count}`]});} prev=tr;
  });
  t.rejectedLines.forEach((x,i)=>out.push({stage:'UNACCOUNTED',lines:[`rejected[${i+1}]=${x}`]})); return out; }
 findTrack(e:ParsedTrack){return this.tracks.get(this.trackKey(e));}
 listTransitions(){return [...this.transitions.values()];}
 listTracks(){return [...this.tracks.values()];}
 listArtists(){return [...this.artists.values()];}
}
