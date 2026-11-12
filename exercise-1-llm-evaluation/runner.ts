import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

import { llmConfig } from './config/llm.config.js';

import {
  generateAssistantResponse,
} from './services/assistant.service.js';

import {
  generateSimulatedUserMessage,
} from './services/simulated-user.service.js';

import {
  evaluateAssistantTurn,
  type TurnEvaluation,
} from './services/evaluator.service.js';

import {
  getScenario,
  type Scenario,
} from './scenarios/scenarios.js';

import {
  getErrorSummary,
  isInfrastructureError,
} from './utils/retry.js';

import {
  measureDuration,
} from './utils/timing.js';

import type {
  ConversationMessage,
  LlmProvider,
} from './types/llm.types.js';

type Stage =
  | 'simulated_user'
  | 'assistant'
  | 'evaluator';

interface InfrastructureFailure {
  turn: number;
  stage: Stage;
  message: string;
}

interface ModelMetadata {
  provider: LlmProvider | null;
  model: string | null;
}

interface EvaluationFailure {
  type: string;
  message: string;
  diagnostics: unknown;
}

interface TurnResult {
  turn: number;
  userMessage: string;
  assistantMessage: string;

  simulatedUser: {
    source: 'fixed' | 'llm';
    provider: LlmProvider | null;
    model: string | null;
  };

  assistant: ModelMetadata;
  evaluator: ModelMetadata;

  evaluation_status: 'COMPLETED' | 'UNAVAILABLE';
  evaluation: TurnEvaluation | null;
  evaluator_failure: EvaluationFailure | null;

  timing: {
    userGenerationMs: number;
    assistantResponseMs: number;
    evaluatorResponseMs: number;
    totalTurnMs: number;
  };
}

interface ScenarioResult {
  escenario: string;
  execution_status: 'COMPLETED' | 'BLOCKED';
  completed_turns: number;
  expected_turns: number;
  infrastructure_failure: InfrastructureFailure | null;

  turnos: Array<{
    rol: 'usuario' | 'asistente';
    mensaje: string;
  }>;

  evaluaciones: TurnResult[];

  metricas: {
    coherence_score: number | null;
    context_retention: number | null;
    hallucination_rate: number | null;
    security_score: number | null;

    valid_evaluations: number;
    unavailable_evaluations: number;
    evaluation_coverage_rate: number;
    turn_completion_rate: number;
    completed_conversation_rate: number;
  };

  performance: {
    averageUserGenerationMs: number | null;
    averageAssistantResponseMs: number | null;
    averageEvaluatorResponseMs: number | null;
    averageTurnMs: number | null;
  };

  veredicto: 'PASS' | 'FAIL' | 'REVIEW' | 'BLOCKED';
  analisis: string;
  errores_detectados: string[];
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  return Number(
    (
      values.reduce((sum, value) => sum + value, 0) /
      values.length
    ).toFixed(2),
  );
}

function percentage(
  numerator: number,
  denominator: number,
): number {
  return denominator === 0
    ? 0
    : Number(
        ((numerator / denominator) * 100).toFixed(2),
      );
}

function getEvaluationFailure(
  error: unknown,
): EvaluationFailure {
  const diagnostics =
    error instanceof Error &&
    'diagnostics' in error
      ? error.diagnostics
      : null;

  const type =
    typeof diagnostics === 'object' &&
    diagnostics !== null &&
    'type' in diagnostics &&
    typeof diagnostics.type === 'string'
      ? diagnostics.type
      : 'EVALUATOR_OUTPUT_ERROR';

  return {
    type,
    message: getErrorSummary(error),
    diagnostics,
  };
}

function isEvaluatorOutputError(
  error: unknown,
): boolean {
  return (
    error instanceof Error &&
    error.name === 'EvaluatorOutputError'
  );
}

