import { defineConfig, devices } from '@playwright/test';

import { defaultPlaywrightReportDir } from './exercise-4-cicd/report-paths.mjs';

const reportDir = process.env.QA_REPORT_DIR?.trim() ||
  defaultPlaywrightReportDir(process.argv.slice(2));

export default defineConfig({
  testDir: './',

  testMatch: [
    'exercise-2-api-testing/**/*.spec.ts',
    'exercise-3-chatbot-testing/**/*.spec.ts',
  ],

  timeout: 150_000,

  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,

  outputDir:
    `${reportDir}/test-results`,

  reporter: [
    ['list'],

    [
      'html',
      {
        outputFolder:
          `${reportDir}/html`,

        open: 'never',
      },
    ],

    [
      'json',
      {
        outputFile:
          `${reportDir}/results.json`,
      },
    ],
  ],

  use: {
    trace: 'on',
    screenshot: 'on',
    video: 'on',
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


