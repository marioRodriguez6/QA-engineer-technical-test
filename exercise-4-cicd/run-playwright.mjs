import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { playwrightSuites } from './report-paths.mjs';

export function runPlaywrightSuites(args = [], execute = spawnSync, env = process.env) {
  const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
  return playwrightSuites.map(suite => {
    const result = execute(process.execPath, [cli, 'test', suite.testPath, ...args], {
      stdio: 'inherit', env: { ...env, QA_REPORT_DIR: suite.reportDir },
    });
    return { suite: suite.id, reportDir: suite.reportDir, exitCode: result.status, signal: result.signal ?? null, error: result.error?.message ?? null };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const results = runPlaywrightSuites(process.argv.slice(2));
  mkdirSync('output/ci', { recursive: true });
  writeFileSync('output/ci/playwright-execution.json', JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2) + '\n');
  process.exitCode = results.every(r => r.exitCode === 0 && !r.signal && !r.error) ? 0 : 1;
}