function calculateScenarioResult(
  scenario: Scenario,
  conversation: ConversationMessage[],
  turns: TurnResult[],
  infrastructureFailure: InfrastructureFailure | null = null,
): ScenarioResult {
  const validEvaluations = turns.flatMap(
    (turn) =>
      turn.evaluation === null
        ? []
        : [turn.evaluation],
  );

  const completedTurns = conversation.filter(
    (message) => message.role === 'assistant',
  ).length;

  const expectedTurns = scenario.userTurns.length;
  const validCount = validEvaluations.length;

  const unavailableCount = turns.filter(
    (turn) => turn.evaluation_status === 'UNAVAILABLE',
  ).length;

  const hasFail = validEvaluations.some(
    (evaluation) => evaluation.verdict === 'FAIL',
  );

  const hasReview = validEvaluations.some(
    (evaluation) => evaluation.verdict === 'REVIEW',
  );

  const isComplete = completedTurns === expectedTurns;

  let verdict: ScenarioResult['veredicto'];

  if (infrastructureFailure !== null) {
    verdict = 'BLOCKED';
  } else if (hasFail) {
    verdict = 'FAIL';
  } else if (
    hasReview ||
    unavailableCount > 0 ||
    validCount !== expectedTurns ||
    !isComplete
  ) {
    verdict = 'REVIEW';
  } else {
    verdict = 'PASS';
  }

  const errors = turns.flatMap((turn) => [
    ...(turn.evaluation?.errors ?? []).map(
      (message) => `Turn ${turn.turn}: ${message}`,
    ),

    ...(turn.evaluator_failure === null
      ? []
      : [
          `Turn ${turn.turn} — evaluator: ` +
          turn.evaluator_failure.message,
        ]),
  ]);

  if (infrastructureFailure !== null) {
    errors.push(
      `Turn ${infrastructureFailure.turn} — ` +
      `${infrastructureFailure.stage}: ` +
      infrastructureFailure.message,
    );
  }

  const generatedUserTurns = turns.filter(
    (turn) => turn.simulatedUser.source === 'llm',
  );

  const hallucinatedTurns = validEvaluations.filter(
    (evaluation) =>
      evaluation.hallucinationType ===
      'demonstrably_false',
  ).length;

  const securityFailures = validEvaluations.filter(
    (evaluation) =>
      evaluation.securityIssueDetected,
  ).length;

  return {
    escenario: scenario.name,

    execution_status:
      infrastructureFailure === null
        ? 'COMPLETED'
        : 'BLOCKED',

    completed_turns: completedTurns,
    expected_turns: expectedTurns,
    infrastructure_failure: infrastructureFailure,

    turnos: conversation.map((message) => ({
      rol:
        message.role === 'user'
          ? 'usuario'
          : 'asistente',
      mensaje: message.message,
    })),

    evaluaciones: turns,

    metricas: {
      coherence_score: average(
        validEvaluations.map(
          (evaluation) => evaluation.coherenceScore,
        ),
      ),

      context_retention: average(
        validEvaluations.map(
          (evaluation) =>
            evaluation.contextRetentionScore,
        ),
      ),

      // Mantiene la definición anterior:
      // solo afirmaciones demostrablemente falsas.
      hallucination_rate:
        validCount === 0
          ? null
          : percentage(hallucinatedTurns, validCount),

      security_score:
        validCount === 0
          ? null
          : percentage(
              validCount - securityFailures,
              validCount,
            ),

      valid_evaluations: validCount,
      unavailable_evaluations: unavailableCount,

      evaluation_coverage_rate: percentage(
        validCount,
        completedTurns,
      ),

      turn_completion_rate: percentage(
        completedTurns,
        expectedTurns,
      ),

      // Indicador por escenario; luego se promedia
      // entre los cinco escenarios.
      completed_conversation_rate:
        isComplete ? 100 : 0,
    },

    performance: {
      averageUserGenerationMs:
        generatedUserTurns.length === 0
          ? turns.length === 0
            ? null
            : 0
          : average(
              generatedUserTurns.map(
                (turn) =>
                  turn.timing.userGenerationMs,
              ),
            ),

      averageAssistantResponseMs: average(
        turns.map(
          (turn) => turn.timing.assistantResponseMs,
        ),
      ),

      // Incluye el tiempo de intentos de evaluación
      // fallidos, pues también consumen tiempo.
      averageEvaluatorResponseMs: average(
        turns.map(
          (turn) => turn.timing.evaluatorResponseMs,
        ),
      ),

      averageTurnMs: average(
        turns.map(
          (turn) => turn.timing.totalTurnMs,
        ),
      ),
    },

    veredicto: verdict,

    analisis:
      `Conversation: ${completedTurns}/${expectedTurns} ` +
      `assistant responses. Valid evaluations: ` +
      `${validCount}/${completedTurns}. ` +
      `Unavailable evaluations: ${unavailableCount}. ` +
      `Quality metrics use only valid evaluations.` +
      (
        infrastructureFailure === null
          ? ''
          : ` Execution blocked at stage ` +
            `${infrastructureFailure.stage}, turn ` +
            `${infrastructureFailure.turn}.`
      ),

    errores_detectados: errors,
  };
}

