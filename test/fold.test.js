import assert from 'node:assert/strict';
import { test } from 'node:test';
import { foldPlan } from '../src/lib/fold.js';

const same = (span, extra = {}) => ({ changed: false, span, heading: false, keep: false, ...extra });
const changed = { changed: true, span: 1, heading: false, keep: false };

test('shows everything when context is 0 or nothing changed', () => {
  assert.deepEqual(foldPlan([same(5), changed], 0), [true, true]);
  assert.deepEqual(foldPlan([same(5), same(5)], 20), [true, true]);
});

test('shows unchanged blocks within the context on both sides', () => {
  const items = [same(10), same(10), same(10), changed, same(10), same(10), same(10)];
  assert.deepEqual(foldPlan(items, 20), [false, true, true, true, true, true, false]);
});

test('always shows the first neighbour of a change, even if it is long', () => {
  assert.deepEqual(foldPlan([same(5), same(200), changed], 20), [false, true, true]);
});

test('keeps the nearest heading above a change and blocks marked keep', () => {
  const items = [
    same(1, { heading: true }),
    same(1, { heading: true }),
    same(50),
    changed,
    same(50),
    same(50),
    same(1, { keep: true }),
  ];
  assert.deepEqual(foldPlan(items, 20), [false, true, true, true, true, false, true]);
});
