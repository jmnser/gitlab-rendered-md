import { hostPattern } from './lib/page.js';

/*
 * gitlab.com is covered by the static content script in manifest.json.
 * Self-managed instances get a content script here once the user granted host access.
 */

const SCRIPT_ID = 'rmd-self-managed';

async function syncContentScripts() {
  const { instances = [] } = await browser.storage.local.get('instances');
  const matches = [];
  for (const origin of instances) {
    const pattern = hostPattern(origin);
    if (await browser.permissions.contains({ origins: [pattern] })) matches.push(pattern);
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

// Syncs run one after another; overlapping runs would register the same id twice.
let queue = Promise.resolve();
function sync() {
  queue = queue
    .then(syncContentScripts)
    .catch((e) => console.error('[gitlab-rendered-md] content script sync failed', e));
}

browser.runtime.onInstalled.addListener(sync);
browser.runtime.onStartup.addListener(sync);
browser.permissions.onAdded.addListener(sync);
browser.permissions.onRemoved.addListener(sync);
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.instances) sync();
});
