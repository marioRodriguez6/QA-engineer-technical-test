import { defineConfig, devices } from '@playwright/test';

const reportDir =
  process.env.QA_REPORT_DIR?.trim();

export default defineConfig({
  testDir: './',

  testMatch: [
    'exercise-1-llm-evaluation/**/*.spec.ts',
    'exercise-2-api-testing/**/*.spec.ts',
    'exercise-3-chatbot-testing/**/*.spec.ts',
  ],

  timeout: 150_000,

  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,

  outputDir:
    reportDir
      ? `${reportDir}/test-results`
      : 'test-results',

  reporter: [
    ['list'],

    [
      'html',
      {
        outputFolder:
          reportDir
            ? `${reportDir}/html`
            : 'output/playwright-report',

        open: 'never',
      },
    ],

    [
      'json',
      {
        outputFile:
          reportDir
            ? `${reportDir}/results.json`
            : 'output/playwright-results.json',
      },
    ],
  ],

  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
});
