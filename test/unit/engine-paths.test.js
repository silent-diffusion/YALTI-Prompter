import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { longPathSafe } = require('../../src/speech/engine.cjs');

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
