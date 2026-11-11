import { LIMITS } from './model.js';
/** Original UTF-16 spans; NFC/case folding is only applied to index keys. */
export function occurrences(text:string):{text:string;start:number;end:number}[]{
 return Array.from(text.matchAll(/[\p{L}\p{N}\p{M}_$]+/gu),m=>({text:m[0],start:m.index,end:m.index+m[0].length}));
}
export function terms(text:string):string[]{
 const split=text.replace(/(\p{Ll}|\p{N})(\p{Lu})/gu,'$1 $2').replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu,'$1 $2');
 return [...new Set([...occurrences(text),...occurrences(split.replace(/[_$]/g,' '))].map(t=>t.text.normalize('NFC').toLowerCase()).filter(t=>t.length<=LIMITS.maxToken))].sort();
}

export function queryTerms(text:string):string[]{
 const split=text.replace(/(\p{Ll}|\p{N})(\p{Lu})/gu,'$1 $2').replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu,'$1 $2').replace(/[_$]/g,' ');
 return [...new Set(occurrences(split).map(t=>t.text.normalize('NFC').toLowerCase()).filter(t=>t.length<=LIMITS.maxToken))].sort();
}
