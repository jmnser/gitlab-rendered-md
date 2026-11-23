import { diffSequences } from './lcs.js';

/** Elements whose children are diffed one by one instead of as a whole. */
const CONTAINERS = new Set(['UL', 'OL', 'BLOCKQUOTE', 'TABLE', 'THEAD', 'TBODY', 'LI', 'DETAILS', 'SECTION']);

/** Block-level elements a comment can be attached to. Table cells resolve to their row. */
export const COMMENTABLE = new Set([
  'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'BLOCKQUOTE', 'TABLE', 'TR',
  'UL', 'OL', 'DIV', 'DETAILS', 'SUMMARY', 'HR', 'DL', 'DT', 'DD', 'SECTION',
]);

const MAX_WORD_CELLS = 250_000;

/**
 * Diffs two rendered Markdown trees block by block and returns a new element
 * that shows both versions merged:
 *
 * - unchanged blocks: copied from the new version
 * - added blocks: class `rmd-added`
 * - removed blocks: class `rmd-removed`
 * - changed blocks: the old block followed by the new block, with changed
 *   words wrapped in `rmd-word-del` / `rmd-word-ins`
 *
 * Every emitted block carries `data-rmd-side="old|new"`, so its
 * `data-sourcepos` can be resolved against the right file version.
 */
export function renderDiff(oldRoot, newRoot, doc) {
  const out = doc.createElement('div');
  out.className = 'rmd-diff';
  diffInto(elementChildren(oldRoot), elementChildren(newRoot), out, doc);
  return out;
}

function elementChildren(el) {
  return Array.from(el.children);
}

/** Element children, or null if the element also holds non-whitespace text. */
function blockChildren(el) {
  const out = [];
  for (const node of el.childNodes) {
    if (node.nodeType === 1) out.push(node);
    else if (node.nodeType === 3 && node.textContent.trim() !== '') return null;
  }
  return out;
}

const keyCache = new WeakMap();

/**
 * Comparison key: the element's HTML without attributes that change when
 * unrelated parts of the document change: source positions, generated ids
 * (headings, footnotes) and links to footnote ids.
 */
