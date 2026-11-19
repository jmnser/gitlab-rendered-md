import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { parseMergeRequestPath } from '../src/lib/page.js';
import { fixUrls, parseRenderedHtml } from '../src/lib/render.js';
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

test('resolves relative links and lazy images against the repository', () => {
  const { window } = new JSDOM('');
  const root = parseRenderedHtml(
    '<p><a href="other.md">x</a><a href="#top">t</a><a href="https://e.com">e</a>' +
      '<img class="lazy" src="data:image/gif;base64,AA" data-src="img/a.png"></p>',
    window.DOMParser,
  );
  fixUrls(root, { webBase: 'https://gl.example/gitlab', projectPath: 'g/p', sha: 'abc', filePath: 'docs/README.md' });
  const [rel, anchor, abs] = root.querySelectorAll('a');
  assert.equal(rel.getAttribute('href'), 'https://gl.example/gitlab/g/p/-/blob/abc/docs/other.md');
  assert.equal(anchor.getAttribute('href'), '#top');
  assert.equal(abs.getAttribute('href'), 'https://e.com');
  assert.equal(root.querySelector('img').getAttribute('src'), 'https://gl.example/gitlab/g/p/-/raw/abc/docs/img/a.png');
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
