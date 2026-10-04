// Turns script files into the block/run structure rendered by the prompter.
// Markdown is parsed with `marked`'s lexer and rebuilt as plain styled runs,
// so no raw HTML from a script is ever injected into the page.

import { marked } from 'marked';

export const SCRIPT_EXTENSIONS = ['txt', 'text', 'md', 'markdown', 'mdown', 'mkd', 'mkdn', 'srt', 'vtt', 'fountain', 'rst', 'adoc', 'asciidoc', 'org', 'log'];
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdown', 'mkd', 'mkdn']);
const SUBTITLE_EXTENSIONS = new Set(['srt', 'vtt']);

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z0-9]+);/gi, (m, name) => {
    const lower = name.toLowerCase();
    if (ENTITIES[lower] !== undefined) return ENTITIES[lower];
    if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16) || 32);
    if (lower.startsWith('#')) return String.fromCodePoint(parseInt(lower.slice(1), 10) || 32);
    return m;
  });
}

/** Detect the text encoding of a file buffer and decode it. */
export function decodeBuffer(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

export function formatForPath(filePath) {
  const ext = String(filePath || '').split('.').pop().toLowerCase();
  if (MARKDOWN_EXTENSIONS.has(ext)) return 'markdown';
  if (SUBTITLE_EXTENSIONS.has(ext)) return 'subtitles';
  return 'text';
}

/** Merge adjacent runs with identical styling to keep the DOM small. */
function compactRuns(runs) {
  const out = [];
  for (const r of runs) {
    if (!r.br && !r.text) continue;
    const prev = out[out.length - 1];
    if (prev && !prev.br && !r.br && !!prev.bold === !!r.bold && !!prev.italic === !!r.italic && !!prev.code === !!r.code && !!prev.strike === !!r.strike) {
      prev.text += r.text;
    } else {
      out.push({ ...r });
    }
  }
  // Trim leading/trailing whitespace of the block.
  while (out.length && out[0].br) out.shift();
  while (out.length && out[out.length - 1].br) out.pop();
  if (out.length && !out[0].br) out[0].text = out[0].text.replace(/^\s+/, '');
  if (out.length && !out[out.length - 1].br) out[out.length - 1].text = out[out.length - 1].text.replace(/\s+$/, '');
  return out.filter((r) => r.br || r.text);
}

function inlineRuns(tokens, style = {}) {
  const runs = [];
  for (const tok of tokens || []) {
    switch (tok.type) {
      case 'strong': runs.push(...inlineRuns(tok.tokens, { ...style, bold: true })); break;
      case 'em': runs.push(...inlineRuns(tok.tokens, { ...style, italic: true })); break;
      case 'del': runs.push(...inlineRuns(tok.tokens, { ...style, strike: true })); break;
      case 'codespan': runs.push({ ...style, code: true, text: decodeEntities(tok.text) }); break;
      case 'link': runs.push(...inlineRuns(tok.tokens, style)); break;
      case 'image': if (tok.text) runs.push({ ...style, text: decodeEntities(tok.text) }); break;
      case 'br': runs.push({ br: true, text: '' }); break;
      case 'html': break; // inline HTML tags are dropped; their text content is not part of the tag
      case 'checkbox': break;
      case 'escape': runs.push({ ...style, text: tok.text }); break;
      case 'text':
        if (tok.tokens && tok.tokens.length) runs.push(...inlineRuns(tok.tokens, style));
        else runs.push({ ...style, text: decodeEntities(tok.text).replace(/\n/g, ' ') });
        break;
      default:
        if (tok.tokens) runs.push(...inlineRuns(tok.tokens, style));
        else if (typeof tok.text === 'string') runs.push({ ...style, text: decodeEntities(tok.text) });
    }
  }
  return runs;
}

function walkBlocks(tokens, out, ctx = { depth: 0, quote: false }) {
  for (const tok of tokens || []) {
    switch (tok.type) {
      case 'heading':
        out.push({ type: 'heading', level: tok.depth, runs: compactRuns(inlineRuns(tok.tokens)) });
        break;
      case 'paragraph':
        out.push({ type: ctx.quote ? 'quote' : 'paragraph', runs: compactRuns(inlineRuns(tok.tokens)) });
        break;
      case 'text':
        // Loose text at block level (e.g. inside tight list items).
        out.push({ type: ctx.quote ? 'quote' : 'paragraph', runs: compactRuns(inlineRuns(tok.tokens || [{ type: 'text', text: tok.text }])) });
        break;
      case 'blockquote':
        walkBlocks(tok.tokens, out, { ...ctx, quote: true });
        break;
      case 'list': {
        let number = typeof tok.start === 'number' ? tok.start : 1;
        for (const item of tok.items) {
          const inner = [];
          walkBlocks(item.tokens, inner, { ...ctx, depth: ctx.depth + 1 });
          const [first, ...rest] = inner;
          if (first && first.runs) {
            out.push({ type: 'list-item', ordered: !!tok.ordered, number, depth: ctx.depth, runs: first.runs });
          } else if (first) {
            out.push(first);
          }
          out.push(...rest);
          number++;
        }
        break;
      }
      case 'code':
        out.push({ type: 'code', runs: compactRuns(tok.text.split('\n').flatMap((line, i) => (i ? [{ br: true, text: '' }, { code: true, text: line }] : [{ code: true, text: line }]))) });
        break;
      case 'hr':
        out.push({ type: 'rule' });
        break;
      case 'table': {
        const rowText = (cells) => cells.map((c) => inlineRuns(c.tokens)).flatMap((runs, i) => (i ? [{ text: ' · ' }, ...runs] : runs));
        out.push({ type: 'paragraph', runs: compactRuns(rowText(tok.header)) });
        for (const row of tok.rows) out.push({ type: 'paragraph', runs: compactRuns(rowText(row)) });
        break;
      }
      case 'html': {
        // Keep text inside block HTML, drop the tags and comments.
        const text = decodeEntities(String(tok.text || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ')).trim();
        if (text) out.push({ type: 'paragraph', runs: [{ text }] });
        break;
      }
      case 'space':
      case 'def':
        break;
      default:
        if (tok.tokens) walkBlocks(tok.tokens, out, ctx);
    }
  }
  return out;
}

export function parseMarkdown(text) {
  // Front matter is metadata, not script.
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').replace(/<!--[\s\S]*?-->/g, '');
  const tokens = marked.lexer(body, { gfm: true, breaks: false });
  return walkBlocks(tokens, []).filter((b) => b.type === 'rule' || (b.runs && b.runs.length));
}

export function parsePlainText(text) {
  const blocks = [];
  for (const para of text.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n+/)) {
    const lines = para.split('\n').map((l) => l.replace(/\s+$/, '')).filter((l, i, arr) => l.trim() || (i > 0 && i < arr.length - 1));
    if (!lines.length || !lines.some((l) => l.trim())) continue;
    const runs = [];
    lines.forEach((line, i) => {
      if (i) runs.push({ br: true, text: '' });
      runs.push({ text: line.trim() });
    });
    blocks.push({ type: 'paragraph', runs: compactRuns(runs) });
  }
  return blocks;
}

export function parseSubtitles(text) {
  const blocks = [];
  const cues = text.replace(/\r\n?/g, '\n').replace(/^﻿?WEBVTT[^\n]*\n/, '').split(/\n[ \t]*\n+/);
  for (const cue of cues) {
    const lines = cue.split('\n').filter((l) => l.trim()
      && !/^\d+$/.test(l.trim())
      && !l.includes('-->')
      && !/^(NOTE|STYLE|REGION)\b/.test(l.trim()));
    if (!lines.length || /^(NOTE|STYLE|REGION)\b/.test(cue.trim())) continue;
    const runs = [];
    lines.forEach((line, i) => {
      if (i) runs.push({ br: true, text: '' });
      runs.push({ text: decodeEntities(line.replace(/<[^>]+>/g, '')).trim() });
    });
    blocks.push({ type: 'paragraph', runs: compactRuns(runs) });
  }
  return blocks;
}

/**
 * Parse a script into blocks.
 * @param {string} text
 * @param {'markdown'|'text'|'subtitles'} format
 */
export function parseScript(text, format = 'text') {
  const clean = String(text ?? '').replace(/^﻿/, '');
  if (format === 'markdown') return parseMarkdown(clean);
  if (format === 'subtitles') return parseSubtitles(clean);
  return parsePlainText(clean);
}

/** A short human title for a script: its first heading, else the file name. */
export function scriptTitle(blocks, filePath) {
  const heading = blocks.find((b) => b.type === 'heading');
  if (heading) return heading.runs.map((r) => r.text || '').join('').trim().slice(0, 80);
  if (filePath) return String(filePath).split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
  return 'Untitled script';
}
