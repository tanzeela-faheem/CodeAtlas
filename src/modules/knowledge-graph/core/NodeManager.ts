import { digest } from '../../symbol-resolution/integration/contracts.js';
import { artifactId as astArtifactId } from '../../ast-management/identity.js';
import { resolutionId } from '../../symbol-resolution/validation.js';
import { check } from '../../../shared/validation.js';
import { graphId } from '../contracts.js';
import { GRAPH_LIMITS, GraphError, type GraphFile, type GraphNode, type GraphProvenance, type GraphLimits } from '../model.js';

/** One node per authoritative entity, plus distinct nodes for resolver lexical bindings. */
export class NodeManager {
    readonly byId=new Map<string,GraphNode>();
    readonly byEntity=new Map<string,GraphNode>();
    readonly bySymbol=new Map<string,GraphNode>();
    constructor(private readonly provenance:GraphProvenance,private readonly limits:Readonly<GraphLimits>=GRAPH_LIMITS){}
    private add(node:GraphNode):void {
        const prior=this.byId.get(node.graphNodeId);
        if(prior){check(JSON.stringify(prior)===JSON.stringify(node),'conflicting graph node');return;}
        if(this.byId.size>=this.limits.maxNodes)throw new GraphError('GRAPH_NODE_LIMIT',413);
        this.byId.set(node.graphNodeId,node);
    }
    addFile(f:GraphFile,sourceArtifactId=astArtifactId(f.ast)):void {
        const {projectId,analysisId}=this.provenance;
        const evidence={astArtifactId:sourceArtifactId,metadataArtifactId:'',resolutionArtifactId:null as string|null};
        // References are supplied by validated producer inputs, not derived from entity names.
        const {createdAt:_,...identity}=f.metadata.sourceAst;
        evidence.metadataArtifactId=digest(['metadata-file',1,f.metadata.extractorVersion,identity]);
        if(f.resolution)evidence.resolutionArtifactId=resolutionId(f.resolution);
        for(const entity of [...f.metadata.entities].sort((a,b)=>a.entityId.localeCompare(b.entityId))){
            const node:GraphNode={graphNodeId:graphId('gn',this.provenance,['entity',entity.entityId]),projectId,analysisId,nodeKind:entity.kind as GraphNode['nodeKind'],displayName:entity.name??entity.kind,qualifiedName:entity.qualifiedName,language:entity.language,relativePath:entity.relativePath,range:entity.sourceRange,metadataEntityId:entity.entityId,symbolId:null,astNodeId:entity.astNodeId,parentGraphNodeId:entity.parentEntityId?graphId('gn',this.provenance,['entity',entity.parentEntityId]):null,declarationGraphNodeIds:[],evidence:{...evidence},attributes:entity.attributes,properties:entity.properties,limitations:f.metadata.extractionStatus==='partial'?['PARTIAL_METADATA']:[]};
            this.add(node);this.byEntity.set(entity.entityId,this.byId.get(node.graphNodeId)!);
        }
        if(f.resolution){
            const ast=new Map(f.ast.nodes.map(n=>[n.id,n]));
            for(const symbol of [...f.resolution.symbols].sort((a,b)=>a.id.localeCompare(b.id))){
                const n=ast.get(symbol.bindingNodeId)!;
                const declarations=[...new Set(symbol.declarations.flatMap(d=>d.metadataEntityId?[this.byEntity.get(d.metadataEntityId)!.graphNodeId]:[]))].sort();
                const node:GraphNode={graphNodeId:graphId('gn',this.provenance,['symbol',symbol.id]),projectId,analysisId,nodeKind:'binding',displayName:symbol.name,qualifiedName:null,language:f.ast.language,relativePath:f.ast.relativePath,range:{start:n.start,end:n.end},metadataEntityId:null,symbolId:symbol.id,astNodeId:n.id,parentGraphNodeId:null,declarationGraphNodeIds:declarations,evidence:{...evidence},attributes:{bindingKind:symbol.kind,scopeId:symbol.scopeId},properties:{initializationOffset:symbol.initializationOffset,import:symbol.import},limitations:['LEXICAL_BINDING_NOT_RUNTIME_VALUE',...(declarations.length?[]:['AST_ONLY_BINDING'])]};
                this.add(node);this.bySymbol.set(symbol.id,this.byId.get(node.graphNodeId)!);
            }
        }
    }
    nodes():GraphNode[]{return [...this.byId.values()].sort((a,b)=>a.graphNodeId.localeCompare(b.graphNodeId));}
}
