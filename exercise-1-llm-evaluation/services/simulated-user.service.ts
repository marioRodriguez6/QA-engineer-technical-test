import { generationOptions } from '../providers/generation-options.js';
import {
  generateText,
} from 'ai';

import {
  llmConfig,
} from '../config/llm.config.js';

import {
  getModel,
} from '../providers/provider-factory.js';

import {
  withRetry,
} from '../utils/retry.js';

import {
  withVisibleTimeout,
} from '../utils/timeout.js';

import type {
  LlmProvider,
  ConversationMessage,
} from '../types/llm.types.js';

import type {
  Scenario,
  UserTurnDefinition,
} from '../scenarios/scenarios.js';

export interface SimulatedUserResponse {
  text: string;

  source:
    | 'fixed'
    | 'llm';

  provider:
    LlmProvider | null;

  model:
    string | null;
}

interface GenerateUserMessageParams {
  scenario:
    Scenario;

  turnDefinition:
    UserTurnDefinition;

  history:
    ConversationMessage[];
}

function formatHistory(
  history:
    ConversationMessage[],
): string {
  if (
    history.length === 0
  ) {
    return 'No previous conversation yet.';
  }

  return history
    .map(
      (item) =>
        `${
          item.role === 'user'
            ? 'USER'
            : 'ASSISTANT'
        }: ${item.message}`,
    )
    .join('\n');
}

export async function generateSimulatedUserMessage({
  scenario,
  turnDefinition,
  history,
}: GenerateUserMessageParams): Promise<SimulatedUserResponse> {
  if (
    turnDefinition.type ===
    'fixed'
  ) {
    if (
      !turnDefinition.message
    ) {
      throw new Error(
        `Fixed turn ${turnDefinition.position} does not have a message.`,
      );
    }

    return {
      text:
        turnDefinition.message,

      source:
        'fixed',

      provider:
        null,

      model:
        null,
    };
  }

  const config =
    llmConfig.simulatedUser;

  const model =
    getModel(
      config,
    );

  const prompt = `
You are simulating ONE consistent user during a QA conversation.

You are NOT creating a new user.
You must continue acting as the exact same person throughout the entire scenario.

SCENARIO:
${scenario.name}

USER IDENTITY:
${scenario.persona.identity}

USER BEHAVIOR:
${scenario.persona.behavior}

USER GOAL:
${scenario.persona.objective}

CURRENT TURN OBJECTIVE:
${turnDefinition.objective}

CONVERSATION HISTORY:
${formatHistory(history)}

Rules:
- Generate ONLY the next user message.
- Do not include explanations.
- Do not mention that this is a simulation.
- Do not evaluate the assistant.
- Do not change identity.
- Respect all facts already established in the conversation.
- Keep the message concise and natural.
- Do not repeat information unnecessarily.
`;

  const text =
    await withRetry(
      async () =>
        withVisibleTimeout(
          async () => {
            const result =
              await generateText({
                model,

                prompt,

                ...generationOptions(config, 0.5),

                maxOutputTokens:
                  80,
              });

            const generatedText =
              result.text.trim();

            if (
              !generatedText
            ) {
              throw new Error(
                `Simulated user returned an empty message at turn ${turnDefinition.position}.`,
              );
            }

            return generatedText;
          },

          {
            timeoutMs:
              30_000,

            label:
              `${config.provider} Simulated User - Turn ${turnDefinition.position}`,
          },
        ),

      {
        maxAttempts:
          3,

        label:
          `${config.provider} Simulated User - Turn ${turnDefinition.position}`,
      },
    );

  return {
    text,

    source:
      'llm',

    provider:
      config.provider,

    model:
      config.model,
  };
}
