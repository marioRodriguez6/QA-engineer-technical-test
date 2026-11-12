export function inspectReport(report, execution) {
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

// Child exit codes remain verdict-based; the CI wrapper separately checks completion.
export function evaluationCompleted(report, execution) {
  const verdict = inspectReport(report, execution);
  return ['PASS', 'FAIL', 'REVIEW'].includes(verdict) && report.evaluaciones.every(turn =>
    turn.evaluation_status === 'COMPLETED' && turn.evaluator_failure === null &&
    ['PASS', 'FAIL', 'REVIEW'].includes(turn.evaluation?.verdict));
}

