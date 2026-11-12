import path from 'node:path';
import type {ModuleRecord,ModuleResolution} from './model.js';
export function resolveModule(from:ModuleRecord,specifier:string|null,inventory:Map<string,ModuleRecord>):ModuleResolution{
 const result:ModuleResolution={status:'unsupported_resolution',specifier,normalizedPath:null,targetModuleId:null,candidates:[],code:null};
 const unsupported=(code:string)=>({...result,code});
 if(specifier===null)return unsupported('MODULE_SPECIFIER_UNSUPPORTED');
 if(!specifier.startsWith('./')&&!specifier.startsWith('../'))return unsupported(specifier.startsWith('node:')?'NODE_BUILTIN_UNSUPPORTED':/^[A-Za-z][A-Za-z0-9+.-]*:/.test(specifier)?'URL_SPECIFIER_UNSUPPORTED':specifier.startsWith('#')?'PACKAGE_IMPORT_MAP_UNSUPPORTED':'BARE_OR_ABSOLUTE_SPECIFIER_UNSUPPORTED');
 if(/[\\\u0000-\u001f\u007f%?#]/.test(specifier))return unsupported('MODULE_SPECIFIER_ENCODING_UNSUPPORTED');
 const normalized=path.posix.normalize(path.posix.join(path.posix.dirname(from.relativePath),specifier));
 if(normalized==='..'||normalized.startsWith('../')||normalized.startsWith('/'))return unsupported('MODULE_PATH_ESCAPE');
 result.normalizedPath=normalized;
 if(!path.posix.extname(normalized))return {...result,code:'EXTENSIONLESS_RESOLUTION_UNSUPPORTED'};
 if(!['.js','.jsx','.mjs'].includes(path.posix.extname(normalized)))return {...result,code:'MODULE_FORMAT_UNSUPPORTED'};
 const target=inventory.get(normalized);if(!target)return {...result,status:'unresolved_module',code:'MODULE_TARGET_NOT_IN_INVENTORY'};
 result.candidates=[target.id];result.targetModuleId=target.id;
 if(target.status==='unsupported')return {...result,code:'MODULE_TARGET_LANGUAGE_UNSUPPORTED'};
 if(target.astArtifactId===null||target.astDocumentHash===null)return {...result,status:'partial_evidence',code:'MODULE_TARGET_AST_UNAVAILABLE'};
 return {...result,status:'established',code:null};
}
/** Decode only verified ordinary JS string-literal escape spellings; never eval. */
export function decodeLiteral(raw:string):string|null{
 if(raw.length<2||!['"',"'"].includes(raw[0]!)||raw.at(-1)!==raw[0])return null;let out='';
 for(let i=1;i<raw.length-1;i++){const c=raw[i]!;if(c!=='\\'){if(c===raw[0]||c==='\n'||c==='\r')return null;out+=c;continue;}const n=raw[++i];if(n===undefined)return null;const simple:Record<string,string>={n:'\n',r:'\r',t:'\t',b:'\b',f:'\f',v:'\v','\\':'\\',"'":"'",'"':'"','/':'/'};if(Object.hasOwn(simple,n)){out+=simple[n];continue;}if(n==='0'&&!/[0-9]/.test(raw[i+1]??'')){out+='\0';continue;}
 if(n==='x'||n==='u'){let hex='';if(n==='u'&&raw[i+1]==='{'){const end=raw.indexOf('}',i+2);if(end<0)return null;hex=raw.slice(i+2,end);if(!/^[a-fA-F0-9]{1,6}$/.test(hex))return null;i=end;}else{const size=n==='x'?2:4;hex=raw.slice(i+1,i+1+size);if(!new RegExp(`^[a-fA-F0-9]{${size}}$`).test(hex))return null;i+=size;}const code=Number.parseInt(hex,16);if(code>0x10ffff)return null;out+=String.fromCodePoint(code);continue;}return null;
 }return out;
}
