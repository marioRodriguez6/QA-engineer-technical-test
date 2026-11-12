import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildReport, renderMarkdown, scenarioIds } from './generate-report.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'qa-report-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (suite, name, value) => {
    const dir = join(root, suite); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), typeof value === 'string' ? value : JSON.stringify(value));
  };
  const evaluation = () => ({ coherenceScore: 100, contextRetentionScore: 100, hallucinationDetected: false, hallucinationType: 'none', securityIssueDetected: false, toxicityDetected: false, verdict: 'PASS', errors: [], analysis: 'Fixture' });
  const reports = Object.fromEntries(scenarioIds.map(id => [id, {
    veredicto: 'PASS', execution_status: 'COMPLETED', expected_turns: 6, completed_turns: 6,
    turnos: Array.from({ length: 12 }, (_, i) => ({ rol: i % 2 ? 'asistente' : 'usuario', mensaje: 'message' })),
    evaluaciones: Array.from({ length: 6 }, (_, i) => ({ turn: i + 1, evaluation_status: 'COMPLETED', evaluation: evaluation(), timing: { assistantResponseMs: 100, evaluatorResponseMs: 200 } })),
    errores_detectados: [],
  }]));
  const summary = { commit: 'current', results: scenarioIds.map(scenarioId => ({ scenarioId, ciStatus: 'PASS', verdict: 'PASS', exitCode: 0 })) };
  const flush = () => { put('llm', 'execution-summary.json', summary); for (const [id, report] of Object.entries(reports)) put('llm', `${id}.json`, report); };
  flush();
  for (const [suite, prefix, n] of [['api', 'API', 11], ['chatbot-docs', 'CHATBOT', 4], ['chatbot-homepage', 'HOME', 4]]) {
    put(suite, 'results.json', { suites: [{ specs: Array.from({ length: n }, (_, i) => ({
      title: `${prefix}-${String(i + 1).padStart(3, '0')}: Case`,
      tests: [{ status: suite === 'chatbot-docs' && i === 2 ? 'skipped' : 'expected', results: [{ status: suite === 'chatbot-docs' && i === 2 ? 'skipped' : 'passed', duration: 50 }] }],
    })) }] });
  }
  return { root, put, reports, summary, flush, read: metadata => buildReport(root, { commit: 'current', ...metadata }) };
}

test('complete evidence retains skipped Docs case, weighted metrics and distinct latency semantics', t => {
  const f = fixture(t); f.put('chatbot-homepage', 'homepage-response-time.json', { responseTimeMs: 5114 });
  const r = f.read();
  assert.equal(r.plannedUnits, 24); assert.equal(r.counts.PASS, 23); assert.equal(r.counts.SKIPPED, 1);
  assert.equal(r.metrics.passExecutedPercent, 100); assert.equal(r.metrics.passedPlannedPercent, 95.83);
  assert.equal(r.metrics.validEvaluations, 30); assert.equal(r.metrics.meanTimesMs.homepageResponseMs.mean, 5114);
  assert.equal(r.metrics.meanTimesMs.apiTestMs.mean, 50); assert.equal(r.overall, 'INCOMPLETE');
  assert.equal(r.bonus.toolCalling.status, 'NOT_IMPLEMENTED'); assert.equal(r.bonus.toolCalling.detectedErrors, null);
  assert.match(renderMarkdown(r), /NOT_EVALUATED/);
});

test('empty artifacts still produce a report with MISSING and null semantic metrics', t => {
  const f = fixture(t); rmSync(f.root, { recursive: true });
  const r = f.read({ needs: { typecheck: { result: 'failure' }, llm: { result: 'skipped' } } });
  assert.equal(r.counts.MISSING, 24); assert.equal(r.metrics.meanCoherence, null);
  assert.equal(r.metrics.flaggedTurnRatePercent, null); assert.equal(r.metrics.passExecutedPercent, null);
  assert.equal(r.overall, 'FAIL'); assert.equal(r.evidenceComplete, false);
  assert.match(renderMarkdown(r), /24 missing/);
});

test('quota blocker is not an assistant quality FAIL', t => {
  const f = fixture(t); const r = f.reports['simple-query'];
  Object.assign(r, { veredicto: 'BLOCKED', execution_status: 'BLOCKED', completed_turns: 1, turnos: r.turnos.slice(0, 2), evaluaciones: [{ turn: 1, evaluation_status: 'UNAVAILABLE', evaluation: null }], errores_detectados: ['Groq quota exhausted'] });
  Object.assign(f.summary.results[0], { ciStatus: 'BLOCKED', verdict: 'BLOCKED', exitCode: 2 }); f.flush();
  const report = f.read(); assert.equal(report.counts.BLOCKED, 1); assert.equal(report.counts.FAIL, 0);
  assert.equal(report.metrics.validEvaluations, 24); assert.equal(report.metrics.completedConversationsPercent, 80);
  assert.match(renderMarkdown(report), /Groq quota exhausted/);
});

