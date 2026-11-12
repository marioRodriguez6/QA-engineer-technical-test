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
      limitation: 'Cuenta fallas de seguridad en el escenario de inyección, incluido su primer turno benigno; no es una tasa de éxito por ataque.' },
    toxicity: { evaluatedTurns: validTurns.length, detectedTurns: validTurns.filter(e => e.toxicityDetected).length },
    context: { materialContextFailures: validTurns.filter(e => e.contextIssueDetected === true).length, explicitDetectorCoverage: validTurns.filter(e => typeof e.contextIssueDetected === 'boolean').length, evaluatedTurns: validTurns.length, meanScore: mean(validTurns.map(e => e.contextRetentionScore)), scoreDeviations: scoreDeviations.length,
      limitation: 'Una puntuación menor de 100 es una señal de revisión, no un defecto de contexto confirmado automáticamente. Se conservan los análisis y errores del juez por turno.' },
    toolCalling: { status: 'NOT_IMPLEMENTED', evaluatedCalls: 0, detectedErrors: null,
      limitation: 'El asistente no tiene herramientas configuradas ni trazas de sus llamadas. Nunca se cuenta como PASS.' },
    apiAndUi: 'NOT_EVALUATED para detección semántica de alucinaciones, inyección, toxicidad, contexto y herramientas. Las aserciones y fallas de ejecución API/UI se consolidan por separado.',
    calibration: 'Se agregan los juicios LLM existentes sin nuevas llamadas a proveedores. Estas métricas no demuestran la sensibilidad ni la tasa de falsos positivos del detector.',
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
  const labels = { 'simple-query': '1 · Consulta simple', 'topic-change': '2 · Cambio de tema', 'ambiguous-information': '3 · Información ambigua', 'conversational-memory': '4 · Memoria conversacional', 'prompt-injection': '5 · Seguridad y prompt injection' };
  const resolutionNames = { resolved: 'resuelta', partial: 'parcial', unresolved: 'sin resolver', not_applicable: 'no aplica', unknown: 'desconocida' };
  const scope = { llm: 'Ejercicio 1 · LLM', api: 'Ejercicio 2 · API', 'chatbot-docs': 'Ejercicio 3 · Chatbot de Docs', 'chatbot-homepage': 'Ejercicio 3 · Chatbot de la página principal (adicional)' };
  const safe = value => cell(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const value = (n, suffix = '') => n == null ? 'N/A' : `${n}${suffix}`;
  const details = (title, body) => ['<details>', `<summary>${safe(title)}</summary>`, '', ...body, '', '</details>', ''];
  const historicalCompletion = r.evidenceComplete && ['typecheck', 'playwright'].every(job => r.jobs?.[job] === 'success') && r.scenarios.length === 5 && r.scenarios.every(s => ['PASS', 'FAIL', 'REVIEW'].includes(s.status) && s.completedTurns === 6 && s.validEvaluations === 6 && s.turnEvaluations?.every(t => t.evaluation_status === 'COMPLETED' && ['PASS', 'FAIL', 'REVIEW'].includes(t.evaluation?.verdict)));
  const execution = r.executionStatus ?? (historicalCompletion ? 'COMPLETED' : 'UNKNOWN (reporte histórico)');
  const lines = [
    '# Reporte consolidado de QA', '',
    `**Ejecución de la evaluación: ${execution}** · **Calidad observada: ${r.overall}**`, '',
    `Ejecución: ${r.metadata.runUrl ?? 'Entrada local'} · Intento: ${r.metadata.attempt ?? 'N/A'}`, '',
    `Commit: \`${r.metadata.commit ?? 'No suministrado'}\` · Generado: ${r.generatedAt}`, '',
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
      ['Turnos con problemas señalados por el juez', `${m.flaggedTurns}/${m.validEvaluations} (${value(m.flaggedTurnRatePercent, '%')})`],
      ['Promedio de coherencia / contexto / utilidad', `${value(m.meanCoherence)} / ${value(m.meanContext)} / ${value(m.meanUsefulness)} sobre 100`],
      ['Resolución de la necesidad del usuario', `${m.resolution.resolved} resueltas · ${m.resolution.partial} parciales · ${m.resolution.unresolved} sin resolver · ${m.resolution.notApplicable} no aplican · ${m.resolution.unknown} desconocidas`],
    ]), '',
    'Las unidades son los cinco escenarios LLM más los casos de API/UI, no los turnos individuales. El denominador de ejecutadas incluye PASS, FAIL, REVIEW y FLAKY; excluye los demás estados. Estas unidades heterogéneas no representan una puntuación de calidad del producto. La tasa de turnos señalados cuenta cada turno una sola vez entre señales factuales, de seguridad, toxicidad y contexto explícito; no mide la precisión del detector. N/A indica evidencia no disponible, nunca cero errores.', '',
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
      ['Alucinaciones', `${r.bonus.hallucinations.detectedTurns}/${m.validEvaluations} señaladas; ${r.bonus.hallucinations.demonstrablyFalse} falsas, ${r.bonus.hallucinations.unsupported} sin respaldo`, 'NOT_EVALUATED'],
      ['Prompt injection', `${r.bonus.promptInjection.securityFailures} fallas de seguridad / ${r.bonus.promptInjection.evaluatedScenarioTurns} juicios del escenario`, 'NOT_EVALUATED'],
      ['Respuestas tóxicas', `${r.bonus.toxicity.detectedTurns}/${m.validEvaluations} señaladas`, 'NOT_EVALUATED'],
      ['Pérdida de contexto / contexto irrelevante', `${r.bonus.context.materialContextFailures} señales explícitas / ${r.bonus.context.explicitDetectorCoverage} juicios explícitos`, 'NOT_EVALUATED'],
      ['Uso incorrecto de herramientas (tool calling)', 'NOT_IMPLEMENTED · 0 llamadas instrumentadas', 'NOT_EVALUATED'],
    ]), '',
    'Cero señales significa que no se registraron, no que se demostró su ausencia. El conteo de prompt injection incluye el turno inicial benigno. Una puntuación de contexto menor de 100 no confirma por sí sola un defecto. No hay herramientas configuradas ni trazas de sus llamadas; esa dimensión nunca se cuenta como PASS. Se consolidan resultados de todos los ejercicios, pero la cobertura actual de los detectores semánticos procede únicamente del ejercicio LLM.', '',
    'Se agregan los juicios existentes sin nuevas llamadas al proveedor. Estas métricas no demuestran por sí solas la sensibilidad ni la tasa de falsos positivos del evaluador.', '',
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
  const input = process.argv[2] ?? 'exercise-5-consolidated-report/output/inputs';
  const output = resolve(process.argv[3] ?? 'exercise-5-consolidated-report/output');
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

