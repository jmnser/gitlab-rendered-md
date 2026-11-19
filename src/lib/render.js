import createDOMPurify from 'dompurify';

const ABSOLUTE_OR_ANCHOR = /^([a-z][a-z0-9+.-]*:|\/|#|\?)/i;

/**
 * Parses HTML returned by GitLab's Markdown API into a detached root element.
 *
 * GitLab sanitizes this HTML server-side. It is sanitized again here, as
 * GitLab's own frontend does, before it is inserted into the page.
 * `data-*` attributes such as `data-sourcepos` are kept.
 */
export function parseRenderedHtml(html, win) {
  const purify = createDOMPurify(win);
  return purify.sanitize(html, { RETURN_DOM: true, ALLOW_DATA_ATTR: true });
}

/** Gives lazy-loaded images and videos their real `src`. */
export function activateLazyMedia(root) {
  for (const el of root.querySelectorAll('img[data-src], video[data-src], source[data-src]')) {
    el.setAttribute('src', el.getAttribute('data-src'));
    el.removeAttribute('data-src');
    el.classList.remove('lazy');
  }
  return root;
}

/**
 * Resolves relative links and images of a rendered diff against the file in
 * the repository. The Markdown API has no file context, so `other.md` or
 * `img/a.png` would otherwise resolve against the merge request page.
 *
 * Runs after diffing, so that both versions compare equal regardless of the
 * commit SHA. Each element uses the side (`data-rmd-side`) it belongs to.
 *
 * sides: { old: { sha, filePath }, new: { sha, filePath } }
 */
export function resolveRelativeUrls(diff, { webBase, projectPath, sides }) {
  const resolve = (el, attr, kind) => {
    const value = el.getAttribute(attr);
    if (!value || ABSOLUTE_OR_ANCHOR.test(value)) return;
    const side = el.closest('[data-rmd-side]')?.getAttribute('data-rmd-side') === 'old' ? sides.old : sides.new;
    try {
      el.setAttribute(attr, new URL(value, `${webBase}/${projectPath}/-/${kind}/${side.sha}/${side.filePath}`).href);
    } catch {
      // Leave unparsable URLs as they are.
    }
  };
  for (const el of diff.querySelectorAll('img[src], video[src], source[src]')) resolve(el, 'src', 'raw');
  for (const el of diff.querySelectorAll('a[href]')) resolve(el, 'href', 'blob');
  return diff;
}
