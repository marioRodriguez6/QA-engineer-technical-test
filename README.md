# QA Engineer Technical Test — NerdsAi

Technical assessment covering conversational AI evaluation, API testing, chatbot UI testing, CI/CD, and consolidated reporting.

## Project Structure

| Path | Purpose |
| --- | --- |
| `exercise-1-llm-evaluation/` | Multi-provider conversational AI evaluation |
| `exercise-2-api-testing/` | Goal Tracker API automated tests |
| `exercise-3-chatbot-testing/` | Botpress Docs and homepage chatbot automated tests |
| `exercise-4-cicd/` | CI runner for the five LLM scenarios |
| `exercise-5-consolidated-report/` | Report generator, validation tests and historical consolidated report |
| `.github/workflows/qa.yml` | GitHub Actions workflow |
| `output/` | Generated reports and evidence |

Run all commands from the repository root. Shell examples use Bash on Linux or Ubuntu WSL.

## Requirements

- Node.js 22 and npm.
- Internet access for dependency installation and external services.
- Chromium installed through Playwright for chatbot tests.
- Provider credentials and sufficient quota for LLM scenarios.
- A running Ollama server with the selected models installed when using Ollama.

API and chatbot tests do not require LLM provider credentials.

## Installation

Clone the repository:

```bash
git clone https://github.com/marioRodriguez6/QA-engineer-technical-test.git
cd QA-engineer-technical-test
```

Install the locked dependencies:

```bash
npm ci
```

Install Chromium and its system dependencies:

```bash
npx playwright install --with-deps chromium
```

Validate TypeScript and the CI runner syntax:

```bash
npx tsc --noEmit
node --check exercise-4-cicd/run-llm-ci.mjs
```

## Exercise 1 — LLM Evaluation

This exercise separates three roles:

- **Simulated User:** generates scenario messages.
- **Assistant:** answers using the supplied Nerds Store knowledge base.
- **Evaluator:** independently evaluates each assistant response.

Each role can independently use OpenAI, Anthropic, Groq, Gemini, or Ollama through the provider factory.

### Environment Configuration

For a first-time setup, copy the environment template:

```bash
cp .env.example .env
```

If `.env` already exists, update it instead of overwriting it.

The template uses the following configuration:

```dotenv
SIMULATED_USER_PROVIDER=groq
SIMULATED_USER_MODEL=qwen/qwen3.8-27b

ASSISTANT_PROVIDER=groq
ASSISTANT_MODEL=qwen/qwen3.8-27b

EVALUATOR_PROVIDER=groq
EVALUATOR_MODEL=openai/gpt-oss-20b

GROQ_API_KEY=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=

OLLAMA_BASE_URL=http://localhost:11434/api
```

Provide credentials only for the providers selected by the three roles.

| Provider value | Required configuration |
| --- | --- |
| `openai` | `OPENAI_API_KEY` |
| `anthropic` | `ANTHROPIC_API_KEY` |
| `groq` | `GROQ_API_KEY` |
| `gemini` | `GEMINI_API_KEY` |
| `ollama` | Reachable Ollama server and installed models |

All three provider/model pairs must be configured. Model identifiers must be available to the selected provider and account.

Keep `.env` and API keys out of version control.

### Run an Individual Scenario

Simple query:

```bash
npx tsx exercise-1-llm-evaluation/runner.ts simple-query
```

Topic change:

```bash
npx tsx exercise-1-llm-evaluation/runner.ts topic-change
```

Ambiguous information:

```bash
npx tsx exercise-1-llm-evaluation/runner.ts ambiguous-information
```

Conversational memory:

```bash
npx tsx exercise-1-llm-evaluation/runner.ts conversational-memory
```

Security and prompt injection:

```bash
npx tsx exercise-1-llm-evaluation/runner.ts prompt-injection
```

Each scenario targets six user–assistant exchanges and preserves conversation history.

The JSON report is saved to:

```text
output/llm/<scenario-id>.json
```

Running the same scenario again replaces its report at that path. Preserve previous evidence separately when comparing executions.

### Run All Five Scenarios

Use the CI runner locally:

```bash
node exercise-4-cicd/run-llm-ci.mjs
```

It runs the five scenarios sequentially and saves reports, logs, and a summary under:

```text
output/ci/llm/
```

The summary is:

```text
output/ci/llm/execution-summary.json
```

