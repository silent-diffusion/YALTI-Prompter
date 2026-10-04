#!/usr/bin/env node
// Launches the real app in smoke-test mode and reports the result.
//
//   npm run test:app                      run against the source tree
//   npm run test:app -- --exe "dist/win-unpacked/YALTI Prompter.exe"   run a packaged build
//   npm run test:app -- --fake-mic file.wav                             also test real speech input
//
// Screenshots and report.json are written to test-output/smoke/.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
};

const outDir = resolve(arg('--out') || join(ROOT, 'test-output', 'smoke'));
rmSync(outDir, { recursive: true, force: true });
rmSync(outDir + '-profile', { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const exe = arg('--exe');
const fakeMic = arg('--fake-mic');
const command = exe ? resolve(exe) : require('electron');
const args = exe ? [`--smoke=${outDir}`] : [ROOT, `--smoke=${outDir}`];
const env = { ...process.env };
if (fakeMic) env.YALTI_FAKE_MIC = resolve(fakeMic);
env.YALTI_SMOKE_ROOT = ROOT;
delete env.ELECTRON_RUN_AS_NODE;

console.log(`Running ${exe ? exe : 'electron (source)'} …`);
const child = spawn(command, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', (d) => process.stdout.write(d));
child.stderr.on('data', (d) => process.stderr.write(d));
const timeout = setTimeout(() => { console.error('Timed out'); child.kill(); }, 240000);

child.on('exit', (code) => {
  clearTimeout(timeout);
  const reportFile = join(outDir, 'report.json');
  if (!existsSync(reportFile)) {
    console.error(`No report written (exit code ${code}).`);
    process.exit(1);
  }
  const report = JSON.parse(readFileSync(reportFile, 'utf8'));
  console.log(`\nSmoke test ${report.ok ? 'PASSED' : 'FAILED'}`);
  for (const e of report.errors) console.log('  ✖', e);
  if (report.metrics) {
    const total = report.metrics.reduce((s, m) => s + m.memMB, 0);
    console.log(`  Memory (working set, all processes): ${total} MB`);
    for (const m of report.metrics) console.log(`    ${m.type.padEnd(10)} ${String(m.memMB).padStart(5)} MB ${m.name || ''}`);
  }
  console.log(`  Screenshots: ${outDir}`);
  process.exit(report.ok ? 0 : 1);
});
