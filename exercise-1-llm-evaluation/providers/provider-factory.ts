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
  evaluatorConfig,
} from '../config/evaluator.config.js';

function requiredKey(
  name: string,
): string {
  const value =
    process.env[
      name
    ]?.trim();

  if (
    !value
  ) {
    throw new Error(
      `Missing API key for selected evaluator provider: ${name}`,
    );
  }

  return value;
}

export function getEvaluatorModel() {
  const {
    provider,
    model,
  } = evaluatorConfig;

  switch (
    provider
  ) {
    case 'openai': {
      const openai =
        createOpenAI({
          apiKey:
            requiredKey(
              'OPENAI_API_KEY',
            ),
        });

      return openai(
        model,
      );
    }

    case 'anthropic': {
      const anthropic =
        createAnthropic({
          apiKey:
            requiredKey(
              'ANTHROPIC_API_KEY',
            ),
        });

      return anthropic(
        model,
      );
    }

    case 'groq': {
      const groq =
        createGroq({
          apiKey:
            requiredKey(
              'GROQ_API_KEY',
            ),
        });

      return groq(
        model,
      );
    }

    case 'gemini': {
      const google =
        createGoogleGenerativeAI({
          apiKey:
            requiredKey(
              'GEMINI_API_KEY',
            ),
        });

      return google(
        model,
      );
    }

    case 'ollama': {
      /*
       * Ollama will be connected in
       * the next step through its
       * OpenAI-compatible endpoint.
       *
       * Keeping this explicit prevents
       * silently using the wrong
       * provider configuration.
       */
      throw new Error(
        'Ollama evaluator provider is configured but its OpenAI-compatible adapter has not been enabled yet.',
      );
    }
  }
}
