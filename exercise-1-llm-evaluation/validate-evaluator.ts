import { mkdir, writeFile } from 'node:fs/promises';
import { cases, evaluationInput, compareJudgment, detectorFlag } from './tests/evaluator-cases.js';
import { evaluateAssistantTurn } from './services/evaluator.service.js';
import { knowledgeBase } from './config/knowledge-base.js';
import { llmConfig } from './config/llm.config.js';
import { getErrorSummary, isInfrastructureError } from './utils/retry.js';

async function main() {
  const records: Array<Record<string, unknown>> = [];
  const matrices = Object.fromEntries(['hallucination', 'context', 'security', 'toxicity'].map(c => [c, { tp: 0, tn: 0, fp: 0, fn: 0 }]));
  let blocked = false;
  let mismatches = 0;
  const root = 'exercise-1-llm-evaluation/output/evaluator-validation';
  await mkdir(root, { recursive: true });
  for (const item of cases) {
    if (blocked) { records.push({ id: item.id, expected: item.expected, rationale: item.rationale, status: 'NOT_RUN', reason: 'Earlier provider blocker' }); continue; }
    try {
      const result = await evaluateAssistantTurn(evaluationInput(item));
      const differences = compareJudgment(item, result.evaluation);
      const actual = detectorFlag(item.category, result.evaluation);
      const key = item.positive ? actual ? 'tp' : 'fn' : actual ? 'fp' : 'tn';
      matrices[item.category]![key]++;
      mismatches += differences.length > 0 ? 1 : 0;
      records.push({ id: item.id, category: item.category, status: differences.length ? 'MISMATCH' : 'MATCH', expected: item.expected, observed: result.evaluation, differences, rationale: item.rationale, history: evaluationInput(item).history });
    } catch (error) {
      blocked = isInfrastructureError(error);
      records.push({ id: item.id, expected: item.expected, rationale: item.rationale, status: blocked ? 'BLOCKED' : 'UNAVAILABLE', error: getErrorSummary(error) });
    }
    await save();
  }
  await save();
  async function save() {
    const valid = records.filter(r => r.status === 'MATCH' || r.status === 'MISMATCH').length;
    const rate = (n: number, d: number) => d ? Number((100 * n / d).toFixed(2)) : null;
    const report = { knowledgeBase, generatedAt: new Date().toISOString(), provider: llmConfig.evaluator, expectedCases: cases.length, validCases: valid, coveragePercent: rate(valid, cases.length), mismatchedCases: mismatches,
      status: blocked ? 'BLOCKED' : valid !== cases.length ? 'INCOMPLETE' : mismatches ? 'MISMATCH' : 'MATCH',
      categories: Object.fromEntries(Object.entries(matrices).map(([c, m]) => [c, { ...m, falsePositiveRatePercent: rate(m.fp, m.fp + m.tn), falseNegativeRatePercent: rate(m.fn, m.fn + m.tp) }])), records,
      limitations: 'Small reference set, not a statistical guarantee. Provider/output failures are excluded from detector denominators. Original judgments and mismatches are preserved.' };
    await writeFile(`${root}/validation-results.json`, JSON.stringify(report, null, 2));
    await writeFile(`${root}/validation-results.md`, `# Evaluator reference validation\n\nStatus: ${report.status}\n\nValid cases: ${valid}/${cases.length}; mismatched cases: ${mismatches}.\n\nSee validation-results.json for per-case evidence and confusion matrices.\n\n${report.limitations}\n`);
  }
  process.exitCode = blocked ? 2 : mismatches || records.some(r => !['MATCH', 'MISMATCH'].includes(String(r.status))) ? 1 : 0;
}
main().catch(error => { console.error(error); process.exitCode = 1; });

