import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { captureEvidence, writeEvidence } from './publish-evidence.mjs';
import { publishReports } from './publish-reports.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'qa-all-outputs-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const inputs = join(root, 'inputs');
  const put = (path, data) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, data); };
  put(join(inputs, 'llm/simple-query.json'), '{"veredicto":"FAIL"}');
  put(join(inputs, 'llm/execution-summary.json'), '{}'); put(join(inputs, 'llm/simple-query.log'), 'Original FAIL finding');
  for (const suite of ['api', 'chatbot-docs', 'chatbot-homepage']) {
    put(join(inputs, suite, 'results.json'), '{"suites":[]}');
    put(join(inputs, suite, 'html/index.html'), '<html>Original report</html>');
  }
  put(join(inputs, 'chatbot-homepage/test-results/video.webm'), Buffer.from([0, 255, 13, 2]));
  put(join(inputs, 'chatbot-docs/chatbot-response-time.json'), '{"responseTimeMs":100}');
  const report = { metadata: { downloads: Object.fromEntries(['llm', 'api', 'chatbot-docs', 'chatbot-homepage'].map(s => [s, 'success'])) }, units: [{ suite: 'llm', id: 'simple-query', status: 'FAIL' }] };
  const publication = { runId: '10', runNumber: 10, attempt: 1, sourceCommit: 'tested' };
  return { root, inputs, put, report, publication };
}

test('every suite publishes current files, binary evidence, status and source hashes without changing a functional FAIL', t => {
  const f = fixture(t); const plans = captureEvidence(f.inputs, f.report);
  writeEvidence(f.root, plans, f.publication, f.report);
  assert.equal(JSON.parse(readFileSync(join(f.root, 'output/exercise1-JSON/simple-query.json'))).veredicto, 'FAIL');
  assert.equal(readFileSync(join(f.root, 'output/exercise1-JSON/ci/simple-query.log'), 'utf8'), 'Original FAIL finding');
  assert.deepEqual(readFileSync(join(f.root, 'output/exercise3-chatbot/homepage/test-results/video.webm')), Buffer.from([0, 255, 13, 2]));
  assert.ok(existsSync(join(f.root, 'output/exercise2API-Reports/html/index.html')));
  const m = JSON.parse(readFileSync(join(f.root, 'output/evidence-manifest.json')));
  assert.equal(m.runNumber, 10); assert.equal(m.suites.length, 4);
  assert.ok(m.files.every(e => /^[a-f0-9]{64}$/.test(e.sha256) && /^[a-f0-9]{64}$/.test(e.originalSha256)));
});

test('missing artifacts remove stale current results and record MISSING instead of reusing an earlier pass', t => {
  const f = fixture(t); f.put(join(f.root, 'output/exercise2API-Reports/results.json'), '{"old":"PASS"}');
  rmSync(join(f.inputs, 'api'), { recursive: true }); f.report.metadata.downloads.api = 'failure';
  writeEvidence(f.root, captureEvidence(f.inputs, f.report), f.publication, f.report);
  assert.equal(existsSync(join(f.root, 'output/exercise2API-Reports/results.json')), false);
  const status = JSON.parse(readFileSync(join(f.root, 'output/exercise2API-Reports/execution-status.json')));
  assert.equal(status.evidenceStatus, 'MISSING'); assert.equal(status.downloadOutcome, 'failure');
});

test('historical evidence remains intact and older or repeated runs cannot replace newer exercise outputs', t => {
  const f = fixture(t); const history = join(f.root, 'output/exercise1-JSON/history/old.json'); f.put(history, 'historical');
  const plans = captureEvidence(f.inputs, f.report);
  writeEvidence(f.root, plans, f.publication, f.report);
  assert.deepEqual(writeEvidence(f.root, [], { ...f.publication, runNumber: 9 }, f.report), []);
  assert.deepEqual(writeEvidence(f.root, [], f.publication, f.report), []);
  assert.equal(readFileSync(history, 'utf8'), 'historical');
  assert.ok(existsSync(join(f.root, 'output/exercise1-JSON/simple-query.json')));
});

