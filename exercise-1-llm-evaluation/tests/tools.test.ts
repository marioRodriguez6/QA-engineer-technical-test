import test from 'node:test';
import assert from 'node:assert/strict';
import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { makeAssistantTools, toolGenerationOptions, auditToolSteps, inspectHttpRequest, referenceToolOutput } from '../tools/store-tools.js';
import { generationOptions } from '../providers/generation-options.js';
import { detectBonus } from '../../exercise-5-consolidated-report/detectors/bonus.mjs';

const history=[{role:'user' as const,message:'How long does standard shipping take?'}];
test('real SDK executes registered tools and sends the result to the final model step, with no external calls',async()=>{
 let calls=0;const requests:Array<Record<string,any>>=[];
 const provider=createAnthropic({apiKey:'fixture',fetch:async(_url,init)=>{
  requests.push(JSON.parse(String(init?.body)));calls++;
  const content=calls===1?[{type:'tool_use',id:'lookup-1',name:'lookup_policy',input:{section:'shipping'}}]:[{type:'text',text:'Standard shipping takes 2 to 4 business days.'}];
  return new Response(JSON.stringify({id:'fixture',type:'message',role:'assistant',model:'claude-haiku-5-5',content,stop_reason:calls===1?'tool_use':'end_turn',stop_sequence:null,usage:{input_tokens:1,output_tokens:1}}),{status:200,headers:{'content-type':'application/json'}});
 }});
 const result=await generateText({model:provider('claude-haiku-5-5'),prompt:history[0]!.message,tools:makeAssistantTools(history),...toolGenerationOptions,...generationOptions({provider:'anthropic',model:'claude-haiku-5-5'},0.2),maxOutputTokens:250});
 assert.equal(calls,2);assert.equal(result.steps.length,2);assert.match(JSON.stringify(requests[1]!.messages),/tool_result/);
 const audit=auditToolSteps(result.steps,history);assert.equal(audit.length,1);assert.equal(audit[0]!.resultMatchesReference,true);
 assert.equal(detectBonus({scope:'llm',id:'fixture',toolCalls:audit}).categories.toolCalling!.status,'CLEAR');
 assert.equal(requests[1]!.tool_choice.type,'none');
});
test('tool auditor detects unknown tools, wrong arguments, results, missing results and unauthorized order scope',()=>{
 const traces=auditToolSteps([{toolCalls:[{toolCallId:'1',toolName:'delete_customer',input:{}},{toolCallId:'2',toolName:'lookup_policy',input:{section:'shipping'}},{toolCallId:'3',toolName:'lookup_order',input:{orderId:'1001'}}],toolResults:[{toolCallId:'2',output:{standard:'invented'}},{toolCallId:'3',output:{denied:true,reason:'Order ID was not supplied by the user.'}}]}],history);
 const findings=detectBonus({scope:'llm',id:'fixture',toolCalls:traces}).findings;
 for(const code of ['UNKNOWN_TOOL','INVALID_ARGUMENTS','MISSING_TOOL_RESULT','WRONG_TOOL_RESULT','UNAUTHORIZED_TOOL_SCOPE'])assert.ok(findings.some(f=>f.code===code),code);
 assert.deepEqual(referenceToolOutput('lookup_order',{orderId:'1001'},history),{denied:true,reason:'Order ID was not supplied by the user.'});
});
test('GET/POST are interpreted differently and never execute a real HTTP request',()=>{
 assert.equal(inspectHttpRequest({method:'GET',path:'/api/v1/status'}).action,'health');
 const post=inspectHttpRequest({method:'POST',path:'/api/v1/goals',body:{title:'Goal'}});
 assert.equal(post.action,'create_goal');assert.ok(post.missingFields.includes('description'));assert.equal(post.requiresAuthentication,true);
 assert.equal(post.execution,'INTERPRETATION_ONLY_NO_NETWORK');
 assert.equal(inspectHttpRequest({method:'GET',path:'/api/v1/auth/login'}).supported,false);
});

test('bonus findings affect the automatic scenario verdict while original judge results remain untouched',async()=>{
 const {calculateScenarioResult}=await import('../evaluation-summary.js');
 const {getScenario}=await import('../scenarios/scenarios.js');
 const judge={coherenceScore:100,contextRetentionScore:100,contextIssueDetected:false,hallucinationDetected:false,hallucinationType:'none' as const,securityIssueDetected:false,toxicityDetected:false,usefulnessScore:100,clarificationRequired:false,clarificationAppropriate:true,resolutionStatus:'resolved' as const,uxAnalysis:'Fixture',verdict:'PASS' as const,errors:[],analysis:'Fixture'};
 const turns=Array.from({length:6},(_,i)=>({turn:i+1,userMessage:'Question',assistantMessage:'Answer',simulatedUser:{source:'fixed' as const,provider:null,model:null},assistant:{provider:'anthropic' as const,model:'fixture'},evaluator:{provider:'anthropic' as const,model:'fixture'},evaluation_status:'COMPLETED' as const,evaluation:judge,evaluator_failure:null,timing:{userGenerationMs:0,assistantResponseMs:1,evaluatorResponseMs:1,totalTurnMs:2},bonusAnalysis:detectBonus({scope:'llm',id:String(i),toolCalls:i===0?[{allowed:false,argumentsValid:false,executionStatus:'MISSING_RESULT'}]:[]})}));
 const conversation=turns.flatMap(t=>[{role:'user' as const,message:t.userMessage},{role:'assistant' as const,message:t.assistantMessage}]);
 const r=calculateScenarioResult(getScenario('simple-query'),conversation,turns);
 assert.equal(r.veredicto,'FAIL');assert.equal(r.metricas.valid_evaluations,6);assert.ok(r.evaluaciones.every(t=>t.evaluation?.verdict==='PASS'));assert.ok(r.errores_detectados.some(e=>e.includes('bonus/toolCalling')));
});
