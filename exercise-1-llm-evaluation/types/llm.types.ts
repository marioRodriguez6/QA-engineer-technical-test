export type LlmProvider =
  | 'openai'
  | 'anthropic'
  | 'groq'
  | 'gemini'
  | 'ollama';

export type LlmRole =
  | 'assistant'
  | 'simulated_user'
  | 'evaluator';

export interface RoleModelConfig {
  provider: LlmProvider;
  model: string;
}

export interface ConversationMessage {
  role:
    | 'user'
    | 'assistant';

  message: string;
}

export interface LlmGenerationResult {
  text: string;

  provider:
    LlmProvider;

  model:
    string;
}
