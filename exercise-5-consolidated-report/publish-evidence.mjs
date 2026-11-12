import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, dirname, relative, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const evidenceTargets = {
  llm: 'output/exercise1-JSON', api: 'output/exercise2API-Reports',
  'chatbot-docs': 'output/exercise3-chatbot/docs', 'chatbot-homepage': 'output/exercise3-chatbot/homepage',
};
export const manifestPath = 'output/evidence-manifest.json';
const hash = data => createHash('sha256').update(data).digest('hex');
function files(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap(e => e.isSymbolicLink() ? [] :
    e.isDirectory() ? files(join(root, e.name)) : [join(root, e.name)]);
}

export function captureEvidence(inputRoot, report) {
  const plans = [];
  for (const [suite, target] of Object.entries(evidenceTargets)) {
    const input = join(inputRoot, suite);
    const available = files(input);
    const reports = available.filter(p => basename(p) === (suite === 'llm' ? 'execution-summary.json' : 'results.json'));
    const root = reports.length === 1 ? dirname(reports[0]) : input;
    const selected = files(root);
    const original = new Map(selected.map(p => [relative(root, p), readFileSync(p)]));
    let publishedRoot = root;
    let temporary;
    try {
      if (suite === 'api' && selected.length) {
        temporary = mkdtempSync(join(tmpdir(), 'qa-api-publication-'));
        for (const [path, data] of original) {
          const dest = join(temporary, path); mkdirSync(dirname(dest), { recursive: true }); writeFileSync(dest, data);
        }
        const sanitized = spawnSync('python3', [fileURLToPath(new URL('./sanitize-api-evidence.py', import.meta.url)), temporary], { encoding: 'utf8' });
        if (sanitized.status !== 0) throw new Error(`API evidence sanitization failed: ${sanitized.stderr || sanitized.error?.message}`);
        publishedRoot = temporary;
      }
      const entries = selected.map(path => {
        const rel = relative(root, path);
        const destination = suite === 'llm' && !/^(simple-query|topic-change|ambiguous-information|conversational-memory|prompt-injection)\.json$/.test(rel)
          ? join(target, 'ci', rel) : join(target, rel);
        return { path: destination, data: readFileSync(join(publishedRoot, rel)), originalSha256: hash(original.get(rel)) };
      });
      const downloadOutcome = report.metadata.downloads?.[suite] ?? 'unknown';
      plans.push({ suite, target, entries, downloadOutcome, sourceReportAvailable: reports.length === 1,
        status: downloadOutcome === 'success' && reports.length === 1 ? 'AVAILABLE' : selected.length ? 'PARTIAL' : 'MISSING' });
    } finally { if (temporary) rmSync(temporary, { recursive: true, force: true }); }
  }
  return plans;
}

function newer(candidate, previous) {
  return !Number.isSafeInteger(previous?.runNumber) || candidate.runNumber > previous.runNumber ||
    (candidate.runNumber === previous.runNumber && candidate.attempt > previous.attempt);
}

export function writeEvidence(cwd, plans, publication, report) {
  const marker = join(cwd, manifestPath);
  const previous = existsSync(marker) ? JSON.parse(readFileSync(marker, 'utf8')) : null;
  if (!newer(publication, previous)) return [];
  const changed = [];
  const manifest = { ...publication, generatedAt: report.generatedAt ?? null, suites: [], files: [],
    policy: 'Resultados de esta ejecución e intento. Las fuentes faltantes reemplazan resultados anteriores por un estado MISSING/PARTIAL. history y LastSuccesfulrun conservan su evidencia original. Las copias API ocultan credenciales; los artefactos originales no se modifican.' };
  for (const plan of plans) {
    const destination = join(cwd, plan.target);
    if (plan.suite === 'llm') {
      if (existsSync(destination)) for (const entry of readdirSync(destination)) {
        if (!['history', 'evaluator-validation'].includes(entry)) rmSync(join(destination, entry), { recursive: true, force: true });
      }
    } else {
      if (existsSync(destination)) for (const entry of readdirSync(destination)) {
        if (entry !== 'history') rmSync(join(destination, entry), { recursive: true, force: true });
      }
    }
    for (const entry of plan.entries) {
      const path = join(cwd, entry.path); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, entry.data);
      manifest.files.push({ path: entry.path, bytes: entry.data.length, sha256: hash(entry.data), originalSha256: entry.originalSha256,
        sanitized: hash(entry.data) !== entry.originalSha256 });
    }
    const units = (report.units ?? []).filter(u => u.suite === plan.suite);
    const status = { ...publication, suite: plan.suite, evidenceStatus: plan.status, downloadOutcome: plan.downloadOutcome,
      sourceReportAvailable: plan.sourceReportAvailable, results: units, fileCount: plan.entries.length };
    mkdirSync(destination, { recursive: true });
    writeFileSync(join(destination, 'execution-status.json'), JSON.stringify(status, null, 2) + '\n');
    manifest.suites.push(status);
    changed.push(plan.target);
  }
  // El reporte conjunto local no se ejecuta en el pipeline y no representa esta ejecución.
  rmSync(join(cwd, 'output/exercise3-chatbot/combined'), { recursive: true, force: true });
  if (!changed.includes('output/exercise3-chatbot')) changed.push('output/exercise3-chatbot');
  mkdirSync(dirname(marker), { recursive: true }); writeFileSync(marker, JSON.stringify(manifest, null, 2) + '\n');
  changed.push(manifestPath);
  return changed;
}
