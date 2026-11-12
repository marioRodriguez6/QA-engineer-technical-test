export const playwrightSuites = [
  { id: 'api', testPath: 'exercise-2-api-testing/tests/status.spec.ts', reportDir: 'output/exercise2API-Reports' },
  { id: 'chatbot-docs', testPath: 'exercise-3-chatbot-testing/tests/botpress-docs/', reportDir: 'output/exercise3-chatbot/docs' },
  { id: 'chatbot-homepage', testPath: 'exercise-3-chatbot-testing/tests/botpress-homepage/', reportDir: 'output/exercise3-chatbot/homepage' },
];

export function defaultPlaywrightReportDir(args) {
  const target = args.join(' ');
  if (target.includes('exercise-2-api-testing') && target.includes('exercise-3-chatbot-testing'))
    return 'output/ci/playwright-combined';
  const suite = playwrightSuites.find(s => target.includes(s.testPath) ||
    (s.id === 'api' ? target.includes('exercise-2-api-testing') : target.includes(s.id === 'chatbot-docs' ? 'botpress-docs' : 'botpress-homepage')));
  if (suite) return suite.reportDir;
  return target.includes('exercise-3-chatbot-testing')
    ? 'output/exercise3-chatbot/combined'
    : 'output/ci/playwright-combined';
}

