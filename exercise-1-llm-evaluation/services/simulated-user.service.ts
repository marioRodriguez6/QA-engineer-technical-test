import { GoogleGenAI } from '@google/genai';
import { modelConfig } from '../config/models.js';
import { withRetry } from '../utils/retry.js';

import type {
  Scenario,
  UserTurnDefinition,
} from '../scenarios/scenarios.js';
import type { ConversationMessage } from './gemini.service.js';

const gemini = new GoogleGenAI({
  apiKey: modelConfig.gemini.apiKey,
});

interface GenerateUserMessageParams {
  scenario: Scenario;
  turnDefinition: UserTurnDefinition;
  history: ConversationMessage[];
}

function formatHistory(history: ConversationMessage[]): string {
  if (history.length === 0) {
    return 'No previous conversation yet.';
  }

  return history
    .map(
      (item) =>
        `${item.role === 'user' ? 'USER' : 'ASSISTANT'}: ${item.message}`,
    )
    .join('\n');
}

export async function generateSimulatedUserMessage({
  scenario,
  turnDefinition,
  history,
}: GenerateUserMessageParams): Promise<string> {
  if (turnDefinition.type === 'fixed') {
    if (!turnDefinition.message) {
      throw new Error(
        `Fixed turn ${turnDefinition.position} does not have a message.`,
      );
    }

    return turnDefinition.message;
  }

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
- Generate only the next user message.
- Do not include explanations.
- Do not mention that this is a simulation.
- Do not evaluate the assistant.
- Do not change identity.
- Respect all facts already established in the conversation.
- Keep the message concise and natural.
- Do not repeat information unnecessarily.
`;

  return withRetry<string>(
    async (): Promise<string> => {
      const response =
        await gemini.models.generateContent({
          model:
            modelConfig.gemini.simulatedUserModel,

          contents: prompt,

          config: {
            temperature: 0.5,
            maxOutputTokens: 80,
            automaticContinuation: false,
          },
        });

      const text =
        response.text?.trim();

      if (!text) {
        throw new Error(
          `Gemini returned an empty simulated user message at turn ${turnDefinition.position}.`,
        );
      }

      return text;
    },
    {
      maxAttempts: 3,
      label:
        `Gemini Simulated User - Turn ${turnDefinition.position}`,
    },
  );
}
