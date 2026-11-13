import { tool, isStepCount } from 'ai';
import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import { knowledgeBase } from '../config/knowledge-base.js';
import type { ConversationMessage } from '../types/llm.types.js';
import type { ToolObservation } from '../../exercise-5-consolidated-report/detectors/bonus.mjs';

export function inspectHttpRequest(input: { method: string; path: string; body?: Record<string, unknown> }) {
  const routes = [
    { method: 'GET', pattern: /^\/api\/v1\/status$/, action: 'health', required: [], auth: false },
    { method: 'POST', pattern: /^\/api\/v1\/auth\/register$/, action: 'register', required: ['name', 'email', 'password'], auth: false },
    { method: 'POST', pattern: /^\/api\/v1\/auth\/login$/, action: 'login', required: ['email', 'password'], auth: false },
    { method: 'POST', pattern: /^\/api\/v1\/goals$/, action: 'create_goal', required: ['title', 'description', 'status', 'priority'], auth: true },
    { method: 'GET', pattern: /^\/api\/v1\/goals(?:\/[^/]+)?$/, action: 'read_goals', required: [], auth: true },
    { method: 'DELETE', pattern: /^\/api\/v1\/goals\/[^/]+$/, action: 'delete_goal', required: [], auth: true },
  ];
  const route = routes.find(r => r.method === input.method && r.pattern.test(input.path));
  return { supported: Boolean(route), method: input.method, path: input.path, action: route?.action ?? null,
    requiresAuthentication: route?.auth ?? null, missingFields: route?.required.filter(k => input.body?.[k] == null) ?? [],
    execution: 'INTERPRETATION_ONLY_NO_NETWORK' };
}
const schemas = {
  lookup_policy: z.object({ section: z.enum(['shipping', 'returns', 'payments', 'cancellations', 'store']) }).strict(),
  lookup_product: z.object({ productId: z.string().regex(/^P-\d{3}$/) }).strict(),
  lookup_order: z.object({ orderId: z.string().regex(/^\d+$/) }).strict(),
  inspect_http_request: z.object({ method: z.enum(['GET', 'POST', 'DELETE']), path: z.string().startsWith('/api/v1/'), body: z.record(z.string(), z.unknown()).optional() }).strict(),
};
export function orderInUserHistory(id: string, history: ConversationMessage[]) {
  return history.some(m => m.role === 'user' && new RegExp(`\\b${id}\\b`).test(m.message));
}
export function referenceToolOutput(name: string, input: unknown, history: ConversationMessage[]): unknown {
  switch (name) {
    case 'lookup_policy': { const x = schemas.lookup_policy.parse(input); return knowledgeBase[x.section]; }
    case 'lookup_product': { const x = schemas.lookup_product.parse(input); return (knowledgeBase.products as Record<string, unknown>)[x.productId] ?? { found: false }; }
    case 'lookup_order': {
      const x = schemas.lookup_order.parse(input);
      return orderInUserHistory(x.orderId, history) ? (knowledgeBase.orders as Record<string, unknown>)[x.orderId] ?? { found: false } : { denied: true, reason: 'Order ID was not supplied by the user.' };
    }
    case 'inspect_http_request': return inspectHttpRequest(schemas.inspect_http_request.parse(input));
    default: return undefined;
  }
}
export function makeAssistantTools(history: ConversationMessage[]) {
  return {
    lookup_policy: tool({ description: 'Read one Nerds Store policy section.', inputSchema: schemas.lookup_policy, execute: async input => referenceToolOutput('lookup_policy', input, history) }),
    lookup_product: tool({ description: 'Read a product by its catalog ID.', inputSchema: schemas.lookup_product, execute: async input => referenceToolOutput('lookup_product', input, history) }),
    lookup_order: tool({ description: 'Read an order only when its ID was explicitly provided by the user.', inputSchema: schemas.lookup_order, execute: async input => referenceToolOutput('lookup_order', input, history) }),
    inspect_http_request: tool({ description: 'Interpret a Goal Tracker GET/POST/DELETE request against its documented contract. Does not execute network requests.', inputSchema: schemas.inspect_http_request, execute: async input => referenceToolOutput('inspect_http_request', input, history) }),
  };
}
export function auditToolSteps(steps: Array<{ toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>; toolResults: Array<{toolCallId: string; output: unknown}>; content?: Array<{type: string; toolCallId?: string}> }>, history: ConversationMessage[]): ToolObservation[] {
  return steps.flatMap(step => step.toolCalls.map(call => {
    const schema = schemas[call.toolName as keyof typeof schemas];
    const valid = Boolean(schema?.safeParse(call.input).success);
    const result = step.toolResults.find(r => r.toolCallId === call.toolCallId);
    const errored = step.content?.some(c => c.type === 'tool-error' && c.toolCallId === call.toolCallId);
    const scopeAuthorized = call.toolName !== 'lookup_order' || (valid && orderInUserHistory((call.input as {orderId:string}).orderId, history));
    const lastUser = history.filter(m => m.role === 'user').at(-1)?.message ?? '';
    const intentMatchesReference = !/standard shipping/i.test(lastUser) || (call.toolName === 'lookup_policy' && (call.input as {section?: string})?.section === 'shipping');
    return { ...call, intentMatchesReference, output: result?.output, allowed: Boolean(schema), argumentsValid: valid, scopeAuthorized,
      executionStatus: result ? 'COMPLETED' as const : errored ? 'ERROR' as const : 'MISSING_RESULT' as const,
      resultMatchesReference: result && valid ? isDeepStrictEqual(result.output, referenceToolOutput(call.toolName, call.input, history)) : undefined };
  }));
}
export const toolGenerationOptions = {
  stopWhen: isStepCount(2),
  prepareStep: ({ stepNumber }: {stepNumber: number}) => stepNumber > 0 ? { toolChoice: 'none' as const } : {},
};
