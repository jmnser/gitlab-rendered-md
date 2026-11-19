import { MARKDOWN_FILE } from '../lib/page.js';

/*
 * All selectors for GitLab's merge request "Changes" tab live here. GitLab's
 * markup changes between versions; adjust this module when it does.
 */

/** Changed Markdown files currently in the DOM, as `{ el, path }`. */
export function findMarkdownDiffFiles(doc) {
  const out = [];
  const seen = new Set();
  for (const el of doc.querySelectorAll('.diff-file[data-path], [data-testid="file-holder-container"]')) {
    if (seen.has(el)) continue;
    seen.add(el);
    const path = el.getAttribute('data-path') || titlePath(el);
    if (path && MARKDOWN_FILE.test(path)) out.push({ el, path });
  }
  return out;
}

function titlePath(el) {
  const title = el.querySelector('.file-title-name');
  return (title?.getAttribute('data-title') || title?.getAttribute('title') || title?.textContent || '').trim();
}

/** The element the "Rendered" toggle is placed in. */
export function toggleContainer(fileEl) {
  const header = fileEl.querySelector('.js-file-title, .file-title, .file-title-flex-parent');
  if (!header) return null;
  return header.querySelector('.file-actions') ?? header;
}

/** GitLab's own diff body, hidden while the rendered view is active. */
export function diffContent(fileEl) {
  return fileEl.querySelector('.diff-content');
}

/** The CSRF token GitLab embeds for same-origin writes. */
export function csrfToken(doc) {
  return doc.querySelector('meta[name="csrf-token"]')?.getAttribute('content') ?? '';
}
