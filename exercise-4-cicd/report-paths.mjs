export const playwrightSuites = [
  { id: 'api', testPath: 'exercise-2-api-testing/tests/status.spec.ts', reportDir: 'exercise-2-api-testing/output' },
  { id: 'chatbot-docs', testPath: 'exercise-3-chatbot-testing/tests/botpress-docs/', reportDir: 'exercise-3-chatbot-testing/output/docs' },
  { id: 'chatbot-homepage', testPath: 'exercise-3-chatbot-testing/tests/botpress-homepage/', reportDir: 'exercise-3-chatbot-testing/output/homepage' },
];

export function defaultPlaywrightReportDir(args) {
  const target = args.join(' ');
  if (target.includes('exercise-2-api-testing') && target.includes('exercise-3-chatbot-testing'))
    return 'exercise-4-cicd/output/playwright-combined';
  const suite = playwrightSuites.find(s => target.includes(s.testPath) ||
    (s.id === 'api' ? target.includes('exercise-2-api-testing') : target.includes(s.id === 'chatbot-docs' ? 'botpress-docs' : 'botpress-homepage')));
  if (suite) return suite.reportDir;
  return target.includes('exercise-3-chatbot-testing')
    ? 'exercise-3-chatbot-testing/output/combined'
    : 'exercise-4-cicd/output/playwright-combined';
}
