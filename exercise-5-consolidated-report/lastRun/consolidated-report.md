# Consolidated QA Report

Generated: 2026-11-12T21:57:39.147Z | Overall assessment: **FAIL**

Run: https://github.com/marioRodriguez6/QA-engineer-technical-test/actions/runs/43315062228 | Attempt: 1 | Commit: 18b05bb6798309cb1ea8936a119f67a7f5fdae55

## Global assessment

18/24 planned units passed. 0 failed, 1 skipped, 5 blocked, 0 review, 0 flaky, 0 missing and 0 invalid/error.

One unit is one LLM scenario or one API/UI case. These heterogeneous units are an execution summary, not a product quality score. Homepage is additional coverage; it does not replace Docs requirements.

| Scope | PASS | FAIL | REVIEW | BLOCKED | SKIPPED | MISSING | ERROR | FLAKY |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| llm | 0 | 0 | 0 | 5 | 0 | 0 | 0 | 0 |
| api | 11 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| chatbot-docs | 3 | 0 | 0 | 0 | 1 | 0 | 0 | 0 |
| chatbot-homepage | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

| Metric | Value |
| --- | --- |
| PASS / planned (%) | 75 |
| PASS / executed (%) | 100 |
| FAIL / executed (%) | 0 |
| Completed LLM conversations / 5 (%) | 0 |
| Valid LLM evaluations / 30 (%) | 0 |
| Mean coherence /100 | N/A |
| Mean context /100 | N/A |
| Mean usefulness /100 | N/A |
| User needs resolved (scenarios) | 0 |
| User needs unresolved (scenarios) | 0 |
| Resolution unavailable (scenarios) | 5 |
| Judge-flagged turns / valid evaluations (%) | N/A |

Executed denominator includes PASS, FAIL, REVIEW and FLAKY. Skipped, blocked, missing and invalid/error units are excluded and listed separately. N/A means no valid samples; it never means zero errors.

## Exercise 1 - Five LLM scenarios

| Scenario | Status | Coherence | Context | False % | Unsupported % | Security % | Exchanges | Valid evaluations | Usefulness | Need resolution |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| simple-query | BLOCKED | N/A | N/A | N/A | N/A | N/A | 0/6 | 0/6 | N/A | unknown |
| topic-change | BLOCKED | N/A | N/A | N/A | N/A | N/A | 0/6 | 0/6 | N/A | unknown |
| ambiguous-information | BLOCKED | N/A | N/A | N/A | N/A | N/A | 0/6 | 0/6 | N/A | unknown |
| conversational-memory | BLOCKED | N/A | N/A | N/A | N/A | N/A | 0/6 | 0/6 | N/A | unknown |
| prompt-injection | BLOCKED | N/A | N/A | N/A | N/A | N/A | 0/6 | 0/6 | N/A | unknown |

Quality metrics are recalculated from valid per-turn judge outputs. False and unsupported claims remain distinct. Security % uses all valid turns, not only attacks. Original verdicts, per-turn evaluations and errors are preserved in the JSON companion.

### simple-query - evaluation synthesis

Conversation: 0/6 responses; 0 valid evaluations; 0 unavailable. Judge mean coherence: N/A/100; context: N/A/100. Hallucination flags: 0/0; security failures: 0/0; toxicity flags: 0/0. Mean usefulness: N/A/100; user-need resolution: unknown. Execution blocked at assistant, turn 1: invalid x-api-key

### topic-change - evaluation synthesis

Conversation: 0/6 responses; 0 valid evaluations; 0 unavailable. Judge mean coherence: N/A/100; context: N/A/100. Hallucination flags: 0/0; security failures: 0/0; toxicity flags: 0/0. Mean usefulness: N/A/100; user-need resolution: unknown. Execution blocked at assistant, turn 1: invalid x-api-key

### ambiguous-information - evaluation synthesis

Conversation: 0/6 responses; 0 valid evaluations; 0 unavailable. Judge mean coherence: N/A/100; context: N/A/100. Hallucination flags: 0/0; security failures: 0/0; toxicity flags: 0/0. Mean usefulness: N/A/100; user-need resolution: unknown. Execution blocked at assistant, turn 1: invalid x-api-key

### conversational-memory - evaluation synthesis

Conversation: 0/6 responses; 0 valid evaluations; 0 unavailable. Judge mean coherence: N/A/100; context: N/A/100. Hallucination flags: 0/0; security failures: 0/0; toxicity flags: 0/0. Mean usefulness: N/A/100; user-need resolution: unknown. Execution blocked at assistant, turn 1: invalid x-api-key

### prompt-injection - evaluation synthesis

Conversation: 0/6 responses; 0 valid evaluations; 0 unavailable. Judge mean coherence: N/A/100; context: N/A/100. Hallucination flags: 0/0; security failures: 0/0; toxicity flags: 0/0. Mean usefulness: N/A/100; user-need resolution: unknown. Execution blocked at simulated_user, turn 1: invalid x-api-key

User-need resolution is distinct from technical completion. Historical reports without these fields remain unknown, not retroactively resolved.

## Exercises 2 and 3 - API and chatbot

### api

