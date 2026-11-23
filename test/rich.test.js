import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import katex from 'katex';
import { isDark, renderRich } from '../src/lib/rich.js';

// Shaped like GitLab's Markdown API output for math and Mermaid.
const HTML = `
<p data-sourcepos="1:1-1:12">Inline <code data-math-style="inline" class="code math js-render-math">a^2</code></p>
<pre data-sourcepos="3:1-5:3" data-math-style="display" class="code math js-render-math"><code><span class="line">x = \\frac{1}{2}</span></code></pre>
<pre data-sourcepos="7:1-10:3" lang="mermaid" data-canonical-lang="mermaid" class="rmd-added"><code class="js-render-mermaid"><span class="line">graph TD</span>
<span class="line">  A --&gt; B</span></code></pre>`;

function setup(mermaidSvg) {
  const { window } = new JSDOM(`<div>${HTML}</div>`);
  const calls = [];
  const mermaid = {
    initialize: (config) => calls.push(['initialize', config]),
    render: async (id, text) => {
      calls.push(['render', text]);
      if (mermaidSvg instanceof Error) throw mermaidSvg;
      return { svg: mermaidSvg };
    },
  };
  const load = async (name) => (name === 'katex' ? katex : mermaid);
  return { window, root: window.document.querySelector('div'), calls, load };
}

test('renders math as MathML and keeps the source elements', async () => {
  const { window, root, load } = setup('<svg></svg>');
  await renderRich(root, window, load);
  const [inline, display] = root.querySelectorAll('.rmd-rich-host');
  assert.equal(inline.tagName, 'CODE');
  assert.equal(inline.querySelector('math').getAttribute('display'), null);
  assert.equal(display.tagName, 'PRE');
  assert.equal(display.getAttribute('data-sourcepos'), '3:1-5:3');
  assert.equal(display.querySelector('math').getAttribute('display'), 'block');
  // The TeX source stays inside <annotation>, which Firefox does not display.
  assert.equal(display.querySelector('math > semantics > annotation').textContent, 'x = \\frac{1}{2}');
});

test('detects a dark page background', () => {
  const { window } = new JSDOM('<body style="background-color: rgb(24, 23, 29)"></body>');
  assert.equal(isDark(window), true);
  assert.equal(isDark(new JSDOM('<body style="background-color: rgb(255, 255, 255)"></body>').window), false);
  assert.equal(isDark(new JSDOM('').window), false);
});

test('renders Mermaid in strict mode and sanitizes the SVG', async () => {
  const { window, root, calls, load } = setup('<svg><script>alert(1)</script><g onclick="x()"><text>A</text></g></svg>');
  await renderRich(root, window, load);
  const [[, config], render] = calls;
  assert.equal(config.securityLevel, 'strict');
  assert.deepEqual(render, ['render', 'graph TD\n  A --> B']);
  const pre = root.querySelector('pre[lang="mermaid"]');
  assert.ok(pre.classList.contains('rmd-added'));
  assert.equal(pre.querySelector('svg text').textContent, 'A');
  assert.equal(pre.querySelector('script'), null);
  assert.equal(pre.querySelector('g').hasAttribute('onclick'), false);
});

test('keeps HTML labels and drops other HTML inside them', async () => {
  const { window, root, calls, load } = setup(
    '<svg><g class="label"><foreignObject width="120" height="21"><div xmlns="http://www.w3.org/1999/xhtml">' +
      '<span class="nodeLabel"><p>Pool<br><small>serviceAllocation</small></p>' +
      '<img src="https://example.com/t.png"><form><input></form><style>body{display:none}</style>' +
      '</span></div></foreignObject></g></svg>',
  );
  await renderRich(root, window, load);
  // GitLab renders HTML labels too, so labels like `A["x<br/><small>y</small>"]` look the same.
  assert.notEqual(calls[0][1].htmlLabels, false);
  assert.notEqual(calls[0][1].flowchart?.htmlLabels, false);
  const label = root.querySelector('foreignObject span.nodeLabel');
  assert.equal(label.querySelector('p').innerHTML, 'Pool<br><small>serviceAllocation</small>');
  assert.equal(label.querySelector('img, form, input, style'), null);
});

test('leaves an invalid Mermaid diagram as code', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const { window, root, load } = setup(new Error('Parse error'));
  await renderRich(root, window, load);
  const pre = root.querySelector('pre[lang="mermaid"]');
  assert.equal(pre.classList.contains('rmd-rich-host'), false);
  assert.equal(pre.textContent, 'graph TD\n  A --> B');
});

test('loads no library when there is nothing to render', async () => {
  const { window } = new JSDOM('<div><p>Text</p></div>');
  await renderRich(window.document.querySelector('div'), window, () => assert.fail('no load expected'));
});
