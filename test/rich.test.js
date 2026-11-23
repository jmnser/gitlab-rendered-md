import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import katex from 'katex';
import { renderRich } from '../src/lib/rich.js';

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
    initialize: (config) => calls.push(['initialize', config.securityLevel]),
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
});

test('renders Mermaid in strict mode and sanitizes the SVG', async () => {
  const { window, root, calls, load } = setup('<svg><script>alert(1)</script><g onclick="x()"><text>A</text></g></svg>');
  await renderRich(root, window, load);
  assert.deepEqual(calls, [['initialize', 'strict'], ['render', 'graph TD\n  A --> B']]);
  const pre = root.querySelector('pre[lang="mermaid"]');
  assert.ok(pre.classList.contains('rmd-added'));
  assert.equal(pre.querySelector('svg text').textContent, 'A');
  assert.equal(pre.querySelector('script'), null);
  assert.equal(pre.querySelector('g').hasAttribute('onclick'), false);
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
