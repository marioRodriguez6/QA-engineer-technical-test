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
  toolTrace?: import("../../exercise-5-consolidated-report/detectors/bonus.mjs").ToolObservation[];
  finishReason?: string;
  text: string;

  provider:
    LlmProvider;

  model:
    string;
}

