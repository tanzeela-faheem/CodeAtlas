import { createHash } from 'node:crypto';
import { occurrences,terms } from '../normalization.js';
import { compare } from '../indexing.js';
import { LIMITS,SearchError } from '../model.js';
import { ADVANCED_LIMITS,type AdvancedLimits,type HistoricalSource,type PositionRef } from './model.js';
import type { Range } from '../../symbol-resolution/model.js';
export const tokenKey=(text:string)=>text.normalize('NFC').toLowerCase();
export function positions(text:string,documents:Map<number,string>){return occurrences(text).map(t=>({start:t.start,end:t.end,term:t.text.length<=LIMITS.maxToken?tokenKey(t.text):null,documentId:documents.get(t.start)??null}));}
export function positionalTables(sources:HistoricalSource[],limits:AdvancedLimits=ADVANCED_LIMITS){
 const tokens=new Map<string,PositionRef[]>(),lexical=new Map<string,PositionRef[]>();let count=0,total=0;
 const add=(map:Map<string,PositionRef[]>,key:string,ref:PositionRef)=>{if(++count>limits.maxPostings)throw new SearchError('SEARCH_RESOURCE_LIMIT',413);const list=map.get(key)??[];list.push(ref);map.set(key,list);if(map.size>limits.maxTerms)throw new SearchError('SEARCH_RESOURCE_LIMIT',413);};
 for(const s of sources)for(let i=0;i<s.positions.length;i++){
 if(++total>limits.maxPositions)throw new SearchError('SEARCH_RESOURCE_LIMIT',413);const p=s.positions[i]!,ref={fileId:s.fileId,position:i};
 if(p.term!==null){add(tokens,p.term,ref);for(const term of terms(s.text.slice(p.start,p.end)))add(lexical,term,ref);}
 }
 const sorted=(map:Map<string,PositionRef[]>):[string,PositionRef[]][]=>[...map].sort((a,b)=>compare(a[0],b[0]));return {tokens:sorted(tokens),lexical:sorted(lexical)};
}
export const sourceHash=(text:string)=>createHash('sha256').update(text,'utf8').digest('hex');
export function lineStarts(text:string){const starts=[0];for(let i=0;i<text.length;i++)if(text[i]==='\n')starts.push(i+1);return starts;}
export function sourceRange(starts:number[],start:number,end:number):Range{
 const point=(offset:number)=>{let lo=0,hi=starts.length;while(lo+1<hi){const mid=(lo+hi)>>>1;if(starts[mid]!<=offset)lo=mid;else hi=mid;}return {offset,row:lo,column:offset-starts[lo]!};};return {start:point(start),end:point(end)};
}
export function snippet(text:string,start:number,end:number){
 let left=Math.max(0,start-40),right=Math.min(text.length,end+40,start+384);
 if(left>0&&/[\uDC00-\uDFFF]/.test(text[left]!))left--;
 if(right<text.length&&/[\uDC00-\uDFFF]/.test(text[right]!))right++;
 return {text:text.slice(left,right),startOffset:left,matchStart:start-left,matchEnd:Math.min(end,right)-left,truncated:end>right,identity:'indexed_historical_snapshot' as const};
}
