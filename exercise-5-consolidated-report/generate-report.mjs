import { detectBonus } from './detectors/bonus.mjs';
import { reconcileLlmTurn, summarizeCoverage } from './detectors/coverage.mjs';
import { validateDetectors } from './detectors/validation.mjs';
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

export function judgmentFindingMetrics(evaluations) {
  const detectors = evaluations.filter(e => e.hallucinationDetected || e.hallucinationType !== 'none' || e.securityIssueDetected || e.toxicityDetected || e.contextIssueDetected === true);
  const findings = evaluations.filter(e => (e.errors?.length ?? 0) > 0 || (e.bonusFindings ?? 0) > 0 || ['FAIL','REVIEW'].includes(e.verdict) || detectors.includes(e));
  return { flaggedTurns: findings.length, flaggedTurnRatePercent: pct(findings.length,evaluations.length), detectorFlaggedTurns: detectors.length, detectorFlaggedTurnRatePercent: pct(detectors.length,evaluations.length) };
}

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
  const bonusRecords = [];
  const assessmentRecords = [];
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
      const expected = evaluations.some(e => e.verdict === 'FAIL') || turns.some(t => (t.bonusAnalysis?.findings?.length ?? 0) > 0) ? 'FAIL' :
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
      validTurns.push(...evaluations.map(e => ({ scenario: id, ...e, bonusFindings: turns.find(t=>t.evaluation===e)?.bonusAnalysis?.findings.length ?? 0 })));
      for (const turn of turns) {
        if (!turn || !Number.isInteger(turn.turn) || turn.turn < 1 || turn.turn > 6) continue;
        if (turn.bonusAnalysis) bonusRecords.push(turn.bonusAnalysis);
        assessmentRecords.push(reconcileLlmTurn({ scenarioId: id, turn,
          history: (data.turnos ?? []).slice(0, turn.turn * 2), judgmentValid: status !== 'ERROR' && evaluations.includes(turn.evaluation) }));
      }
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

  for (const [suite, name, key] of [['chatbot-docs', 'chatbot-response-time.json', 'docsResponseMs'], ['chatbot-homepage', 'homepage-response-time.json', 'homepageResponseMs']]) {
    const data = readOne(suite, name, false);
    if (numeric(data?.responseTimeMs)) timing[key].push(data.responseTimeMs);
  }
  for (const suite of Object.keys(inventories)) {
    for (const path of filesUnder(join(root, suite)).filter(p => ['bonus-evidence.json','bonus-probes.json'].includes(basename(p)))) {
      try {
        const evidence = JSON.parse(readFileSync(path,'utf8'));
        for (const record of evidence.records ?? []) {
          if (record.input?.scope !== suite) { issues.push(`${suite}: bonus scope mismatch.`); continue; }
          bonusRecords.push(detectBonus(record.input));
        }
      } catch (error) { issues.push(`${suite}: invalid bonus evidence: ${error.message}`); }
    }
  }
  const counts = Object.fromEntries(states.map(state => [state, units.filter(unit => unit.status === state).length]));
  const executed = counts.PASS + counts.FAIL + counts.REVIEW + counts.FLAKY;
  const findingMetrics = judgmentFindingMetrics(validTurns);
  const toolRecords = bonusRecords.map(r => r.categories.toolCalling).filter(Boolean);
  const httpActions = bonusRecords.filter(r=>r.scope==='api').reduce((n,r)=>n+(r.observedToolCalls ?? 0),0);
  const eligibleBonusRecords = bonusRecords.filter(r=>Object.values(r.categories).some(c=>['CLEAR','DETECTED'].includes(c.status)));
  const toolCalls = scenarioReports.flatMap(s => s.turnEvaluations ?? []).flatMap(t => t.toolTrace ?? []);
  const rulesTransverse = summarizeCoverage(bonusRecords);
  const transverse = summarizeCoverage([...assessmentRecords, ...bonusRecords.filter(r => r.scope !== 'llm')]);
  const injections = assessmentRecords.filter(r => r.attackIdentified && r.judgmentAvailable);
  const disagreements = assessmentRecords.flatMap(r => Object.entries(r.categories).filter(([, c]) => c.disagreement).map(([category, c]) => ({ id: r.id, category, judgment: c.judgment, rule: c.rule })));
  const scoreDeviations = validTurns.filter(e => e.contextRetentionScore < 100);
  const bonus = {
    hallucinations: { evaluatedTurns: validTurns.length, detectedTurns: validTurns.filter(e => e.hallucinationDetected || e.hallucinationType !== 'none').length,
      demonstrablyFalse: validTurns.filter(e => e.hallucinationType === 'demonstrably_false').length,
      unsupported: validTurns.filter(e => e.hallucinationType === 'unsupported').length },
    promptInjection: { evaluatedScenarioTurns: validTurns.filter(e => e.scenario === 'prompt-injection').length, identifiedAttacks: assessmentRecords.filter(r => r.attackIdentified).length, evaluatedAttacks: injections.length, securityFailures: injections.filter(r => r.categories.promptInjection.judgment?.status === 'DETECTED').length,
      limitation: 'Se cuentan ataques identificados en el mensaje, con juicio válido; los turnos benignos se excluyen del denominador de ataques.' },
    toxicity: { evaluatedTurns: validTurns.length, detectedTurns: validTurns.filter(e => e.toxicityDetected).length },
    context: { materialContextFailures: validTurns.filter(e => e.contextIssueDetected === true).length, explicitDetectorCoverage: validTurns.filter(e => typeof e.contextIssueDetected === 'boolean').length, evaluatedTurns: validTurns.length, meanScore: mean(validTurns.map(e => e.contextRetentionScore)), scoreDeviations: scoreDeviations.length,
      limitation: 'Una puntuación menor de 100 es una señal de revisión, no un defecto de contexto confirmado automáticamente. Se conservan los análisis y errores del juez por turno.' },
    toolCalling: { implementation: 'AVAILABLE', status: toolRecords.some(r=>['CLEAR','DETECTED'].includes(r.status)) ? 'EVALUATED' : 'NO_TRACE', evaluatedCalls: toolCalls.length, httpActionsEvaluated: httpActions,
      detectedErrors: toolRecords.some(r=>['CLEAR','DETECTED'].includes(r.status)) ? toolRecords.reduce((n,r)=>n+r.findings.length,0) : null, limitation: 'Se auditan trazas instrumentadas. Las llamadas HTTP de API se identifican por separado; las herramientas internas de Botpress no son observables desde la UI.' },
    transverse, rulesTransverse, assessments: assessmentRecords, disagreements, records: bonusRecords, detectorValidation: validateDetectors(),
    apiAndUi: 'LLM: juicios válidos con historial y reglas complementarias, con fuentes y discrepancias separadas. API: contratos HTTP e integridad. Chatbot: reglas sobre texto e historial visibles; las herramientas internas de Botpress no son observables desde la UI.',
    calibration: 'Se agregan los juicios LLM existentes sin nuevas llamadas a proveedores. Estas métricas no demuestran la sensibilidad ni la tasa de falsos positivos del detector.',
  };
  const jobs = Object.fromEntries(Object.entries(metadata.needs ?? {}).map(([name, job]) => [name, job.result]));
  const incomplete = counts.MISSING + counts.ERROR > 0 || issues.length > 0;
  const failedJobs = Object.values(jobs).some(result => ['failure', 'cancelled'].includes(result));
  const overall = counts.FAIL || failedJobs || bonusRecords.some(r=>r.findings.length>0) ? 'FAIL' : incomplete || counts.BLOCKED || counts.REVIEW || counts.FLAKY || counts.SKIPPED || bonusRecords.some(r=>Object.values(r.categories).some(c=>c.status==='REVIEW')) ? 'INCOMPLETE' : 'PASS';
  return {
    generatedAt: new Date().toISOString(), metadata, jobs, overall,
    executionStatus: failedJobs || units.some(u => u.suite !== 'llm' && ['FAIL', 'FLAKY'].includes(u.status)) ? 'FAILED' :
      incomplete || scenarioReports.some(s => !['PASS', 'FAIL', 'REVIEW'].includes(s.status) || s.completedTurns !== 6 || s.validEvaluations !== 6 || s.turnEvaluations?.some(t => t.evaluation_status !== 'COMPLETED' || !['PASS', 'FAIL', 'REVIEW'].includes(t.evaluation?.verdict))) ? 'INCOMPLETE' : 'COMPLETED',
    evidenceComplete: !incomplete,
    metricDefinitions: { flaggedTurnRatePercent: 'Turnos con juicio válido y errores, FAIL, REVIEW, señal semántica o hallazgo bonus / juicios válidos; un turno se cuenta una vez.', detectorFlaggedTurnRatePercent: 'Juicios válidos con señal de alucinación, seguridad, toxicidad o contexto explícito / juicios válidos.', bonusFindingRecordRatePercent: 'Registros bonus con hallazgos / registros con al menos una categoría evaluable. Controles fijos excluidos.' },
    units, counts, plannedUnits: units.length, executedUnits: executed,
    metrics: { passedPlannedPercent: pct(counts.PASS, units.length), passExecutedPercent: pct(counts.PASS, executed), failExecutedPercent: pct(counts.FAIL, executed),
      completedConversationsPercent: pct(scenarioReports.filter(s => s.completedTurns === 6).length, 5),
      llmEvaluationCoveragePercent: pct(validTurns.length, 30), meanCoherence: mean(validTurns.map(e => e.coherenceScore)),
      meanContext: mean(validTurns.map(e => e.contextRetentionScore)), meanUsefulness: mean(validTurns.map(e => e.usefulnessScore).filter(numeric)),
      resolution: { notApplicable: scenarioReports.filter(s => s.experience?.resolutionStatus === "not_applicable").length, resolved: scenarioReports.filter(s => s.experience?.resolutionStatus === "resolved").length, partial: scenarioReports.filter(s => s.experience?.resolutionStatus === "partial").length, unresolved: scenarioReports.filter(s => s.experience?.resolutionStatus === "unresolved").length, unknown: scenarioReports.filter(s => !s.experience || s.experience.resolutionStatus === "unknown").length }, ...findingMetrics,
      bonusRecords: eligibleBonusRecords.length, bonusDetectedRecords: eligibleBonusRecords.filter(r=>r.findings.length>0).length, bonusFindingRecordRatePercent: pct(eligibleBonusRecords.filter(r=>r.findings.length>0).length,eligibleBonusRecords.length),
      validEvaluations: validTurns.length,
      meanTimesMs: Object.fromEntries(Object.entries(timing).map(([key, values]) => [key, { mean: mean(values), samples: values.length }])) },
    scenarios: scenarioReports, suites, bonus, issues, sources, llmRows,
  };
}

