import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const folders = ['lastRun', 'LastSuccesfulrun'];
const problematic = ['FAIL', 'REVIEW', 'BLOCKED', 'MISSING', 'ERROR', 'FLAKY'];

export function successfulRun(report) {
  return report.evidenceComplete === true &&
    ['typecheck', 'playwright', 'llm'].every(job => report.metadata?.needs?.[job]?.result === 'success') &&
    problematic.every(status => report.counts?.[status] === 0) &&
    report.units?.filter(unit => unit.suite === 'llm' && unit.status === 'PASS').length === 5;
}

function newer(candidate, current) {
  if (!current) return true;
  if (candidate.runNumber !== current.runNumber) return candidate.runNumber > current.runNumber;
  return candidate.attempt > current.attempt;
}

export function writeSnapshots(cwd, markdown, report, publication) {
  const changed = [];
  for (const folder of folders) {
    if (folder === 'LastSuccesfulrun' && !successfulRun(report)) continue;
    const destination = join(cwd, 'exercise-5-consolidated-report', folder);
    const marker = join(destination, 'publication.json');
    let previous = null;
    if (existsSync(marker)) previous = JSON.parse(readFileSync(marker, 'utf8'));
    if (!newer(publication, previous)) continue;
    mkdirSync(destination, { recursive: true });
    writeFileSync(join(destination, 'consolidated-report.md'), markdown);
    writeFileSync(join(destination, 'consolidated-report.json'), JSON.stringify(report, null, 2) + '\n');
    writeFileSync(marker, JSON.stringify(publication, null, 2) + '\n');
    changed.push(folder);
  }
  return changed;
}

export function publishReports({ cwd, sourceRoot, branch, sourceSha, runId, runNumber, attempt }) {
  function git(args, allowFailure = false) {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (!allowFailure && result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr || result.error?.message || result.status}`);
    return result;
  }
  git(['check-ref-format', `refs/heads/${branch}`]);
  // Read before checking out the current branch tip: never commit unrelated runner files.
  const markdown = readFileSync(join(sourceRoot, 'consolidated-report.md'), 'utf8');
  const report = JSON.parse(readFileSync(join(sourceRoot, 'consolidated-report.json'), 'utf8'));
  for (const value of [runNumber, attempt]) if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid workflow sequence metadata.');
  if (!report.metadata?.runUrl?.endsWith(`/actions/runs/${runId}`) || report.metadata?.attempt !== String(attempt)) throw new Error('Report provenance does not match this run/attempt.');
  const publication = {
    runId: String(runId), runNumber, attempt, sourceCommit: sourceSha,
    workflowCommit: report.metadata.commit, runUrl: report.metadata.runUrl,
    successfulWorkflow: successfulRun(report),
    policy: 'Successful upstream jobs and complete evidence; no failed, blocked, review, flaky, missing or invalid units. Explicit skips remain visible.',
  };
  for (let retry = 0; retry < 3; retry++) {
    git(['fetch', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`]);
    // Do not attach an old report to a branch that no longer contains its tested source.
    if (git(['merge-base', '--is-ancestor', sourceSha, `refs/remotes/origin/${branch}`], true).status !== 0) {
      console.log('Report publication skipped: source commit is no longer on the target branch. Artifact retained.');
      return [];
    }
    git(['checkout', '--detach', `refs/remotes/origin/${branch}`]);
    const changed = writeSnapshots(cwd, markdown, report, publication);
    if (!changed.length) { console.log('Newer or identical report snapshots already exist. Artifact retained.'); return []; }
    git(['add', '--', ...changed.map(folder => `exercise-5-consolidated-report/${folder}`)]);
    git(['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
      'commit', '-m', `docs: publish QA report for run ${runId} attempt ${attempt} [skip ci]`]);
    const pushed = git(['push', 'origin', `HEAD:refs/heads/${branch}`], true);
    if (pushed.status === 0) { console.log(`Published: ${changed.join(', ')}`); return changed; }
    // An ordinary branch update may race publication. Fetch and rebuild on its tip;
    // never force-push or overwrite a newer report with an older run.
    if (retry === 2) throw new Error(`Report publication failed after three attempts: ${pushed.stderr}`);
  }
  return [];
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  publishReports({
    cwd: process.cwd(), sourceRoot: resolve(process.argv[2] ?? 'output'),
    branch: process.env.REPORT_BRANCH, sourceSha: process.env.REPORT_SOURCE_SHA,
    runId: process.env.GITHUB_RUN_ID, runNumber: Number(process.env.GITHUB_RUN_NUMBER),
    attempt: Number(process.env.GITHUB_RUN_ATTEMPT),
  });
}
