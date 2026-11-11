import 'dotenv/config';

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

export const modelConfig = {
  gemini: {
    apiKey: requiredEnv('GEMINI_API_KEY'),
    assistantModel: requiredEnv('GEMINI_ASSISTANT_MODEL'),
    simulatedUserModel: requiredEnv('GEMINI_SIMULATED_USER_MODEL'),
  },

  groq: {
    apiKey: requiredEnv('GROQ_API_KEY'),
    evaluatorModel: requiredEnv('GROQ_JUDGE_MODEL'),
  },
};
