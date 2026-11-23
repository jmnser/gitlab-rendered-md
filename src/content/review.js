import { COMMENTABLE, renderDiff } from '../lib/blockdiff.js';
import { foldPlan } from '../lib/fold.js';
import { parseSourcepos, pickCommentLines } from '../lib/linemap.js';

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Creates the empty panel that replaces GitLab's raw diff of one file. */
export function createPanel(doc, path) {
  const root = el(doc, 'div', 'rmd-panel');
  root.setAttribute('data-rmd-path', path);
  const bar = el(doc, 'div', 'rmd-toolbar');
  bar.append(
    el(doc, 'span', 'rmd-legend rmd-legend-added', 'Added'),
    el(doc, 'span', 'rmd-legend rmd-legend-removed', 'Removed'),
    el(doc, 'span', 'rmd-hint', 'Click a paragraph to comment on it.'),
  );
  const fullToggle = el(doc, 'button', 'btn btn-default btn-sm gl-button rmd-full-toggle', 'Full file');
  fullToggle.type = 'button';
  fullToggle.hidden = true;
  fullToggle.setAttribute('aria-pressed', 'false');
  bar.querySelector('.rmd-hint').before(fullToggle);
  const status = el(doc, 'div', 'rmd-status', 'Rendering…');
  const body = el(doc, 'div', 'md rmd-body');
  root.append(bar, status, body);
  fullToggle.addEventListener('click', () => {
    const full = !body.classList.contains('rmd-full');
    body.classList.toggle('rmd-full', full);
    fullToggle.setAttribute('aria-pressed', String(full));
  });
  return { root, status, body, fullToggle, hint: bar.querySelector('.rmd-hint') };
}

export function setStatus(ui, text, isError = false) {
  ui.status.textContent = text;
  ui.status.hidden = !text;
  ui.status.classList.toggle('rmd-error', isError);
}

/**
 * Renders the merged diff of one file into the panel and wires up commenting.
 *
 * model:
 *   oldRoot, newRoot   parsed rendered HTML of both versions
 *   map                line map from linemap.buildLineMap
 *   oldLineCount, newLineCount
 *   threads            from threads.fileThreads
 *   noteUrl(noteId)    link to a note in GitLab
 *   finishDiff(diff)   post-processing of the merged diff (URL resolution)
 *   commentsDisabled   reason why commenting is off, or empty
 *   contextLines       unchanged source lines shown around changes; 0 shows the full file
 * postComment(lines, text) -> Promise<discussion>
 */
export function showReview(doc, ui, model, postComment) {
  const diff = renderDiff(model.oldRoot, model.newRoot, doc);
  model.finishDiff?.(diff);
  ui.body.replaceChildren(diff);
  if (model.commentsDisabled) {
    ui.hint.textContent = model.commentsDisabled;
    diff.classList.add('rmd-readonly');
  }
  if (diff.childElementCount === 0) setStatus(ui, 'Both versions are empty.');

  const unplaced = [];
  for (const t of model.threads) {
    const block = findBlockForLine(diff, t.side, t.line);
    const box = renderThread(doc, t.discussion, model.noteUrl);
    if (block) insertNear(block, box, diff);
    else unplaced.push(box);
  }
  if (unplaced.length) {
    const section = el(doc, 'div', 'rmd-unplaced');
    section.append(el(doc, 'div', 'rmd-unplaced-title', 'Comments on lines without a rendered block'), ...unplaced);
    diff.append(section);
  }
  foldUnchanged(doc, ui, diff, model.contextLines ?? 0);

  let hovered = null;
  const setHover = (block) => {
    if (hovered === block) return;
    hovered?.classList.remove('rmd-hover');
    hovered = block;
    hovered?.classList.add('rmd-hover');
  };
  if (model.commentsDisabled) return;
  diff.addEventListener('mouseover', (ev) => setHover(isInteractive(ev.target) ? null : blockAt(ev.target, diff)?.block ?? null));
  diff.addEventListener('mouseleave', () => setHover(null));

  diff.addEventListener('click', (ev) => {
    if (isInteractive(ev.target)) return;
    if (String(doc.getSelection?.() ?? '').trim() !== '') return; // Selecting text, not commenting.
    const hit = blockAt(ev.target, diff);
    if (!hit) return;
    const range = parseSourcepos(hit.block.getAttribute('data-sourcepos'));
    if (!range) return;
    const lines = pickCommentLines({
      side: hit.side,
      ...range,
      map: model.map,
      maxLine: hit.side === 'old' ? model.oldLineCount : model.newLineCount,
    });
    openForm(doc, diff, hit.block, lines, model, postComment);
  });
}

const CHANGED = ['rmd-added', 'rmd-removed', 'rmd-container'];

/** Hides unchanged top-level blocks far from any change behind "Show N unchanged lines" bars. */
function foldUnchanged(doc, ui, diff, contextLines) {
  const children = Array.from(diff.children);
  const items = children.map((node, i) => {
    const range = parseSourcepos(node.getAttribute('data-sourcepos'));
    return {
      changed: CHANGED.some((c) => node.classList.contains(c)),
      span: range ? range.end - range.start + 1 : 0,
      heading: /^H[1-6]$/.test(node.tagName),
      // Threads, the unplaced-comments section, and blocks that carry a thread.
      keep:
        !node.hasAttribute('data-rmd-side') ||
        !!node.querySelector('.rmd-thread') ||
        !!children[i + 1]?.classList.contains('rmd-thread'),
    };
  });
  const visible = foldPlan(items, contextLines);

  let folds = 0;
  for (let i = 0; i < children.length; ) {
    if (visible[i]) {
      i++;
      continue;
    }
    const run = [];
    let lines = 0;
    for (; i < children.length && !visible[i]; i++) {
      run.push(children[i]);
      lines += items[i].span;
    }
    const expand = el(doc, 'button', 'rmd-expand', `Show ${lines} unchanged line${lines === 1 ? '' : 's'}`);
    expand.type = 'button';
    expand.addEventListener('click', () => {
      for (const node of run) node.classList.remove('rmd-folded');
      expand.remove();
    });
    run[0].before(expand);
    for (const node of run) node.classList.add('rmd-folded');
    folds++;
  }
  ui.fullToggle.hidden = folds === 0;
}

