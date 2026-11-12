import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultPlaywrightReportDir, playwrightSuites } from './report-paths.mjs';
import { runPlaywrightSuites } from './run-playwright.mjs';

test('reports for each selected exercise stay in that exercise folder', () => {
  for (const s of playwrightSuites) assert.equal(defaultPlaywrightReportDir([s.testPath]), s.reportDir);
  assert.equal(defaultPlaywrightReportDir(['exercise-3-chatbot-testing/tests/']), 'output/exercise3-chatbot/combined');
  assert.equal(defaultPlaywrightReportDir(['exercise-2-api-testing/tests/', 'exercise-3-chatbot-testing/tests/']), 'output/ci/playwright-combined');
  assert.equal(defaultPlaywrightReportDir([]), 'output/ci/playwright-combined');
});

test('npm test isolates suite outputs and continues after an assertion failure', () => {
  const calls = [];
  const results = runPlaywrightSuites(['--list'], (command, args, options) => {
    calls.push({ command, args, options }); return { status: calls.length === 1 ? 1 : 0 };
  }, { CI: 'true' });
  assert.equal(calls.length, 3);
  assert.deepEqual(calls.map(c => c.options.env.QA_REPORT_DIR), playwrightSuites.map(s => s.reportDir));
  assert.ok(calls.every(c => c.args.includes('--list') && c.options.env.CI === 'true'));
  assert.deepEqual(results.map(r => r.exitCode), [1, 0, 0]);
});

