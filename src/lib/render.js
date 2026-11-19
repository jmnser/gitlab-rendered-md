const ABSOLUTE_OR_ANCHOR = /^([a-z][a-z0-9+.-]*:|\/|#|\?)/i;

/**
 * Parses HTML returned by GitLab's Markdown API into a detached root element.
 * GitLab sanitizes this HTML server-side; it is the same HTML GitLab inserts
 * into its own pages.
 */
export function parseRenderedHtml(html, DOMParserImpl) {
  return new DOMParserImpl().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html').body;
}

/**
 * Fixes up rendered HTML for display outside GitLab's own page logic:
 * - lazy-loaded images get their real `src`
 * - relative links and images resolve against the file in the repository
 *   at the given commit (the Markdown API has no file context)
 */
export function fixUrls(root, { webBase, projectPath, sha, filePath }) {
  const blobBase = `${webBase}/${projectPath}/-/blob/${sha}/${filePath}`;
  const rawBase = `${webBase}/${projectPath}/-/raw/${sha}/${filePath}`;
  const resolve = (value, base) => {
    if (!value || ABSOLUTE_OR_ANCHOR.test(value)) return value;
    try {
      return new URL(value, base).href;
    } catch {
      return value;
    }
  };

  for (const el of root.querySelectorAll('img[data-src], video[data-src], source[data-src]')) {
    el.setAttribute('src', el.getAttribute('data-src'));
    el.removeAttribute('data-src');
    el.classList.remove('lazy');
  }
  for (const el of root.querySelectorAll('img[src], video[src], source[src]')) {
    el.setAttribute('src', resolve(el.getAttribute('src'), rawBase));
  }
  for (const el of root.querySelectorAll('a[href]')) {
    el.setAttribute('href', resolve(el.getAttribute('href'), blobBase));
  }
  return root;
}
