// Creates a new project root/docs-<timestamp> with docs/guide.md on main, a changed version on a branch, and an MR.
const OLD = `# Guide

Intro paragraph that stays the same.

This paragraph will be reworded slightly in the new version.

This paragraph will be removed entirely.

- first item
- second item
- third item

| Name | Value |
|------|-------|
| a    | 1     |
| b    | 2     |

See [the other doc](other.md) and ![logo](img/logo.png).

<details>
<summary>More</summary>

Hidden text.

</details>

Footnote reference[^1].

[^1]: The footnote.

Euler: $\`e^{i\\pi} + 1 = 0\`$

\`\`\`mermaid
graph TD
  A --> B
\`\`\`
`;

const NEW = `# Guide

Intro paragraph that stays the same.

This paragraph was reworded slightly in the new version.

A brand new paragraph was added here.

- first item
- 2nd item
- third item

| Name | Value |
|------|-------|
| a    | 1     |
| b    | 3     |

See [the other doc](other.md) and ![logo](img/logo.png).

<details>
<summary>More</summary>

Hidden text, now changed.

</details>

Footnote reference[^1].

[^1]: The footnote.

Euler: $\`e^{i\\pi} + 1 = 0\`$

\`\`\`mermaid
graph TD
  A --> C
\`\`\`
`;

const API = 'http://localhost:18080/api/v4';
const NAME = `docs-${Date.now()}`;
const H = { 'PRIVATE-TOKEN': process.env.TOKEN, 'Content-Type': 'application/json' };
async function call(method, path, body) {
  const res = await fetch(API + path, { method, headers: H, body: body && JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text}`);
  return JSON.parse(text);
}
const project = await call('POST', '/projects', { name: NAME, initialize_with_readme: true, visibility: 'private' });
const id = project.id;
const file = encodeURIComponent('docs/guide.md');
await call('POST', `/projects/${id}/repository/files/${file}`, { branch: 'main', content: OLD, commit_message: 'docs: add guide' });
await call('POST', `/projects/${id}/repository/branches`, { branch: 'update-guide', ref: 'main' });
// A new branch can take a moment to become writable.
for (let attempt = 1; ; attempt++) {
  try {
    await call('PUT', `/projects/${id}/repository/files/${file}`, { branch: 'update-guide', content: NEW, commit_message: 'docs: update guide' });
    break;
  } catch (e) {
    if (attempt === 10) throw e;
    await new Promise((r) => setTimeout(r, 2000));
  }
}
const mr = await call('POST', `/projects/${id}/merge_requests`, { source_branch: 'update-guide', target_branch: 'main', title: 'Update guide' });
console.log(JSON.stringify({ projectId: id, iid: mr.iid, path: project.path_with_namespace }));