test('semantic findings include unsupported, toxicity and security without double-counting flagged turns', t => {
  const f = fixture(t); const e = f.reports['prompt-injection'].evaluaciones[1].evaluation;
  Object.assign(e, { verdict: 'FAIL', hallucinationDetected: true, hallucinationType: 'unsupported', securityIssueDetected: true, toxicityDetected: true, contextRetentionScore: 60, errors: ['Security and unsupported content'] });
  f.reports['prompt-injection'].veredicto = 'FAIL';
  f.reports['prompt-injection'].errores_detectados = e.errors;
  Object.assign(f.summary.results[4], { ciStatus: 'FAIL', verdict: 'FAIL', exitCode: 1 }); f.flush();
  const r = f.read(); assert.equal(r.counts.FAIL, 1); assert.equal(r.metrics.flaggedTurns, 1);
  assert.equal(r.bonus.hallucinations.unsupported, 1); assert.equal(r.bonus.hallucinations.demonstrablyFalse, 0);
  assert.equal(r.bonus.promptInjection.securityFailures, 1); assert.equal(r.bonus.toxicity.detectedTurns, 1);
  assert.equal(r.bonus.context.scoreDeviations, 1); assert.equal(r.overall, 'FAIL');
});

test('malformed JSON cannot become PASS', t => {
  const f = fixture(t); f.put('api', 'results.json', '{bad json'); const r = f.read();
  assert.equal(r.counts.MISSING, 11); assert.equal(r.evidenceComplete, false); assert.ok(r.issues.some(x => x.includes('invalid JSON')));
});

test('mismatched source commit rejects LLM evidence rather than reusing old PASS', t => {
  const f = fixture(t); f.summary.commit = 'old'; f.flush(); const r = f.read();
  assert.equal(r.counts.MISSING, 5); assert.equal(r.metrics.validEvaluations, 0); assert.equal(r.metrics.meanCoherence, null);
});

test('inconsistent scenario summary and invalid evaluator fields are reported as ERROR', t => {
  const f = fixture(t); f.reports['simple-query'].evaluaciones[0].evaluation.coherenceScore = '100'; f.flush();
  const r = f.read(); assert.equal(r.counts.ERROR, 1); assert.equal(r.scenarios[0].reportedVerdict, 'PASS'); assert.equal(r.evidenceComplete, false);
});

test('failed API assertion and retry history are preserved', t => {
  const f = fixture(t); f.put('api', 'results.json', { suites: [{ specs: [{ title: 'API-001: health', tests: [{ status: 'unexpected', results: [{ status: 'failed', duration: 100, errors: [{ message: 'Expected 200, received 500' }] }] }] }] }] });
  const r = f.read(); assert.equal(r.counts.FAIL, 1); assert.equal(r.counts.MISSING, 10);
  assert.match(renderMarkdown(r), /Expected 200, received 500/); assert.equal(r.overall, 'FAIL');
});

test('flaky tests do not silently become ordinary PASS', t => {
  const f = fixture(t); f.put('chatbot-homepage', 'results.json', { suites: [{ specs: [{ title: 'HOME-001: launcher', tests: [{ status: 'flaky', results: [{ status: 'failed', duration: 100, errors: [{ message: 'First attempt timeout' }] }, { status: 'passed', duration: 50 }] }] }] }] });
  const r = f.read(); assert.equal(r.counts.FLAKY, 1); assert.match(renderMarkdown(r), /First attempt timeout/);
});

test('no zero-error inference from unavailable evaluations', t => {
  const f = fixture(t);
  for (const [i, id] of scenarioIds.entries()) {
    f.reports[id].evaluaciones.forEach(turn => { turn.evaluation_status = 'UNAVAILABLE'; turn.evaluation = null; });
    f.reports[id].veredicto = 'REVIEW'; Object.assign(f.summary.results[i], { ciStatus: 'REVIEW', verdict: 'REVIEW', exitCode: 1 });
  }
  f.flush(); const r = f.read(); assert.equal(r.counts.REVIEW, 5); assert.equal(r.metrics.flaggedTurnRatePercent, null);
  assert.equal(r.metrics.completedConversationsPercent, 100); assert.equal(r.metrics.llmEvaluationCoveragePercent, 0);
});

test('download failure remains an evidence error even if some downloaded files exist', t => {
  const f = fixture(t); const r = f.read({ downloads: { api: 'failure', llm: 'success' } });
  assert.equal(r.evidenceComplete, false); assert.equal(r.overall, 'INCOMPLETE');
  assert.ok(r.issues.some(issue => issue.includes('artifact download outcome failure')));
});

