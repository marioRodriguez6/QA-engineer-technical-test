import 'dotenv/config';

export type EvaluatorProvider =
  | 'openai'
  | 'anthropic'
  | 'groq'
  | 'gemini'
  | 'ollama';

function requiredEnv(
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
      `Missing environment variable: ${name}`,
    );
  }

  return value;
}

function readProvider():
  EvaluatorProvider {
  const provider =
    requiredEnv(
      'EVALUATOR_PROVIDER',
    ).toLowerCase();

  const supported:
    EvaluatorProvider[] = [
      'openai',
      'anthropic',
      'groq',
      'gemini',
      'ollama',
    ];

  if (
    !supported.includes(
      provider as
        EvaluatorProvider,
    )
  ) {
    throw new Error(
      `Unsupported evaluator provider: ${provider}`,
    );
  }

  return provider as
    EvaluatorProvider;
}

export const evaluatorConfig = {
  provider:
    readProvider(),

  model:
    requiredEnv(
      'EVALUATOR_MODEL',
    ),

  ollamaBaseUrl:
    process.env
      .OLLAMA_BASE_URL
      ?.trim() ??
    'http://localhost:11434/v1',
};
