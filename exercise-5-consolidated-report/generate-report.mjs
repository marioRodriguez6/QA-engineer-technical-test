import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve, join, relative, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

export const scenarioIds = ['simple-query', 'topic-change', 'ambiguous-information', 'conversational-memory', 'prompt-injection'];
const inventories = { api: ['API', 11], 'chatbot-docs': ['CHATBOT', 4], 'chatbot-homepage': ['HOME', 4] };
const states = ['PASS', 'FAIL', 'REVIEW', 'BLOCKED', 'SKIPPED', 'MISSING', 'ERROR', 'FLAKY'];
const mean = values => values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)) : null;
const pct = (n, d) => d ? Number((100 * n / d).toFixed(2)) : null;
const numeric = value => typeof value === 'number' && Number.isFinite(value);
const cell = value => value == null ? 'N/A' : String(value).replaceAll('|', '\\|').replace(/[\r\n]+/g, ' ');
const table = (headers, rows) => [headers, headers.map(() => '---'), ...rows].map(row => '| ' + row.map(cell).join(' | ') + ' |').join('\n');

function filesUnder(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    // Never read HTML report asset copies: they duplicate attached JSON files.
    if (entry.name === 'html' || entry.isSymbolicLink()) return [];
    const path = join(root, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

export function buildReport(inputRoot, metadata = {}) {
  const root = resolve(inputRoot);
  const issues = [];
  for (const [suite, outcome] of Object.entries(metadata.downloads ?? {})) {
    if (outcome !== 'success') issues.push(`${suite}: artifact download outcome ${outcome}; evidence may be absent or partial.`);
  }
  const sources = [];
  const units = [];
  const validTurns = [];
  const timing = { llmAssistantMs: [], llmEvaluatorMs: [], apiTestMs: [], docsTestMs: [], homepageTestMs: [], docsResponseMs: [], homepageResponseMs: [] };
  const llmRows = [];
  const scenarioReports = [];
  function readOne(suite, name, required = true) {
    const matches = filesUnder(join(root, suite)).filter(path => basename(path) === name);
    if (matches.length !== 1) {
      if (required || matches.length > 1) issues.push(`${suite}/${name}: expected one source, found ${matches.length}.`);
      return null;
    }
    try {
      const data = JSON.parse(readFileSync(matches[0], 'utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Expected a report object');
      sources.push(relative(root, matches[0]));
      return data;
    } catch (error) {
      issues.push(`${suite}/${name}: invalid JSON (${error.message}).`);
      return null;
    }
  }
  const summary = readOne('llm', 'execution-summary.json');
  const summaryMatchesCommit = !metadata.commit || !summary || summary.commit === metadata.commit;
  if (!summaryMatchesCommit) issues.push('LLM summary commit does not match this workflow commit; LLM evidence rejected.');
  for (const id of scenarioIds) {
    const data = readOne('llm', `${id}.json`);
    const entries = summary?.results?.filter?.(entry => entry.scenarioId === id) ?? [];
    const entry = entries.length === 1 ? entries[0] : null;
    let status = 'MISSING';
    let evaluations = [];
    let completed = null;
    let quality = { coherence: null, context: null, falseRate: null, unsupportedRate: null, security: null, usefulness: null };
    const findings = [];
    if (data && summaryMatchesCommit) {
      completed = Array.isArray(data.turnos) ? data.turnos.filter(message => message.rol === 'asistente').length : null;
      const turns = Array.isArray(data.evaluaciones) ? data.evaluaciones : [];
      const ids = new Set();
      let invalid = false;
      for (const turn of turns) {
        if (!turn || typeof turn !== 'object') { invalid = true; continue; }
        if (!Number.isInteger(turn.turn) || turn.turn < 1 || turn.turn > 6 || ids.has(turn.turn)) { invalid = true; continue; }
        ids.add(turn.turn);
        const e = turn.evaluation;
        if (turn.evaluation_status !== 'COMPLETED' || e == null) continue;
        if (!numeric(e.coherenceScore) || e.coherenceScore < 0 || e.coherenceScore > 100 ||
            !numeric(e.contextRetentionScore) || e.contextRetentionScore < 0 || e.contextRetentionScore > 100 ||
            !['none', 'unsupported', 'demonstrably_false'].includes(e.hallucinationType) ||
            !['hallucinationDetected', 'securityIssueDetected', 'toxicityDetected'].every(key => typeof e[key] === 'boolean') ||
            !['PASS', 'FAIL', 'REVIEW'].includes(e.verdict) || !Array.isArray(e.errors)) { invalid = true; continue; }
        evaluations.push(e);
        findings.push(...e.errors.map(error => `Turn ${turn.turn}: ${typeof error === 'string' ? error : JSON.stringify(error)}`));
      }
      status = states.includes(data.veredicto) ? data.veredicto : 'ERROR';
      const ordered = Array.isArray(data.turnos) && data.turnos.length === 12 && data.turnos.every((m, i) =>
        m.rol === (i % 2 ? 'asistente' : 'usuario') && typeof m.mensaje === 'string' && m.mensaje.trim());
      const expected = evaluations.some(e => e.verdict === 'FAIL') ? 'FAIL' :
        evaluations.length === 6 && evaluations.every(e => e.verdict === 'PASS') && ordered ? 'PASS' : 'REVIEW';
      const consistent = entry && entry.ciStatus === status && entry.verdict === data.veredicto &&
        (status === 'BLOCKED' ? data.execution_status === 'BLOCKED' && entry.exitCode === 2 :
          data.execution_status === 'COMPLETED' && data.completed_turns === 6 && data.expected_turns === 6 &&
          ordered && turns.length === 6 && expected === status && entry.exitCode === (status === 'PASS' ? 0 : 1));
      if (invalid || !consistent) {
        status = 'ERROR';
        issues.push(`${id}: report/schema/CI summary inconsistency; original verdict ${cell(data.veredicto)} retained as reportedVerdict.`);
      }
      if (Array.isArray(data.errores_detectados)) findings.push(...data.errores_detectados.map(String));
      if (data.infrastructure_failure?.message) findings.push(String(data.infrastructure_failure.message));
      validTurns.push(...evaluations.map(e => ({ scenario: id, ...e })));
      for (const turn of turns) {
        if (!turn || typeof turn !== 'object') continue;
        if (numeric(turn.timing?.assistantResponseMs)) timing.llmAssistantMs.push(turn.timing.assistantResponseMs);
        if (numeric(turn.timing?.evaluatorResponseMs)) timing.llmEvaluatorMs.push(turn.timing.evaluatorResponseMs);
      }
      quality = {
        usefulness: mean(evaluations.map(e => e.usefulnessScore).filter(numeric)),
        coherence: mean(evaluations.map(e => e.coherenceScore)),
        context: mean(evaluations.map(e => e.contextRetentionScore)),
        falseRate: pct(evaluations.filter(e => e.hallucinationType === 'demonstrably_false').length, evaluations.length),
        unsupportedRate: pct(evaluations.filter(e => e.hallucinationType === 'unsupported').length, evaluations.length),
        security: pct(evaluations.filter(e => !e.securityIssueDetected).length, evaluations.length),
      };
      scenarioReports.push({ id, status, reportedVerdict: data.veredicto, completedTurns: completed, validEvaluations: evaluations.length, quality, experience: data.experience ?? { resolutionStatus: 'unknown' }, analysis: data.analisis ?? null, metricDefinitions: data.metric_definitions ?? null, findings: [...new Set(findings)], turnEvaluations: turns });
    } else {
      scenarioReports.push({ id, status, reportedVerdict: data?.veredicto ?? null, completedTurns: null, validEvaluations: 0, quality, findings: [] });
    }
    units.push({ suite: 'llm', id, status });
    llmRows.push([id, status, quality.coherence, quality.context, quality.falseRate, quality.unsupportedRate, quality.security, completed == null ? 'N/A' : `${completed}/6`, `${evaluations.length}/6`, quality.usefulness, data && summaryMatchesCommit ? data.experience?.resolutionStatus ?? 'unknown' : 'unknown']);
  }

  const suites = [];
  for (const [suite, [prefix, count]] of Object.entries(inventories)) {
    const data = readOne(suite, 'results.json');
    const tests = [];
    function walk(node) {
      if (!node || typeof node !== 'object') { issues.push(`${suite}: invalid suite entry.`); return; }
      for (const spec of Array.isArray(node.specs) ? node.specs : []) {
        for (const test of Array.isArray(spec?.tests) ? spec.tests : []) tests.push({ title: spec.title, ...test });
      }
      for (const child of Array.isArray(node.suites) ? node.suites : []) walk(child);
    }
    if (data && Array.isArray(data.suites)) walk(data);
    else if (data) issues.push(`${suite}: invalid Playwright report structure.`);
    for (const error of data?.errors ?? []) issues.push(`${suite}: runner error: ${error.message ?? JSON.stringify(error)}`);
    const rows = [];
    const expectedIds = Array.from({ length: count }, (_, i) => `${prefix}-${String(i + 1).padStart(3, '0')}`);
    for (const id of expectedIds) {
      const matches = tests.filter(test => test.title?.startsWith(`${id}:`));
      const test = matches.length === 1 ? matches[0] : null;
      const attempts = test?.results ?? [];
      const last = attempts.at(-1);
      let status = 'MISSING';
      if (test) {
        if (test.status === 'skipped' || last?.status === 'skipped') status = 'SKIPPED';
        else if (test.status === 'flaky') status = 'FLAKY';
        else if (test.status === 'unexpected' || ['failed', 'timedOut', 'interrupted'].includes(last?.status)) status = 'FAIL';
        else if (test.status === 'expected' && last?.status === 'passed') status = 'PASS';
        else status = 'ERROR';
      }
      if (matches.length > 1) { status = 'ERROR'; issues.push(`${suite}/${id}: duplicate test results.`); }
      const errors = [...new Set(attempts.flatMap(attempt => (attempt.errors ?? []).map(error => error.message ?? String(error))))];
      const durationMs = last && last.status !== 'skipped' && numeric(last.duration) ? last.duration : null;
      if (durationMs !== null) timing[suite === 'api' ? 'apiTestMs' : suite === 'chatbot-docs' ? 'docsTestMs' : 'homepageTestMs'].push(durationMs);
      rows.push({ id, title: test?.title ?? id, status, durationMs, attempts: attempts.length, errors });
      units.push({ suite, id, status });
    }
    for (const test of tests) if (!expectedIds.some(id => test.title?.startsWith(`${id}:`))) issues.push(`${suite}: unexpected test inventory entry ${cell(test.title)}; review the configured inventory.`);
    suites.push({ suite, durationMs: data?.stats?.duration ?? null, tests: rows });
  }

  // Optional latency evidence is read only from the downloaded suite artifact.
  for (const [suite, name, key] of [['chatbot-docs', 'chatbot-response-time.json', 'docsResponseMs'], ['chatbot-homepage', 'homepage-response-time.json', 'homepageResponseMs']]) {
    const data = readOne(suite, name, false);
    if (numeric(data?.responseTimeMs)) timing[key].push(data.responseTimeMs);
  }
  const counts = Object.fromEntries(states.map(state => [state, units.filter(unit => unit.status === state).length]));
  const executed = counts.PASS + counts.FAIL + counts.REVIEW + counts.FLAKY;
  const qualityFlags = validTurns.filter(e => e.hallucinationDetected || e.hallucinationType !== 'none' || e.securityIssueDetected || e.toxicityDetected);
  const injections = validTurns.filter(e => e.scenario === 'prompt-injection');
  const scoreDeviations = validTurns.filter(e => e.contextRetentionScore < 100);
  const bonus = {
    hallucinations: { evaluatedTurns: validTurns.length, detectedTurns: validTurns.filter(e => e.hallucinationDetected || e.hallucinationType !== 'none').length,
      demonstrablyFalse: validTurns.filter(e => e.hallucinationType === 'demonstrably_false').length,
      unsupported: validTurns.filter(e => e.hallucinationType === 'unsupported').length },
    promptInjection: { evaluatedScenarioTurns: injections.length, securityFailures: injections.filter(e => e.securityIssueDetected).length,
      limitation: 'Counts security failures in the injection scenario, including its benign first turn; not a per-attack success rate.' },
    toxicity: { evaluatedTurns: validTurns.length, detectedTurns: validTurns.filter(e => e.toxicityDetected).length },
    context: { materialContextFailures: validTurns.filter(e => e.contextIssueDetected === true).length, explicitDetectorCoverage: validTurns.filter(e => typeof e.contextIssueDetected === 'boolean').length, evaluatedTurns: validTurns.length, meanScore: mean(validTurns.map(e => e.contextRetentionScore)), scoreDeviations: scoreDeviations.length,
      limitation: 'A score below 100 is a review signal, not automatically a confirmed context-loss defect. Per-turn judge analysis and errors are preserved.' },
    toolCalling: { status: 'NOT_IMPLEMENTED', evaluatedCalls: 0, detectedErrors: null,
      limitation: 'The assistant has no configured tools or recorded tool-call traces. Never counted as PASS.' },
    apiAndUi: 'NOT_EVALUATED for semantic hallucination/injection/toxicity/context/tool-call detection. API/UI assertions and execution failures are consolidated separately.',
    calibration: 'Existing LLM judge outputs are aggregated without new provider calls. Detector sensitivity/false-positive rates remain uncalibrated.',
  };
  const jobs = Object.fromEntries(Object.entries(metadata.needs ?? {}).map(([name, job]) => [name, job.result]));
  const incomplete = counts.MISSING + counts.ERROR > 0 || issues.length > 0;
  const failedJobs = Object.values(jobs).some(result => ['failure', 'cancelled'].includes(result));
  const overall = counts.FAIL || failedJobs ? 'FAIL' : incomplete || counts.BLOCKED || counts.REVIEW || counts.FLAKY || counts.SKIPPED ? 'INCOMPLETE' : 'PASS';
  return {
    generatedAt: new Date().toISOString(), metadata, jobs, overall, evidenceComplete: !incomplete,
    units, counts, plannedUnits: units.length, executedUnits: executed,
    metrics: { passedPlannedPercent: pct(counts.PASS, units.length), passExecutedPercent: pct(counts.PASS, executed), failExecutedPercent: pct(counts.FAIL, executed),
      completedConversationsPercent: pct(scenarioReports.filter(s => s.completedTurns === 6).length, 5),
      llmEvaluationCoveragePercent: pct(validTurns.length, 30), meanCoherence: mean(validTurns.map(e => e.coherenceScore)),
      meanContext: mean(validTurns.map(e => e.contextRetentionScore)), meanUsefulness: mean(validTurns.map(e => e.usefulnessScore).filter(numeric)),
      resolution: { notApplicable: scenarioReports.filter(s => s.experience?.resolutionStatus === "not_applicable").length, resolved: scenarioReports.filter(s => s.experience?.resolutionStatus === "resolved").length, partial: scenarioReports.filter(s => s.experience?.resolutionStatus === "partial").length, unresolved: scenarioReports.filter(s => s.experience?.resolutionStatus === "unresolved").length, unknown: scenarioReports.filter(s => !s.experience || s.experience.resolutionStatus === "unknown").length }, flaggedTurnRatePercent: pct(qualityFlags.length, validTurns.length),
      flaggedTurns: qualityFlags.length, validEvaluations: validTurns.length,
      meanTimesMs: Object.fromEntries(Object.entries(timing).map(([key, values]) => [key, { mean: mean(values), samples: values.length }])) },
    scenarios: scenarioReports, suites, bonus, issues, sources, llmRows,
  };
}

export function renderMarkdown(r) {
  const m = r.metrics;
  const lines = [
    '# Consolidated QA Report', '',
    `Generated: ${r.generatedAt} | Overall assessment: **${r.overall}**`, '',
    `Run: ${r.metadata.runUrl ?? 'Local input'} | Attempt: ${r.metadata.attempt ?? 'N/A'} | Commit: ${r.metadata.commit ?? 'Not supplied'}`, '',
    '## Global assessment', '',
    `${r.counts.PASS}/${r.plannedUnits} planned units passed. ${r.counts.FAIL} failed, ${r.counts.SKIPPED} skipped, ${r.counts.BLOCKED} blocked, ${r.counts.REVIEW} review, ${r.counts.FLAKY} flaky, ${r.counts.MISSING} missing and ${r.counts.ERROR} invalid/error.`, '',
    'One unit is one LLM scenario or one API/UI case. These heterogeneous units are an execution summary, not a product quality score. Homepage is additional coverage; it does not replace Docs requirements.', '',
    table(['Scope', ...states], ['llm', ...Object.keys(inventories)].map(suite => [suite, ...states.map(state => r.units.filter(u => u.suite === suite && u.status === state).length)])), '',
    table(['Metric', 'Value'], [
      ['PASS / planned (%)', m.passedPlannedPercent], ['PASS / executed (%)', m.passExecutedPercent], ['FAIL / executed (%)', m.failExecutedPercent],
      ['Completed LLM conversations / 5 (%)', m.completedConversationsPercent], ['Valid LLM evaluations / 30 (%)', m.llmEvaluationCoveragePercent],
      ['Mean coherence /100', m.meanCoherence], ['Mean context /100', m.meanContext], ['Mean usefulness /100', m.meanUsefulness], ['User needs resolved (scenarios)', m.resolution.resolved], ['User needs unresolved (scenarios)', m.resolution.unresolved], ['Resolution unavailable (scenarios)', m.resolution.unknown], ['Judge-flagged turns / valid evaluations (%)', m.flaggedTurnRatePercent],
    ]), '',
    'Executed denominator includes PASS, FAIL, REVIEW and FLAKY. Skipped, blocked, missing and invalid/error units are excluded and listed separately. N/A means no valid samples; it never means zero errors.', '',
    '## Exercise 1 - Five LLM scenarios', '',
    table(['Scenario', 'Status', 'Coherence', 'Context', 'False %', 'Unsupported %', 'Security %', 'Exchanges', 'Valid evaluations', 'Usefulness', 'Need resolution'], r.llmRows), '',
    'Quality metrics are recalculated from valid per-turn judge outputs. False and unsupported claims remain distinct. Security % uses all valid turns, not only attacks. Original verdicts, per-turn evaluations and errors are preserved in the JSON companion.', '',
    ...r.scenarios.flatMap(s => [`### ${s.id} - evaluation synthesis`, '', cell(s.analysis ?? 'No scenario-level synthesis available in this source report.'), '']),
    'User-need resolution is distinct from technical completion. Historical reports without these fields remain unknown, not retroactively resolved.', '',
    '## Exercises 2 and 3 - API and chatbot', '',
  ];
  for (const suite of r.suites) lines.push(`### ${suite.suite}`, '', table(['Case', 'Status', 'Test duration ms', 'Attempts'], suite.tests.map(t => [t.id, t.status, t.durationMs, t.attempts])), '');
  lines.push('## Timing', '', table(['Measurement', 'Mean ms', 'Samples'], Object.entries(m.meanTimesMs).map(([key, value]) => [key, value.mean, value.samples])), '',
    'LLM timings include wrapper/retry overhead. API/UI test duration includes assertions and setup; it is not endpoint response latency. Chatbot response timings are separate measurements to the first visible reply text, not necessarily the entire answer. No average combines these unlike measurements.', '',
    '## Automated findings and bonus coverage', '',
    table(['Dimension', 'Evidence', 'Limit'], [
      ['Hallucinations', `${r.bonus.hallucinations.detectedTurns}/${m.validEvaluations} flagged; ${r.bonus.hallucinations.demonstrablyFalse} false, ${r.bonus.hallucinations.unsupported} unsupported`, 'LLM judge only; no evidence is not a PASS'],
      ['Prompt injection', `${r.bonus.promptInjection.securityFailures} security failures / ${r.bonus.promptInjection.evaluatedScenarioTurns} valid scenario turns`, r.bonus.promptInjection.limitation],
      ['Toxicity', `${r.bonus.toxicity.detectedTurns}/${m.validEvaluations} flagged`, 'No positive detector calibration demonstrated'],
      ['Context retention', `${r.bonus.context.meanScore ?? 'N/A'}/100 mean; ${r.bonus.context.materialContextFailures} explicit material context flags (${r.bonus.context.explicitDetectorCoverage} explicit judgments); ${r.bonus.context.scoreDeviations} scores below 100`, r.bonus.context.limitation],
      ['Incorrect tool calling', 'NOT_IMPLEMENTED; 0 observed calls', r.bonus.toolCalling.limitation],
      ['API/UI semantic detectors', 'NOT_EVALUATED', r.bonus.apiAndUi],
    ]), '', r.bonus.calibration, '',
    '## Errors and evidence gaps', '');
  const findings = [...r.issues, ...r.scenarios.flatMap(s => s.findings.map(f => `${s.id}: ${f}`)), ...r.suites.flatMap(s => s.tests.flatMap(t => t.errors.map(e => `${s.suite}/${t.id}: ${e}`)))];
  lines.push(findings.length ? findings.map(f => `- ${cell(f)}`).join('\n') : 'No execution errors or judge findings were recorded in the available reports. This does not establish unimplemented or uncalibrated bonus coverage.', '',
    '## Workflow and provenance', '', table(['Job', 'Result'], Object.entries(r.jobs)), '',
    `Artifact download outcomes: ${cell(JSON.stringify(r.metadata.downloads ?? {}))}`, '',
    'Only the supplied input directory is read. CI populates it with artifact names scoped to the current run ID and attempt. Tracked historical reports are never used as fallback. A retry without artifacts from successful earlier attempts is marked missing rather than silently mixed.', '',
    ...r.sources.map(source => `- ${cell(source)}`), '',
    '## Limitations and follow-up', '',
    '- CHATBOT-003 remains a Docs coverage gap when skipped. A passing homepage name case does not close it.',
    '- Inspect failed assertions and judge errors before changing expectations. BLOCKED provider failures are separate from assistant quality findings.',
    '- Preserve the downloaded evidence before artifact retention expires. Review detector calibration and implement real tool instrumentation before claiming all bonuses complete.',
    '- No report can be guaranteed if GitHub cannot start this job, checkout/setup fails, or the workflow is forcibly terminated. Normal upstream failures/skips are handled by always().', '',
  );
  return lines.join('\n');
}

function envJson(name) {
  try { return JSON.parse(process.env[name] || '{}'); }
  catch { return { parsingError: `Invalid ${name}` }; }
}

export function main() {
  const input = process.argv[2] ?? 'output/ci/consolidated-inputs';
  const output = resolve(process.argv[3] ?? 'output');
  const report = buildReport(input, {
    runUrl: process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
    attempt: process.env.GITHUB_RUN_ATTEMPT ?? null, commit: process.env.GITHUB_SHA ?? null,
    needs: envJson('WORKFLOW_NEEDS'), downloads: envJson('DOWNLOAD_OUTCOMES'),
  });
  mkdirSync(output, { recursive: true });
  const markdown = renderMarkdown(report);
  writeFileSync(join(output, 'consolidated-report.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(join(output, 'consolidated-report.md'), markdown);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
  console.log(`Consolidated report: ${report.overall}; ${report.counts.PASS}/${report.plannedUnits} PASS. Saved to ${output}`);
  // Still upload the report when evidence is missing/invalid; do not greenwash missing inputs.
  if (!report.evidenceComplete) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();

