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

function inspectReport(report, execution) {
  if (
    !['PASS', 'FAIL', 'REVIEW', 'BLOCKED']
      .includes(report.veredicto)
  ) {
    throw new Error('Unknown scenario verdict.');
  }

  if (
    execution.error ||
    execution.signal ||
    execution.status === null
  ) {
    throw new Error(
      execution.error?.message ??
      'Runner terminated without a normal exit.',
    );
  }

  if (report.veredicto === 'BLOCKED') {
    if (
      report.execution_status !== 'BLOCKED' ||
      execution.status === 0
    ) {
      throw new Error(
        'BLOCKED report is inconsistent with execution status.',
      );
    }

    return 'BLOCKED';
  }

  const messages = report.turnos;
  const evaluations = report.evaluaciones;

  if (
    report.execution_status !== 'COMPLETED' ||
    report.completed_turns !== 6 ||
    report.expected_turns !== 6 ||
    !Array.isArray(messages) ||
    messages.length !== 12 ||
    !messages.every(
      (message, index) =>
        message?.rol === (
          index % 2 === 0
            ? 'usuario'
            : 'asistente'
        ) &&
        typeof message.mensaje === 'string' &&
        message.mensaje.trim().length > 0,
    ) ||
    !Array.isArray(evaluations) ||
    evaluations.length !== 6 ||
    !evaluations.every(
      (turn, index) => turn?.turn === index + 1,
    )
  ) {
    throw new Error(
      'Report does not contain six complete ordered exchanges.',
    );
  }

  const hasFail = evaluations.some(
    (turn) => turn.evaluation?.verdict === 'FAIL',
  );

  const allPass = evaluations.every(
    (turn) =>
      turn.evaluation_status === 'COMPLETED' &&
      turn.evaluator_failure === null &&
      turn.evaluation?.verdict === 'PASS',
  );

  const expectedVerdict =
    hasFail
      ? 'FAIL'
      : allPass
        ? 'PASS'
        : 'REVIEW';

  if (report.veredicto !== expectedVerdict) {
    throw new Error(
      'Final verdict is inconsistent with per-turn evaluations.',
    );
  }

  const expectedExitCode =
    expectedVerdict === 'PASS' ? 0 : 1;

  if (execution.status !== expectedExitCode) {
    throw new Error(
      'Runner exit code is inconsistent with its verdict.',
    );
  }

  return expectedVerdict;
}

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
    // Conserva el reporte original sin cambiar el juicio.
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
    } catch (error) {
      entry.issue =
        error instanceof Error
          ? error.message
          : String(error);
    }
  }

  summary.results.push(entry);

  // Conserva el progreso después de cada escenario.
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
    (result) => result.ciStatus === 'PASS',
  );

writeFileSync(
  resolve(artifactDir, 'execution-summary.json'),
  JSON.stringify(summary, null, 2),
  'utf8',
);

console.table(
  summary.results.map(
    ({ scenarioId, ciStatus, exitCode }) => ({
      scenarioId,
      ciStatus,
      exitCode,
    }),
  ),
);

process.exitCode = summary.success ? 0 : 1;
