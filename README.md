# GitLab Rendered Markdown Review

A Firefox add-on to read and comment on Markdown files in GitLab merge requests as rendered documents
instead of raw source.

GitLab shows `.md` changes in merge requests only as raw text
([gitlab-org/gitlab#17000](https://gitlab.com/gitlab-org/gitlab/-/issues/17000)).
This add-on adds a rendered review view to the **Changes** tab.

## Features

| Feature | Behaviour |
|---------|-----------|
| **Rendered** toggle | A button in the header of every changed Markdown file (`.md`, `.markdown`, `.mdown`, `.mkd`, `.mkdn`). It swaps GitLab's raw diff for the rendered view and back. |
| Rendered diff | The HTML from GitLab is sanitized again with DOMPurify before display. Unchanged blocks appear as normal. Added blocks are green, removed blocks red. In changed paragraphs, list items and table rows, the changed words are highlighted. |
| Comments | Click a paragraph, heading, list item, table row or code block to comment on it. The comment is a normal GitLab diff comment on the matching source line, visible to everyone in the raw diff as well. |
| Existing threads | Diff comments of the current version appear under the block they belong to, with a link to the thread in GitLab. |

## How it works

1. The content script reads the merge request from the page URL and fetches the current
   [MR diff version](https://docs.gitlab.com/api/merge_requests/#get-a-single-merge-request-diff-version)
   (base, start and head SHA and the file diffs).
2. It fetches the file at the base and head SHA and renders both versions with
   [`POST /api/v4/markdown`](https://docs.gitlab.com/api/markdown/), so the output matches GitLab's own rendering (GLFM, references, emoji).
3. The two rendered trees are diffed block by block. Lists, block quotes and tables are diffed item by item.
4. Every rendered block carries `data-sourcepos="start:col-end:col"`. A click on a block maps it to its source lines.
   The unified diff maps that line to a diff position (added line, removed line, or unchanged line with both line
   numbers), and the comment is created with
   [`POST /merge_requests/:iid/discussions`](https://docs.gitlab.com/api/discussions/#create-a-new-thread-in-the-merge-request-diff).

### Which source line a comment uses

| Clicked block | Line used |
|---------------|-----------|
| Added or changed block | The last added line inside the block |
| Removed block | The last removed line inside the block |
| Unchanged block | The last line of the block (old and new line number) |

## Decisions

| Question | Decision |
|----------|----------|
| gitlab.com or self-managed? | Both. gitlab.com works after install. Self-managed instances are added in the add-on options; Firefox asks for access to each host. Instances served under a sub-path (`https://example.com/gitlab`) are supported. |
| Token or OAuth? | Neither by default. The add-on calls the API as the page itself (Firefox `content.fetch`), with the browser's GitLab session cookie and the page's CSRF token, which is how GitLab's own frontend calls the API. A personal access token (scope `api`) can be set per https instance in the options as a fallback. It is stored in the local browser profile only. |

## Limitations

- Client-side rendered content (Mermaid, PlantUML, math) appears as code, because GitLab renders it in the browser.
- Comment threads from earlier MR versions are not shown in the rendered view; they stay visible in GitLab.
- When GitLab compares two MR versions (`start_sha`), the rendered view still shows the full diff of the selected version and says so.
- Files too large for GitLab to send a diff and too large for an exact local diff are shown read-only.
- Comments posted from the rendered view appear in GitLab's raw diff after a page reload.
- The add-on relies on GitLab's Changes tab markup (`.diff-file[data-path]`). All selectors are in
  [`src/content/gitlab-dom.js`](src/content/gitlab-dom.js).

## Development

Requires Node.js 22 or later and Firefox 142 or later.

```sh
npm install
npm test          # unit tests (node:test + jsdom)
npm run lint      # build and run web-ext lint
npm start         # build and start Firefox with the add-on loaded
npm run package   # build a .zip for AMO into artifacts/
```

`npm run build` writes the unpacked add-on to `dist/`. To load it manually, open `about:debugging#/runtime/this-firefox`,
choose **Load Temporary Add-on**, and select `dist/manifest.json`.

| Path | Content |
|------|---------|
| `src/content/main.js` | Content script: finds Markdown files, toggles the view, loads data |
| `src/content/review.js` | Rendered panel, block selection, comment form, threads |
| `src/content/gitlab-dom.js` | GitLab page selectors |
| `src/lib/blockdiff.js` | Block and word diff of two rendered HTML trees |
| `src/lib/linemap.js` | Unified diff parsing, line mapping, comment line choice |
| `src/lib/api.js` | GitLab REST API client |
| `src/background.js` | Registers the content script for self-managed instances |
| `src/options/` | Options page: instances and tokens |

## License

[MIT](LICENSE)
