import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeChunk, normalizePhrase, phoneticKey, wordSimilarity, editDistance, countWords, describeDuration } from '../../src/core/text.js';
import { cardinal, numberToWords, yearWords } from '../../src/core/numbers.js';

test('normalizes punctuation, case, accents and contractions', () => {
  assert.deepEqual(normalizeChunk('Hello,'), ['hello']);
  assert.deepEqual(normalizeChunk('“Don’t'), ['dont']);
  assert.deepEqual(normalizeChunk('well-known'), ['well', 'known']);
  assert.deepEqual(normalizeChunk('café'), ['cafe']);
  assert.deepEqual(normalizeChunk('—'), []);
  assert.deepEqual(normalizeChunk('(team’s)'), ['teams']);
  assert.deepEqual(normalizeChunk('R&D'), ['r', 'd']);
  assert.deepEqual(normalizeChunk('&'), ['and']);
});

test('spells out numbers the way they are spoken', () => {
  assert.deepEqual(cardinal(0), ['zero']);
  assert.deepEqual(cardinal(42), ['forty', 'two']);
  assert.deepEqual(cardinal(1250), ['one', 'thousand', 'two', 'hundred', 'fifty']);
  assert.deepEqual(yearWords(2024), ['twenty', 'twenty', 'four']);
  assert.deepEqual(yearWords(1999), ['nineteen', 'ninety', 'nine']);
  assert.deepEqual(yearWords(2005), ['two', 'thousand', 'five']);
  assert.deepEqual(numberToWords('2024'), ['twenty', 'twenty', 'four']);
  assert.deepEqual(numberToWords('3rd'), ['third']);
  assert.deepEqual(numberToWords('21st'), ['twenty', 'first']);
  assert.deepEqual(numberToWords('40%'), ['forty', 'percent']);
  assert.deepEqual(numberToWords('$5'), ['five', 'dollars']);
  assert.deepEqual(numberToWords('3.5'), ['three', 'point', 'five']);
  assert.deepEqual(numberToWords('1,000,000'), ['one', 'million']);
  assert.deepEqual(numberToWords('1990s'), ['nineteen', 'nineties']);
  assert.equal(numberToWords('hello'), null);
  assert.deepEqual(normalizeChunk('2024.'), ['twenty', 'twenty', 'four']);
  assert.deepEqual(normalizeChunk('covid-19'), ['covid', 'nineteen']);
});

test('normalizes recognizer output', () => {
  assert.deepEqual(normalizePhrase("GOOD MORNING EVERYONE AND THANK YOU"), ['good', 'morning', 'everyone', 'and', 'thank', 'you']);
  assert.deepEqual(normalizePhrase("  IT'S   "), ['its']);
  assert.deepEqual(normalizePhrase(''), []);
});

test('phonetic keys group likely recognizer confusions', () => {
  assert.equal(phoneticKey('their'), phoneticKey('there'));
  assert.equal(phoneticKey('invoice'), phoneticKey('envoice'));
  assert.equal(phoneticKey('phone'), phoneticKey('fone'));
  assert.notEqual(phoneticKey('cat'), phoneticKey('dog'));
});

test('word similarity', () => {
  assert.equal(wordSimilarity('team', 'team'), 1);
  assert.ok(wordSimilarity('there', 'their') >= 0.7);
  assert.ok(wordSimilarity('customers', 'customer') >= 0.6);
  assert.ok(wordSimilarity('experience', 'experiance') >= 0.6);
  assert.equal(wordSimilarity('cat', 'dog'), 0);
  assert.equal(wordSimilarity('the', 'a'), 0);
});

test('edit distance', () => {
  assert.equal(editDistance('kitten', 'sitting'), 3);
  assert.equal(editDistance('', 'abc'), 3);
  assert.equal(editDistance('same', 'same'), 0);
  assert.ok(editDistance('abcdefgh', 'zzzzzzzz', 2) > 2);
});

test('counts words', () => {
  assert.equal(countWords('Hello, world — it’s 2024!'), 4);
  assert.equal(countWords(''), 0);
});

test('describes reading time the same way everywhere', () => {
  assert.equal(describeDuration(0), 'under a minute');
  assert.equal(describeDuration(0.99), 'under a minute');
  assert.equal(describeDuration(Number.NaN), 'under a minute');
  assert.equal(describeDuration(1), 'about 1 min');
  assert.equal(describeDuration(4.4), 'about 4 min');
  assert.equal(describeDuration(59.4), 'about 59 min');
  assert.equal(describeDuration(60), 'about 1 h');
  assert.equal(describeDuration(75.2), 'about 1 h 15 min');
});