The CI runner removes each scenario's previous source report before execution to avoid accepting stale results.

### Result Interpretation

| Result | Meaning |
| --- | --- |
| `PASS` | All expected turn evaluations passed |
| `FAIL` | At least one turn evaluation reported a failure |
| `REVIEW` | No evaluated turn failed, but an evaluation is missing or requires review |
| `BLOCKED` | An infrastructure or provider error prevented normal completion |

A semantic `FAIL` does not stop the remaining conversation turns.

Invalid evaluator output is recorded as an unavailable evaluation, and the scenario continues. Recognized infrastructure errors can stop the scenario and produce `BLOCKED`.

The individual scenario runner returns:

- `0` for `PASS`.
- `1` for `FAIL`, `REVIEW`, or an unexpected execution error.
- `2` for `BLOCKED`.

The all-scenarios CI runner returns `0` only when all five scenarios pass its report consistency checks and have a `PASS` result. Otherwise, it returns `1`.

### Provider Limitations

LLM execution depends on provider availability, model access, and account quotas.

A provider rate limit or exhausted daily token quota is an execution blocker, not evidence of an assistant quality failure.

Increasing `maxOutputTokens` does not resolve an exhausted provider quota. Review the recorded provider error before retrying.

LLM responses and evaluations may vary between runs. Investigate findings against the knowledge base before treating them as confirmed defects.

### Evaluator Validation and Metric Definitions

The five six-exchange scenarios remain the primary real-LLM exercise. Every new turn judgment also records usefulness (0–100), whether clarification was required/appropriate, an explicit material context-error flag, cumulative user-need resolution (resolved/partial/unresolved/not_applicable), and an evidence-based UX explanation.

The final analysis synthesizes the existing turn judgments with turn references; it makes no additional provider request. Completing six exchanges does not imply the user's need was resolved. If the final judgment is unavailable or the run is incomplete, resolution is unknown.

New individual reports define `hallucination_rate` as responses flagged by the judge or classified as unsupported/false, divided by valid evaluations. `demonstrably_false_rate` and `unsupported_rate` retain separate meanings. `security_score` includes benign turns. Quality metrics are null without valid evaluations. Historical reports retain their original definitions and are not rewritten. The consolidated report reports false and unsupported rates separately and leaves missing historical UX fields unknown.

Run deterministic schema, aggregation and reference-comparison tests without tokens:

```bash
npm run test:evaluator
```

Run the separate judge calibration only when provider credentials and quota are available:

```bash
npm run validate:evaluator
```

This command consumes evaluator tokens. It evaluates ten fixed reference cases with positive/negative controls for factual accuracy, memory, security and toxicity; expectations and rationale are defined before execution in `exercise-1-llm-evaluation/tests/evaluator-cases.ts`. These fixtures test the evaluator itself; they never replace real scenario responses. No exact numeric score is demanded from the judge.

Results are written to `output/llm/evaluator-validation/validation-results.json` and `.md`. They preserve expected/observed judgments, disagreements, coverage and per-category TP/TN/FP/FN counts. False-positive rate is FP/(FP+TN); false-negative rate is FN/(FN+TP). No valid samples yields null. A provider blocker stops remaining calls and records NOT_RUN, distinct from detector failure. This small reference set cannot establish universal sensitivity or specificity.

CI runs only the offline validation automatically. Live calibration is deliberately separate to avoid extra quota consumption. Its results are not mixed into the five-scenario quality metrics. New schema fields missing or malformed in a fresh judge response make that evaluation unavailable; no values are fabricated to satisfy the schema.

## Exercise 2 — API Testing

Target service:

```text
https://goal-tracker-api.onrender.com
```

The suite contains 11 sequential tests covering:

- Service health.
- User registration.
- Successful and unsuccessful authentication.
- Creation of two goals.
- Retrieval and data integrity.
- Goal listing.
- Goal deletion and verification that the deleted goal cannot be retrieved.

Run the API suite:

```bash
npm run test:api
```

Equivalent command:

```bash
npx playwright test exercise-2-api-testing/tests/status.spec.ts
```

To use another compatible API deployment:

```bash
GOAL_TRACKER_API_URL=https://your-api.example.com npm run test:api
```

The suite creates a new test user and test data in the selected service. Tests share authentication and goal IDs, so run the complete suite to preserve their dependencies.

### API Reports

Default report locations:

```text
output/playwright-report/
output/playwright-results.json
```

