import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { longPathSafe, warmModel } = require('../../src/speech/engine.cjs');

test('short model paths are left alone', () => {
  assert.equal(longPathSafe('C:\\Programs\\YALTI\\encoder.int8.onnx'), 'C:\\Programs\\YALTI\\encoder.int8.onnx');
});

test('long Windows paths use the extended-length form', { skip: process.platform !== 'win32' }, () => {
  const long = `C:\\${'a'.repeat(210)}\\encoder.int8.onnx`;
  assert.equal(longPathSafe(long), `\\\\?\\${long}`);
  assert.equal(longPathSafe(`\\\\?\\${long}`), `\\\\?\\${long}`, 'not prefixed twice');
  const unc = `\\\\server\\share\\${'b'.repeat(200)}\\x.onnx`;
  assert.equal(longPathSafe(unc), `\\\\?\\UNC\\server\\share\\${'b'.repeat(200)}\\x.onnx`);
});

test('reading a model reports real progress up to the total size', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'yalti-model-'));
  const files = { encoder: 'encoder.onnx', decoder: 'decoder.onnx', joiner: 'joiner.onnx', tokens: 'tokens.txt' };
  writeFileSync(join(dir, 'model.json'), JSON.stringify({ id: 'test', files }));
  const sizes = { encoder: 9 * 1024 * 1024 + 7, decoder: 1024, joiner: 0, tokens: 300 };
  for (const [role, name] of Object.entries(files)) writeFileSync(join(dir, name), Buffer.alloc(sizes[role], 1));
  const total = Object.values(sizes).reduce((a, b) => a + b, 0);
  const seen = [];
  assert.equal(await warmModel(dir, (loaded, t) => seen.push([loaded, t])), total);
  assert.ok(seen.length >= 3, 'several updates for a large file');
  assert.ok(seen.every(([, t]) => t === total));
  assert.ok(seen.every(([l], i) => i === 0 || l > seen[i - 1][0]), 'progress only moves forward');
  assert.equal(seen.at(-1)[0], total);
  rmSync(dir, { recursive: true, force: true });
});

test('reading a model with a missing file fails with a clear message', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'yalti-model-'));
  writeFileSync(join(dir, 'model.json'), JSON.stringify({ files: { encoder: 'e', decoder: 'd', joiner: 'j', tokens: 't' } }));
  await assert.rejects(warmModel(dir), /Model file not found: e/);
  rmSync(dir, { recursive: true, force: true });
});
