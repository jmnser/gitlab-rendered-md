import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLineMap, localHunks, parseSourcepos, parseUnifiedDiff, pickCommentLines } from '../src/lib/linemap.js';

// old: a b c d e f g h i j  ->  new: a b C d e f g h X i j   (c changed, X inserted)
const DIFF = [
  '@@ -1,5 +1,5 @@',
  ' a',
  ' b',
  '-c',
  '+C',
  ' d',
  ' e',
  '@@ -7,3 +7,4 @@',
  ' g',
  ' h',
  '+X',
  ' i',
  '\\ No newline at end of file',
  '',
].join('\n');

test('parses hunks and builds the line map', () => {
  const map = buildLineMap(parseUnifiedDiff(DIFF));
  assert.deepEqual([...map.added], [3, 9]);
  assert.deepEqual([...map.removed], [3]);
  assert.equal(map.newToOld(2), 2);
  assert.equal(map.newToOld(3), null);
  assert.equal(map.newToOld(6), 6); // between hunks
  assert.equal(map.newToOld(10), 9); // inside second hunk
  assert.equal(map.newToOld(11), 10); // after the last hunk
  assert.equal(map.oldToNew(10), 11);
  assert.equal(map.oldToNew(3), null);
});

test('handles new files and pure deletions', () => {
  const created = buildLineMap(parseUnifiedDiff('@@ -0,0 +1,2 @@\n+a\n+b\n'));
  assert.deepEqual([...created.added], [1, 2]);

  // old: 1 2 3 4 5 -> new: 1 2 5
  const deleted = buildLineMap(parseUnifiedDiff('@@ -3,2 +2,0 @@\n-3\n-4\n'));
  assert.equal(deleted.newToOld(3), 5);
  assert.equal(deleted.oldToNew(5), 3);
  assert.equal(deleted.oldToNew(2), 2);
});

test('treats empty lines inside a hunk as context', () => {
  const map = buildLineMap(parseUnifiedDiff('@@ -1,3 +1,3 @@\n a\n\n-b\n+B\n'));
  assert.equal(map.newToOld(2), 2);
  assert.deepEqual([...map.added], [3]);
});

test('local hunks match a computed diff', () => {
  const map = buildLineMap(localHunks('a\nb\nc\n', 'a\nB\nc\nd\n'));
  assert.deepEqual([...map.added].sort(), [2, 4]);
  assert.deepEqual([...map.removed], [2]);
  assert.equal(map.newToOld(3), 3);
});

test('parses data-sourcepos', () => {
  assert.deepEqual(parseSourcepos('3:1-5:12'), { start: 3, end: 5 });
  assert.equal(parseSourcepos('garbage'), null);
  assert.equal(parseSourcepos(null), null);
});

test('picks comment lines', () => {
  const map = buildLineMap(parseUnifiedDiff(DIFF));
  // Block covering lines 2-3 on the new side: line 3 was added.
  assert.deepEqual(pickCommentLines({ side: 'new', start: 2, end: 3, map, maxLine: 11 }), { new_line: 3 });
  // Unchanged block: both line numbers.
  assert.deepEqual(pickCommentLines({ side: 'new', start: 10, end: 11, map, maxLine: 11 }), { old_line: 10, new_line: 11 });
  // Removed block on the old side.
  assert.deepEqual(pickCommentLines({ side: 'old', start: 3, end: 3, map, maxLine: 10 }), { old_line: 3 });
  // End line beyond the file is clamped.
  assert.deepEqual(pickCommentLines({ side: 'new', start: 11, end: 14, map, maxLine: 11 }), { old_line: 10, new_line: 11 });
});