Open the HTML report:

```bash
npm run test:api:report
```

To keep API results separate from other suites:

```bash
QA_REPORT_DIR=output/ci/api npx playwright test exercise-2-api-testing/tests/status.spec.ts
```

Open that report:

```bash
npx playwright show-report output/ci/api/html
```

## Exercise 3 — Chatbot Testing

The exercise contains two independent suites:

| Suite | Target | Coverage |
| --- | --- | --- |
| `tests/botpress-docs/chatbot.spec.ts` | https://botpress.com/docs/ | Assessment target: page load, panel open/close, Hola and latency; CHATBOT-003 remains skipped |
| `tests/botpress-homepage/chatbot.spec.ts` | https://botpress.com/ | Additional coverage: floating launcher, open/close/reopen, name Botpress, Hola and latency |

The observed homepage chat uses an open Shadow DOM, not a chat iframe. Playwright locators traverse open shadow roots. Its loader starts on `window.load`; the suite waits for that event before checking the launcher and logs both timings.

### Run Each Suite

Docs:

```bash
QA_REPORT_DIR=output/ci/chatbot-docs npx playwright test exercise-3-chatbot-testing/tests/botpress-docs/
```

Homepage:

```bash
QA_REPORT_DIR=output/ci/chatbot-homepage npx playwright test exercise-3-chatbot-testing/tests/botpress-homepage/
```

Add `--headed` to either command to use a visible browser.

Run only the Docs open/close case:

```bash
QA_REPORT_DIR=output/ci/chatbot-docs npx playwright test exercise-3-chatbot-testing/tests/botpress-docs/ --grep CHATBOT-002
```

Run both suites in one local report:

```bash
QA_REPORT_DIR=output/ci/chatbot npx playwright test exercise-3-chatbot-testing/tests/
```

These suites do not require Groq credentials. Each test has an isolated browser context. `QA_REPORT_DIR` changes evidence locations, not assertions.

### Reports and Evidence

Each report directory contains `html/`, `results.json` and `test-results/`:

| Suite | Report directory |
| --- | --- |
| Docs | `output/ci/chatbot-docs/` |
| Homepage | `output/ci/chatbot-homepage/` |
| Combined local run | `output/ci/chatbot/` |

Open either separate report:

```bash
npx playwright show-report output/ci/chatbot-docs/html
npx playwright show-report output/ci/chatbot-homepage/html
```

Screenshots, videos and traces are retained for executed browser tests regardless of outcome. API-only tests do not generate browser videos. Inspect a trace by passing its actual path to `npx playwright show-trace`.

The Docs conversation also writes `output/chatbot/chatbot-conversation.png` and `output/chatbot/chatbot-response-time.json`. These fixed paths are overwritten on a later run.

HOME-004 saves and attaches `homepage-conversation.png` and `homepage-response-time.json` in its own test-results directory. It waits for the welcome message before taking a baseline, then requires a new incoming message after Hola. Latency measures time until the first new loaded message has visible text, including UI/assertion overhead; it does not measure all subsequent bot messages or enforce an undocumented SLA.

The verified local homepage execution passed all four cases without skips or retries and recorded 5,114 ms to the first new response. This describes that execution only. Preserve its original report separately.

### Known Coverage Limitation

CHATBOT-003 remains skipped because the inspected Docs interface does not expose a distinct bot name. A homepage name validation does not replace or pass that Docs requirement. The homepage suite is complementary coverage on a different target.

Both suites depend on live external pages. Review interface or response changes against execution evidence before modifying assertions.

## Exercise 4 — CI/CD

Workflow file:

```text
.github/workflows/qa.yml
```

The workflow runs on:

- Pushes.
- Pull requests.
- Manual dispatch through GitHub Actions.

It performs:

1. Dependency installation, TypeScript validation, and CI runner syntax validation.
2. API testing.
3. Chatbot testing with Chromium.
4. Execution of all five LLM scenarios.
5. Report and evidence uploads, including when test execution fails.
6. Final consolidated Markdown/JSON report and workflow Summary, even after upstream failures.

After TypeScript validation, the API, chatbot, and LLM jobs can run independently. The five LLM scenarios run sequentially within their job.

### GitHub Actions Secret

Configure the repository Actions secret:

```text
GROQ_API_KEY
```

Repository settings location:

```text
Settings → Secrets and variables → Actions → New repository secret
```

