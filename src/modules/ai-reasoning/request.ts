import * as v from '../../shared/validation.js';
import {parseContextRequest,publicContextRequest} from '../ai-context/request.js';
import type {ReasoningRequest} from './model.js';
export function parseReasoningRequest(raw:unknown):ReasoningRequest {
 const o=v.object(raw,'reasoning request',['schemaVersion','contextRequest'],['style','explanation']);
 v.check(o.schemaVersion===1,'reasoning schema');
 const context=parseContextRequest(o.contextRequest),style=o.style??'concise',explanation=o.explanation??'overview';
 v.member(style,['concise','detailed'],'answer style');v.member(explanation,['overview','source','relationships'],'explanation');
 return {schemaVersion:1,contextRequest:publicContextRequest(context),style:style as ReasoningRequest['style'],explanation:explanation as ReasoningRequest['explanation']};
}
