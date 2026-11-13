import { test as base, expect, type APIResponse } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { detectBonus, type BonusEvidence } from '../../exercise-5-consolidated-report/detectors/bonus.mjs';

const goals = new Map<string, Record<string, unknown>>();
const deleted = new Set<string>();
export const test = base.extend({
  request: async ({ request }, use, testInfo) => {
    const evidence: Array<{ input: BonusEvidence; analysis: ReturnType<typeof detectBonus> }> = [];
    const proxy = new Proxy(request, {
      get(target, prop) {
        const value = Reflect.get(target, prop);
        if (typeof value !== 'function') return value;
        if (!['get', 'post', 'delete', 'put', 'patch', 'head'].includes(String(prop))) return value.bind(target);
        return async (url: string, options?: { data?: Record<string, unknown>; headers?: Record<string, string> }) => {
          const method = String(prop).toUpperCase(); const path = new URL(url).pathname;
          const response = await Reflect.apply(value, target, [url, options]) as APIResponse;
          let body: Record<string, any> = {};
          try { body = await response.json(); } catch { /* El contrato de cuerpo JSON queda registrado como fallido. */ }
          const isGoals = /^\/api\/v1\/goals(?:\/[^/]+)?$/.test(path);
          const allowed = (method === 'GET' && (path === '/api/v1/status' || isGoals)) ||
            (method === 'POST' && ['/api/v1/auth/register', '/api/v1/auth/login', '/api/v1/goals'].includes(path)) || (method === 'DELETE' && /\/goals\/[^/]+$/.test(path));
          const needed = path.endsWith('/register') ? ['name','email','password'] : path.endsWith('/login') ? ['email','password'] : method === 'POST' && isGoals ? ['title','description','status','priority'] : [];
          const argumentsValid = needed.every(k => options?.data?.[k] != null);
          const authorized = !isGoals || Boolean(options?.headers?.Authorization);
          const id = path.split('/').at(-1)!;
          const expectedStatus = testInfo.title.startsWith('API-004:') ? 401 : method === 'GET' && deleted.has(id) ? 404 : method === 'POST' && !path.endsWith('/login') ? 201 : 200;
          const facts = [{ field: 'http.status', expected: expectedStatus, actual: response.status(), source: 'Goal Tracker API contract and test case' }];
          const checks: Array<{field:string; expected:unknown; actual:unknown; source:string}> = [];
          if (path === '/api/v1/status') checks.push({ field: 'body.status', expected: 'OPERATIONAL', actual: body.status, source: 'API contract' });
          if (path.endsWith('/register')) for (const k of ['name','email']) checks.push({field:`user.${k}`,expected:options?.data?.[k],actual:body.user?.[k],source:'registration request'});
          if (path.endsWith('/login')) checks.push(expectedStatus === 401 ? {field:'error.msg',expected:'Invalid Credentials',actual:body.msg,source:'negative login contract'} : {field:'token.present',expected:true,actual:typeof body.token==='string'&&body.token.length>0,source:'login contract'});
          if (method === 'POST' && isGoals) {
            for (const k of ['title','description','status','priority']) checks.push({field:`goal.${k}`,expected:options?.data?.[k],actual:body.goal?.[k],source:'create request'});
            checks.push({field:'goal.id.present',expected:true,actual:typeof body.goal?._id==='string'&&body.goal._id.length>0,source:'API contract'}, {field:'goal.createdAt.valid',expected:true,actual:typeof body.goal?.createdAt==='string'&&!Number.isNaN(Date.parse(body.goal.createdAt)),source:'API contract'});
            if (body.goal?._id) goals.set(body.goal._id, { ...options?.data, _id: body.goal._id, createdAt: body.goal.createdAt });
          }
          if (method === 'GET' && isGoals && goals.has(id)) for (const [k,v] of Object.entries(goals.get(id)!)) checks.push({field:`goal.${k}`,expected:v,actual:body.goal?.[k],source:'previous create request/response'});
          if (method === 'GET' && path.endsWith('/goals')) checks.push({field:'goal.ids',expected:[...goals.keys()].sort(),actual:Array.isArray(body.goals)?body.goals.map((g:Record<string,unknown>)=>g._id).sort():null,source:'created goals in this serial suite'});
          if (method === 'DELETE' && isGoals && response.status() === 200) { goals.delete(id); deleted.add(id); }
          const input: BonusEvidence = { scope:'api',id:testInfo.title.split(':')[0]!,responseRole:'api-data',facts:[...facts,...checks],contextChecks:checks.filter(c=>c.source.startsWith('previous')||c.field==='goal.ids'),toolCalls:[{toolName:`HTTP ${method} ${path}`,allowed,argumentsValid,scopeAuthorized:authorized,executionStatus:'COMPLETED'}] };
          evidence.push({ input, analysis: detectBonus(input) });
          return response;
        };
      },
    });
    try { await use(proxy); }
    finally {
      const path = testInfo.outputPath('bonus-evidence.json');
      await writeFile(path, JSON.stringify({scope:'api',id:testInfo.title.split(':')[0],records:evidence},null,2));
      await testInfo.attach('API bonus evidence', {path,contentType:'application/json'});
    }
  },
});
export { expect };