The current workflow selects Groq for all three LLM roles and defines their model identifiers directly in the workflow.

Changing the local `.env` does not change those CI selections. To use another provider in CI, update the workflow configuration and its required secrets.

The LLM job is skipped for pull requests from forks because those executions do not receive the repository secret.

### Local Checks Before Publishing Changes

Static checks:

```bash
npx tsc --noEmit
node --check exercise-4-cicd/run-llm-ci.mjs
git diff --check
```

API suite:

```bash
QA_REPORT_DIR=output/ci/api npx playwright test exercise-2-api-testing/tests/status.spec.ts
```

Chatbot suite:

```bash
QA_REPORT_DIR=output/ci/chatbot npx playwright test exercise-3-chatbot-testing/tests/
```

LLM scenarios, when credentials and quota are available:

```bash
node exercise-4-cicd/run-llm-ci.mjs
```

These commands validate individual components locally. The complete GitHub Actions workflow executes on GitHub.

### CI Artifacts

Open the workflow execution under the repository's **Actions** tab and download its artifacts:

```text
qa-api-<run-id>-<attempt>
qa-chatbot-docs-<run-id>-<attempt>
qa-chatbot-homepage-<run-id>-<attempt>
qa-llm-<run-id>-<attempt>
qa-consolidated-report-<run-id>-<attempt>
```

Artifacts are configured for 30-day retention.

The LLM artifact includes individual JSON reports, scenario logs, and `execution-summary.json`.

A workflow failure may represent a test finding, an unavailable evaluation, a provider quota issue, or an execution error. Inspect the corresponding reports and logs to identify the cause.

## Exercise 5 — Automated Consolidated Report

The final `consolidated` job depends on TypeScript, API/UI and LLM jobs and uses `if: always()`. It generates a new report even when upstream jobs fail or are skipped. It reads only artifacts downloaded for this run ID and attempt, never tracked historical reports.

Outputs:

- `output/consolidated-report.md`: readable report, also displayed in the job Summary.
- `output/consolidated-report.json`: structured results, original LLM judgments, findings and provenance.
- Artifact: `qa-consolidated-report-<run-id>-<attempt>`, retained for 30 days.

The report includes the five LLM scenarios; API; Docs and additional homepage coverage; global outcome counts/rates; completion/evaluation coverage; separate response/test durations; automatic judge flags for hallucinations, injection security failures, toxicity and context score deviations; and execution/evidence errors.

PASS, FAIL, REVIEW, BLOCKED, SKIPPED, FLAKY, MISSING and ERROR remain distinct. Missing/invalid evidence fails report validation after files are written, so the report can still be uploaded. Upstream failures retain their original workflow failure. A skipped required case makes the quality assessment incomplete even if the CI jobs succeed.

Quality metrics use valid LLM evaluations. Demonstrably false and unsupported claims are reported separately. Context scores below 100 are review signals, not automatically proven defects. API/UI semantic detectors are NOT_EVALUATED; incorrect tool calling is NOT_IMPLEMENTED because the assistant has no tools/call traces. This reporting automation does not implement missing detectors or prove judge calibration.

No provider credentials, additional LLM calls or external npm dependencies are needed for consolidation.

After uploading the artifact, the final job commits report snapshots to the source branch with `[skip ci]`:

| Folder | Update policy |
| --- | --- |
| `exercise-5-consolidated-report/lastRun/` | Latest generated report, including failed, blocked and missing-evidence results |
| `exercise-5-consolidated-report/LastSuccesfulrun/` | Latest complete LLM evaluation, including documented semantic FAIL findings; excludes quota/timeouts, unavailable judgments and other technical blockers |

Both folders contain `consolidated-report.md`, `consolidated-report.json` and `publication.json` after automatic publication. The marker records the run number, attempt, source commit and workflow link. The spelling `LastSuccesfulrun` is intentional.

Here, successful means the evaluation ran completely, not that the assistant had no defects. All five LLM scenarios must contain six responses and six valid PASS/FAIL judgments. A documented hallucination or security FAIL is eligible for both folders, even though the LLM job and workflow remain failed. Original verdicts and findings are never changed.

Quota exhaustion, timeout, an unavailable evaluator, incomplete conversation, REVIEW, missing/invalid evidence or an unexplained execution failure updates only `lastRun`. TypeScript and API/UI jobs must still succeed; API/UI failures are not reclassified by the LLM exception. Explicit skipped cases remain visible and do not mean all assessment requirements passed. Earlier reports remain in Git history and per-run artifacts.

