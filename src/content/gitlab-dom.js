import { MARKDOWN_FILE } from '../lib/page.js';

/*
 * All selectors for GitLab's merge request "Changes" tab live here. GitLab's
 * markup changes between versions; adjust this module when it does.
 *
 * Two diff views exist:
 * - Rapid Diffs (default from GitLab 19): `<diff-file data-file-data="{json}">`
 *   with `.rd-diff-file-header` and `.rd-diff-file-body`.
 * - Classic diffs (Vue app): `.diff-file[data-path]` with `.file-title`,
 *   `.file-actions` and `.diff-content`.
 */

const FILE_SELECTOR = 'diff-file[data-file-data], .diff-file[data-path]';

/** Changed Markdown files currently in the DOM, as `{ el, path }`. */
export function findMarkdownDiffFiles(doc) {
  const out = [];
  for (const el of doc.querySelectorAll(FILE_SELECTOR)) {
    const path = filePath(el);
    if (path && MARKDOWN_FILE.test(path)) out.push({ el, path });
  }
  return out;
}

/** The new path of a diff file element. */
export function filePath(el) {
  if (el.hasAttribute('data-path')) return el.getAttribute('data-path');
  try {
    const data = JSON.parse(el.getAttribute('data-file-data'));
    return data.new_path || data.old_path || '';
  } catch {
    return '';
  }
}

/** The element the "Rendered" toggle is prepended to. */
export function toggleContainer(fileEl) {
  const rapid = fileEl.querySelector('.rd-diff-file-header .rd-diff-file-info');
  if (rapid) return rapid;
  const header = fileEl.querySelector('.js-file-title, .file-title, .file-title-flex-parent');
  if (!header) return null;
  return header.querySelector('.file-actions') ?? header;
}

/** GitLab's own diff body; the rendered panel is placed after it and it is hidden while active. */
export function diffContent(fileEl) {
  return fileEl.querySelector('.rd-diff-file-body, .diff-content');
}

/** The CSRF token GitLab embeds for same-origin writes. */
export function csrfToken(doc) {
  return doc.querySelector('meta[name="csrf-token"]')?.getAttribute('content') ?? '';
}
