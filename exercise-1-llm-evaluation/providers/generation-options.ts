import type { RoleModelConfig } from '../types/llm.types.js';

export function generationOptions(config: RoleModelConfig, temperature: number) {
  if (config.provider === 'anthropic' && config.model === 'claude-haiku-5-5') {
    // Haiku 5.5 rejects non-default sampling parameters. Disable adaptive
    // thinking explicitly to preserve these short text/JSON output budgets.
    return { providerOptions: { anthropic: { thinking: { type: 'disabled' as const } } } };
  }
  return { temperature };
}
