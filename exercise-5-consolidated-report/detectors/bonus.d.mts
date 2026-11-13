export interface EvidenceCheck { field: string; expected: unknown; actual: unknown; source?: string }
export interface ToolObservation {
  toolCallId?: string; toolName?: string; input?: unknown; output?: unknown;
  intentMatchesReference?: boolean; allowed: boolean; argumentsValid: boolean; scopeAuthorized?: boolean;
  executionStatus: 'COMPLETED' | 'ERROR' | 'MISSING_RESULT'; resultMatchesReference?: boolean;
}
export interface BonusEvidence {
  scope: string; id: string; responseRole?: string; response?: string; userMessage?: string;
  history?: Array<{ role: string; message: string }>; facts?: EvidenceCheck[]; contextChecks?: EvidenceCheck[];
  protectedValues?: string[]; toolCalls?: ToolObservation[];
}
export interface BonusAnalysis {
  observedToolCalls?: number | null; toolTraceKind?: string | null; schemaVersion: number; scope: string; id: string; method: string; limitations: string;
  categories: Record<string, {status: string; findings: Array<{code: string; evidence: unknown; explanation: string}>; reason: string | null}>;
  findings: Array<{ category: string; code: string; evidence: unknown; explanation: string }>;
}
export const categories: string[];
export function detectBonus(evidence: BonusEvidence): BonusAnalysis;
export function conversationEvidence(params: {scope: string; id: string; history: Array<{role:string;message:string}>; userMessage:string;response:string;toolCalls?:ToolObservation[];shippingStandardDays?:number[]}): BonusEvidence;