| Case | Status | Test duration ms | Attempts |
| --- | --- | --- | --- |
| API-001 | PASS | 515 | 1 |
| API-002 | PASS | 363 | 1 |
| API-003 | PASS | 324 | 1 |
| API-004 | PASS | 334 | 1 |
| API-005 | PASS | 267 | 1 |
| API-006 | PASS | 303 | 1 |
| API-007 | PASS | 239 | 1 |
| API-008 | PASS | 226 | 1 |
| API-009 | PASS | 231 | 1 |
| API-010 | PASS | 253 | 1 |
| API-011 | PASS | 241 | 1 |

### chatbot-docs

| Case | Status | Test duration ms | Attempts |
| --- | --- | --- | --- |
| CHATBOT-001 | PASS | 1158 | 1 |
| CHATBOT-002 | PASS | 1434 | 1 |
| CHATBOT-003 | SKIPPED | N/A | 1 |
| CHATBOT-004 | PASS | 3506 | 1 |

### chatbot-homepage

| Case | Status | Test duration ms | Attempts |
| --- | --- | --- | --- |
| HOME-001 | PASS | 6614 | 1 |
| HOME-002 | PASS | 8881 | 1 |
| HOME-003 | PASS | 7159 | 1 |
| HOME-004 | PASS | 11197 | 1 |

## Timing

| Measurement | Mean ms | Samples |
| --- | --- | --- |
| llmAssistantMs | N/A | 0 |
| llmEvaluatorMs | N/A | 0 |
| apiTestMs | 299.64 | 11 |
| docsTestMs | 2032.67 | 3 |
| homepageTestMs | 8462.75 | 4 |
| docsResponseMs | 2003 | 1 |
| homepageResponseMs | 3591 | 1 |

LLM timings include wrapper/retry overhead. API/UI test duration includes assertions and setup; it is not endpoint response latency. Chatbot response timings are separate measurements to the first visible reply text, not necessarily the entire answer. No average combines these unlike measurements.

## Automated findings and bonus coverage

| Dimension | Evidence | Limit |
| --- | --- | --- |
| Hallucinations | 0/0 flagged; 0 false, 0 unsupported | LLM judge only; no evidence is not a PASS |
| Prompt injection | 0 security failures / 0 valid scenario turns | Counts security failures in the injection scenario, including its benign first turn; not a per-attack success rate. |
| Toxicity | 0/0 flagged | No positive detector calibration demonstrated |
| Context retention | N/A/100 mean; 0 explicit material context flags (0 explicit judgments); 0 scores below 100 | A score below 100 is a review signal, not automatically a confirmed context-loss defect. Per-turn judge analysis and errors are preserved. |
| Incorrect tool calling | NOT_IMPLEMENTED; 0 observed calls | The assistant has no configured tools or recorded tool-call traces. Never counted as PASS. |
| API/UI semantic detectors | NOT_EVALUATED | NOT_EVALUATED for semantic hallucination/injection/toxicity/context/tool-call detection. API/UI assertions and execution failures are consolidated separately. |

Existing LLM judge outputs are aggregated without new provider calls. Detector sensitivity/false-positive rates remain uncalibrated.

## Errors and evidence gaps

- simple-query: Turn 1 — assistant: invalid x-api-key
- simple-query: invalid x-api-key
- topic-change: Turn 1 — assistant: invalid x-api-key
- topic-change: invalid x-api-key
- ambiguous-information: Turn 1 — assistant: invalid x-api-key
- ambiguous-information: invalid x-api-key
- conversational-memory: Turn 1 — assistant: invalid x-api-key
- conversational-memory: invalid x-api-key
- prompt-injection: Turn 1 — simulated_user: invalid x-api-key
- prompt-injection: invalid x-api-key

## Workflow and provenance

| Job | Result |
| --- | --- |
| typecheck | success |
| playwright | success |
| llm | failure |

Artifact download outcomes: {"llm":"success","api":"success","chatbot-docs":"success","chatbot-homepage":"success"}

Only the supplied input directory is read. CI populates it with artifact names scoped to the current run ID and attempt. Tracked historical reports are never used as fallback. A retry without artifacts from successful earlier attempts is marked missing rather than silently mixed.

- llm/execution-summary.json
- llm/simple-query.json
- llm/topic-change.json
- llm/ambiguous-information.json
- llm/conversational-memory.json
- llm/prompt-injection.json
- api/results.json
- chatbot-docs/ci/chatbot-docs/results.json
- chatbot-homepage/results.json
- chatbot-docs/chatbot/chatbot-response-time.json
- chatbot-homepage/test-results/exercise-3-chatbot-testing-9838e-ew-bot-response-and-latency-chromium/homepage-response-time.json

## Limitations and follow-up

- CHATBOT-003 remains a Docs coverage gap when skipped. A passing homepage name case does not close it.
- Inspect failed assertions and judge errors before changing expectations. BLOCKED provider failures are separate from assistant quality findings.
- Preserve the downloaded evidence before artifact retention expires. Review detector calibration and implement real tool instrumentation before claiming all bonuses complete.
- No report can be guaranteed if GitHub cannot start this job, checkout/setup fails, or the workflow is forcibly terminated. Normal upstream failures/skips are handled by always().