function keyOf(el) {
  let key = keyCache.get(el);
  if (key === undefined) {
    const clone = el.cloneNode(true);
    for (const d of [clone, ...clone.querySelectorAll('*')]) {
      d.removeAttribute('data-sourcepos');
      d.removeAttribute('id');
      if (/^#fn/.test(d.getAttribute('href') ?? '')) d.removeAttribute('href');
    }
    key = clone.outerHTML;
    keyCache.set(el, key);
  }
  return key;
}

function diffInto(olds, news, out, doc) {
  const ops = diffSequences(olds.map(keyOf), news.map(keyOf));
  let dels = [];
  let ins = [];
  const flush = () => {
    emitChange(dels.map((i) => olds[i]), ins.map((j) => news[j]), out, doc);
    dels = [];
    ins = [];
  };
  for (const op of ops) {
    if (op.type === 'equal') {
      flush();
      out.append(mark(news[op.b].cloneNode(true), 'new', 'rmd-same'));
    } else if (op.type === 'delete') {
      dels.push(op.a);
    } else {
      ins.push(op.b);
    }
  }
  flush();
}

/** Emits a run of removed and added blocks, pairing similar ones as "changed". */
function emitChange(dels, ins, out, doc) {
  if (dels.length === 0 && ins.length === 0) return;

  // Greedy in-order pairing of removed and added blocks with the same tag.
  const pairOf = new Array(ins.length).fill(-1);
  let lastDel = -1;
  for (let j = 0; j < ins.length; j++) {
    for (let i = lastDel + 1; i < dels.length; i++) {
      if (isPair(dels[i], ins[j])) {
        pairOf[j] = i;
        lastDel = i;
        break;
      }
    }
  }

  let nextDel = 0;
  const emitDelsBefore = (limit) => {
    while (nextDel < limit) out.append(openDetails(mark(dels[nextDel++].cloneNode(true), 'old', 'rmd-removed')));
  };
  for (let j = 0; j < ins.length; j++) {
    const i = pairOf[j];
    if (i === -1) {
      // Removed blocks are shown before added ones, up to the next pair.
      const nextPair = pairOf.slice(j + 1).find((p) => p !== -1);
      emitDelsBefore(nextPair === undefined ? dels.length : nextPair);
      out.append(openDetails(mark(ins[j].cloneNode(true), 'new', 'rmd-added')));
      continue;
    }
    emitDelsBefore(i);
    nextDel = i + 1;
    emitPair(dels[i], ins[j], out, doc);
  }
  emitDelsBefore(dels.length);
}

function isPair(oldEl, newEl) {
  if (oldEl.tagName !== newEl.tagName) return false;
  // Containers are diffed item by item, so unrelated ones still come out right.
  if (CONTAINERS.has(newEl.tagName)) return true;
  return similarity(oldEl.textContent, newEl.textContent) >= 0.4;
}

function emitPair(oldEl, newEl, out, doc) {
  if (CONTAINERS.has(newEl.tagName)) {
    const oldKids = blockChildren(oldEl);
    const newKids = blockChildren(newEl);
    if (oldKids && newKids && (oldKids.length > 0 || newKids.length > 0)) {
      const shell = mark(newEl.cloneNode(false), 'new', 'rmd-container');
      diffInto(oldKids, newKids, shell, doc);
      if (shell.tagName === 'DETAILS') shell.open = true; // Show the changes inside.
      out.append(shell);
      return;
    }
  }
  const o = mark(oldEl.cloneNode(true), 'old', 'rmd-removed');
  const n = mark(newEl.cloneNode(true), 'new', 'rmd-added');
  markWordChanges(o, n, doc);
  out.append(openDetails(o), openDetails(n));
}

function openDetails(el) {
  if (el.tagName === 'DETAILS') el.open = true;
  return el;
}

function mark(el, side, cls) {
  el.classList.add(cls);
  el.setAttribute('data-rmd-side', side);
  return el;
}

const WORD = /[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu;

function words(text) {
  return text.match(WORD) ?? [];
}

/** Word-set similarity in [0, 1]. Two texts without words count as similar. */
export function similarity(a, b) {
  const wa = new Set(words(a.toLowerCase()));
  const wb = new Set(words(b.toLowerCase()));
  if (wa.size === 0 && wb.size === 0) return 1;
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  return common / (wa.size + wb.size - common);
}

function textSegments(el, doc) {
  const segs = [];
  let text = '';
  const walker = doc.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    segs.push({ node, start: text.length, end: text.length + node.data.length });
    text += node.data;
  }
  return { segs, text };
}

function tokens(text) {
  const out = [];
  for (const m of text.matchAll(WORD)) out.push({ t: m[0], s: m.index, e: m.index + m[0].length });
  return out;
}

/** Wraps changed words of a changed block pair in highlight spans. */
export function markWordChanges(oldEl, newEl, doc) {
  const o = textSegments(oldEl, doc);
  const n = textSegments(newEl, doc);
  const ot = tokens(o.text);
  const nt = tokens(n.text);
  if (ot.length * nt.length > MAX_WORD_CELLS) return;
  const ops = diffSequences(ot.map((x) => x.t), nt.map((x) => x.t));
  wrapRanges(o.segs, collectRanges(ops, 'delete', 'a', ot), 'rmd-word-del', doc);
  wrapRanges(n.segs, collectRanges(ops, 'insert', 'b', nt), 'rmd-word-ins', doc);
}

/** Merges runs of consecutive changed tokens into character ranges. */
function collectRanges(ops, type, idx, toks) {
  const ranges = [];
  let current = null;
  for (const op of ops) {
    if (op.type === type) {
      const tok = toks[op[idx]];
      if (current) current.e = tok.e;
      else current = { s: tok.s, e: tok.e };
    } else if (op.type === 'equal' && current) {
      ranges.push(current);
      current = null;
    }
  }
  if (current) ranges.push(current);
  return ranges;
}

function wrapRanges(segs, ranges, cls, doc) {
  if (ranges.length === 0) return;
  for (const { node, start, end } of segs) {
    const local = [];
    for (const r of ranges) {
      if (r.s < end && r.e > start) local.push([Math.max(r.s, start) - start, Math.min(r.e, end) - start]);
    }
    // Right to left, so earlier offsets stay valid in the shrinking node.
    for (let k = local.length - 1; k >= 0; k--) {
      const [a, b] = local[k];
      if (b <= a) continue;
      if (b < node.data.length) node.splitText(b);
      const mid = a > 0 ? node.splitText(a) : node;
      if (mid.data.trim() === '') continue;
      const span = doc.createElement('span');
      span.className = cls;
      mid.replaceWith(span);
      span.append(mid);
      if (mid === node) break;
    }
  }
}
