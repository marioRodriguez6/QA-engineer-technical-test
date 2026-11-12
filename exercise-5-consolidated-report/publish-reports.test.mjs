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
    units: Array.from({ length: 5 }, () => ({ suite: 'llm', status: success ? 'PASS' : 'BLOCKED' })),
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
test('missing evidence and semantic failures cannot become last successful', t => {
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
