/**
 * Minimal GitLab REST API client.
 *
 * Authentication: by default it reuses the signed-in browser session (cookie
 * plus the page's CSRF token for writes), so no token or OAuth setup is
 * needed. If a personal access token is configured, it is sent instead.
 */
export function createApi({ apiBase, token, csrfToken, fetchImpl }) {
  async function request(path, { method = 'GET', body, as = 'json' } = {}) {
    const headers = { Accept: as === 'json' ? 'application/json' : '*/*' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers['PRIVATE-TOKEN'] = token;
    else if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;

    const res = await fetchImpl(`${apiBase}${path}`, {
      method,
      headers,
      credentials: token ? 'omit' : 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      let detail = '';
      try {
        const data = await res.json();
        detail = typeof data.message === 'string' ? data.message : JSON.stringify(data.message ?? data.error ?? data);
      } catch {
        // No JSON error body.
      }
      throw new Error(`GitLab API ${method} ${path.split('?')[0]} failed: ${res.status}${detail ? ` ${detail}` : ''}`);
    }
    if (as === 'text') return res.text();
    return { data: await res.json(), headers: res.headers };
  }

  const json = async (path, opts) => (await request(path, opts)).data;

  async function paged(path) {
    const items = [];
    let page = '1';
    const sep = path.includes('?') ? '&' : '?';
    while (page) {
      const { data, headers } = await request(`${path}${sep}per_page=100&page=${page}`);
      items.push(...data);
      page = headers.get('x-next-page') || '';
    }
    return items;
  }

  const enc = encodeURIComponent;
  const mr = (projectId, iid) => `/projects/${enc(projectId)}/merge_requests/${iid}`;

  return {
    getProject: (projectPath) => json(`/projects/${enc(projectPath)}`),
    listVersions: (projectId, iid) => json(`${mr(projectId, iid)}/versions`),
    getVersion: (projectId, iid, versionId) => json(`${mr(projectId, iid)}/versions/${versionId}`),
    getRawFile: (projectId, filePath, ref) =>
      request(`/projects/${enc(projectId)}/repository/files/${enc(filePath)}/raw?ref=${enc(ref)}`, { as: 'text' }),
    async renderMarkdown(text, projectPath) {
      const { html } = await json('/markdown', { method: 'POST', body: { text, gfm: true, project: projectPath } });
      return html;
    },
    listDiscussions: (projectId, iid) => paged(`${mr(projectId, iid)}/discussions`),
    createDiscussion: (projectId, iid, body, position) =>
      json(`${mr(projectId, iid)}/discussions`, { method: 'POST', body: { body, position } }),
  };
}
