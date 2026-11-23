import { createApi } from '../lib/api.js';
import { buildLineMap, localHunks, parseUnifiedDiff, splitLines } from '../lib/linemap.js';
import { parseMergeRequestPath } from '../lib/page.js';
import { activateLazyMedia, parseRenderedHtml, resolveRelativeUrls } from '../lib/render.js';
import { renderRich } from '../lib/rich.js';
import { fileThreads } from '../lib/threads.js';
import { csrfToken, diffContent, findMarkdownDiffFiles, toggleContainer } from './gitlab-dom.js';
import { createPanel, setStatus, showReview } from './review.js';

/** Per-file view state, keyed by the file's new path. */
const files = new Map();
let currentKey = null;
let mrPromise = null;
/** Option: open Markdown files in the rendered view when they first appear. */
let renderByDefault = false;
/** Option: unchanged source lines shown around changes; 0 shows the full file. */
let contextLines = 20;
/** Option: render Mermaid diagrams and math. */
let renderDiagrams = true;

/*
 * Firefox's `content.fetch` sends requests as the page itself (same origin,
 * session cookie), which is what GitLab's API expects for session auth.
 */
const pageFetch =
  typeof content !== 'undefined' && content?.fetch ? content.fetch.bind(content) : globalThis.fetch.bind(globalThis);

/** Libraries imported on demand; build.mjs copies them into the add-on. */
const LIBRARIES = { mermaid: 'lib/mermaid/mermaid.esm.min.mjs', katex: 'lib/katex/katex.mjs' };
const libraries = new Map();

function loadLibrary(name) {
  if (!libraries.has(name)) {
    const loaded = import(browser.runtime.getURL(LIBRARIES[name])).then((module) => module.default);
    loaded.catch(() => libraries.delete(name)); // Allow a retry.
    libraries.set(name, loaded);
  }
  return libraries.get(name);
}

function pageContext() {
  const parsed = parseMergeRequestPath(location.pathname, document.body?.dataset.projectFullPath);
  if (!parsed) return null;
  const webBase = location.origin + parsed.urlRoot;
  return { ...parsed, webBase, apiBase: `${webBase}/api/v4`, key: `${webBase}/${parsed.projectPath}!${parsed.iid}` };
}

async function configuredToken() {
  if (location.protocol !== 'https:') return ''; // Never send a token in clear text.
  try {
    const { tokens = {} } = await browser.storage.local.get('tokens');
    return tokens[location.origin] || '';
  } catch {
    return '';
  }
}

function loadMergeRequest(ctx) {
  mrPromise ??= (async () => {
    const api = createApi({
      apiBase: ctx.apiBase,
      token: await configuredToken(),
      csrfToken: csrfToken(document),
      fetchImpl: pageFetch,
    });
    const projectId = document.body?.dataset.projectId || (await api.getProject(ctx.projectPath)).id;
    const params = new URLSearchParams(location.search);
    // `diff_id` selects an older version in GitLab's UI; otherwise use the newest (listed first).
    let versionId = params.get('diff_id');
    if (!versionId) {
      const versions = await api.listVersions(projectId, ctx.iid);
      if (versions.length === 0) throw new Error('This merge request has no diff yet.');
      versionId = versions[0].id;
    }
    const version = await api.getVersion(projectId, ctx.iid, versionId);
    return {
      api,
      projectId,
      version,
      diffs: version.diffs ?? [],
      // `start_sha` compares two versions in GitLab; the rendered view always shows the full version diff.
      notice: params.get('start_sha') ? 'The rendered view shows the full diff of this version, not the comparison between versions.' : '',
    };
  })();
  mrPromise.catch(() => {
    mrPromise = null; // Allow a retry on the next toggle.
  });
  return mrPromise;
}

async function loadFileModel(ctx, path) {
  const { api, projectId, version, diffs, notice } = await loadMergeRequest(ctx);
  const file = diffs.find((d) => d.new_path === path) ?? diffs.find((d) => d.old_path === path);
  if (!file) throw new Error(`${path} is not part of this merge request version.`);
  const { base_commit_sha: baseSha, head_commit_sha: headSha, start_commit_sha: startSha } = version;

  const [oldText, newText] = await Promise.all([
    file.new_file ? '' : api.getRawFile(projectId, file.old_path, baseSha),
    file.deleted_file ? '' : api.getRawFile(projectId, file.new_path, headSha),
  ]);
  const render = (text) => (text.trim() ? api.renderMarkdown(text, ctx.projectPath) : Promise.resolve(''));
  const [oldHtml, newHtml] = await Promise.all([render(oldText), render(newText)]);

  const parse = (html) => activateLazyMedia(parseRenderedHtml(html, window));

  const hunks = file.diff ? parseUnifiedDiff(file.diff) : localHunks(oldText, newText);

  let threads = [];
  const notices = [notice];
  try {
    threads = fileThreads(await api.listDiscussions(projectId, ctx.iid), file, headSha);
  } catch (e) {
    notices.push(`Existing comments could not be loaded: ${e.message}`);
  }

  return {
    model: {
      oldRoot: parse(oldHtml),
      newRoot: parse(newHtml),
      finishDiff: (diff) =>
        resolveRelativeUrls(diff, {
          webBase: ctx.webBase,
          projectPath: ctx.projectPath,
          sides: {
            old: { sha: baseSha, filePath: file.old_path, text: oldText },
            new: { sha: headSha, filePath: file.new_path, text: newText },
          },
        }),
      commentsDisabled: hunks.approximate
        ? 'This file is too large to map rendered blocks to diff lines. Comment in the raw diff instead.'
        : '',
      map: buildLineMap(hunks),
      oldLineCount: splitLines(oldText).length,
      newLineCount: splitLines(newText).length,
      threads,
      noteUrl: (noteId) => `${ctx.webBase}/${ctx.projectPath}/-/merge_requests/${ctx.iid}#note_${noteId}`,
    },
    notice: notices.filter(Boolean).join(' '),
    postComment: (lines, body) =>
      api.createDiscussion(projectId, ctx.iid, body, {
        position_type: 'text',
        base_sha: baseSha,
        start_sha: startSha,
        head_sha: headSha,
        old_path: file.old_path,
        new_path: file.new_path,
        ...lines,
      }),
  };
}

