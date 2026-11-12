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
} from './types/llm.types.js';

import { calculateScenarioResult, getEvaluationFailure, isEvaluatorOutputError, type TurnResult, type ModelMetadata, type EvaluationFailure, type InfrastructureFailure, type ScenarioResult } from './evaluation-summary.js';

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

  await mkdir('output/exercise1-JSON', { recursive: true });

  const outputPath =
    `output/exercise1-JSON/${scenarioId}.json`;

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


