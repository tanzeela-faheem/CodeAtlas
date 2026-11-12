import type {AstNode} from '../ast-management/model.js';
import type {InputFile,ModuleRecord} from '../module-linking/model.js';
import type {Target} from '../cross-file-binding/model.js';
import type {ReferenceRecord} from '../symbol-resolution/model.js';
import {lookup,recordId} from '../module-linking/extraction.js';
import type {Caller,Callee,Limits} from './model.js';
const functions=new Set(['function_declaration','generator_function_declaration','function_expression','generator_function','arrow_function','method_definition']);
export function callerContext(file:InputFile,module:ModuleRecord,site:AstNode,ref:ReferenceRecord|undefined,limits:Limits,work:()=>void):Caller {
 const q=lookup(file),doc=file.resolution,scopeMap=new Map(doc?.scopes.map(s=>[s.id,s])??[]),ancestry=new Set<string>();let scope=ref?scopeMap.get(ref.scopeId):undefined;
 while(scope){work();ancestry.add(scope.id);scope=scope.parentId?scopeMap.get(scope.parentId):undefined;}
 const make=(node:AstNode,kind:Caller['kind'],codes:string[]=[],truncated=false):Caller=>{const scopes=doc?.scopes.filter(s=>s.astNodeId===node.id&&(kind==='module'?s.kind==='module':['function','parameters'].includes(s.kind)))??[],symbols=doc?.symbols.filter(s=>s.declarations.some(d=>d.astNodeId===node.id))??[],metadata=[...new Set(symbols.flatMap(s=>s.declarations.filter(d=>d.astNodeId===node.id&&d.metadataEntityId).map(d=>d.metadataEntityId!)))];return {id:recordId('xc',module.id,kind,node.id),moduleId:module.id,relativePath:module.relativePath,kind,astArtifactId:module.astArtifactId!,astNodeId:node.id,nodeType:node.type,range:{start:node.start,end:node.end},scopeIds:scopes.map(s=>s.id).sort(),symbolIds:symbols.map(s=>s.id).sort(),metadataEntityId:metadata.length===1?metadata[0]!:null,codes,truncated};};
 let child=site,parent=site.parentId?q.nodes.get(site.parentId):undefined,depth=0;
 while(parent){work();if(++depth>limits.maxContextDepth)return make(site,'call_site',['CALLER_DEPTH_LIMIT'],true);
  if(functions.has(parent.type)){
   if(!['body','parameters','parameter'].includes(child.fieldName??''))return make(site,'call_site',['CALLABLE_NON_BODY_CONTEXT']);
   const scopes=doc?.scopes.filter(s=>s.astNodeId===parent!.id&&['function','parameters'].includes(s.kind))??[];
   if(!scopes.some(s=>ancestry.has(s.id)))return make(site,'call_site',['CALLER_SCOPE_PROOF_UNAVAILABLE']);
   return make(parent,'callable');
  }
  if(['field_definition','class_static_block','class_heritage','decorator'].includes(parent.type))return make(site,'call_site',['INITIALIZER_OR_CLASS_CONTEXT_DEFERRED']);
  if(parent.id===file.ast!.rootId){const root=doc?.scopes.find(s=>s.kind==='module'&&s.parentId===null);return root&&ancestry.has(root.id)?make(parent,'module'):make(site,'call_site',['CALLER_MODULE_SCOPE_UNAVAILABLE']);}
  child=parent;parent=parent.parentId?q.nodes.get(parent.parentId):undefined;
 }
 return make(site,'call_site',['CALLER_CONTAINMENT_UNAVAILABLE']);
}
export function callableTarget(origin:Target,file:InputFile,module:ModuleRecord):{target:Callee|null;code:string|null} {
 if(!file.ast||!module.syntaxComplete)return {target:null,code:'TARGET_AST_UNAVAILABLE_OR_INCOMPLETE'};
 const q=lookup(file);let node:AstNode|undefined,meaning:Callee['meaning'];
 if(origin.status==='established_declaration'&&origin.origin.kind==='binding'){
  const symbol=file.resolution?.symbols.find(s=>s.id===origin.origin.symbolId);
  if(!symbol||symbol.declarations.length!==1||!['function','function-name'].includes(symbol.kind))return {target:null,code:'ORIGIN_NOT_UNIQUE_FUNCTION_DECLARATION'};
  if(file.resolution!.references.some(r=>['write','read_write'].includes(r.usage)&&(r.symbolId===symbol.id||r.candidates.includes(symbol.id)||r.status!=='resolved')))return {target:null,code:'TARGET_BINDING_MUTATION_OR_UNKNOWN_WRITE'};
  node=q.nodes.get(origin.declarationAstNodeId!);if(!node||!['function_declaration','generator_function_declaration','function_expression','generator_function'].includes(node.type))return {target:null,code:'CALLABLE_DECLARATION_FORM_UNSUPPORTED'};
  meaning='function_declaration';
 }else if(origin.status==='established_export_slot'&&origin.origin.kind==='default_expression'){
  node=q.nodes.get(origin.expressionAstNodeId!);const parent=node?.parentId?q.nodes.get(node.parentId):undefined;
  if(!node||!['function_expression','generator_function','arrow_function'].includes(node.type)||parent?.type!=='export_statement'||q.field(parent,'value')?.id!==node.id)return {target:null,code:'EXPORT_EXPRESSION_RESULT_NOT_CALLABLE_PROOF'};
  meaning='default_function_slot';
 }else return {target:null,code:'ORIGIN_NOT_SUPPORTED_CALLABLE'};
 return {target:{originId:origin.id,moduleId:module.id,relativePath:module.relativePath,astArtifactId:module.astArtifactId!,astNodeId:node.id,nodeType:node.type,range:{start:node.start,end:node.end},symbolId:origin.origin.symbolId,metadataEntityId:origin.metadataEntityId,meaning},code:null};
}
