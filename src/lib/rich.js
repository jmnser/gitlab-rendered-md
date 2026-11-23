import createDOMPurify from 'dompurify';

/*
 * GitLab renders Mermaid diagrams and math in the browser, so its Markdown API
 * returns them as code. This module renders them in the rendered diff.
 *
 * Mermaid: `<pre lang="mermaid"><code class="js-render-mermaid">…`
 * Math:    `<code data-math-style="inline" class="js-render-math">…` and
 *          `<pre data-math-style="display" class="js-render-math"><code>…`
 */
const MERMAID = '.js-render-mermaid, pre[data-canonical-lang="mermaid"], pre[lang="mermaid"], code.language-mermaid';
const MATH = '.js-render-math, [data-math-style]';

/**
 * Replaces the source of Mermaid diagrams and math inside `root` with the
 * rendered result. Blocks that fail to render stay as code.
 *
 * load(name) -> Promise<library>, for name 'mermaid' or 'katex'.
 */
export async function renderRich(root, win, load) {
  const doc = win.document;
  const purify = createDOMPurify(win);

  const formulas = unique(root.querySelectorAll(MATH), (el) => el.closest('pre') ?? el);
  if (formulas.length) {
    const katex = await load('katex');
    for (const el of formulas) {
      const display = el.tagName === 'PRE' || el.getAttribute('data-math-style') === 'display';
      const mathml = katex.renderToString(el.textContent.trim(), { output: 'mathml', displayMode: display, throwOnError: false });
      replaceSource(el, purify.sanitize(mathml, { USE_PROFILES: { mathMl: true }, RETURN_DOM_FRAGMENT: true }), doc);
    }
  }

  const diagrams = unique(root.querySelectorAll(MERMAID), (el) => el.closest('pre') ?? el);
  if (diagrams.length) {
    const mermaid = await load('mermaid');
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      // Invalid diagrams throw and stay as code instead of leaving an error graphic in the page.
      suppressErrorRendering: true,
      htmlLabels: false,
      flowchart: { htmlLabels: false },
    });
    for (const [i, el] of diagrams.entries()) {
      try {
        const { svg } = await mermaid.render(`rmd-mermaid-${Date.now()}-${i}`, el.textContent.trim());
        replaceSource(el, purify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, RETURN_DOM_FRAGMENT: true }), doc);
      } catch (e) {
        console.warn('[gitlab-rendered-md] Mermaid diagram not rendered', e);
      }
    }
  }
}

function unique(nodes, map) {
  return [...new Set(Array.from(nodes, map))];
}

/** Keeps the element itself, so its source position, diff side and classes stay for commenting and folding. */
function replaceSource(el, fragment, doc) {
  const box = doc.createElement('span');
  box.className = 'rmd-rich';
  box.append(fragment);
  el.replaceChildren(box);
  el.classList.add('rmd-rich-host');
}
