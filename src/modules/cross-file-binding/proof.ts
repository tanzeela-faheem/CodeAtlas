import type {ImportRecord, ModuleDocument} from '../module-linking/model.js';
import type {SymbolRecord} from '../symbol-resolution/model.js';
import {lookup} from '../module-linking/extraction.js';
import {decodeLiteral} from '../module-linking/resolver.js';
import type {AstNode} from '../ast-management/model.js';
/** No name lookup: validate the exact Phase 1 -> producer-symbol join. */
export function importSymbol(input:ModuleDocument, record:ImportRecord):SymbolRecord|null {
 const module=input.modules.find(m=>m.id===record.moduleId), file=input.inputs.files.find(f=>f.relativePath===module?.relativePath), doc=file?.resolution;
 if(!doc||!file.ast||!record.localSymbolId||!['named','default','namespace'].includes(record.form))return null;
 const s=doc.symbols.find(s=>s.id===record.localSymbolId),scope=doc.scopes.find(s=>s.id===doc.symbols.find(s=>s.id===record.localSymbolId)?.scopeId);
 if(!s||s.kind!=='import'||!s.import||scope?.kind!=='module'||scope.parentId!==null||s.name!==record.localName||s.import.importedName!==record.importedName||s.import.moduleSpecifier!==record.source.specifier||!s.declarations.some(d=>d.astNodeId===record.syntax.astNodeId))return null;
 if(input.imports.filter(i=>i.moduleId===record.moduleId&&i.localSymbolId===s.id).length!==1)return null;
 // Duplicate lexical declarations cannot be turned into a uniquely usable binding.
 if(doc.symbols.filter(other=>other.scopeId===s.scopeId&&other.name===s.name).length!==1)return null;
 return s;
}
export function astString(node:AstNode, file:ModuleDocument['inputs']['files'][number]):string|null {
 if(node.type!=='string')return null;const q=lookup(file),stack=[node],leaves:AstNode[]=[];
 while(stack.length){const n=stack.pop()!;if(n.children.length)stack.push(...q.children(n).reverse());else leaves.push(n);}
 let offset=node.start.offset,text='';for(const leaf of leaves){if(leaf.start.offset!==offset||leaf.text===undefined)return null;text+=leaf.text;offset=leaf.end.offset;}
 return offset===node.end.offset?decodeLiteral(text):null;
}
