import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { diffContent, findMarkdownDiffFiles, toggleContainer } from '../src/content/gitlab-dom.js';

// Trimmed markup of both diff views as rendered by GitLab 19.5.
const RAPID = `
<diff-file data-file-data='{"old_path":"docs/old.md","new_path":"docs/guide.md"}'>
  <article class="rd-diff-file">
    <header class="rd-diff-file-header"><div class="rd-diff-file-info"><div class="rd-diff-file-stats"></div></div></header>
    <div class="rd-diff-file-body"></div>
  </article>
</diff-file>
<diff-file data-file-data='{"old_path":"a.js","new_path":"a.js"}'></diff-file>`;
const CLASSIC = `
<div class="diff-file file-holder" data-path="README.markdown">
  <div class="js-file-title file-title"><div class="file-header-content"></div><div class="file-actions"></div></div>
  <div class="diff-content"></div>
</div>
<div class="diff-file file-holder" data-path="src/x.go"></div>`;

test('finds Markdown files in Rapid Diffs', () => {
  const { document } = new JSDOM(RAPID).window;
  const files = findMarkdownDiffFiles(document);
  assert.deepEqual(files.map((f) => f.path), ['docs/guide.md']);
  assert.ok(toggleContainer(files[0].el).classList.contains('rd-diff-file-info'));
  assert.ok(diffContent(files[0].el).classList.contains('rd-diff-file-body'));
});

test('finds Markdown files in classic diffs', () => {
  const { document } = new JSDOM(CLASSIC).window;
  const files = findMarkdownDiffFiles(document);
  assert.deepEqual(files.map((f) => f.path), ['README.markdown']);
  assert.ok(toggleContainer(files[0].el).classList.contains('file-actions'));
  assert.ok(diffContent(files[0].el).classList.contains('diff-content'));
});
