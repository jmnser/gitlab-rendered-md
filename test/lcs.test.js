import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffSequences } from '../src/lib/lcs.js';

const summary = (ops) => ops.map((o) => o.type[0]).join('');

test('equal sequences', () => {
  assert.equal(summary(diffSequences(['a', 'b'], ['a', 'b'])), 'ee');
});

test('insert, delete and replace', () => {
  assert.equal(summary(diffSequences(['a', 'c'], ['a', 'b', 'c'])), 'eie');
  assert.equal(summary(diffSequences(['a', 'b', 'c'], ['a', 'c'])), 'ede');
  assert.equal(summary(diffSequences(['a', 'x', 'c'], ['a', 'y', 'c'])), 'edie');
});

test('indexes point into both inputs', () => {
  const ops = diffSequences(['a', 'b', 'c', 'd'], ['b', 'c', 'e', 'd']);
  assert.deepEqual(
    ops.filter((o) => o.type === 'equal').map((o) => [o.a, o.b]),
    [[1, 0], [2, 1], [3, 3]],
  );
});

test('falls back to full replacement above the cell limit', () => {
  const ops = diffSequences(['a', 'b', 'c'], ['x', 'b', 'y'], 1);
  assert.equal(summary(ops), 'dddiii');
});