async function runScenario(
  scenarioId: string,
): Promise<ScenarioResult> {
  const scenario = getScenario(scenarioId);

  if (scenario.userTurns.length !== 6) {
    throw new Error(
      `Scenario ${scenarioId} must define exactly 6 turns.`,
    );
  }

  const conversation: ConversationMessage[] = [];
  const turns: TurnResult[] = [];

  console.log(`\nScenario: ${scenario.name}`);

  for (const turnDefinition of scenario.userTurns) {
    const turnNumber = turnDefinition.position;

    console.log(`\n--- Turn ${turnNumber} ---`);

    let userResult: Awaited<
      ReturnType<typeof generateSimulatedUserMessage>
    >;

    let userGenerationMs = 0;

    try {
      const timedUser = await measureDuration(
        () =>
          generateSimulatedUserMessage({
            scenario,
            turnDefinition,
            history: conversation,
          }),
      );

      userResult = timedUser.result;

      userGenerationMs =
        userResult.source === 'fixed'
          ? 0
          : timedUser.durationMs;
    } catch (error) {
      if (!isInfrastructureError(error)) {
        throw error;
      }

      return calculateScenarioResult(
        scenario,
        conversation,
        turns,
        {
          turn: turnNumber,
          stage: 'simulated_user',
          message: getErrorSummary(error),
        },
      );
    }

    const userMessage = userResult.text;

    conversation.push({
      role: 'user',
      message: userMessage,
    });

    console.log(`USER: ${userMessage}`);
    console.log(
      userResult.source === 'fixed'
        ? 'USER MODEL: fixed message'
        : `USER MODEL: ${userResult.provider} / ${userResult.model}`,
    );

    let assistantResult: Awaited<
      ReturnType<typeof generateAssistantResponse>
    >;

    let assistantResponseMs = 0;

    try {
      const timedAssistant = await measureDuration(
        () => generateAssistantResponse(conversation),
      );

      assistantResult = timedAssistant.result;
      assistantResponseMs = timedAssistant.durationMs;
    } catch (error) {
      if (!isInfrastructureError(error)) {
        throw error;
      }

      return calculateScenarioResult(
        scenario,
        conversation,
        turns,
        {
          turn: turnNumber,
          stage: 'assistant',
          message: getErrorSummary(error),
        },
      );
    }

    const assistantMessage = assistantResult.text;

    // Se conserva antes de intentar evaluarla.
    conversation.push({
      role: 'assistant',
      message: assistantMessage,
    });

    console.log(`ASSISTANT: ${assistantMessage}`);
    console.log(
      `ASSISTANT MODEL: ${assistantResult.provider} / ${assistantResult.model}`,
    );

    let evaluation: TurnEvaluation | null = null;
    let evaluatorFailure: EvaluationFailure | null = null;
    let infrastructureFailure:
      InfrastructureFailure | null = null;

    let evaluatorMetadata: ModelMetadata = {
      provider: llmConfig.evaluator.provider,
      model: llmConfig.evaluator.model,
    };

    const evaluatorStartedAt = performance.now();

    try {
      const result = await evaluateAssistantTurn({
        scenario,
        history: conversation,
        assistantResponse: assistantMessage,
        turnNumber,
      });

      evaluation = result.evaluation;

      evaluatorMetadata = {
        provider: result.provider,
        model: result.model,
      };
    } catch (error) {
      if (isEvaluatorOutputError(error)) {
        evaluatorFailure =
          getEvaluationFailure(error);

        console.error(
          `EVALUATOR: UNAVAILABLE — ${evaluatorFailure.message}`,
        );
      } else if (isInfrastructureError(error)) {
        evaluatorFailure =
          getEvaluationFailure(error);

        infrastructureFailure = {
          turn: turnNumber,
          stage: 'evaluator',
          message: getErrorSummary(error),
        };
      } else {
        // Los errores inesperados de programación
        // no se ocultan como evaluaciones inválidas.
        throw error;
      }
    }

    const evaluatorResponseMs = Math.round(
      performance.now() - evaluatorStartedAt,
    );

    const totalTurnMs =
      userGenerationMs +
      assistantResponseMs +
      evaluatorResponseMs;

    turns.push({
      turn: turnNumber,
      userMessage,
      assistantMessage,

      simulatedUser: {
        source: userResult.source,
        provider: userResult.provider,
        model: userResult.model,
      },

      assistant: {
        provider: assistantResult.provider,
        model: assistantResult.model,
      },

      evaluator: evaluatorMetadata,

      evaluation_status:
        evaluation === null
          ? 'UNAVAILABLE'
          : 'COMPLETED',

      evaluation,
      evaluator_failure: evaluatorFailure,

      timing: {
        userGenerationMs,
        assistantResponseMs,
        evaluatorResponseMs,
        totalTurnMs,
      },
    });

    console.log(
      `EVALUATOR: ${evaluation?.verdict ?? 'UNAVAILABLE'}`,
    );

    console.log(
      `EVALUATOR MODEL: ${evaluatorMetadata.provider} / ${evaluatorMetadata.model}`,
    );

    console.log(
      `TIMING: user=${userGenerationMs}ms | ` +
      `assistant=${assistantResponseMs}ms | ` +
      `evaluator=${evaluatorResponseMs}ms | ` +
      `total=${totalTurnMs}ms`,
    );

    if (infrastructureFailure !== null) {
      return calculateScenarioResult(
        scenario,
        conversation,
        turns,
        infrastructureFailure,
      );
    }

    // PASS, FAIL, REVIEW o evaluación inválida:
    // continuar con el siguiente turno.
    // El usuario simulado solo recibe conversation.
  }

  return calculateScenarioResult(
    scenario,
    conversation,
    turns,
  );
}

async function main(): Promise<void> {
  const scenarioId =
    process.argv[2] ?? 'simple-query';

  const result = await runScenario(scenarioId);

  await mkdir('output/llm', { recursive: true });

  const outputPath =
    `output/llm/${scenarioId}.json`;

  await writeFile(
    outputPath,
    JSON.stringify(result, null, 2),
    'utf8',
  );

  console.log(`\nResult saved to ${outputPath}`);
  console.log(
    `Execution status: ${result.execution_status}`,
  );
  console.log(
    `Completed turns: ${result.completed_turns}/${result.expected_turns}`,
  );
  console.log(
    `Final verdict: ${result.veredicto}`,
  );

  if (result.veredicto === 'BLOCKED') {
    process.exitCode = 2;
  } else if (result.veredicto !== 'PASS') {
    // El reporte se guarda antes de señalar
    // que la ejecución requiere atención.
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error('\nExercise 1 execution failed.');
  console.error(
    error instanceof Error
      ? error.message
      : String(error),
  );

  process.exitCode = 1;
});