test('published API copies redact credentials in JSON and zipped traces while original artifacts remain unchanged', t => {
  const f = fixture(t); const trace = join(f.inputs, 'api/test-results/trace.zip');
  const api = join(f.inputs, 'api/results.json'); f.put(api, '{"token":"private-token","test":"PASS"}');
  mkdirSync(dirname(trace), { recursive: true });
  const network = JSON.stringify({ headers: [{ name: 'Authorization', value: 'Bearer private-token' }], postData: { text: JSON.stringify({ password: 'private-password' }) } });
  const created = spawnSync('python3', ['-c', 'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],"w"); z.writestr("trace.network",sys.argv[2]); z.close()', trace, network], { encoding: 'utf8' });
  assert.equal(created.status, 0, created.stderr);
  const plans = captureEvidence(f.inputs, f.report); writeEvidence(f.root, plans, f.publication, f.report);
  assert.equal(JSON.parse(readFileSync(api)).token, 'private-token');
  const published = JSON.parse(readFileSync(join(f.root, 'output/exercise2API-Reports/results.json')));
  assert.equal(published.token, '[REDACTED]'); assert.equal(published.test, 'PASS');
  const decoded = spawnSync('python3', ['-c', 'import zipfile,sys; print(zipfile.ZipFile(sys.argv[1]).read("trace.network").decode())', join(f.root, 'output/exercise2API-Reports/test-results/trace.zip')], { encoding: 'utf8' });
  assert.equal(decoded.status, 0, decoded.stderr); assert.ok(!decoded.stdout.includes('private-token')); assert.ok(!decoded.stdout.includes('private-password'));
});

test('real Git publication includes all output folders, stages removals and excludes unrelated working files', t => {
  const f = fixture(t); const remote = join(f.root, 'remote.git'); const cwd = join(f.root, 'checkout'); const source = join(f.root, 'generated');
  const git = (dir, args) => { const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  git(f.root, ['init', '--bare', remote]); git(f.root, ['clone', remote, cwd]);
  git(cwd, ['checkout', '-b', 'feature']); git(cwd, ['config', 'user.name', 'Test']); git(cwd, ['config', 'user.email', 'test@example.com']);
  f.put(join(cwd, '.gitignore'), 'output/exercise3-chatbot/docs/\noutput/exercise3-chatbot/homepage/\n');
  f.put(join(cwd, 'source.txt'), 'source'); f.put(join(cwd, 'output/exercise2API-Reports/stale.json'), 'old');
  git(cwd, ['add', '.']); git(cwd, ['commit', '-m', 'source']); const sha = git(cwd, ['rev-parse', 'HEAD']); git(cwd, ['push', 'origin', 'feature']);
  const r = { ...f.report, evidenceComplete: false, scenarios: [], counts: {}, metadata: { ...f.report.metadata, commit: sha, runUrl: 'https://github.com/owner/repo/actions/runs/10', attempt: '1', needs: {} } };
  f.put(join(source, 'consolidated-report.json'), JSON.stringify(r)); f.put(join(source, 'consolidated-report.md'), 'Partial evaluation');
  f.put(join(cwd, 'unrelated.txt'), 'never commit');
  publishReports({ cwd, sourceRoot: source, inputRoot: f.inputs, branch: 'feature', sourceSha: sha, runId: '10', runNumber: 10, attempt: 1 });
  const changed = git(cwd, ['show', '--format=', '--name-only', 'HEAD']).split('\n');
  for (const path of ['output/exercise1-JSON/simple-query.json', 'output/exercise2API-Reports/results.json', 'output/exercise3-chatbot/docs/results.json', 'output/exercise3-chatbot/homepage/results.json', 'output/reporte-consolidado/lastRun/consolidated-report.md', 'output/evidence-manifest.json', 'output/exercise2API-Reports/stale.json']) assert.ok(changed.includes(path), path);
  assert.ok(changed.every(p => p.startsWith('output/'))); assert.ok(!changed.includes('unrelated.txt'));
  assert.match(git(cwd, ['log', '-1', '--format=%s']), /\[skip ci\]/);
});
