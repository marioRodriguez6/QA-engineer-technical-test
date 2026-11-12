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
  const qualityFlags = validTurns.filter(e => e.hallucinationDetected || e.hallucinationType !== 'none' || e.securityIssueDetected || e.toxicityDetected || e.contextIssueDetected === true);
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
    generatedAt: new Date().toISOString(), metadata, jobs, overall,
    executionStatus: failedJobs || units.some(u => u.suite !== 'llm' && ['FAIL', 'FLAKY'].includes(u.status)) ? 'FAILED' :
      incomplete || scenarioReports.some(s => !['PASS', 'FAIL', 'REVIEW'].includes(s.status) || s.completedTurns !== 6 || s.validEvaluations !== 6 || s.turnEvaluations?.some(t => t.evaluation_status !== 'COMPLETED' || !['PASS', 'FAIL', 'REVIEW'].includes(t.evaluation?.verdict))) ? 'INCOMPLETE' : 'COMPLETED',
    evidenceComplete: !incomplete,
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
  const labels = { 'simple-query': '1 · Simple query', 'topic-change': '2 · Topic change', 'ambiguous-information': '3 · Ambiguous information', 'conversational-memory': '4 · Conversational memory', 'prompt-injection': '5 · Security & prompt injection' };
  const scope = { llm: 'Exercise 1 · LLM', api: 'Exercise 2 · API', 'chatbot-docs': 'Exercise 3 · Docs chatbot', 'chatbot-homepage': 'Exercise 3 · Homepage chatbot (additional)' };
  const safe = value => cell(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const value = (n, suffix = '') => n == null ? 'N/A' : `${n}${suffix}`;
  const details = (title, body) => ['<details>', `<summary>${safe(title)}</summary>`, '', ...body, '', '</details>', ''];
  const historicalCompletion = r.evidenceComplete && ['typecheck', 'playwright'].every(job => r.jobs?.[job] === 'success') && r.scenarios.length === 5 && r.scenarios.every(s => ['PASS', 'FAIL', 'REVIEW'].includes(s.status) && s.completedTurns === 6 && s.validEvaluations === 6 && s.turnEvaluations?.every(t => t.evaluation_status === 'COMPLETED' && ['PASS', 'FAIL', 'REVIEW'].includes(t.evaluation?.verdict)));
  const execution = r.executionStatus ?? (historicalCompletion ? 'COMPLETED' : 'UNKNOWN (historical report)');
  const lines = [
    '# Consolidated QA Report', '',
    `**Evaluation execution: ${execution}** · **Observed quality: ${r.overall}**`, '',
    `Run: ${r.metadata.runUrl ?? 'Local input'} · Attempt: ${r.metadata.attempt ?? 'N/A'}`, '',
    `Commit: \`${r.metadata.commit ?? 'Not supplied'}\` · Generated: ${r.generatedAt}`, '',
    '## At a glance', '',
    `**${r.counts.PASS} PASS · ${r.counts.FAIL} FAIL · ${r.counts.SKIPPED} SKIPPED** across ${r.plannedUnits} planned units.`, '',
    `${r.counts.BLOCKED} blocked, ${r.counts.REVIEW} review, ${r.counts.FLAKY} flaky, ${r.counts.MISSING} missing and ${r.counts.ERROR} invalid/error.`, '',
    'A completed evaluation can contain functional FAIL or REVIEW findings. REVIEW is technical incompleteness only when a judgment is unavailable; an available REVIEW verdict remains a quality finding. Execution status describes whether the evaluation ran; observed quality preserves the original findings and coverage gaps.', '',
    table(['Scope', 'PASS', 'FAIL', 'REVIEW', 'Skipped', 'Other / incomplete'], ['llm', ...Object.keys(inventories)].map(suite => {
      const count = status => r.units.filter(u => u.suite === suite && u.status === status).length;
      return [scope[suite], count('PASS'), count('FAIL'), count('REVIEW'), count('SKIPPED'), ['BLOCKED', 'FLAKY', 'MISSING', 'ERROR'].reduce((n, s) => n + count(s), 0)];
    })), '',
    '## Global metrics', '',
    table(['Metric', 'Result'], [
      ['PASS / executed units', value(m.passExecutedPercent, '%')], ['FAIL / executed units', value(m.failExecutedPercent, '%')],
      ['PASS / all planned units', value(m.passedPlannedPercent, '%')],
      ['Complete LLM conversations', `${r.scenarios.filter(s => s.completedTurns === 6).length}/5 (${value(m.completedConversationsPercent, '%')})`],
      ['Available LLM judgments', `${m.validEvaluations}/30 (${value(m.llmEvaluationCoveragePercent, '%')})`],
      ['Turns with judge-reported problems', `${m.flaggedTurns}/${m.validEvaluations} (${value(m.flaggedTurnRatePercent, '%')})`],
      ['Mean coherence / context / usefulness', `${value(m.meanCoherence)} / ${value(m.meanContext)} / ${value(m.meanUsefulness)} out of 100`],
      ['User-need resolution', `${m.resolution.resolved} resolved · ${m.resolution.partial} partial · ${m.resolution.unresolved} unresolved · ${m.resolution.notApplicable} not applicable · ${m.resolution.unknown} unknown`],
    ]), '',
    'Units are five LLM scenarios plus API/UI cases, not individual turns. Executed units include PASS, FAIL, REVIEW and FLAKY; other states are excluded. These mixed units are not a product quality score. Judge-flagged rate counts a turn once across factual, security, toxicity and explicit context flags; it is not measured detector accuracy. N/A means unavailable evidence, never zero errors.', '',
    '## Exercise 1 · Five conversational scenarios', '',
    table(['Scenario', 'Verdict', 'Coherence /100', 'Hallucination flags', 'Security %', 'Completion'], r.scenarios.map(s => {
      const valid = (s.turnEvaluations ?? []).filter(t => t.evaluation_status === 'COMPLETED' && t.evaluation);
      const hallucinations = valid.filter(t => t.evaluation.hallucinationDetected || t.evaluation.hallucinationType !== 'none').length;
      return [labels[s.id] ?? s.id, s.status, s.quality.coherence, s.validEvaluations ? `${hallucinations}/${s.validEvaluations}` : 'N/A', s.quality.security, `${s.completedTurns ?? '?'}/6 replies · ${s.validEvaluations}/6 judgments`];
    })), '',
    'Security % is the share of available judgments without a security flag, including benign turns. Hallucination flags are judge classifications, not independently confirmed facts. Completing six exchanges does not imply the user need was resolved.', '',
  ];
  for (const s of r.scenarios) {
    const turns = s.turnEvaluations ?? [];
    lines.push(`### ${labels[s.id] ?? s.id} · ${s.status}`, '',
      `**Context:** ${value(s.quality.context, '/100')} · **Usefulness:** ${value(s.quality.usefulness, '/100')} · **Need resolution:** ${safe(s.experience?.resolutionStatus ?? 'unknown')}`, '',
      `**Judge classifications:** ${value(s.quality.falseRate, '%')} demonstrably false · ${value(s.quality.unsupportedRate, '%')} unsupported.`, '',
      '**Recorded findings**', '',
      ...(s.findings.length ? s.findings.map(f => `- ${safe(f)}`) : ['No findings recorded in the available evidence.']), '');
    const body = [];
    for (const t of turns) {
      const e = t.evaluation;
      body.push(`#### Turn ${t.turn} · ${safe(e?.verdict ?? t.evaluation_status ?? 'UNAVAILABLE')}`, '',
        `**User:** ${safe(t.userMessage ?? 'Not stored in this source')}`, '',
        `**Assistant:** ${safe(t.assistantMessage ?? 'Not stored in this source')}`, '',
        `**Judge reasoning:** ${safe(e?.analysis ?? t.evaluator_failure?.message ?? 'Unavailable')}`, '',
        `**User experience:** ${safe(e?.uxAnalysis ?? 'Unavailable in this source')}`, '');
    }
    if (!turns.length) body.push('No per-turn evidence available.');
    lines.push(...details(`Inspect ${s.id}: conversation and per-turn judgments`, body));
    if (s.analysis) lines.push(...details('Original scenario analysis (preserved)', [safe(s.analysis)]));
  }
  lines.push('## Exercises 2 and 3 · API and chatbot', '');
  for (const suite of r.suites) {
    const n = state => suite.tests.filter(t => t.status === state).length;
    lines.push(`### ${scope[suite.suite]}`, '', `**${n('PASS')} PASS · ${n('FAIL')} FAIL · ${n('SKIPPED')} SKIPPED** · ${suite.tests.length} planned cases.`, '');
    lines.push(...details('Inspect case results and assertion evidence', [
      table(['Case', 'Result', 'Duration ms', 'Attempts'], suite.tests.map(t => [t.id, t.status, t.durationMs, t.attempts])), '',
      ...suite.tests.flatMap(t => t.errors.map(e => `- **${t.id}:** ${safe(e)}`)),
    ]));
  }
  const timingLabels = { llmAssistantMs: 'LLM assistant response', llmEvaluatorMs: 'LLM judge response', apiTestMs: 'API test (setup + assertions)', docsTestMs: 'Docs UI test', homepageTestMs: 'Homepage UI test', docsResponseMs: 'Docs first visible reply', homepageResponseMs: 'Homepage first visible reply' };
  lines.push('## Average timings', '', table(['Measurement', 'Mean ms', 'Samples'], Object.entries(m.meanTimesMs).map(([key, v]) => [timingLabels[key] ?? key, v.mean, v.samples])), '',
    'LLM timings include wrapper/retry overhead. Test duration is not endpoint response latency. Chatbot reply timing measures first visible text, not a complete answer. Unlike measurements are not combined.', '',
    '## Automatic detection · Cross-exercise coverage', '',
    table(['Detector', 'LLM evidence', 'API / chatbot coverage'], [
      ['Hallucinations', `${r.bonus.hallucinations.detectedTurns}/${m.validEvaluations} flagged; ${r.bonus.hallucinations.demonstrablyFalse} false, ${r.bonus.hallucinations.unsupported} unsupported`, 'NOT_EVALUATED'],
      ['Prompt injection', `${r.bonus.promptInjection.securityFailures} security failures / ${r.bonus.promptInjection.evaluatedScenarioTurns} scenario judgments`, 'NOT_EVALUATED'],
      ['Toxic responses', `${r.bonus.toxicity.detectedTurns}/${m.validEvaluations} flagged`, 'NOT_EVALUATED'],
      ['Context loss / irrelevant context', `${r.bonus.context.materialContextFailures} explicit flags / ${r.bonus.context.explicitDetectorCoverage} explicit judgments`, 'NOT_EVALUATED'],
      ['Incorrect tool calling', 'NOT_IMPLEMENTED · 0 instrumented calls', 'NOT_EVALUATED'],
    ]), '',
    'Zero flags means none were reported, not proven absence. Prompt-injection counts include the benign opening turn. Context scores below 100 alone are not confirmed defects. Tool calling has no configured tools or recorded traces and is never counted as PASS. Cross-exercise results are consolidated, but semantic detector coverage currently comes from the LLM exercise only.', '',
    r.bonus.calibration, '',
    '## Evidence gaps and follow-up', '',
    ...r.issues.map(issue => `- ${safe(issue)}`),
    '- CHATBOT-003 remains a documented Docs coverage gap when skipped; homepage coverage is additional.',
    '- Review judge classifications against the source evidence; a functional FAIL is preserved even when evaluation execution succeeds.',
    '- Historical UX fields remain unknown. The JSON companion retains original analyses, messages, metrics and judgments.', '',
  );
  lines.push(...details('Workflow provenance and input files', [table(['Job', 'Result'], Object.entries(r.jobs)), '',
    `Artifact downloads: ${safe(JSON.stringify(r.metadata.downloads ?? {}))}`, '',
    'Only this run/attempt input directory is read. Historical snapshots are never used as fallback. Report generation makes no provider calls.', '', ...r.sources.map(source => `- ${safe(source)}`)]));
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



