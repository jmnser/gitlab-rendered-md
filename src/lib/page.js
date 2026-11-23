/** `https://gitlab.example.com:8443` -> `https://gitlab.example.com/*` (match patterns carry no port). */
export function hostPattern(origin) {
  const url = new URL(origin);
  return `${url.protocol}//${url.hostname}/*`;
}

/** File extensions treated as Markdown. */
export const MARKDOWN_FILE = /\.(md|markdown|mdown|mkd|mkdn)$/i;

/**
 * Extracts the merge request from a GitLab page.
 *
 * `bodyFullPath` is GitLab's `<body data-project-full-path>`; when present it
 * separates a relative URL root (self-managed instances served under a
 * sub-path) from the project path.
 */
export function parseMergeRequestPath(pathname, bodyFullPath) {
  const m = /^(.*?)\/-\/merge_requests\/(\d+)(?:[/?#]|$)/.exec(pathname);
  if (!m) return null;
  const before = m[1];
  let urlRoot = '';
  let projectPath = before.replace(/^\//, '');
  if (bodyFullPath && before.endsWith(`/${bodyFullPath}`)) {
    urlRoot = before.slice(0, before.length - bodyFullPath.length - 1);
    projectPath = bodyFullPath;
  }
  if (!projectPath) return null;
  return { urlRoot, projectPath, iid: Number(m[2]) };
}
