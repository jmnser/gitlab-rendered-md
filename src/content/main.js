import { createApi } from '../lib/api.js';
import { buildLineMap, localHunks, parseUnifiedDiff, splitLines } from '../lib/linemap.js';
import { parseMergeRequestPath } from '../lib/page.js';
import { fixUrls, parseRenderedHtml } from '../lib/render.js';
import { fileThreads } from '../lib/threads.js';
import { csrfToken, diffContent, findMarkdownDiffFiles, toggleContainer } from './gitlab-dom.js';
import { createPanel, setStatus, showReview } from './review.js';

/** Per-file view state, keyed by the file's new path. */
const files = new Map();
let currentKey = null;
let mrPromise = null;

/*
 * Firefox's `content.fetch` sends requests as the page itself (same origin,
 * session cookie), which is what GitLab's API expects for session auth.
 */
const pageFetch =
  typeof content !== 'undefined' && content?.fetch ? content.fetch.bind(content) : globalThis.fetch.bind(globalThis);

function pageContext() {
  const parsed = parseMergeRequestPath(location.pathname, document.body?.dataset.projectFullPath);
  if (!parsed) return null;
  const webBase = location.origin + parsed.urlRoot;
  return { ...parsed, webBase, apiBase: `${webBase}/api/v4`, key: `${webBase}/${parsed.projectPath}!${parsed.iid}` };
}

async function configuredToken() {
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
    const versions = await api.listVersions(projectId, ctx.iid);
    if (versions.length === 0) throw new Error('This merge request has no diff yet.');
    // GitLab lists versions newest first; `diff_id` selects an older one in the UI.
    const wanted = new URLSearchParams(location.search).get('diff_id');
    const version = versions.find((v) => String(v.id) === wanted) ?? versions[0];
    const detail = await api.getVersion(projectId, ctx.iid, version.id);
    return { api, projectId, version, diffs: detail.diffs ?? [] };
  })();
  mrPromise.catch(() => {
    mrPromise = null; // Allow a retry on the next toggle.
  });
  return mrPromise;
}

async function loadFileModel(ctx, path) {
  const { api, projectId, version, diffs } = await loadMergeRequest(ctx);
  const file = diffs.find((d) => d.new_path === path) ?? diffs.find((d) => d.old_path === path);
  if (!file) throw new Error(`${path} is not part of this merge request version.`);
  const { base_commit_sha: baseSha, head_commit_sha: headSha, start_commit_sha: startSha } = version;

  const [oldText, newText] = await Promise.all([
    file.new_file ? '' : api.getRawFile(projectId, file.old_path, baseSha),
    file.deleted_file ? '' : api.getRawFile(projectId, file.new_path, headSha),
  ]);
  const render = (text) => (text.trim() ? api.renderMarkdown(text, ctx.projectPath) : Promise.resolve(''));
  const [oldHtml, newHtml] = await Promise.all([render(oldText), render(newText)]);

  const parse = (html, sha, filePath) =>
    fixUrls(parseRenderedHtml(html, DOMParser), { webBase: ctx.webBase, projectPath: ctx.projectPath, sha, filePath });

  const hunks = file.diff ? parseUnifiedDiff(file.diff) : localHunks(oldText, newText);

  let threads = [];
  let threadError = '';
  try {
    threads = fileThreads(await api.listDiscussions(projectId, ctx.iid), file, headSha);
  } catch (e) {
    threadError = `Existing comments could not be loaded: ${e.message}`;
  }

  return {
    model: {
      oldRoot: parse(oldHtml, baseSha, file.old_path),
      newRoot: parse(newHtml, headSha, file.new_path),
      map: buildLineMap(hunks),
      oldLineCount: splitLines(oldText).length,
      newLineCount: splitLines(newText).length,
      threads,
      noteUrl: (noteId) => `${ctx.webBase}/${ctx.projectPath}/-/merge_requests/${ctx.iid}#note_${noteId}`,
    },
    threadError,
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
    const { model, threadError, postComment } = await loadFileModel(ctx, path);
    if (ctx.key !== currentKey) return;
    setStatus(state.ui, threadError, !!threadError);
    showReview(document, state.ui, model, postComment);
  } catch (e) {
    console.error('[gitlab-rendered-md]', path, e);
    state.failed = true; // Retried on the next toggle.
    setStatus(state.ui, `Rendering failed: ${e.message}`, true);
  }
}

function toggle(ctx, path) {
  let state = files.get(path);
  if (!state) files.set(path, (state = { active: false, ui: null }));
  state.active = !state.active;
  if (state.active && (!state.ui || state.failed)) {
    state.ui ??= createPanel(document);
    openRendered(ctx, path, state);
  }
  scan();
}

function ensureToggle(ctx, fileEl, path, active) {
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
      toggle(ctx, path);
    });
    container.prepend(btn);
  }
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
    const state = files.get(path);
    const active = !!state?.active;
    ensureToggle(ctx, el, path, active);
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

if (pageContext()) {
  scan();
  new MutationObserver(scheduleScan).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  });
}
