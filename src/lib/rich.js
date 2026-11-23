import { sanitize } from './render.js';

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

// KaTeX wraps MathML in <semantics> with the TeX source as <annotation>, which Firefox does not display.
const MATHML = { USE_PROFILES: { mathMl: true }, ADD_TAGS: ['semantics', 'annotation'], RETURN_DOM_FRAGMENT: true };
// Mermaid draws HTML labels as <foreignObject><div><span><p>…</p></span></div>, with inline tags such as <small>.
const LABEL_TAGS = ['div', 'span', 'p', 'br', 'b', 'i', 'strong', 'em', 'small', 'sub', 'sup', 'code', 'u', 's'];
const SVG = {
  USE_PROFILES: { svg: true, svgFilters: true },
  ADD_TAGS: ['foreignObject', ...LABEL_TAGS],
  HTML_INTEGRATION_POINTS: { 'annotation-xml': true, foreignobject: true },
  RETURN_DOM_FRAGMENT: true,
};

/**
 * Replaces the source of Mermaid diagrams and math inside `root` with the
 * rendered result. Blocks that fail to render stay as code.
 *
 * load(name) -> Promise<library>, for name 'mermaid' or 'katex'.
 */
export async function renderRich(root, win, load) {
  const formulas = unique(root.querySelectorAll(MATH), (el) => el.closest('pre') ?? el);
  if (formulas.length) {
    const katex = await load('katex');
    for (const el of formulas) {
      try {
        const display = el.tagName === 'PRE' || el.getAttribute('data-math-style') === 'display';
        const mathml = katex.renderToString(el.textContent.trim(), { output: 'mathml', displayMode: display, throwOnError: false });
        replaceSource(el, sanitize(mathml, win, MATHML));
      } catch (e) {
        console.warn('[gitlab-rendered-md] Formula not rendered', e);
      }
    }
  }

  const diagrams = unique(root.querySelectorAll(MERMAID), (el) => el.closest('pre') ?? el);
  if (diagrams.length) {
    const mermaid = await load('mermaid');
    const config = {
      startOnLoad: false,
      securityLevel: 'strict',
      theme: isDark(win) ? 'dark' : 'default',
      // Invalid diagrams throw and stay as code instead of leaving an error graphic in the page.
      suppressErrorRendering: true,
    };
    for (const [i, el] of diagrams.entries()) {
      try {
        const text = el.textContent.trim();
        // Mermaid's default layout, ELK, reads `Math` through `window`, which a content script sees only through an
        // Xray wrapper. GitLab's Mermaid lays out with dagre as well. Mindmaps use cose-bilkent unless a layout is set.
        const { diagramType } = await mermaid.parse(text);
        mermaid.initialize(diagramType === 'mindmap' ? config : { ...config, layout: 'dagre' });
        const { svg } = await mermaid.render(`rmd-mermaid-${Date.now()}-${i}`, text);
        const fragment = sanitize(svg, win, SVG);
        // <style> is allowed for Mermaid's own, ID-scoped CSS. Inside a label it would style the whole page.
        for (const style of fragment.querySelectorAll('foreignObject style')) style.remove();
        replaceSource(el, fragment);
      } catch (e) {
        console.warn('[gitlab-rendered-md] Mermaid diagram not rendered', e);
      }
    }
  }
}

function unique(nodes, map) {
  return [...new Set(Array.from(nodes, map))];
}

/** True when GitLab's page background is dark, whatever theme setting produced it. */
export function isDark(win) {
  const m = /rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/.exec(win.getComputedStyle(win.document.body).backgroundColor);
  if (!m || m[4] === '0') return false;
  const [r, g, b] = m.slice(1, 4).map(Number);
  return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}

/** Keeps the element itself, so its source position, diff side and classes stay for commenting and folding. */
function replaceSource(el, fragment) {
  const box = el.ownerDocument.createElement('span');
  box.className = 'rmd-rich';
  box.append(fragment);
  el.replaceChildren(box);
  el.classList.add('rmd-rich-host');
}
