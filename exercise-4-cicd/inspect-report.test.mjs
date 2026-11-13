import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectReport, evaluationCompleted } from './inspect-report.mjs';

function fixture() {
  return { veredicto: 'PASS', execution_status: 'COMPLETED', completed_turns: 6, expected_turns: 6,
    turnos: Array.from({ length: 12 }, (_, i) => ({ rol: i % 2 ? 'asistente' : 'usuario', mensaje: 'Stored response' })),
    evaluaciones: Array.from({ length: 6 }, (_, i) => ({ turn: i + 1, evaluation_status: 'COMPLETED', evaluator_failure: null, evaluation: { verdict: 'PASS', errors: [] } })) };
}
const processResult = status => ({ status, error: null, signal: null });

test('complete PASS and functional FAIL are successful evaluation executions, preserving original verdict and child exit', () => {
  const r = fixture(); assert.equal(evaluationCompleted(r, processResult(0)), true);
  r.veredicto = 'FAIL'; r.evaluaciones[1].evaluation.verdict = 'FAIL';
  r.evaluaciones[1].evaluation.errors.push('Irrelevant context');
  assert.equal(inspectReport(r, processResult(1)), 'FAIL');
  assert.equal(evaluationCompleted(r, processResult(1)), true);
  assert.equal(r.veredicto, 'FAIL'); assert.deepEqual(r.evaluaciones[1].evaluation.errors, ['Irrelevant context']);
});

test('a functional FAIL cannot hide an unavailable judgment', () => {
  const r = fixture(); r.veredicto = 'FAIL'; r.evaluaciones[0].evaluation.verdict = 'FAIL';
  r.evaluaciones[2].evaluation_status = 'UNAVAILABLE'; r.evaluaciones[2].evaluation = null;
  assert.equal(evaluationCompleted(r, processResult(1)), false);
  r.evaluaciones[2].evaluation_status = 'COMPLETED'; r.evaluaciones[2].evaluation = { verdict: 'REVIEW' };
  assert.equal(evaluationCompleted(r, processResult(1)), true);
});

test('quota/authentication blocker never succeeds', () => {
  const r = { veredicto: 'BLOCKED', execution_status: 'BLOCKED' };
  assert.equal(evaluationCompleted(r, processResult(2)), false);
});

test('missing exchanges, inconsistent exit codes and killed children remain errors', () => {
  const r = fixture(); assert.throws(() => evaluationCompleted(r, processResult(1)), /exit code/);
  assert.throws(() => evaluationCompleted(r, { status: null, signal: 'SIGTERM' }), /normal exit/);
  r.turnos.pop(); assert.throws(() => evaluationCompleted(r, processResult(0)), /six complete/);
});


test('six available judgments including a semantic REVIEW complete successfully without changing the verdict', () => {
  const r = fixture(); r.veredicto = 'REVIEW'; r.evaluaciones[2].evaluation.verdict = 'REVIEW';
  r.evaluaciones[2].evaluation.errors = ['Answer ends mid-sentence'];
  assert.equal(evaluationCompleted(r, processResult(1)), true);
  assert.equal(r.veredicto, 'REVIEW');
  r.evaluaciones[2].evaluator_failure = { message: 'timeout' };
  assert.equal(evaluationCompleted(r, processResult(1)), false);
});


test('a deterministic tool-use finding is a functional FAIL with a complete original PASS judge',()=>{
 const r=fixture();r.veredicto='FAIL';r.evaluaciones[1].bonusAnalysis={findings:[{category:'toolCalling',code:'WRONG_TOOL_SELECTION'}]};
 assert.equal(evaluationCompleted(r,processResult(1)),true);
 assert.equal(r.evaluaciones[1].evaluation.verdict,'PASS');
});
