import { inspectReport, evaluationCompleted } from './inspect-report.mjs';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';

import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const scenarios = [
  'simple-query',
  'topic-change',
  'ambiguous-information',
  'conversational-memory',
  'prompt-injection',
];

const artifactDir = resolve('output/ci/llm');

mkdirSync(artifactDir, { recursive: true });

const summary = {
  startedAt: new Date().toISOString(),
  commit: process.env.GITHUB_SHA ?? null,
  nodeVersion: process.version,
  results: [],
};


for (const scenarioId of scenarios) {
  console.log(
    '\n========== ' + scenarioId + ' ==========',
  );

  const sourcePath = resolve(
    'output/llm/' + scenarioId + '.json',
  );

  const artifactPath = resolve(
    artifactDir,
    scenarioId + '.json',
  );

  // Evita reutilizar resultados de una ejecución anterior.
  rmSync(sourcePath, { force: true });
  rmSync(artifactPath, { force: true });

  const startedAt = Date.now();

  const execution = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      'exercise-1-llm-evaluation/runner.ts',
      scenarioId,
    ],
    {
      env: process.env,
      encoding: 'utf8',
      timeout: 300_000,
      maxBuffer: 16 * 1024 * 1024,
    },
  );

  const stdout = execution.stdout ?? '';
  const stderr = execution.stderr ?? '';

  process.stdout.write(stdout);
  process.stderr.write(stderr);

  const entry = {
    scenarioId,
    exitCode: execution.status,
    signal: execution.signal,
    durationMs: Date.now() - startedAt,
    executionStatus: null,
    verdict: null,
    ciStatus: 'ERROR',
    evaluationCompleted: false,
    issue: execution.error?.message ?? null,
  };

  writeFileSync(
    resolve(artifactDir, scenarioId + '.log'),
    [
      'STDOUT:',
      stdout,
      'STDERR:',
      stderr,
      'PROCESS ERROR:',
      execution.error?.message ?? 'none',
    ].join('\n'),
    'utf8',
  );

  if (!existsSync(sourcePath)) {
    entry.issue ??=
      'Runner did not generate a new JSON report.';
  } else {
    copyFileSync(sourcePath, artifactPath);

    try {
      const report = JSON.parse(
        readFileSync(sourcePath, 'utf8'),
      );

      entry.executionStatus =
        report.execution_status;

      entry.verdict = report.veredicto;

      entry.ciStatus =
        inspectReport(report, execution);
      entry.evaluationCompleted = evaluationCompleted(report, execution);
    } catch (error) {
      entry.issue =
        error instanceof Error
          ? error.message
          : String(error);
    }
  }

  summary.results.push(entry);

  writeFileSync(
    resolve(artifactDir, 'execution-summary.json'),
    JSON.stringify(summary, null, 2),
    'utf8',
  );
}

summary.finishedAt = new Date().toISOString();

summary.success =
  summary.results.length === scenarios.length &&
  summary.results.every(
    (result) => result.evaluationCompleted === true,
  );

writeFileSync(
  resolve(artifactDir, 'execution-summary.json'),
  JSON.stringify(summary, null, 2),
  'utf8',
);

console.table(
  summary.results.map(
    ({ scenarioId, ciStatus, exitCode, evaluationCompleted }) => ({
      scenarioId,
      ciStatus,
      exitCode,
      evaluationCompleted,
    }),
  ),
);

console.log(`Evaluation execution: ${summary.success ? 'COMPLETED' : 'INCOMPLETE/ERROR'}; ${summary.results.filter(r => r.evaluationCompleted).length}/5 scenarios fully evaluated. Functional verdicts are preserved above.`);
process.exitCode = summary.success ? 0 : 1;
