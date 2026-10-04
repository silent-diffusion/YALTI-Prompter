#!/usr/bin/env node
// Downloads the bundled speech-recognition model into resources/models.
//
//   npm run fetch-model                 download (skips files that already verify)
//   npm run fetch-model -- --from DIR   copy from a local folder instead (offline builds)
//
// The model is the int8 streaming Zipformer transducer for English from the
// k2-fsa / sherpa-onnx project, licensed Apache-2.0. Every file is verified
// against a pinned SHA-256 so builds are reproducible.

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, copyFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const MODEL = {
  id: 'en-us-zipformer-2023-06-26',
  name: 'English (US) — Zipformer streaming',
  language: 'en',
  repo: 'csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26',
  revision: '672fbf1b30579d6585301139bb363f42a0ad4a24',
  license: 'Apache-2.0',
  source: 'https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26',
  training: 'https://github.com/k2-fsa/icefall/pull/1058 (LibriSpeech)',
  // `name` is the file in the source repository; `local` is the short name
  // used on disk (short paths stay clear of Windows path-length limits).
  files: {
    encoder: { name: 'encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx', local: 'encoder.int8.onnx', sha256: '563fde436d16cf7607cf408cd6b30909819d03162652ef389c2450ced3f45ac1' },
    decoder: { name: 'decoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx', local: 'decoder.int8.onnx', sha256: '98da299f471e38bb4e1a8df579b8cc9122d6039576a77e357b3c60f17dd83b02' },
    joiner: { name: 'joiner-epoch-99-avg-1-chunk-16-left-128.int8.onnx', local: 'joiner.int8.onnx', sha256: 'd944208d660d67c8d72cd2acaeac971fa5ceb8c80e76c1968148846fedd6e297' },
    tokens: { name: 'tokens.txt', local: 'tokens.txt', sha256: '49e3c2646595fd907228b3c6787069658f67b17377c60aeb8619c4551b2316fb' },
  },
};

export const MODEL_DIR_NAME = 'en-us';
const outDir = join(ROOT, 'resources', 'models', MODEL_DIR_NAME);

async function sha256(file) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
  const tmp = dest + '.part';
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  renameSync(tmp, dest);
}

async function main() {
  const fromIdx = process.argv.indexOf('--from');
  const fromDir = fromIdx > 0 ? resolve(process.argv[fromIdx + 1]) : null;
  mkdirSync(outDir, { recursive: true });

  for (const [role, file] of Object.entries(MODEL.files)) {
    const dest = join(outDir, file.local);
    if (existsSync(dest) && (await sha256(dest)) === file.sha256) {
      console.log(`✓ ${role.padEnd(8)} ${file.local} (cached)`);
      continue;
    }
    if (fromDir) {
      const src = [file.local, file.name].map((n) => join(fromDir, n)).find((p) => existsSync(p));
      if (!src) throw new Error(`${file.name} not found in ${fromDir}`);
      copyFileSync(src, dest);
    } else {
      const url = `https://huggingface.co/${MODEL.repo}/resolve/${MODEL.revision}/${file.name}`;
      process.stdout.write(`↓ ${role.padEnd(8)} ${file.name} … `);
      await download(url, dest);
      process.stdout.write('done\n');
    }
    const actual = await sha256(dest);
    if (actual !== file.sha256) {
      rmSync(dest, { force: true });
      throw new Error(`Checksum mismatch for ${file.name}: expected ${file.sha256}, got ${actual}`);
    }
    console.log(`✓ ${role.padEnd(8)} ${file.local} verified`);
  }

  const manifest = {
    id: MODEL.id,
    name: MODEL.name,
    language: MODEL.language,
    type: 'transducer',
    license: MODEL.license,
    source: MODEL.source,
    revision: MODEL.revision,
    training: MODEL.training,
    files: Object.fromEntries(Object.entries(MODEL.files).map(([k, v]) => [k, v.local])),
    sourceFiles: Object.fromEntries(Object.entries(MODEL.files).map(([k, v]) => [k, v.name])),
  };
  writeFileSync(join(outDir, 'model.json'), JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(join(outDir, 'NOTICE.txt'), [
    `${MODEL.name}`,
    '',
    `Source: ${MODEL.source} (revision ${MODEL.revision})`,
    `Training recipe: ${MODEL.training}`,
    'Exported for sherpa-onnx by the k2-fsa / Next-gen Kaldi team.',
    `License: ${MODEL.license} — see licenses/Apache-2.0.txt in the YALTI Prompter distribution.`,
    '',
  ].join('\n'));
  console.log(`Model ready in ${outDir}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
