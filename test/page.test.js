import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { parseMergeRequestPath } from '../src/lib/page.js';
import { renderDiff } from '../src/lib/blockdiff.js';
import { activateLazyMedia, parseRenderedHtml, resolveRelativeUrls } from '../src/lib/render.js';
import { fileThreads } from '../src/lib/threads.js';

test('parses merge request URLs', () => {
  assert.deepEqual(parseMergeRequestPath('/group/sub/proj/-/merge_requests/42/diffs'), {
    urlRoot: '',
    projectPath: 'group/sub/proj',
    iid: 42,
  });
  assert.deepEqual(parseMergeRequestPath('/gitlab/group/proj/-/merge_requests/7', 'group/proj'), {
    urlRoot: '/gitlab',
    projectPath: 'group/proj',
    iid: 7,
  });
  assert.equal(parseMergeRequestPath('/group/proj/-/issues/1'), null);
});

test('resolves relative links and lazy images per side after diffing', () => {
  const { window } = new JSDOM('');
  const parse = (html) => activateLazyMedia(parseRenderedHtml(html, window));
  const same = '<p data-sourcepos="1:1-1:9"><a href="other.md">x</a><a href="#top">t</a><a href="https://e.com">e</a></p>';
  const diff = renderDiff(
    parse(`${same}<p data-sourcepos="3:1-3:9"><img class="lazy" src="data:image/gif;base64,AA" data-src="img/old.png"></p>`),
    parse(`${same}<p data-sourcepos="3:1-3:9"><img class="lazy" src="data:image/gif;base64,AA" data-src="img/new.png"></p>`),
    window.document,
  );
  // The paragraph with relative links compares equal on both sides.
  assert.ok(diff.children[0].classList.contains('rmd-same'));
  resolveRelativeUrls(diff, {
    webBase: 'https://gl.example/gitlab',
    projectPath: 'g/p',
    sides: { old: { sha: 'base', filePath: 'docs/README.md' }, new: { sha: 'head', filePath: 'docs/README.md' } },
  });
  const [rel, anchor, abs] = diff.querySelectorAll('a');
  assert.equal(rel.getAttribute('href'), 'https://gl.example/gitlab/g/p/-/blob/head/docs/other.md');
  assert.equal(anchor.getAttribute('href'), '#top');
  assert.equal(abs.getAttribute('href'), 'https://e.com');
  const [oldImg, newImg] = diff.querySelectorAll('img');
  assert.equal(oldImg.getAttribute('src'), 'https://gl.example/gitlab/g/p/-/raw/base/docs/img/old.png');
  assert.equal(newImg.getAttribute('src'), 'https://gl.example/gitlab/g/p/-/raw/head/docs/img/new.png');
});

test('sanitizes rendered HTML but keeps source positions', () => {
  const { window } = new JSDOM('');
  const root = parseRenderedHtml('<p data-sourcepos="1:1-1:3" onclick="x()">a<script>x()</script><a href="javascript:x()">l</a></p>', window);
  const p = root.querySelector('p');
  assert.equal(p.getAttribute('data-sourcepos'), '1:1-1:3');
  assert.equal(p.hasAttribute('onclick'), false);
  assert.equal(root.querySelector('script'), null);
  assert.equal(root.querySelector('a').hasAttribute('href'), false);
});

test('selects current diff threads of one file', () => {
  const pos = (extra) => ({ position_type: 'text', head_sha: 'h', new_path: 'a.md', old_path: 'a.md', ...extra });
  const discussions = [
    { notes: [{ position: pos({ new_line: 3 }) }] },
    { notes: [{ position: pos({ old_line: 5, new_line: null }) }] },
    { notes: [{ position: pos({ new_line: 1, head_sha: 'old' }) }] },
    { notes: [{ position: pos({ new_line: 1, new_path: 'b.md', old_path: 'b.md' }) }] },
    { notes: [{ body: 'general comment' }] },
  ];
  const threads = fileThreads(discussions, { new_path: 'a.md', old_path: 'a.md' }, 'h');
  assert.deepEqual(threads.map((t) => [t.side, t.line]), [['new', 3], ['old', 5]]);
});
