import {
  createOpenAI,
} from '@ai-sdk/openai';

import {
  createAnthropic,
} from '@ai-sdk/anthropic';

import {
  createGoogleGenerativeAI,
} from '@ai-sdk/google';

import {
  createGroq,
} from '@ai-sdk/groq';

import {
  createOllama,
} from 'ollama-ai-provider-v2';

import {
  llmConfig,
} from '../config/llm.config.js';

import type {
  RoleModelConfig,
} from '../types/llm.types.js';

function requiredKey(
  variable:
    string,
): string {
  const value =
    process.env[
      variable
    ]?.trim();

  if (!value) {
    throw new Error(
      `Missing API key for selected provider: ${variable}`,
    );
  }

  return value;
}

export function getModel(
  config:
    RoleModelConfig,
) {
  switch (
    config.provider
  ) {
    case 'openai': {
      const provider =
        createOpenAI({
          apiKey:
            requiredKey(
              'OPENAI_API_KEY',
            ),
        });

      return provider(
        config.model,
      );
    }

    case 'anthropic': {
      const provider =
        createAnthropic({
          apiKey:
            requiredKey(
              'ANTHROPIC_API_KEY',
            ),
        });

      return provider(
        config.model,
      );
    }

    case 'groq': {
      const provider =
        createGroq({
          apiKey:
            requiredKey(
              'GROQ_API_KEY',
            ),
        });

      return provider(
        config.model,
      );
    }

    case 'gemini': {
      const provider =
        createGoogleGenerativeAI({
          apiKey:
            requiredKey(
              'GEMINI_API_KEY',
            ),
        });

      return provider(
        config.model,
      );
    }

    case 'ollama': {
      const provider =
        createOllama({
          baseURL:
            llmConfig
              .ollamaBaseUrl,
        });

      return provider(
        config.model,
      );
    }
  }
}
