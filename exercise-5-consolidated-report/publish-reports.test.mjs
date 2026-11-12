import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { successfulRun, writeSnapshots, publishReports } from './publish-reports.mjs';

function report(success = true) {
  return {
    evidenceComplete: true, metadata: { runUrl: 'https://github.com/owner/repo/actions/runs/10', attempt: '1', commit: 'tested', needs: { typecheck: { result: 'success' }, playwright: { result: 'success' }, llm: { result: success ? 'success' : 'failure' } } },
    counts: { PASS: success ? 23 : 19, SKIPPED: 1, FAIL: 0, BLOCKED: success ? 0 : 4, REVIEW: 0, MISSING: 0, ERROR: 0, FLAKY: 0 },
    units: ['simple-query', 'topic-change', 'ambiguous-information', 'conversational-memory', 'prompt-injection'].map(id => ({ id, suite: 'llm', status: success ? 'PASS' : 'BLOCKED' })),
    scenarios: ['simple-query', 'topic-change', 'ambiguous-information', 'conversational-memory', 'prompt-injection'].map(id => ({
      id, status: success ? 'PASS' : 'BLOCKED', reportedVerdict: success ? 'PASS' : 'BLOCKED',
      completedTurns: success ? 6 : 1, validEvaluations: success ? 6 : 0,
      turnEvaluations: Array.from({ length: success ? 6 : 1 }, (_, i) => ({ turn: i + 1, evaluation_status: success ? 'COMPLETED' : 'UNAVAILABLE', evaluation: success ? { verdict: 'PASS' } : null })),
    })),
  };
}
function temporary(t) {
  const dir = mkdtempSync(join(tmpdir(), 'qa-publication-'));
  t.after(() => rmSync(dir, { recursive: true, force: true })); return dir;
}
const marker = (runNumber, attempt = 1) => ({ runNumber, attempt });
const destination = (root, folder, name = 'consolidated-report.md') => join(root, 'exercise-5-consolidated-report', folder, name);

test('a successful workflow updates both snapshots while preserving the explicit skipped case', t => {
  const root = temporary(t); assert.equal(successfulRun(report()), true);
  assert.deepEqual(writeSnapshots(root, 'success', report(), marker(1)), ['lastRun', 'LastSuccesfulrun']);
  assert.equal(JSON.parse(readFileSync(destination(root, 'LastSuccesfulrun', 'consolidated-report.json'))).counts.SKIPPED, 1);
});
test('a later failed workflow changes lastRun without changing the last successful report', t => {
  const root = temporary(t); writeSnapshots(root, 'success', report(), marker(1));
  assert.deepEqual(writeSnapshots(root, 'quota failure', report(false), marker(2)), ['lastRun']);
  assert.equal(readFileSync(destination(root, 'LastSuccesfulrun'), 'utf8'), 'success');
  assert.equal(readFileSync(destination(root, 'lastRun'), 'utf8'), 'quota failure');
});
test('older runs cannot replace newer snapshots, but can advance an older successful snapshot', t => {
  const root = temporary(t); writeSnapshots(root, 'first success', report(), marker(1));
  writeSnapshots(root, 'new failure', report(false), marker(4));
  assert.deepEqual(writeSnapshots(root, 'second success', report(), marker(3)), ['LastSuccesfulrun']);
  assert.equal(readFileSync(destination(root, 'lastRun'), 'utf8'), 'new failure');
  assert.equal(readFileSync(destination(root, 'LastSuccesfulrun'), 'utf8'), 'second success');
  assert.deepEqual(writeSnapshots(root, 'old', report(), marker(2)), []);
});
test('a newer attempt updates a run; repeating it is idempotent', t => {
  const root = temporary(t); writeSnapshots(root, 'a1', report(), marker(1));
  assert.equal(writeSnapshots(root, 'a2', report(), marker(1, 2)).length, 2);
  assert.deepEqual(writeSnapshots(root, 'a2 duplicate', report(), marker(1, 2)), []);
});
test('missing evidence and unexplained failures cannot become last successful', t => {
  const root = temporary(t); const r = report(); r.evidenceComplete = false;
  writeSnapshots(root, 'missing', r, marker(1)); assert.equal(existsSync(destination(root, 'LastSuccesfulrun')), false);
  r.evidenceComplete = true; r.counts.FAIL = 1; assert.equal(successfulRun(r), false);
});
test('publisher commits only report snapshots to a real branch and retains unrelated files', t => {
  const root = temporary(t); const remote = join(root, 'remote.git'); const cwd = join(root, 'checkout'); const source = join(root, 'output');
  function git(dir, args) { const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); }
  git(root, ['init', '--bare', remote]); git(root, ['clone', remote, cwd]);
  git(cwd, ['config', 'user.name', 'Test']); git(cwd, ['config', 'user.email', 'test@example.com']);
  git(cwd, ['checkout', '-b', 'feature']); writeFileSync(join(cwd, 'source.txt'), 'unchanged'); git(cwd, ['add', '.']); git(cwd, ['commit', '-m', 'source']);
  const sha = git(cwd, ['rev-parse', 'HEAD']); git(cwd, ['push', 'origin', 'feature']);
  mkdirSync(source); const r = report(false); r.metadata.commit = sha;
  writeFileSync(join(source, 'consolidated-report.md'), 'failed run'); writeFileSync(join(source, 'consolidated-report.json'), JSON.stringify(r));
  writeFileSync(join(cwd, 'untracked.txt'), 'do not commit');
  const options = { cwd, sourceRoot: source, branch: 'feature', sourceSha: sha, runId: '10', runNumber: 2, attempt: 1 };
  assert.deepEqual(publishReports(options), ['lastRun']);
  const files = git(cwd, ['show', '--format=', '--name-only', 'HEAD']).split('\n');
  assert.equal(files.length, 3); assert.ok(files.every(path => path.startsWith('exercise-5-consolidated-report/lastRun/')));
  assert.match(git(cwd, ['log', '-1', '--format=%s']), /\[skip ci\]/);
  assert.equal(readFileSync(join(cwd, 'source.txt'), 'utf8'), 'unchanged');
  assert.equal(existsSync(destination(cwd, 'LastSuccesfulrun')), false);
  assert.deepEqual(publishReports(options), []);
});

