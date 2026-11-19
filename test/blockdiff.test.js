import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { renderDiff, similarity } from '../src/lib/blockdiff.js';
import { parseRenderedHtml } from '../src/lib/render.js';

const { window } = new JSDOM('');
const doc = window.document;
const parse = (html) => parseRenderedHtml(html, window.DOMParser);

function blocks(out) {
  return Array.from(out.children).map((el) => {
    const state = ['rmd-same', 'rmd-added', 'rmd-removed', 'rmd-container'].find((c) => el.classList.contains(c));
    return `${el.tagName}:${state}:${el.getAttribute('data-rmd-side')}`;
  });
}

test('marks unchanged, added and removed blocks', () => {
  const out = renderDiff(
    parse('<p data-sourcepos="1:1-1:5">Intro</p><p data-sourcepos="3:1-3:4">Gone</p>'),
    parse('<p data-sourcepos="1:1-1:5">Intro</p><h2 data-sourcepos="3:1-3:7">New</h2>'),
    doc,
  );
  assert.deepEqual(blocks(out), ['P:rmd-same:new', 'P:rmd-removed:old', 'H2:rmd-added:new']);
});

test('ignores source position shifts when comparing blocks', () => {
  const out = renderDiff(
    parse('<p data-sourcepos="1:1-1:5">Same</p>'),
    parse('<p data-sourcepos="7:1-7:5">Same</p>'),
    doc,
  );
  assert.deepEqual(blocks(out), ['P:rmd-same:new']);
  assert.equal(out.firstElementChild.getAttribute('data-sourcepos'), '7:1-7:5');
});

test('highlights changed words inside a changed paragraph', () => {
  const out = renderDiff(
    parse('<p data-sourcepos="1:1-1:30">The quick brown fox jumps</p>'),
    parse('<p data-sourcepos="1:1-1:30">The quick red fox <em>leaps</em></p>'),
    doc,
  );
  assert.deepEqual(blocks(out), ['P:rmd-removed:old', 'P:rmd-added:new']);
  const del = [...out.querySelectorAll('.rmd-word-del')].map((e) => e.textContent);
  const ins = [...out.querySelectorAll('.rmd-word-ins')].map((e) => e.textContent);
  assert.deepEqual(del, ['brown', 'jumps']);
  assert.deepEqual(ins, ['red', 'leaps']);
  assert.equal(out.children[1].textContent, 'The quick red fox leaps');
});

test('recurses into lists so only the changed item is marked', () => {
  const out = renderDiff(
    parse('<ul data-sourcepos="1:1-3:3"><li data-sourcepos="1:1-1:3">one</li><li data-sourcepos="2:1-2:3">two</li><li data-sourcepos="3:1-3:5">three</li></ul>'),
    parse('<ul data-sourcepos="1:1-3:3"><li data-sourcepos="1:1-1:3">one</li><li data-sourcepos="2:1-2:3">2</li><li data-sourcepos="3:1-3:5">three</li></ul>'),
    doc,
  );
  assert.deepEqual(blocks(out), ['UL:rmd-container:new']);
  assert.deepEqual(blocks(out.firstElementChild), ['LI:rmd-same:new', 'LI:rmd-removed:old', 'LI:rmd-added:new', 'LI:rmd-same:new']);
});

test('shows removals before additions in a replaced run', () => {
  const out = renderDiff(
    parse('<p data-sourcepos="1:1-1:1">alpha beta</p>'),
    parse('<h1 data-sourcepos="1:1-1:1">Title</h1><p data-sourcepos="2:1-2:1">gamma</p>'),
    doc,
  );
  assert.deepEqual(blocks(out), ['P:rmd-removed:old', 'H1:rmd-added:new', 'P:rmd-added:new']);
});

test('similarity', () => {
  assert.equal(similarity('a b', 'a b'), 1);
  assert.equal(similarity('a', 'b'), 0);
  assert.equal(similarity('', ''), 1);
});