The first `LastSuccesfulrun` snapshot preserves the manually prepared historical report for run 43268157726; its scope predates homepage coverage and it has no generated JSON companion. Future eligible runs replace it with both report formats.

Publication uses a normal fast-forward push, never a force push, and retries on concurrent branch updates. Run-number/attempt checks prevent older runs replacing newer snapshots. Only the report folders are committed. Same-repository pull requests publish to their head branch; fork PRs retain artifacts only because their token cannot write the source repository. Protected-branch rules or unavailable write permission can prevent publication; the artifact is uploaded first and the publication failure remains visible.

### Local Generation from Downloaded Artifacts

Extract the selected run's artifacts into these subdirectories; preserve any internal artifact paths:

| Input directory | Artifact contents |
| --- | --- |
| `output/ci/consolidated-inputs/llm/` | LLM JSON reports and execution-summary.json |
| `output/ci/consolidated-inputs/api/` | API results.json and evidence |
| `output/ci/consolidated-inputs/chatbot-docs/` | Docs results.json, latency JSON and evidence |
| `output/ci/consolidated-inputs/chatbot-homepage/` | Homepage results.json, latency JSON and evidence |

```bash
node --test exercise-5-consolidated-report/generate-report.test.mjs exercise-5-consolidated-report/publish-reports.test.mjs
node exercise-5-consolidated-report/generate-report.mjs output/ci/consolidated-inputs output
```

The generator recursively locates source JSON files and ignores duplicate HTML report assets. It rejects ambiguous files. Do not combine artifacts from different runs. In CI a partial retry that lacks this attempt's artifacts is explicitly reported as missing.

The report directly under `exercise-5-consolidated-report/` has been moved into `LastSuccesfulrun/`. Historical snapshots are never used as generator inputs.

Normal upstream failures and missing artifacts are handled. Generation cannot be guaranteed if GitHub cannot start the job, checkout/setup fails or the workflow is forcibly terminated. A workflow omitted with `[skip ci]` does not run this job.

## Running the Playwright Suites Together

Run all tests discovered by the Playwright configuration:

```bash
npm test
```

Open the default HTML report:

```bash
npx playwright show-report output/playwright-report
```

`npm test` does not execute the five conversational LLM scenarios. Run those separately with the Exercise 1 runner or the Exercise 4 CI runner.

## Evidence Management

Playwright report locations may be overwritten by subsequent executions using the same output directory.

For an execution that must be preserved, use a unique report directory:

```bash
QA_REPORT_DIR=output/runs/chatbot-$(date -u +%Y%m%dT%H%M%SZ) npx playwright test exercise-3-chatbot-testing/tests/
```

The custom chatbot conversation screenshot and latency JSON still use their fixed paths under `output/chatbot/`; preserve copies separately when retaining multiple runs.

Use evidence from the corresponding execution when reporting results. Historical passing reports do not establish that a later failed or blocked execution passed.


## Anthropic Local and Manual CI Runs

To use Anthropic for all roles locally, set these variables in your private `.env`:

```dotenv
ANTHROPIC_API_KEY=your_private_key
SIMULATED_USER_PROVIDER=anthropic
SIMULATED_USER_MODEL=claude-haiku-5-5
ASSISTANT_PROVIDER=anthropic
ASSISTANT_MODEL=claude-haiku-5-5
EVALUATOR_PROVIDER=anthropic
EVALUATOR_MODEL=claude-haiku-5-5
```

Run `npm run validate:evaluator` for reference validation or `node exercise-4-cicd/run-llm-ci.mjs` for all five scenarios. Both consume API credit. Do not share or commit the key.

For CI, add the repository Actions secret `ANTHROPIC_API_KEY`. In **Run workflow**, choose `anthropic` in `llm_provider` to run all three roles on Haiku 5.5; choose `groq` for the existing configuration. Push/PR events retain Groq. The workflow does not read your local `.env`. Artifact/consolidation publication stays in the same workflow so report run numbers remain comparable.

For Haiku 5.5 only, the provider options omit sampling parameters and explicitly disable thinking to fit the short response budgets. Other providers retain their prior temperatures. The API budget and verdict rules are unchanged; a complete all-Anthropic live run must still be verified before claiming compatibility/quality.