async function openRendered(ctx, path, state) {
  state.failed = false;
  setStatus(state.ui, 'Rendering…');
  try {
    const { model, notice, postComment } = await loadFileModel(ctx, path);
    if (ctx.key !== currentKey) return;
    setStatus(state.ui, notice);
    showReview(document, state.ui, { ...model, contextLines }, postComment);
    if (renderDiagrams) {
      renderRich(state.ui.body, window, loadLibrary).catch((e) => {
        console.error('[gitlab-rendered-md]', path, e);
        setStatus(state.ui, [notice, `Diagrams and math could not be rendered: ${e.message}`].filter(Boolean).join(' '), true);
      });
    }
  } catch (e) {
    console.error('[gitlab-rendered-md]', path, e);
    state.failed = true; // Retried on the next toggle.
    setStatus(state.ui, `Rendering failed: ${e.message}`, true);
  }
}

function fileState(path) {
  let state = files.get(path);
  if (!state) files.set(path, (state = { active: false, ui: null }));
  return state;
}

function setActive(ctx, path, state, active) {
  state.active = active;
  if (state.active && (!state.ui || state.failed)) {
    state.ui ??= createPanel(document, path);
    openRendered(ctx, path, state);
  }
}

function toggle(path) {
  const ctx = pageContext();
  if (!ctx || ctx.key !== currentKey) return;
  const state = fileState(path);
  setActive(ctx, path, state, !state.active);
  scan();
}

function ensureToggle(fileEl, path, active) {
  const container = toggleContainer(fileEl);
  if (!container) return;
  let btn = container.querySelector('.rmd-toggle');
  if (!btn) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-default btn-sm gl-button rmd-toggle';
    btn.textContent = 'Rendered';
    btn.title = 'Show this file as a rendered Markdown diff';
    btn.addEventListener('click', (ev) => {
      // GitLab collapses the file when its header is clicked.
      ev.preventDefault();
      ev.stopPropagation();
      // GitLab may reuse a file element for another file; the path is kept current by scan().
      toggle(btn.getAttribute('data-rmd-path'));
    });
    container.prepend(btn);
  }
  if (btn.getAttribute('data-rmd-path') !== path) btn.setAttribute('data-rmd-path', path);
  if (btn.getAttribute('aria-pressed') !== String(active)) {
    btn.setAttribute('aria-pressed', String(active));
    btn.classList.toggle('selected', active);
  }
}

/** Brings toggles and panels in line with the current DOM and view state. */
function scan() {
  const ctx = pageContext();
  if (!ctx) return;
  if (ctx.key !== currentKey) {
    currentKey = ctx.key;
    files.clear();
    mrPromise = null;
  }
  for (const { el, path } of findMarkdownDiffFiles(document)) {
    if (renderByDefault && !files.has(path)) setActive(ctx, path, fileState(path), true);
    const state = files.get(path);
    const active = !!state?.active;
    ensureToggle(el, path, active);
    // Panels of other files left behind in a reused file element.
    for (const panel of el.querySelectorAll('.rmd-panel')) {
      if (panel.getAttribute('data-rmd-path') !== path) panel.remove();
    }
    if (active) {
      if (!el.classList.contains('rmd-active')) el.classList.add('rmd-active');
      if (state.ui && !el.contains(state.ui.root)) {
        const content = diffContent(el);
        if (content) content.after(state.ui.root);
        else el.append(state.ui.root);
      }
    } else {
      if (el.classList.contains('rmd-active')) el.classList.remove('rmd-active');
      if (state?.ui && el.contains(state.ui.root)) state.ui.root.remove();
    }
  }
}

let scheduled = false;
function scheduleScan() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    scan();
  }, 150);
}

async function start() {
  try {
    const options = await browser.storage.local.get(['renderByDefault', 'contextLines', 'renderDiagrams']);
    renderByDefault = !!options.renderByDefault;
    renderDiagrams = options.renderDiagrams !== false;
    if (Number.isInteger(options.contextLines) && options.contextLines >= 0) contextLines = options.contextLines;
  } catch {
    // Without storage access the defaults apply.
  }
  scan();
  new MutationObserver((records) => {
    // Changes inside the rendered panels (hover, comment forms) need no scan.
    if (records.some((r) => !r.target.closest?.('.rmd-panel'))) scheduleScan();
  }).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  });
}

if (pageContext()) start();
