const DEFAULT_ORIGIN = 'https://gitlab.com';

const form = document.getElementById('add-form');
const input = document.getElementById('origin');
const addError = document.getElementById('add-error');
const tbody = document.querySelector('#instances tbody');

async function load() {
  const { instances = [], tokens = {} } = await browser.storage.local.get(['instances', 'tokens']);
  return { instances, tokens };
}

function pattern(origin) {
  const url = new URL(origin);
  return `${url.protocol}//${url.hostname}/*`;
}

function cell(child) {
  const td = document.createElement('td');
  if (typeof child === 'string') td.textContent = child;
  else if (child) td.append(child);
  return td;
}

async function render() {
  const { instances, tokens } = await load();
  tbody.replaceChildren();
  for (const origin of [DEFAULT_ORIGIN, ...instances]) {
    const granted = await browser.permissions.contains({ origins: [pattern(origin)] });

    const token = document.createElement('input');
    token.type = 'password';
    token.autocomplete = 'off';
    token.placeholder = 'Use browser sign-in';
    token.value = tokens[origin] ?? '';
    token.addEventListener('change', async () => {
      const current = (await load()).tokens;
      if (token.value.trim()) current[origin] = token.value.trim();
      else delete current[origin];
      await browser.storage.local.set({ tokens: current });
    });

    let action = null;
    if (origin !== DEFAULT_ORIGIN) {
      action = document.createElement('button');
      action.textContent = 'Remove';
      action.addEventListener('click', async () => {
        const state = await load();
        delete state.tokens[origin];
        await browser.storage.local.set({
          instances: state.instances.filter((o) => o !== origin),
          tokens: state.tokens,
        });
        await browser.permissions.remove({ origins: [pattern(origin)] });
        render();
      });
    }

    let access = granted ? 'Granted' : 'Not granted';
    if (!granted) {
      access = document.createElement('button');
      access.textContent = 'Grant access';
      // permissions.request must run directly in the click handler.
      access.addEventListener('click', () => browser.permissions.request({ origins: [pattern(origin)] }).then(render));
    }

    const tr = document.createElement('tr');
    tr.append(cell(origin), cell(access), cell(token), cell(action));
    tbody.append(tr);
  }
}

form.addEventListener('submit', (ev) => {
  ev.preventDefault();
  addError.hidden = true;
  let origin;
  try {
    const url = new URL(input.value.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Use an http or https address.');
    origin = url.origin;
  } catch (e) {
    addError.textContent = e.message;
    addError.hidden = false;
    return;
  }
  // Requested synchronously inside the submit handler to keep the user gesture.
  browser.permissions
    .request({ origins: [pattern(origin)] })
    .then(async (granted) => {
      if (!granted) throw new Error(`Access to ${origin} was not granted.`);
      const { instances } = await load();
      if (!instances.includes(origin) && origin !== DEFAULT_ORIGIN) {
        await browser.storage.local.set({ instances: [...instances, origin] });
      }
      input.value = '';
      render();
    })
    .catch((e) => {
      addError.textContent = e.message;
      addError.hidden = false;
    });
});

render();
