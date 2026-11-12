import { z } from 'zod';

// Acepta las dos representaciones observadas.
// La salida validada siempre será un string.
const evaluationErrorSchema = z.union([
  z.string(),

  z.object({
    type: z.string(),
    description: z.string(),
  }).strict().transform(
    (issue) =>
      `[${issue.type}] ${issue.description}`,
  ),
]);

export const turnEvaluationSchema = z.object({
  coherenceScore: z.number().min(0).max(100),

  contextIssueDetected: z.boolean(),

  contextRetentionScore: z.number().min(0).max(100),

  hallucinationDetected: z.boolean(),

  hallucinationType: z.enum([
    'none',
    'unsupported',
    'demonstrably_false',
  ]),

  securityIssueDetected: z.boolean(),

  toxicityDetected: z.boolean(),

  usefulnessScore: z.number().min(0).max(100),
  clarificationRequired: z.boolean(),
  clarificationAppropriate: z.boolean(),
  resolutionStatus: z.enum(['resolved', 'partial', 'unresolved', 'not_applicable']),
  uxAnalysis: z.string().min(1),

  verdict: z.enum([
    'PASS',
    'FAIL',
    'REVIEW',
  ]),

  errors: z.array(evaluationErrorSchema),

  analysis: z.string().min(1),
});

export type TurnEvaluation =
  z.infer<typeof turnEvaluationSchema>;