function withSemanticFailure() {
  const r = report();
  r.metadata.needs.llm.result = 'failure';
  r.counts.PASS--; r.counts.FAIL++;
  r.units[0].status = 'FAIL';
  r.scenarios[0].status = 'FAIL'; r.scenarios[0].reportedVerdict = 'FAIL';
  r.scenarios[0].turnEvaluations[1].evaluation = { verdict: 'FAIL', hallucinationType: 'unsupported', errors: ['Claim absent from knowledge base'] };
  r.overall = 'FAIL';
  return r;
}

test('complete semantic LLM FAIL updates both snapshots without changing the original finding or workflow result', t => {
  const root = temporary(t); const r = withSemanticFailure();
  assert.equal(successfulRun(r), true);
  assert.deepEqual(writeSnapshots(root, 'Detected hallucination: FAIL', r, marker(1)), ['lastRun', 'LastSuccesfulrun']);
  const saved = JSON.parse(readFileSync(destination(root, 'LastSuccesfulrun', 'consolidated-report.json')));
  assert.equal(saved.overall, 'FAIL'); assert.equal(saved.metadata.needs.llm.result, 'failure');
  assert.equal(saved.scenarios[0].turnEvaluations[1].evaluation.verdict, 'FAIL');
});

test('quota or timeout after a semantic finding updates only lastRun', t => {
  const root = temporary(t); writeSnapshots(root, 'prior complete evaluation', report(), marker(1));
  const r = withSemanticFailure();
  r.counts.BLOCKED = 1; r.units[1].status = 'BLOCKED'; r.scenarios[1].status = 'BLOCKED';
  assert.deepEqual(writeSnapshots(root, 'token exhaustion', r, marker(2)), ['lastRun']);
  assert.equal(readFileSync(destination(root, 'LastSuccesfulrun'), 'utf8'), 'prior complete evaluation');
});

test('six responses with an unavailable evaluator are insufficient for last successful', t => {
  const root = temporary(t); const r = withSemanticFailure();
  r.scenarios[0].turnEvaluations[5].evaluation_status = 'UNAVAILABLE';
  r.scenarios[0].turnEvaluations[5].evaluation = null;
  assert.deepEqual(writeSnapshots(root, 'evaluator timeout', r, marker(1)), ['lastRun']);
});

test('partial conversation, missing scenario and failed API/UI job are not complete evaluations', () => {
  for (const mutate of [
    r => { r.scenarios[0].completedTurns = 5; },
    r => { r.scenarios.pop(); },
    r => { r.metadata.needs.playwright.result = 'failure'; },
    r => { r.counts.REVIEW = 1; },
  ]) { const r = withSemanticFailure(); mutate(r); assert.equal(successfulRun(r), false); }
});


test('new complete evaluation with functional FAIL and successful job updates both snapshots', t => {
  const root = temporary(t); const r = withSemanticFailure();
  r.metadata.needs.llm.result = 'success'; r.executionStatus = 'COMPLETED';
  assert.equal(successfulRun(r), true);
  assert.deepEqual(writeSnapshots(root, 'Complete evaluation with findings', r, marker(1)), ['lastRun', 'LastSuccesfulrun']);
  r.metadata.needs.llm.result = 'failure'; r.executionStatus = 'FAILED';
  assert.equal(successfulRun(r), false);
});


test('available semantic REVIEW updates both snapshots; unavailable REVIEW does not', t => {
  const root = temporary(t); const r = report(); r.executionStatus = 'COMPLETED';
  r.counts.PASS--; r.counts.REVIEW++;
  r.units[0].status = 'REVIEW';
  r.scenarios[0].status = 'REVIEW'; r.scenarios[0].reportedVerdict = 'REVIEW';
  r.scenarios[0].turnEvaluations[2].evaluation.verdict = 'REVIEW';
  assert.equal(successfulRun(r), true);
  assert.deepEqual(writeSnapshots(root, 'Quality needs review; execution complete', r, marker(1)), ['lastRun', 'LastSuccesfulrun']);
  r.scenarios[0].turnEvaluations[2].evaluation_status = 'UNAVAILABLE';
  r.scenarios[0].turnEvaluations[2].evaluation = null;
  assert.equal(successfulRun(r), false);
  assert.deepEqual(writeSnapshots(root, 'Judge timeout', r, marker(2)), ['lastRun']);
});