function isInteractive(target) {
  return !target?.closest || !!target.closest('a, button, input, textarea, select, summary, label, .rmd-form, .rmd-thread, .rmd-unplaced');
}

/** The innermost commentable block under a click target, and its side. */
function blockAt(target, diff) {
  const sideEl = target.closest?.('[data-rmd-side]');
  if (!sideEl || !diff.contains(sideEl)) return null;
  const side = sideEl.getAttribute('data-rmd-side');
  for (let node = target; node; node = node.parentElement) {
    if (node.hasAttribute('data-sourcepos') && COMMENTABLE.has(node.tagName)) return { block: node, side };
    if (node === sideEl) break;
  }
  return sideEl.hasAttribute('data-sourcepos') ? { block: sideEl, side } : null;
}

/** The smallest rendered block on `side` whose source range contains `line`. */
export function findBlockForLine(diff, side, line) {
  let best = null;
  let bestSize = Infinity;
  for (const node of diff.querySelectorAll('[data-sourcepos]')) {
    if (!COMMENTABLE.has(node.tagName)) continue;
    if (node.closest('[data-rmd-side]')?.getAttribute('data-rmd-side') !== side) continue;
    const r = parseSourcepos(node.getAttribute('data-sourcepos'));
    if (!r || line < r.start || line > r.end) continue;
    const size = r.end - r.start;
    if (size <= bestSize) {
      best = node;
      bestSize = size;
    }
  }
  return best;
}

/** Inserts UI next to a block without breaking list or table markup. */
function insertNear(block, node, diff) {
  const table = block.closest('table');
  if (table && diff.contains(table)) table.after(node);
  else if (block.tagName === 'LI') block.append(node);
  else block.after(node);
}

function renderThread(doc, discussion, noteUrl) {
  const box = el(doc, 'div', 'rmd-thread');
  const notes = (discussion.notes ?? []).filter((n) => !n.system);
  if (notes[0]?.resolved) box.classList.add('rmd-resolved');
  for (const note of notes) {
    const row = el(doc, 'div', 'rmd-note');
    row.append(
      el(doc, 'strong', 'rmd-note-author', note.author?.name ?? note.author?.username ?? 'Unknown'),
      el(doc, 'div', 'rmd-note-body', note.body ?? ''),
    );
    box.append(row);
  }
  if (notes[0]) {
    const link = el(doc, 'a', 'rmd-note-link', notes[0].resolved ? 'Resolved · open in GitLab' : 'Open in GitLab');
    link.href = noteUrl(notes[0].id);
    box.append(link);
  }
  return box;
}

function describeLines(lines) {
  if (lines.new_line != null) return `line ${lines.new_line}`;
  return `removed line ${lines.old_line}`;
}

function openForm(doc, diff, block, lines, model, postComment) {
  const open = diff.querySelector('.rmd-form');
  if (open) {
    const draft = open.querySelector('textarea');
    if (draft.value.trim() !== '') {
      // Keep an unsent draft; it has to be sent or cancelled first.
      draft.focus();
      return;
    }
    open.remove();
  }
  diff.querySelector('.rmd-selected')?.classList.remove('rmd-selected');
  block.classList.add('rmd-selected');

  const form = el(doc, 'form', 'rmd-form');
  const label = el(doc, 'div', 'rmd-form-label', `Comment on ${describeLines(lines)}`);
  const textarea = el(doc, 'textarea', 'form-control rmd-textarea');
  textarea.rows = 4;
  textarea.placeholder = 'Write a comment (Markdown). Ctrl+Enter to submit.';
  const error = el(doc, 'div', 'rmd-error');
  error.hidden = true;
  const buttons = el(doc, 'div', 'rmd-form-buttons');
  const submit = el(doc, 'button', 'btn btn-confirm btn-sm gl-button', 'Comment');
  submit.type = 'submit';
  const cancel = el(doc, 'button', 'btn btn-default btn-sm gl-button', 'Cancel');
  cancel.type = 'button';
  buttons.append(submit, cancel);
  form.append(label, textarea, error, buttons);

  const close = () => {
    form.remove();
    block.classList.remove('rmd-selected');
  };
  cancel.addEventListener('click', close);
  textarea.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      form.requestSubmit();
    } else if (ev.key === 'Escape') {
      close();
    }
  });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const text = textarea.value.trim();
    if (!text) return;
    submit.disabled = true;
    error.hidden = true;
    try {
      const discussion = await postComment(lines, text);
      block.classList.remove('rmd-selected');
      form.replaceWith(renderThread(doc, discussion, model.noteUrl));
    } catch (e) {
      error.textContent = e.message;
      error.hidden = false;
      submit.disabled = false;
    }
  });

  insertNear(block, form, diff);
  textarea.focus();
}
