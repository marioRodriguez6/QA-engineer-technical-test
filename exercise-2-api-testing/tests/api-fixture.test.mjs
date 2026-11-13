import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync,readFileSync,readdirSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('API instrumentation audits the unchanged eleven-case suite against a local contract server',async()=>{
 const goals=new Map();let user;let sequence=0;
 const server=createServer(async(req,res)=>{
  let raw='';for await(const c of req)raw+=c;const data=raw?JSON.parse(raw):{};
  const send=(code,body)=>{res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify(body));};
  const url=new URL(req.url,'http://localhost');const path=url.pathname;const id=path.split('/').at(-1);
  if(path==='/api/v1/status')return send(200,{status:'OPERATIONAL'});
  if(path==='/api/v1/auth/register'){user=data;return send(201,{user:{name:data.name,email:data.email}});}
  if(path==='/api/v1/auth/login')return data.password===user?.password?send(200,{token:'fixture-local-token'}):send(401,{msg:'Invalid Credentials'});
  if(req.headers.authorization!=='Bearer fixture-local-token')return send(401,{msg:'Unauthorized'});
  if(path==='/api/v1/goals'&&req.method==='POST'){const goal={...data,_id:`goal-${++sequence}`,createdAt:new Date().toISOString()};goals.set(goal._id,goal);return send(201,{goal});}
  if(path==='/api/v1/goals'&&req.method==='GET')return send(200,{goals:[...goals.values()]});
  if(req.method==='DELETE'&&goals.has(id)){goals.delete(id);return send(200,{msg:'Success! Goal removed.'});}
  if(req.method==='GET'&&goals.has(id))return send(200,{goal:goals.get(id)});
  send(404,{msg:'Not found'});
 });
 const output=mkdtempSync(join(tmpdir(),'qa-api-contract-'));
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}`;
  const cli=createRequire(import.meta.url).resolve('@playwright/test/cli');let stdout='',stderr='';
  const child=spawn(process.execPath,[cli,'test','exercise-2-api-testing/tests/status.spec.ts'],{env:{...process.env,GOAL_TRACKER_API_URL:url,QA_REPORT_DIR:output},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);
  const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
  assert.equal(code,0,stdout+stderr);
  const report=JSON.parse(readFileSync(join(output,'results.json'),'utf8'));assert.equal(report.stats.expected,11);
  function files(root){return readdirSync(root,{withFileTypes:true}).filter(e=>e.name!=='html').flatMap(e=>e.isDirectory()?files(join(root,e.name)):[join(root,e.name)]);}
  const evidence=files(output).filter(f=>f.endsWith('bonus-evidence.json'));assert.equal(evidence.length,11);
  for(const file of evidence){const text=readFileSync(file,'utf8');assert.ok(!text.includes('fixture-local-token'));const r=JSON.parse(text);assert.equal(r.records.length,1);assert.equal(r.records[0].analysis.categories.toolCalling.status,'CLEAR');assert.equal(r.records[0].analysis.categories.hallucination.status,'CLEAR');}
 } finally{await new Promise(resolve=>server.close(resolve));rmSync(output,{recursive:true,force:true});}
});
