import 'dotenv/config';

import type {
  LlmProvider,
  RoleModelConfig,
} from '../types/llm.types.js';

const supportedProviders:
  LlmProvider[] = [
    'openai',
    'anthropic',
    'groq',
    'gemini',
    'ollama',
  ];

function requiredEnv(
  name: string,
): string {
  const value =
    process.env[name]?.trim();

  if (!value) {
    throw new Error(
      `Missing environment variable: ${name}`,
    );
  }

  return value;
}

function readProvider(
  name: string,
): LlmProvider {
  const value =
    requiredEnv(
      name,
    ).toLowerCase();

  if (
    !supportedProviders.includes(
      value as LlmProvider,
    )
  ) {
    throw new Error(
      `Unsupported LLM provider "${value}" for ${name}.`,
    );
  }

  return value as LlmProvider;
}

function readRoleConfig(
  prefix: string,
): RoleModelConfig {
  return {
    provider:
      readProvider(
        `${prefix}_PROVIDER`,
      ),

    model:
      requiredEnv(
        `${prefix}_MODEL`,
      ),
  };
}

export const llmConfig = {
  simulatedUser:
    readRoleConfig(
      'SIMULATED_USER',
    ),

  assistant:
    readRoleConfig(
      'ASSISTANT',
    ),

  evaluator:
    readRoleConfig(
      'EVALUATOR',
    ),

  ollamaBaseUrl:
    process.env
      .OLLAMA_BASE_URL
      ?.trim() ??
    'http://localhost:11434/api',
};
