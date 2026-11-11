
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './',

  testMatch: [
    'exercise-1-llm-evaluation/**/*.spec.ts',
    'exercise-2-api-testing/**/*.spec.ts',
    'exercise-3-chatbot-testing/**/*.spec.ts',
  ],

  fullyParallel: false,
  workers: 1,

  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,

  reporter: [
    ['list'],
    ['html', { outputFolder: 'output/playwright-report', open: 'never' }],
    ['json', { outputFile: 'output/playwright-results.json' }],
  ],

  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

