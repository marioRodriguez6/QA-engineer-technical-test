import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateScenarioResult, type TurnResult } from '../evaluation-summary.js';
import { turnEvaluationSchema, type TurnEvaluation } from '../types/evaluation.types.js';
import { getScenario } from '../scenarios/scenarios.js';
import { cases, compareJudgment, detectorFlag, evaluationInput } from './evaluator-cases.js';

function evaluation(patch: Partial<TurnEvaluation> = {}): TurnEvaluation {
  return { coherenceScore: 100, contextRetentionScore: 100, contextIssueDetected: false, hallucinationDetected: false, hallucinationType: 'none', securityIssueDetected: false, toxicityDetected: false,
    usefulnessScore: 90, clarificationRequired: false, clarificationAppropriate: true, resolutionStatus: 'resolved', uxAnalysis: 'Shipping request answered using the supplied policy.', verdict: 'PASS', errors: [], analysis: 'Matches the policy.', ...patch };
}
function run(evaluations: Array<TurnEvaluation | null>, complete = true) {
  const turns: TurnResult[] = evaluations.map((e, i) => ({ turn: i + 1, userMessage: 'Question', assistantMessage: 'Answer', simulatedUser: { source: 'fixed', provider: null, model: null }, assistant: { provider: 'groq', model: 'fixture' }, evaluator: { provider: 'groq', model: 'fixture' }, evaluation_status: e ? 'COMPLETED' : 'UNAVAILABLE', evaluation: e, evaluator_failure: e ? null : { type: 'INVALID_JSON', message: 'Unavailable judgment', diagnostics: null }, timing: { userGenerationMs: 0, assistantResponseMs: 100, evaluatorResponseMs: 200, totalTurnMs: 300 } }));
  const length = complete ? 6 : evaluations.length;
  const history = Array.from({ length: length * 2 }, (_, i) => ({ role: i % 2 ? 'assistant' as const : 'user' as const, message: 'message' }));
  return calculateScenarioResult(getScenario('simple-query'), history, turns, complete ? null : { stage: 'evaluator', turn: length, message: 'Rate limit' });
}

test('false and unsupported responses are counted separately and in the total without double counting', () => {
  const r = run([evaluation({ hallucinationDetected: true, hallucinationType: 'unsupported', verdict: 'FAIL', errors: ['Price absent from KB'] }), evaluation({ hallucinationDetected: true, hallucinationType: 'demonstrably_false', verdict: 'FAIL' }), ...Array.from({ length: 4 }, () => evaluation())]);
  assert.equal(r.metricas.hallucination_rate, 33.33); assert.equal(r.metricas.unsupported_rate, 16.67); assert.equal(r.metricas.demonstrably_false_rate, 16.67);
  assert.equal(r.veredicto, 'FAIL'); assert.match(r.errores_detectados.join(), /Turn 1: Price absent/); assert.match(r.analisis, /Turn 1:/);
});
test('quality metrics exclude unavailable judgments, not convert them to successes', () => {
  const r = run([evaluation({ coherenceScore: 60, securityIssueDetected: true, verdict: 'FAIL' }), null, null, null, null, null]);
  assert.equal(r.metricas.coherence_score, 60); assert.equal(r.metricas.security_score, 0); assert.equal(r.metricas.evaluation_coverage_rate, 16.67); assert.equal(r.experience.resolutionStatus, 'unknown');
});
test('no evaluations yields null quality and REVIEW despite six generated responses', () => {
  const r = run(Array.from({ length: 6 }, () => null));
  assert.equal(r.metricas.hallucination_rate, null); assert.equal(r.metricas.usefulness_score, null); assert.equal(r.metricas.security_score, null); assert.equal(r.veredicto, 'REVIEW');
});
test('six exchanges do not imply that the user need was resolved', () => {
  const r = run(Array.from({ length: 6 }, () => evaluation({ resolutionStatus: 'unresolved', uxAnalysis: 'The order cannot be located without its number.' })));
  assert.equal(r.metricas.completed_conversation_rate, 100); assert.equal(r.experience.resolutionStatus, 'unresolved'); assert.equal(r.experience.evaluatedTurn, 6);
});
test('quota blocker remains BLOCKED with preserved evidence and unknown resolution', () => {
  const r = run([evaluation()], false); assert.equal(r.veredicto, 'BLOCKED'); assert.equal(r.completed_turns, 1); assert.equal(r.experience.resolutionStatus, 'unknown'); assert.equal(r.metricas.completed_conversation_rate, 0);
});
test('schema requires explicit UX fields and rejects invalid scores or fabricated enum values', () => {
  assert.ok(turnEvaluationSchema.safeParse(evaluation()).success);
  assert.equal(turnEvaluationSchema.safeParse({ ...evaluation(), usefulnessScore: 101 }).success, false);
  assert.equal(turnEvaluationSchema.safeParse({ ...evaluation(), resolutionStatus: 'PASS' }).success, false);
  const { uxAnalysis, ...missing } = evaluation(); assert.equal(turnEvaluationSchema.safeParse(missing).success, false);
});
test('reference expectations remain fixed; disagreement is recorded rather than repaired', () => {
  const item = cases.find(c => c.id === 'FACT-FALSE')!;
  const diff = compareJudgment(item, evaluation()); assert.ok(diff.some(d => d.field === 'hallucinationType'));
  assert.equal(item.expected.hallucinationType, 'demonstrably_false');
});
test('reference set has positive and negative controls in every detector category and full supplied history', () => {
  assert.equal(new Set(cases.map(c => c.id)).size, cases.length);
  for (const category of ['hallucination', 'context', 'security', 'toxicity']) {
    assert.ok(cases.some(c => c.category === category && c.positive)); assert.ok(cases.some(c => c.category === category && !c.positive));
  }
  const input = evaluationInput(cases.find(c => c.id === 'MEMORY-WRONG')!);
  assert.equal(input.history[0]!.message, 'My name is Mario.'); assert.equal(input.history.at(-1)!.message, 'Your name is Carlos.');
  assert.equal(detectorFlag('context', evaluation({ contextIssueDetected: true })), true);
  assert.equal(detectorFlag('hallucination', evaluation({ hallucinationType: 'unsupported' })), true);
});

test('Haiku 5.5 request omits temperature and forwards disabled thinking without an external call', async () => {
  const { createAnthropic } = await import('@ai-sdk/anthropic');
  const { generateText } = await import('ai');
  const { generationOptions } = await import('../providers/generation-options.js');
  let body: Record<string, unknown> | undefined;
  const provider = createAnthropic({ apiKey: 'fixture-not-a-real-key', fetch: async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: 'fixture', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'text', text: 'Fixture reply' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  const config = { provider: 'anthropic' as const, model: 'claude-haiku-5-5' };
  const result = await generateText({ model: provider(config.model), prompt: 'Fixture only', maxOutputTokens: 100, ...generationOptions(config, 0.1) });
  assert.equal(result.text, 'Fixture reply');
  assert.equal(Object.hasOwn(body!, 'temperature'), false);
  assert.deepEqual(body!.thinking, { type: 'disabled' });
  assert.deepEqual(generationOptions({ provider: 'groq', model: 'fixture' }, 0.2), { temperature: 0.2 });
});
