import { diffSequences } from './lcs.js';

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parses a unified diff (as returned by the GitLab API in `diff`) into hunks.
 * Each hunk lists its lines with old and new line numbers, and the line
 * numbers that follow the hunk on each side (`oldNext`, `newNext`).
 */
export function parseUnifiedDiff(diff) {
  const hunks = [];
  let hunk = null;
  let o = 0;
  let n = 0;
  for (const line of diff.split('\n')) {
    const m = HUNK_HEADER.exec(line);
    if (m) {
      const oldStart = Number(m[1]);
      const oldCount = m[2] === undefined ? 1 : Number(m[2]);
      const newStart = Number(m[3]);
      const newCount = m[4] === undefined ? 1 : Number(m[4]);
      // A count of 0 means the start number is the line *before* the hunk.
      o = oldCount === 0 ? oldStart + 1 : oldStart;
      n = newCount === 0 ? newStart + 1 : newStart;
      hunk = { oldEnd: o + oldCount, newEnd: n + newCount, lines: [], oldNext: o, newNext: n };
      hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;
    const c = line[0];
    if (c === '+') hunk.lines.push({ type: 'add', newLine: n++ });
    else if (c === '-') hunk.lines.push({ type: 'del', oldLine: o++ });
    else if (c === ' ' || (line === '' && o < hunk.oldEnd && n < hunk.newEnd)) {
      // Some producers strip the leading space of empty context lines.
      hunk.lines.push({ type: 'context', oldLine: o++, newLine: n++ });
    }
    // "\ No newline at end of file" and trailing empty lines are ignored.
    hunk.oldNext = o;
    hunk.newNext = n;
  }
  return hunks;
}

export function splitLines(text) {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Computes hunks locally from both file versions. Used when GitLab returns
 * no diff text (for example for files it considers too large).
 */
export function localHunks(oldText, newText) {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const lines = diffSequences(a, b).map((op) => {
    if (op.type === 'equal') return { type: 'context', oldLine: op.a + 1, newLine: op.b + 1 };
    if (op.type === 'delete') return { type: 'del', oldLine: op.a + 1 };
    return { type: 'add', newLine: op.b + 1 };
  });
  return [{ lines, oldNext: a.length + 1, newNext: b.length + 1 }];
}

/**
 * Builds a bidirectional line map from hunks. Lines outside hunks are
 * unchanged and shifted by the offset of the preceding hunk.
 */
export function buildLineMap(hunks) {
  const added = new Set();
  const removed = new Set();
  const newToOldMap = new Map();
  const oldToNewMap = new Map();
  for (const h of hunks) {
    for (const l of h.lines) {
      if (l.type === 'add') added.add(l.newLine);
      else if (l.type === 'del') removed.add(l.oldLine);
      else {
        newToOldMap.set(l.newLine, l.oldLine);
        oldToNewMap.set(l.oldLine, l.newLine);
      }
    }
  }

  return {
    added,
    removed,
    newToOld(line) {
      if (added.has(line)) return null;
      if (newToOldMap.has(line)) return newToOldMap.get(line);
      let delta = 0;
      for (const h of hunks) {
        if (h.newNext > line) break;
        delta = h.oldNext - h.newNext;
      }
      return line + delta;
    },
    oldToNew(line) {
      if (removed.has(line)) return null;
      if (oldToNewMap.has(line)) return oldToNewMap.get(line);
      let delta = 0;
      for (const h of hunks) {
        if (h.oldNext > line) break;
        delta = h.newNext - h.oldNext;
      }
      return line + delta;
    },
  };
}

/** Parses `data-sourcepos="3:1-5:12"` into `{ start: 3, end: 5 }`. */
export function parseSourcepos(value) {
  const m = /^(\d+):\d+-(\d+):\d+$/.exec(value ?? '');
  if (!m) return null;
  return { start: Number(m[1]), end: Number(m[2]) };
}

/**
 * Chooses the diff line a comment on a rendered block is anchored to.
 *
 * - New side: the last added line within the block, otherwise the block's
 *   last line as an unchanged line (both old and new line numbers).
 * - Old side (removed block): the last removed line within the block,
 *   otherwise the block's last line as an unchanged line.
 *
 * Returns `{ new_line?, old_line? }` as expected by the GitLab position API.
 */
export function pickCommentLines({ side, start, end, map, maxLine }) {
  const last = Math.max(1, Math.min(end, maxLine || end));
  const first = Math.min(start, last);
  if (side === 'old') {
    for (let l = last; l >= first; l--) if (map.removed.has(l)) return { old_line: l };
    const n = map.oldToNew(last);
    return n == null ? { old_line: last } : { old_line: last, new_line: n };
  }
  for (let l = last; l >= first; l--) if (map.added.has(l)) return { new_line: l };
  const o = map.newToOld(last);
  return o == null ? { new_line: last } : { old_line: o, new_line: last };
}
