import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScript, parseMarkdown, parsePlainText, parseSubtitles, decodeBuffer, formatForPath, scriptTitle } from '../../src/main/script-parser.js';
import { buildModel, splitCues } from '../../src/core/document.js';

const text = (block) => block.runs.map((r) => (r.br ? '\n' : r.text)).join('');

test('markdown renders as clean blocks without syntax', () => {
  const blocks = parseMarkdown(`---\ntitle: x\n---\n# Hello **World**\n\nThis is *very* \`neat\` and [a link](https://example.com).\n\n- one\n- two\n\n> quoted\n\n---\n\n1. first\n2. second\n\n<!-- hidden -->\n<div>raw html</div>`);
  assert.equal(blocks[0].type, 'heading');
  assert.equal(blocks[0].level, 1);
  assert.equal(text(blocks[0]), 'Hello World');
  assert.ok(blocks[0].runs.some((r) => r.bold && r.text === 'World'));
  assert.equal(text(blocks[1]), 'This is very neat and a link.');
  assert.ok(blocks[1].runs.some((r) => r.italic && r.text === 'very'));
  assert.ok(blocks[1].runs.some((r) => r.code && r.text === 'neat'));
  assert.deepEqual(blocks.filter((b) => b.type === 'list-item').map(text), ['one', 'two', 'first', 'second']);
  assert.equal(blocks.find((b) => b.type === 'list-item' && b.ordered).number, 1);
  assert.equal(text(blocks.find((b) => b.type === 'quote')), 'quoted');
  assert.ok(blocks.some((b) => b.type === 'rule'));
  const all = blocks.filter((b) => b.runs).map(text).join(' ');
  assert.ok(!all.includes('<'), 'no html tags');
  assert.ok(!all.includes('hidden'), 'comments removed');
  assert.ok(all.includes('raw html'));
  assert.ok(!all.includes('title: x'), 'front matter removed');
});

test('plain text keeps paragraphs and line breaks', () => {
  const blocks = parsePlainText('First line\nsecond line\n\n\nNew paragraph.  \r\n\r\nThird');
  assert.equal(blocks.length, 3);
  assert.equal(text(blocks[0]), 'First line\nsecond line');
  assert.equal(text(blocks[1]), 'New paragraph.');
});

test('subtitles drop indexes and timestamps', () => {
  const blocks = parseSubtitles('WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\n<v Ann>Hello there</v>\n\n2\n00:00:03,000 --> 00:00:04,000\nSecond cue\nline two\n');
  assert.deepEqual(blocks.map(text), ['Hello there', 'Second cue\nline two']);
});

test('decodes common encodings', () => {
  assert.equal(decodeBuffer(Buffer.from([0xef, 0xbb, 0xbf, 0x68, 0x69])), 'hi');
  assert.equal(decodeBuffer(Buffer.from([0xff, 0xfe, 0x68, 0x00, 0x69, 0x00])), 'hi');
  assert.equal(decodeBuffer(Buffer.from('café', 'utf8')), 'café');
  assert.equal(decodeBuffer(Buffer.from([0x63, 0x61, 0x66, 0xe9])), 'café'); // windows-1252
});

test('formats and titles', () => {
  assert.equal(formatForPath('C:\\a\\talk.MD'), 'markdown');
  assert.equal(formatForPath('x.srt'), 'subtitles');
  assert.equal(formatForPath('x.txt'), 'text');
  assert.equal(scriptTitle(parseScript('# My Talk\n\nHi', 'markdown')), 'My Talk');
  assert.equal(scriptTitle(parseScript('Hi', 'text'), 'C:\\x\\notes.txt'), 'notes');
});

test('model maps words to tracking tokens', () => {
  const model = buildModel(parseScript('# Title\n\nIn 2024, we grew 40% — really [pause] fast.', 'markdown'));
  const words = model.words.map((w) => w.text);
  assert.deepEqual(words, ['Title', 'In', '2024,', 'we', 'grew', '40%', '—', 'really', '[pause]', 'fast.']);
  const tok = model.tokens.map((t) => t.t);
  assert.deepEqual(tok, ['title', 'in', 'twenty', 'twenty', 'four', 'we', 'grew', 'forty', 'percent', 'really', 'fast']);
  const dash = model.words[6];
  assert.equal(dash.tokenEnd - dash.tokenStart, 0);
  const cue = model.words[8];
  assert.equal(cue.cue, true);
  assert.equal(cue.tokenEnd - cue.tokenStart, 0);
  assert.equal(model.tokens[2].word, 2);
  // Function words weigh less than content words.
  assert.ok(model.tokens.find((t) => t.t === 'in').w < model.tokens.find((t) => t.t === 'grew').w);
});

test('cue splitting', () => {
  const runs = splitCues([{ text: 'Hello [smile] world [beat]' }]);
  assert.deepEqual(runs.map((r) => [r.text, !!r.cue]), [['Hello ', false], ['[smile]', true], [' world ', false], ['[beat]', true]]);
});
