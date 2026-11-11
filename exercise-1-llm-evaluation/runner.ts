import {
  mkdir,
  writeFile,
} from 'node:fs/promises';

import {
  generateAssistantResponse,
  type ConversationMessage,
} from './services/gemini.service.js';

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

type ExecutionStatus =
  | 'COMPLETED'
  | 'BLOCKED';

interface InfrastructureFailure {
  turn: number;

  stage:
    | 'simulated_user'
    | 'assistant'
    | 'evaluator';

  message: string;
}

interface TurnResult {
  turn: number;

  userMessage: string;

  assistantMessage: string;

  evaluation:
    TurnEvaluation;

  evaluator: {
    provider: string;
    model: string;
  };

  timing: {
    userGenerationMs:
      number;

    assistantResponseMs:
      number;

    evaluatorResponseMs:
      number;

    totalTurnMs:
      number;
  };

  userMessageSource:
    | 'fixed'
    | 'llm';
}

interface ScenarioResult {
  escenario: string;

  execution_status:
    ExecutionStatus;

  completed_turns:
    number;

  expected_turns:
    number;

  infrastructure_failure:
    InfrastructureFailure |
    null;

  turnos: Array<{
    rol:
      | 'usuario'
      | 'asistente';

    mensaje:
      string;
  }>;

  evaluaciones:
    TurnResult[];

  metricas: {
    coherence_score:
      number | null;

    context_retention:
      number | null;

    hallucination_rate:
      number | null;

    security_score:
      number | null;
  };

  performance: {
    averageUserGenerationMs:
      number | null;

    averageAssistantResponseMs:
      number | null;

    averageEvaluatorResponseMs:
      number | null;

    averageTurnMs:
      number | null;
  };

  veredicto:
    | 'PASS'
    | 'FAIL'
    | 'REVIEW'
    | 'BLOCKED';

  analisis:
    string;

  errores_detectados:
    string[];
}

function average(
  values:
    number[],
): number {
  if (
    values.length ===
    0
  ) {
    return 0;
  }

  return Number(
    (
      values.reduce(
        (
          sum,
          value,
        ) =>
          sum +
          value,

        0,
      ) /
      values.length
    ).toFixed(
      2,
    ),
  );
}

function calculateScenarioResult(
  scenario:
    Scenario,

  conversation:
    ConversationMessage[],

  evaluations:
    TurnResult[],
): ScenarioResult {
  const coherenceScore =
    average(
      evaluations.map(
        (item) =>
          item
            .evaluation
            .coherenceScore,
      ),
    );

  const contextRetention =
    average(
      evaluations.map(
        (item) =>
          item
            .evaluation
            .contextRetentionScore,
      ),
    );

  const hallucinatedTurns =
    evaluations.filter(
      (item) =>
        item
          .evaluation
          .hallucinationType ===
        'demonstrably_false',
    ).length;

  const hallucinationRate =
    Number(
      (
        (
          hallucinatedTurns /
          evaluations.length
        ) *
        100
      ).toFixed(
        2,
      ),
    );

  const securityFailures =
    evaluations.filter(
      (item) =>
        item
          .evaluation
          .securityIssueDetected,
    ).length;

  const securityScore =
    Number(
      (
        (
          (
            evaluations.length -
            securityFailures
          ) /
          evaluations.length
        ) *
        100
      ).toFixed(
        2,
      ),
    );

  const errors =
    evaluations.flatMap(
      (item) =>
        item
          .evaluation
          .errors,
    );

  const hasFail =
    evaluations.some(
      (item) =>
        item
          .evaluation
          .verdict ===
        'FAIL',
    );

  const hasReview =
    evaluations.some(
      (item) =>
        item
          .evaluation
          .verdict ===
        'REVIEW',
    );

  const verdict:
    | 'PASS'
    | 'FAIL'
    | 'REVIEW' =
    hasFail
      ? 'FAIL'
      : hasReview
        ? 'REVIEW'
        : 'PASS';

  const generatedUserTurns =
    evaluations.filter(
      (item) =>
        item
          .userMessageSource ===
        'llm',
    );

  const averageUserGenerationMs =
    generatedUserTurns.length >
    0
      ? average(
          generatedUserTurns.map(
            (item) =>
              item
                .timing
                .userGenerationMs,
          ),
        )
      : 0;

  const averageAssistantResponseMs =
    average(
      evaluations.map(
        (item) =>
          item
            .timing
            .assistantResponseMs,
      ),
    );

  const averageEvaluatorResponseMs =
    average(
      evaluations.map(
        (item) =>
          item
            .timing
            .evaluatorResponseMs,
      ),
    );

  const averageTurnMs =
    average(
      evaluations.map(
        (item) =>
          item
            .timing
            .totalTurnMs,
      ),
    );

  return {
    escenario:
      scenario.name,

    execution_status:
      'COMPLETED',

    completed_turns:
      evaluations.length,

    expected_turns:
      scenario
        .userTurns
        .length,

    infrastructure_failure:
      null,

    turnos:
      conversation.map(
        (
          message,
        ) => ({
          rol:
            message.role ===
            'user'
              ? 'usuario'
              : 'asistente',

          mensaje:
            message.message,
        }),
      ),

    evaluaciones:
      evaluations,

    metricas: {
      coherence_score:
        coherenceScore,

      context_retention:
        contextRetention,

      hallucination_rate:
        hallucinationRate,

      security_score:
        securityScore,
    },

    performance: {
      averageUserGenerationMs,

      averageAssistantResponseMs,

      averageEvaluatorResponseMs,

      averageTurnMs,
    },

    veredicto:
      verdict,

    analisis:
      `Scenario completed with ${evaluations.length} evaluated assistant responses.`,

    errores_detectados:
      errors,
  };
}

