import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const folders = ['lastRun', 'LastSuccesfulrun'];
const problematic = [ 'BLOCKED', 'MISSING', 'ERROR', 'FLAKY'];
const scenarioIds = ['simple-query', 'topic-change', 'ambiguous-information', 'conversational-memory', 'prompt-injection'];

export function successfulRun(report) {
  // Successful means a complete, valid evaluation, not an assistant with no defects.
  if (report.evidenceComplete !== true ||
      (report.issues ?? []).length > 0 ||
      !['typecheck', 'playwright'].every(job => report.metadata?.needs?.[job]?.result === 'success') ||
      !problematic.every(status => report.counts?.[status] === 0)) return false;

  if (!Array.isArray(report.scenarios) || report.scenarios.length !== 5 ||
      !Array.isArray(report.units)) return false;
  for (const id of scenarioIds) {
    const scenarios = report.scenarios.filter(s => s.id === id);
    const units = report.units.filter(unit => unit.suite === 'llm' && unit.id === id);
    const scenario = scenarios[0];
    if (scenarios.length !== 1 || units.length !== 1 ||
        !['PASS', 'FAIL', 'REVIEW'].includes(scenario.status) ||
        scenario.reportedVerdict !== scenario.status || units[0].status !== scenario.status ||
        scenario.completedTurns !== 6 || scenario.validEvaluations !== 6 ||
        !Array.isArray(scenario.turnEvaluations) || scenario.turnEvaluations.length !== 6 ||
        !scenario.turnEvaluations.every((turn, index) =>
          turn.turn === index + 1 && turn.evaluation_status === 'COMPLETED' &&
          turn.evaluator_failure == null &&
          ['PASS', 'FAIL', 'REVIEW'].includes(turn.evaluation?.verdict))) return false;
  }
  const semanticReviews = report.scenarios.filter(s => s.status === 'REVIEW').length;
  const semanticFailures = report.scenarios.filter(s => s.status === 'FAIL').length;
  // Every failed unit must be a fully evaluated LLM scenario, not an API/UI
  // failure or an unexplained job execution failure.
  if (report.units.filter(unit => unit.suite === 'llm').length !== 5 ||
      report.units.some(unit => unit.suite !== 'llm' && !['PASS', 'SKIPPED'].includes(unit.status)) ||
      report.counts.FAIL !== semanticFailures || report.counts.REVIEW !== semanticReviews) return false;
  const llmResult = report.metadata?.needs?.llm?.result;
  // New CI succeeds on complete evaluations. Accept verdict-based legacy reports only
  // when they predate the explicit execution status. Never mask a new technical failure.
  return llmResult === 'success' ||
    (report.executionStatus == null && semanticFailures > 0 && llmResult === 'failure');
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
    evaluationExecutionComplete: successfulRun(report),
    upstreamJobResults: Object.fromEntries(Object.entries(report.metadata.needs ?? {}).map(([name, job]) => [name, job.result])),
    policy: 'Complete LLM evaluation: five scenarios, six responses and six available valid judgments each. Semantic LLM FAIL/REVIEW verdicts are retained and eligible; provider/timeouts, unavailable evaluations, invalid evidence and failed API/UI jobs are not. Workflow conclusions are unchanged.',
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


