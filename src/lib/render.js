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
  return sanitize(html, win, { RETURN_DOM: true, ALLOW_DATA_ATTR: true });
}

const purifiers = new WeakMap();

/** Sanitizes markup with DOMPurify, one instance per window. */
export function sanitize(markup, win, config) {
  let purify = purifiers.get(win);
  if (!purify) purifiers.set(win, (purify = createDOMPurify(win)));
  return purify.sanitize(markup, config);
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
 * Returns the Markdown source covered by `data-sourcepos="l:c-l:c"`.
 * Columns count UTF-8 bytes, 1-based and inclusive.
 */
export function sourceSlice(text, sourcepos) {
  const m = /^(\d+):(\d+)-(\d+):(\d+)$/.exec(sourcepos ?? '');
  if (!m) return '';
  const [sl, sc, el, ec] = m.slice(1).map(Number);
  const lines = text.split('\n').slice(sl - 1, el);
  if (lines.length === 0) return '';
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const bytes = lines.map((l) => enc.encode(l));
  if (bytes.length === 1) return dec.decode(bytes[0].slice(sc - 1, ec));
  bytes[0] = bytes[0].slice(sc - 1);
  bytes[bytes.length - 1] = bytes[bytes.length - 1].slice(0, ec);
  return bytes.map((b) => dec.decode(b)).join('\n');
}

/** The literal destination of an inline link or image (`[x](dest)`, `![x](<dest>)`). */
function literalDestination(source) {
  const m = /\]\(\s*(?:<([^>]*)>|([^\s)]+))/.exec(source);
  return m ? (m[1] ?? m[2]) : null;
}

/**
 * Points relative links and images of a rendered diff at the file in the
 * repository at the right commit.
 *
 * GitLab's Markdown API has no file context: it resolves relative links
 * against the repository root on the default branch. The literal link target
 * is therefore read from the Markdown source through the element's
 * `data-sourcepos` and resolved against the file's own directory at the
 * commit of its side (`data-rmd-side`). Reference-style links have no
 * literal target in their span and keep GitLab's URL.
 *
 * Runs after diffing, so that both versions compare equal regardless of the
 * commit SHA.
 *
 * sides: { old: { sha, filePath, text }, new: { sha, filePath, text } }
 */
export function resolveRelativeUrls(diff, { webBase, projectPath, sides }) {
  const resolve = (el, attr, kind, posEl) => {
    const side = el.closest('[data-rmd-side]')?.getAttribute('data-rmd-side') === 'old' ? sides.old : sides.new;
    const literal = literalDestination(sourceSlice(side.text, posEl.getAttribute('data-sourcepos')));
    if (!literal || ABSOLUTE_OR_ANCHOR.test(literal)) return;
    try {
      el.setAttribute(attr, new URL(literal, `${webBase}/${projectPath}/-/${kind}/${side.sha}/${side.filePath}`).href);
    } catch {
      // Leave unparsable URLs as they are.
    }
  };
  for (const el of diff.querySelectorAll('img[data-sourcepos], video[data-sourcepos]')) {
    resolve(el, 'src', 'raw', el);
    // GitLab wraps images in a link to the image itself.
    const link = el.closest('a');
    if (link && !link.hasAttribute('data-sourcepos') && link.querySelectorAll('img, video').length === 1) {
      resolve(link, 'href', 'raw', el);
    }
  }
  for (const el of diff.querySelectorAll('a[href][data-sourcepos]')) resolve(el, 'href', 'blob', el);
  return diff;
}