function buildBlockedResult(
  scenario:
    Scenario,

  conversation:
    ConversationMessage[],

  evaluations:
    TurnResult[],

  failure:
    InfrastructureFailure,
): ScenarioResult {
  return {
    escenario:
      scenario.name,

    execution_status:
      'BLOCKED',

    completed_turns:
      evaluations.length,

    expected_turns:
      scenario
        .userTurns
        .length,

    infrastructure_failure:
      failure,

    turnos:
      conversation.map(
        (
          message,
        ) => ({
          rol:
            message.role ===
            'user'
              ? 'usuario'
              : 'asistente',

          mensaje:
            message.message,
        }),
      ),

    evaluaciones:
      evaluations,

    metricas: {
      coherence_score:
        null,

      context_retention:
        null,

      hallucination_rate:
        null,

      security_score:
        null,
    },

    performance: {
      averageUserGenerationMs:
        null,

      averageAssistantResponseMs:
        null,

      averageEvaluatorResponseMs:
        null,

      averageTurnMs:
        null,
    },

    veredicto:
      'BLOCKED',

    analisis:
      `Scenario execution was blocked by an infrastructure/provider failure during turn ${failure.turn} at stage ${failure.stage}.`,

    errores_detectados:
      [],
  };
}

async function runScenario(
  scenarioId:
    string,
): Promise<ScenarioResult> {
  const scenario =
    getScenario(
      scenarioId,
    );

  const conversation:
    ConversationMessage[] =
    [];

  const evaluations:
    TurnResult[] =
    [];

  console.log(
    `\nScenario: ${scenario.name}`,
  );

  for (
    const turnDefinition
    of scenario.userTurns
  ) {
    console.log(
      `\n--- Turn ${turnDefinition.position} ---`,
    );

    let userMessage:
      string;

    let userGenerationMs =
      0;

    try {
      const timedUser =
        await measureDuration(
          async () =>
            generateSimulatedUserMessage({
              scenario,

              turnDefinition,

              history:
                conversation,
            }),
        );

      userMessage =
        timedUser.result;

      userGenerationMs =
        turnDefinition.type ===
        'fixed'
          ? 0
          : timedUser.durationMs;
    } catch (error) {
      if (
        isInfrastructureError(
          error,
        )
      ) {
        return buildBlockedResult(
          scenario,
          conversation,
          evaluations,
          {
            turn:
              turnDefinition.position,

            stage:
              'simulated_user',

            message:
              getErrorSummary(
                error,
              ),
          },
        );
      }

      throw error;
    }

    conversation.push({
      role:
        'user',

      message:
        userMessage,
    });

    console.log(
      `USER: ${userMessage}`,
    );

    let assistantMessage:
      string;

    let assistantResponseMs =
      0;

    try {
      const timedAssistant =
        await measureDuration(
          async () =>
            generateAssistantResponse(
              conversation,
            ),
        );

      assistantMessage =
        timedAssistant.result;

      assistantResponseMs =
        timedAssistant.durationMs;
    } catch (error) {
      if (
        isInfrastructureError(
          error,
        )
      ) {
        return buildBlockedResult(
          scenario,
          conversation,
          evaluations,
          {
            turn:
              turnDefinition.position,

            stage:
              'assistant',

            message:
              getErrorSummary(
                error,
              ),
          },
        );
      }

      throw error;
    }

    conversation.push({
      role:
        'assistant',

      message:
        assistantMessage,
    });

    console.log(
      `ASSISTANT: ${assistantMessage}`,
    );

    let evaluatorResult:
      Awaited<
        ReturnType<
          typeof evaluateAssistantTurn
        >
      >;

    try {
      evaluatorResult =
        await evaluateAssistantTurn({
          scenario,

          history:
            conversation,

          assistantResponse:
            assistantMessage,

          turnNumber:
            turnDefinition.position,
        });
    } catch (error) {
      if (
        isInfrastructureError(
          error,
        )
      ) {
        return buildBlockedResult(
          scenario,
          conversation,
          evaluations,
          {
            turn:
              turnDefinition.position,

            stage:
              'evaluator',

            message:
              getErrorSummary(
                error,
              ),
          },
        );
      }

      throw error;
    }

    const evaluation =
      evaluatorResult
        .evaluation;

    const evaluatorResponseMs =
      evaluatorResult
        .responseTimeMs;

    const totalTurnMs =
      userGenerationMs +
      assistantResponseMs +
      evaluatorResponseMs;

    evaluations.push({
      turn:
        turnDefinition.position,

      userMessage,

      assistantMessage,

      evaluation,

      evaluator: {
        provider:
          evaluatorResult
            .provider,

        model:
          evaluatorResult
            .model,
      },

      userMessageSource:
        turnDefinition.type ===
        'fixed'
          ? 'fixed'
          : 'llm',

      timing: {
        userGenerationMs,

        assistantResponseMs,

        evaluatorResponseMs,

        totalTurnMs,
      },
    });

    console.log(
      `EVALUATOR: ${evaluation.verdict}`,
    );

    console.log(
      `EVALUATOR MODEL: ${evaluatorResult.provider} / ${evaluatorResult.model}`,
    );

    console.log(
      `TIMING: user=${userGenerationMs}ms | assistant=${assistantResponseMs}ms | evaluator=${evaluatorResponseMs}ms | total=${totalTurnMs}ms`,
    );
  }

  return calculateScenarioResult(
    scenario,
    conversation,
    evaluations,
  );
}

async function main():
  Promise<void> {
  const scenarioId =
    process.argv[2] ??
    'simple-query';

  const result =
    await runScenario(
      scenarioId,
    );

  await mkdir(
    'output/llm',
    {
      recursive:
        true,
    },
  );

  const outputPath =
    `output/llm/${scenarioId}.json`;

  await writeFile(
    outputPath,

    JSON.stringify(
      result,
      null,
      2,
    ),

    'utf8',
  );

  console.log(
    `\nResult saved to ${outputPath}`,
  );

  console.log(
    `Execution status: ${result.execution_status}`,
  );

  console.log(
    `Completed turns: ${result.completed_turns}/${result.expected_turns}`,
  );

  console.log(
    `Final verdict: ${result.veredicto}`,
  );
}

main().catch(
  (
    error:
      unknown,
  ) => {
    console.error(
      '\nExercise 1 execution failed.',
    );

    if (
      error instanceof Error
    ) {
      console.error(
        error.message,
      );
    } else {
      console.error(
        error,
      );
    }

    process.exitCode =
      1;
  },
);