test('duplicate source reports are rejected instead of selecting a convenient PASS', t => {
  const f = fixture(t); mkdirSync(join(f.root, 'api', 'duplicate'));
  writeFileSync(join(f.root, 'api', 'duplicate', 'results.json'), '{}');
  const r = f.read(); assert.equal(r.counts.MISSING, 11); assert.equal(r.evidenceComplete, false);
});

test('new UX fields and scenario analysis are consolidated while historical omissions remain unknown', t => {
  const f = fixture(t);
  f.reports['simple-query'].experience = { resolutionStatus: 'partial', explanation: 'Order not fully resolved.' };
  f.reports['simple-query'].analisis = 'Turn 1: clarification is useful but resolution is partial.';
  for (const turn of f.reports['simple-query'].evaluaciones) {
    turn.evaluation.usefulnessScore = 75;
    turn.evaluation.contextIssueDetected = false;
  }
  f.flush(); const r = f.read();
  assert.equal(r.metrics.meanUsefulness, 75);
  assert.equal(r.metrics.resolution.partial, 1); assert.equal(r.metrics.resolution.unknown, 4);
  assert.equal(r.bonus.context.explicitDetectorCoverage, 6);
  assert.equal(r.scenarios[0].experience.resolutionStatus, 'partial');
  assert.match(renderMarkdown(r), /Turn 1: clarification/);
});



test('functional FAIL preserves quality findings while execution can complete successfully', t => {
  const f = fixture(t); const report = f.reports['conversational-memory'];
  report.veredicto = 'FAIL';
  Object.assign(report.evaluaciones[1].evaluation, { verdict: 'FAIL', contextIssueDetected: true, errors: ['Irrelevant order details'] });
  Object.assign(f.summary.results[3], { ciStatus: 'FAIL', verdict: 'FAIL', exitCode: 1, evaluationCompleted: true });
  f.flush(); const r = f.read({ needs: { llm: { result: 'success' }, playwright: { result: 'success' } } });
  assert.equal(r.executionStatus, 'COMPLETED'); assert.equal(r.overall, 'FAIL');
  assert.equal(r.metrics.flaggedTurns, 1); assert.equal(r.metrics.flaggedTurnRatePercent, 3.33);
  const md = renderMarkdown(r);
  assert.match(md, /Evaluation execution: COMPLETED/); assert.match(md, /Observed quality: FAIL/);
  assert.match(md, /Irrelevant order details/);
});

test('synthesis keeps verbose evidence inside disclosures and exposes required summary dimensions', t => {
  const f = fixture(t); f.reports['simple-query'].analisis = 'VERBOSE_ORIGINAL_ANALYSIS'; f.flush();
  const md = renderMarkdown(f.read()); const location = md.indexOf('VERBOSE_ORIGINAL_ANALYSIS');
  assert.ok(md.lastIndexOf('<details>', location) > md.lastIndexOf('</details>', location));
  for (const label of ['Coherence /100', 'Hallucination flags', 'Security %', 'Completion', 'Incorrect tool calling', 'Prompt injection', 'Toxic responses', 'Average timings', 'API and chatbot']) assert.ok(md.includes(label), label);
  assert.match(md, /Original scenario analysis \(preserved\)/);
});


test('available REVIEW is a quality result, while missing REVIEW judgments are incomplete', t => {
  const f = fixture(t); const s = f.reports['ambiguous-information'];
  s.veredicto = 'REVIEW'; s.evaluaciones[2].evaluation.verdict = 'REVIEW';
  Object.assign(f.summary.results[2], { ciStatus: 'REVIEW', verdict: 'REVIEW', exitCode: 1 }); f.flush();
  const r = f.read({ needs: { llm: { result: 'success' }, playwright: { result: 'success' } } });
  assert.equal(r.executionStatus, 'COMPLETED'); assert.equal(r.scenarios[2].status, 'REVIEW');
  assert.match(renderMarkdown(r), /REVIEW is technical incompleteness only when a judgment is unavailable/);
  s.evaluaciones[2].evaluation_status = 'UNAVAILABLE'; s.evaluaciones[2].evaluation = null; f.flush();
  assert.equal(f.read().executionStatus, 'INCOMPLETE');
});

test('Exercise 5 CLI emits only JSON and Markdown report files, never HTML', async t => {
  const { spawnSync } = await import('node:child_process');
  const { readdirSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const f = fixture(t); const output = join(f.root, 'generated');
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./generate-report.mjs', import.meta.url)), f.root, output], {
    encoding: 'utf8', env: { ...process.env, GITHUB_SHA: 'current', GITHUB_STEP_SUMMARY: '' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readdirSync(output).sort(), ['consolidated-report.json', 'consolidated-report.md']);
});
