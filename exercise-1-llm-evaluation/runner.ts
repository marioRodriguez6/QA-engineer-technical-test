import { mkdir, writeFile } from 'node:fs/promises';

import {
  generateAssistantResponse,
  type ConversationMessage,
} from './services/gemini.service.js';

import { generateSimulatedUserMessage } from './services/simulated-user.service.js';

import {
  evaluateAssistantTurn,
  type TurnEvaluation,
} from './services/groq-judge.service.js';

import {
  getScenario,
  type Scenario,
} from './scenarios/scenarios.js';

interface TurnResult {
  turn: number;

  userMessage: string;

  assistantMessage: string;

  evaluation: TurnEvaluation;
}

interface ScenarioResult {
  escenario: string;

  turnos: Array<{
    rol: 'usuario' | 'asistente';
    mensaje: string;
  }>;

  evaluaciones: TurnResult[];

  metricas: {
    coherence_score: number;
    context_retention: number;
    hallucination_rate: number;
    security_score: number;
  };

  veredicto: 'PASS' | 'FAIL' | 'REVIEW';

  analisis: string;

  errores_detectados: string[];
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return Number(
    (
      values.reduce((sum, value) => sum + value, 0) /
      values.length
    ).toFixed(2),
  );
}

function calculateScenarioResult(
  scenario: Scenario,
  conversation: ConversationMessage[],
  evaluations: TurnResult[],
): ScenarioResult {
  const coherenceScore = average(
    evaluations.map((item) => item.evaluation.coherenceScore),
  );

  const contextRetention = average(
    evaluations.map(
      (item) => item.evaluation.contextRetentionScore,
    ),
  );

  const hallucinatedTurns = evaluations.filter(
    (item) =>
      item.evaluation.hallucinationType ===
      'demonstrably_false',
  ).length;

  const hallucinationRate = Number(
    ((hallucinatedTurns / evaluations.length) * 100).toFixed(2),
  );

  const securityFailures = evaluations.filter(
    (item) => item.evaluation.securityIssueDetected,
  ).length;

  const securityScore = Number(
    (
      ((evaluations.length - securityFailures) /
        evaluations.length) *
      100
    ).toFixed(2),
  );

  const errors = evaluations.flatMap(
    (item) => item.evaluation.errors,
  );

  const hasFail = evaluations.some(
    (item) => item.evaluation.verdict === 'FAIL',
  );

  const hasReview = evaluations.some(
    (item) => item.evaluation.verdict === 'REVIEW',
  );

  const verdict: 'PASS' | 'FAIL' | 'REVIEW' = hasFail
    ? 'FAIL'
    : hasReview
      ? 'REVIEW'
      : 'PASS';

  return {
    escenario: scenario.name,

    turnos: conversation.map((message) => ({
      rol: message.role === 'user' ? 'usuario' : 'asistente',
      mensaje: message.message,
    })),

    evaluaciones: evaluations,

    metricas: {
      coherence_score: coherenceScore,
      context_retention: contextRetention,
      hallucination_rate: hallucinationRate,
      security_score: securityScore,
    },

    veredicto: verdict,

    analisis:
      `Scenario completed with ${evaluations.length} evaluated assistant responses.`,

    errores_detectados: errors,
  };
}

async function runScenario(
  scenarioId: string,
): Promise<ScenarioResult> {
  const scenario = getScenario(scenarioId);

  const conversation: ConversationMessage[] = [];

  const evaluations: TurnResult[] = [];

  console.log(`\nScenario: ${scenario.name}`);

  for (const turnDefinition of scenario.userTurns) {
    console.log(`\n--- Turn ${turnDefinition.position} ---`);

    const userMessage =
      await generateSimulatedUserMessage({
        scenario,
        turnDefinition,
        history: conversation,
      });

    conversation.push({
      role: 'user',
      message: userMessage,
    });

    console.log(`USER: ${userMessage}`);

    const assistantMessage =
      await generateAssistantResponse(conversation);

    conversation.push({
      role: 'assistant',
      message: assistantMessage,
    });

    console.log(`ASSISTANT: ${assistantMessage}`);

    const evaluation =
      await evaluateAssistantTurn({
        scenario,
        history: conversation,
        assistantResponse: assistantMessage,
        turnNumber: turnDefinition.position,
      });

    evaluations.push({
      turn: turnDefinition.position,
      userMessage,
      assistantMessage,
      evaluation,
    });

    console.log(
      `EVALUATOR: ${evaluation.verdict}`,
    );
  }

  return calculateScenarioResult(
    scenario,
    conversation,
    evaluations,
  );
}

async function main(): Promise<void> {
  const scenarioId =
    process.argv[2] ?? 'simple-query';

  const result = await runScenario(scenarioId);

  await mkdir('output/llm', {
    recursive: true,
  });

  const outputPath =
    `output/llm/${scenarioId}.json`;

  await writeFile(
    outputPath,
    JSON.stringify(result, null, 2),
    'utf8',
  );

  console.log(
    `\nResult saved to ${outputPath}`,
  );

  console.log(
    `Final verdict: ${result.veredicto}`,
  );
}

main().catch((error: unknown) => {
  console.error('\nExercise 1 execution failed.');

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});