export function renderMarkdown(r) {
  const m = r.metrics;
  const labels = { 'simple-query': '1 · Consulta simple', 'topic-change': '2 · Cambio de tema', 'ambiguous-information': '3 · Información ambigua', 'conversational-memory': '4 · Memoria conversacional', 'prompt-injection': '5 · Seguridad y prompt injection' };
  const resolutionNames = { resolved: 'resuelta', partial: 'parcial', unresolved: 'sin resolver', not_applicable: 'no aplica', unknown: 'desconocida' };
  const scope = { llm: 'Ejercicio 1 · LLM', api: 'Ejercicio 2 · API', 'chatbot-docs': 'Ejercicio 3 · Chatbot de Docs', 'chatbot-homepage': 'Ejercicio 3 · Chatbot de la página principal (adicional)' };
  const safe = value => cell(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const value = (n, suffix = '') => n == null ? 'N/A' : `${n}${suffix}`;
  const details = (title, body) => ['<details>', `<summary>${safe(title)}</summary>`, '', ...body, '', '</details>', ''];
  const historicalCompletion = r.evidenceComplete && ['typecheck', 'playwright'].every(job => r.jobs?.[job] === 'success') && r.scenarios.length === 5 && r.scenarios.every(s => ['PASS', 'FAIL', 'REVIEW'].includes(s.status) && s.completedTurns === 6 && s.validEvaluations === 6 && s.turnEvaluations?.every(t => t.evaluation_status === 'COMPLETED' && ['PASS', 'FAIL', 'REVIEW'].includes(t.evaluation?.verdict)));
  const coverage = category => { if (!(r.bonus.transverse ?? []).some(s=>s.scope!=='llm' && s.records>0)) return 'NOT_EVALUATED (sin registros de esta ejecución)'; const c=(r.bonus.transverse ?? []).filter(s=>s.scope!=='llm').map(s=>s.categories[category]).filter(Boolean); return c.length ? `${c.reduce((n,e)=>n+e.evaluated,0)} registros evaluados · ${c.reduce((n,e)=>n+e.detected,0)} detectados · ${c.reduce((n,e)=>n+e.review,0)} REVIEW` : 'Sin evidencia de reglas transversales en esta ejecución'; };
  const execution = r.executionStatus ?? (historicalCompletion ? 'COMPLETED' : 'UNKNOWN (reporte histórico)');
  const lines = [
    '# Reporte consolidado de QA', '',
    `**Ejecución de la evaluación: ${execution}** · **Calidad observada: ${r.overall}**`, '',
    `Ejecución: ${r.metadata.runUrl ?? 'Entrada local'} · Intento: ${r.metadata.attempt ?? 'N/A'}`, '',
    `Commit: \`${r.metadata.commit ?? 'No suministrado'}\` · Generado: ${r.generatedAt}`, '',
    ...(r.metricRevision ? [`Revisión de métricas: ${r.metricRevision.note}`, ''] : []),
    '## Resumen general', '',
    `**${r.counts.PASS} PASS · ${r.counts.FAIL} FAIL · ${r.counts.SKIPPED} SKIPPED** en ${r.plannedUnits} unidades planificadas.`, '',
    `${r.counts.BLOCKED} bloqueadas, ${r.counts.REVIEW} para revisión, ${r.counts.FLAKY} inestables, ${r.counts.MISSING} ausentes y ${r.counts.ERROR} inválidas/con error.`, '',
    'Una evaluación completada puede incluir hallazgos funcionales FAIL o REVIEW. REVIEW indica una ejecución técnicamente incompleta solo cuando falta un juicio; un veredicto REVIEW disponible es un hallazgo de calidad. El estado de ejecución describe si el proceso se completó; la calidad observada conserva los hallazgos y las brechas de cobertura.', '',
    table(['Ámbito', 'PASS', 'FAIL', 'REVIEW', 'Omitidos', 'Otros / incompletos'], ['llm', ...Object.keys(inventories)].map(suite => {
      const count = status => r.units.filter(u => u.suite === suite && u.status === status).length;
      return [scope[suite], count('PASS'), count('FAIL'), count('REVIEW'), count('SKIPPED'), ['BLOCKED', 'FLAKY', 'MISSING', 'ERROR'].reduce((n, s) => n + count(s), 0)];
    })), '',
    '## Métricas globales', '',
    table(['Métrica', 'Resultado'], [
      ['PASS / unidades ejecutadas', value(m.passExecutedPercent, '%')], ['FAIL / unidades ejecutadas', value(m.failExecutedPercent, '%')],
      ['PASS / unidades planificadas', value(m.passedPlannedPercent, '%')],
      ['Conversaciones LLM completas', `${r.scenarios.filter(s => s.completedTurns === 6).length}/5 (${value(m.completedConversationsPercent, '%')})`],
      ['Juicios LLM disponibles', `${m.validEvaluations}/30 (${value(m.llmEvaluationCoveragePercent, '%')})`],
      ['Turnos LLM con hallazgos (juez o bonus, incluye REVIEW)', `${m.flaggedTurns}/${m.validEvaluations} (${value(m.flaggedTurnRatePercent, '%')})`],
      ['Turnos señalados por los cuatro detectores semánticos del juez', `${m.detectorFlaggedTurns ?? 'N/A'}/${m.validEvaluations} (${value(m.detectorFlaggedTurnRatePercent, '%')})`],
      ['Registros de reglas auxiliares con hallazgos / evaluables', `${m.bonusDetectedRecords ?? 'N/A'}/${m.bonusRecords ?? 'N/A'} (${value(m.bonusFindingRecordRatePercent, '%')})`],
      ['Promedio de coherencia / contexto / utilidad', `${value(m.meanCoherence)} / ${value(m.meanContext)} / ${value(m.meanUsefulness)} sobre 100`],
      ['Resolución de la necesidad del usuario', `${m.resolution.resolved} resueltas · ${m.resolution.partial} parciales · ${m.resolution.unresolved} sin resolver · ${m.resolution.notApplicable} no aplican · ${m.resolution.unknown} desconocidas`],
    ]), '',
    'Las unidades son los cinco escenarios LLM más los casos de API/UI, no los turnos individuales. El denominador de ejecutadas incluye PASS, FAIL, REVIEW y FLAKY; excluye los demás estados. Estas unidades heterogéneas no representan una puntuación de calidad del producto. La tasa global cuenta una vez cada turno con juicio válido y errores explícitos, FAIL, REVIEW, señal semántica o hallazgo bonus. La tasa de detectores se limita a alucinación, seguridad, toxicidad y contexto explícito; no mide la precisión del detector. N/A indica evidencia no disponible, nunca cero errores.', '',
    '## Ejercicio 1 · Cinco escenarios conversacionales', '',
    table(['Escenario', 'Veredicto', 'Coherencia /100', 'Señales de alucinación', 'Seguridad %', 'Completitud'], r.scenarios.map(s => {
      const valid = (s.turnEvaluations ?? []).filter(t => t.evaluation_status === 'COMPLETED' && t.evaluation);
      const hallucinations = valid.filter(t => t.evaluation.hallucinationDetected || t.evaluation.hallucinationType !== 'none').length;
      return [labels[s.id] ?? s.id, s.status, s.quality.coherence, s.validEvaluations ? `${hallucinations}/${s.validEvaluations}` : 'N/A', s.quality.security, `${s.completedTurns ?? '?'}/6 respuestas · ${s.validEvaluations}/6 juicios`];
    })), '',
    'Seguridad % es la proporción de juicios disponibles sin señal de falla de seguridad; incluye turnos benignos. Las señales de alucinación son clasificaciones del juez, no hechos confirmados independientemente. Completar seis intercambios no implica resolver la necesidad del usuario.', '',
  ];
  for (const s of r.scenarios) {
    const turns = s.turnEvaluations ?? [];
    lines.push(`### ${labels[s.id] ?? s.id} · ${s.status}`, '',
      `**Contexto:** ${value(s.quality.context, '/100')} · **Utilidad:** ${value(s.quality.usefulness, '/100')} · **Resolución de la necesidad:** ${safe(resolutionNames[s.experience?.resolutionStatus] ?? 'desconocida')}`, '',
      `**Clasificaciones del juez:** ${value(s.quality.falseRate, '%')} afirmaciones falsas · ${value(s.quality.unsupportedRate, '%')} sin respaldo.`, '',
      '**Hallazgos registrados (citas originales)**', '',
      ...(s.findings.length ? s.findings.map(f => `- ${safe(f)}`) : ['No se registraron hallazgos en la evidencia disponible.']), '');
    const body = [];
    for (const t of turns) {
      const e = t.evaluation;
      body.push(`#### Turno ${t.turn} · ${safe(e?.verdict ?? t.evaluation_status ?? 'UNAVAILABLE')}`, '',
        `**Usuario (cita original):** ${safe(t.userMessage ?? 'No registrado en esta fuente')}`, '',
        `**Asistente (cita original):** ${safe(t.assistantMessage ?? 'No registrado en esta fuente')}`, '',
        `**Razonamiento del juez (cita original):** ${safe(e?.analysis ?? t.evaluator_failure?.message ?? 'No disponible')}`, '',
        `**Experiencia de usuario (cita del juez):** ${safe(e?.uxAnalysis ?? 'No disponible en esta fuente')}`, '');
    }
    if (!turns.length) body.push('No hay evidencia por turno disponible.');
    lines.push(...details(`Revisar ${s.id}: conversación y juicios por turno`, body));
    if (s.analysis) lines.push(...details('Análisis original del escenario (cita preservada)', [safe(s.analysis)]));
  }
  lines.push('## Ejercicios 2 y 3 · API y chatbot', '');
  for (const suite of r.suites) {
    const n = state => suite.tests.filter(t => t.status === state).length;
    lines.push(`### ${scope[suite.suite]}`, '', `**${n('PASS')} PASS · ${n('FAIL')} FAIL · ${n('SKIPPED')} SKIPPED** · ${suite.tests.length} casos planificados.`, '');
    lines.push(...details('Revisar resultados por caso y evidencia de aserciones', [
      table(['Caso', 'Resultado', 'Duración ms', 'Intentos'], suite.tests.map(t => [t.id, t.status, t.durationMs, t.attempts])), '',
      ...suite.tests.flatMap(t => t.errors.map(e => `- **${t.id}:** ${safe(e)}`)),
    ]));
  }
  const timingLabels = { llmAssistantMs: 'Respuesta del asistente LLM', llmEvaluatorMs: 'Respuesta del juez LLM', apiTestMs: 'Prueba API (preparación y aserciones)', docsTestMs: 'Prueba UI de Docs', homepageTestMs: 'Prueba UI de la página principal', docsResponseMs: 'Primera respuesta visible de Docs', homepageResponseMs: 'Primera respuesta visible de la página principal' };
  lines.push('## Tiempos promedio', '', table(['Medición', 'Promedio ms', 'Muestras'], Object.entries(m.meanTimesMs).map(([key, v]) => [timingLabels[key] ?? key, v.mean, v.samples])), '',
    'Los tiempos LLM incluyen la sobrecarga del ejecutor y sus reintentos. La duración de una prueba no equivale a la latencia del endpoint. La latencia del chatbot mide el primer texto visible, no la respuesta completa. No se combinan mediciones de distinta naturaleza.', '',
    '## Detección automática · Cobertura entre ejercicios', '',
    table(['Detector', 'Evidencia LLM', 'Cobertura API / chatbot'], [
      ['Alucinaciones', `${r.bonus.hallucinations.detectedTurns}/${m.validEvaluations} señaladas; ${r.bonus.hallucinations.demonstrablyFalse} falsas, ${r.bonus.hallucinations.unsupported} sin respaldo`, coverage('hallucination')],
      ['Prompt injection', `${r.bonus.promptInjection.securityFailures} fallas de seguridad / ${r.bonus.promptInjection.evaluatedAttacks ?? 'N/A'} ataques con juicio válido`, coverage('promptInjection')],
      ['Respuestas tóxicas', `${r.bonus.toxicity.detectedTurns}/${m.validEvaluations} señaladas`, coverage('toxicity')],
      ['Pérdida de contexto / contexto irrelevante', `${r.bonus.context.materialContextFailures} señales explícitas / ${r.bonus.context.explicitDetectorCoverage} juicios explícitos`, coverage('contextLoss')],
      ['Uso incorrecto de herramientas (tool calling)', `${r.bonus.toolCalling.status} · ${r.bonus.toolCalling.evaluatedCalls} llamadas LLM · ${r.bonus.toolCalling.httpActionsEvaluated ?? 'N/A'} acciones HTTP · ${r.bonus.toolCalling.detectedErrors ?? 'N/A'} hallazgos instrumentados totales`, 'Contrato de acciones HTTP; trazas internas de Botpress no observables'],
    ]), '',
    'Cero señales significa que no se registraron, no que se demostró su ausencia. El denominador de prompt injection incluye solo ataques identificados con juicio válido. Una puntuación de contexto menor de 100 no confirma por sí sola un defecto. Las herramientas de consulta del LLM y las acciones HTTP se instrumentan. No se infieren herramientas internas del bot externo. Cada detector declara la cobertura realmente disponible.', '',
    'En API, la comparación factual corresponde al contrato y a la integridad de sus datos; no se atribuye al servicio una conversación LLM. Los controles de reglas no se incluyen en las métricas de ejecución real.', '',
    'Se agregan los juicios existentes sin nuevas llamadas al proveedor. Estas métricas no demuestran por sí solas la sensibilidad ni la tasa de falsos positivos del evaluador.', '',
    ...(r.bonus.transverse ? ['### Cobertura de evaluación por ejercicio', '',
      'En LLM se reutilizan los juicios válidos con historial acumulado y las comprobaciones adicionales. Un extractor sin coincidencia no invalida un juicio disponible. Las fuentes pueden coincidir en un mismo turno y no se suman como evaluaciones distintas. Los veredictos originales se conservan.', '',
      table(['Ámbito','Registros','Detector','Evaluados','Detectados','REVIEW','No aplica','Sin evaluación','Juez','Reglas','Discrepancias'],r.bonus.transverse.flatMap(s=>Object.entries(s.categories).map(([name,c])=>[s.scope,s.records,name,c.evaluated,c.detected,c.review,c.notApplicable,c.unavailable,c.judgeEvaluated ?? 0,c.rulesEvaluated ?? 0,c.disagreements ?? 0]))), ''] : []),
    ...(r.bonus.rulesTransverse ? details('Cobertura independiente de las reglas auxiliares', [
      'Esta tabla solo describe extractores y reglas; sus omisiones no indican que falte la evaluación del juez.', '',
      table(['Ámbito','Registros','Detector','Evaluados','Detectados','REVIEW','No aplica','Sin referencia/traza'],r.bonus.rulesTransverse.flatMap(s=>Object.entries(s.categories).map(([name,c])=>[s.scope,s.records,name,c.evaluated,c.detected,c.review,c.notApplicable,c.unavailable]))),
    ]) : []),
    ...((r.bonus.disagreements ?? []).length ? details('Discrepancias entre juez y reglas', (r.bonus.disagreements ?? []).map(d => `- **${safe(d.id)} · ${safe(d.category)}:** juez ${safe(d.judgment.status)}, regla ${safe(d.rule.status)}. Evidencia: ${safe(JSON.stringify(d))}`)) : []),
    ...(r.bonus.detectorValidation ? ['### Controles de validación del motor bonus', '', `${r.bonus.detectorValidation.cases} controles fijos; ${r.bonus.detectorValidation.mismatches} discrepancias. Incluyen casos positivos y negativos. No son conversaciones reales ni calibración del juez LLM.`, ''] : []),
    ...((r.bonus.records ?? []).some(record=>record.findings?.length) ? details('Evidencia de los hallazgos bonus', (r.bonus.records ?? []).flatMap(record=>(record.findings ?? []).map(f=>`- **${safe(record.scope)}/${safe(record.id)} · ${safe(f.category)} · ${safe(f.code)}:** ${safe(f.explanation)} Evidencia: ${safe(JSON.stringify(f.evidence))}`))) : []),
    '## Brechas de evidencia y seguimiento', '',
    ...(r.issues.length ? ['**Incidencias de ejecución (mensajes originales del código):**', ''] : []),
    ...r.issues.map(issue => `- ${safe(issue)}`),
    '- CHATBOT-003 permanece como una brecha documentada de Docs cuando se omite; la página principal aporta cobertura adicional.',
    '- Contrasta las clasificaciones del juez con la evidencia; los FAIL funcionales se conservan aunque la ejecución termine correctamente.',
    '- Los campos históricos de experiencia de usuario ausentes permanecen desconocidos. El JSON conserva los análisis, mensajes, métricas y juicios originales.', '',
  );
  lines.push(...details('Trazabilidad del workflow y archivos de entrada', [table(['Job', 'Resultado'], Object.entries(r.jobs)), '',
    `Descargas de artefactos: ${safe(JSON.stringify(r.metadata.downloads ?? {}))}`, '',
    'Solo se lee el directorio de entrada de esta ejecución e intento. Nunca se utilizan reportes históricos como respaldo. Generar este reporte no hace llamadas a proveedores.', '', ...r.sources.map(source => `- ${safe(source)}`)]));
  return lines.join('\n');
}

function envJson(name) {
  try { return JSON.parse(process.env[name] || '{}'); }
  catch { return { parsingError: `Invalid ${name}` }; }
}

export function main() {
  const input = process.argv[2] ?? 'output/reporte-consolidado/inputs';
  const output = resolve(process.argv[3] ?? 'output/reporte-consolidado');
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
  console.log(`Reporte consolidado: ${report.overall}; ${report.counts.PASS}/${report.plannedUnits} PASS. Guardado en ${output}`);
  // Escribe las evidencias antes de devolver el error para permitir su subida.
  if (!report.evidenceComplete) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();



