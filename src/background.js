/*
 * gitlab.com is covered by the static content script in manifest.json.
 * Self-managed instances are added in the options page; for each one the
 * user granted host access to, a content script is registered here.
 */

const SCRIPT_ID = 'rmd-self-managed';

async function syncContentScripts() {
  const { instances = [] } = await browser.storage.local.get('instances');
  const matches = [];
  for (const origin of instances) {
    const pattern = originPattern(origin);
    if (pattern && (await browser.permissions.contains({ origins: [pattern] }))) matches.push(pattern);
  }

  const registered = await browser.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  if (registered.length) await browser.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  if (matches.length === 0) return;
  await browser.scripting.registerContentScripts([
    {
      id: SCRIPT_ID,
      matches,
      js: ['content.js'],
      css: ['content.css'],
      runAt: 'document_idle',
    },
  ]);
}

/** `https://gitlab.example.com:8443` -> `https://gitlab.example.com/*` (match patterns carry no port). */
function originPattern(origin) {
  try {
    const url = new URL(origin);
    return `${url.protocol}//${url.hostname}/*`;
  } catch {
    return null;
  }
}

function sync() {
  syncContentScripts().catch((e) => console.error('[gitlab-rendered-md] content script sync failed', e));
}

browser.runtime.onInstalled.addListener(sync);
browser.runtime.onStartup.addListener(sync);
browser.permissions.onAdded.addListener(sync);
browser.permissions.onRemoved.addListener(sync);
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.instances) sync();
});
