# Exercise 3 — Web chatbot tests

Run commands from the repository root after `npm ci` and `npx playwright install --with-deps chromium`.

| Suite | Target | Cases |
| --- | --- | --- |
| `tests/chatbot.spec.ts` | https://botpress.com/docs/ | Existing Docs panel checks; CHATBOT-003 remains skipped |
| `tests/homepage.spec.ts` | https://botpress.com/ | Floating launcher, open/close/reopen, displayed bot name, Hola and response latency |

The homepage was inspected on November 12, 2026. The observed chat is rendered inside an open Shadow DOM under a `#fab-root` host, not a chat iframe. Playwright CSS and role locators traverse open shadow roots. Unrelated form/tracking iframes must not be treated as the chatbot. The branch name retains the original iframe investigation label.

Run only the new homepage suite (no Groq provider credentials required):

```bash
QA_REPORT_DIR=output/ci/chatbot-homepage npx playwright test exercise-3-chatbot-testing/tests/homepage.spec.ts
```

Run only the existing Docs suite:

```bash
QA_REPORT_DIR=output/ci/chatbot-docs npx playwright test exercise-3-chatbot-testing/tests/chatbot.spec.ts
```

Run both suites, as configured for the chatbot CI job:

```bash
QA_REPORT_DIR=output/ci/chatbot npx playwright test exercise-3-chatbot-testing/tests/
```

Open the new suite's report:

```bash
npx playwright show-report output/ci/chatbot-homepage/html
```

The shared configuration retains screenshots, videos and traces for browser tests regardless of result. HOME-004 also attaches `homepage-conversation.png` and `homepage-response-time.json` inside its test-results directory and HTML report. CI uploads the containing directory.

The response test waits for the initial welcome message before recording its baseline and requires a new incoming message after Hola. It validates receipt of a nonempty loaded response without fixing the generated wording. Latency includes UI/assertion overhead and is recorded without imposing an undocumented SLA.

Each test has an isolated browser context. The new bot-name check does not turn the skipped Docs bot-name check into a pass. This additional website is complementary coverage; the assessment specifically names Botpress Docs, so describe the target difference in the final report.

Live UI interactions were inspected when this suite was authored; a complete automated execution must be recorded before declaring HOME-001 through HOME-004 passed.
