// End-to-end check of the add-on in Firefox against the test GitLab. Run through e2e/run.sh.
import { writeFileSync } from 'node:fs';
import { Builder, By, until } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';

const GITLAB = 'http://gitlab.rmd-test.svc.cluster.local';
const UUID = '11111111-2222-3333-4444-555555555555';
const ADDON_ID = 'gitlab-rendered-md@jmnser.github.io';
const OUT = process.env.OUT;
const API = 'http://localhost:18080/api/v4';
const { projectId, iid, path } = JSON.parse(process.env.MR);
const QUERY = process.env.QUERY ?? '';
const TAG = process.env.TAG ?? 'E2E';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const opts = new firefox.Options()
  .setPreference('extensions.webextOptionalPermissionPrompts', false)
  .setPreference('extensions.webextensions.uuids', JSON.stringify({ [ADDON_ID]: UUID }))
  .addArguments('-headless')
  .windowSize({ width: 1400, height: 1000 });
const driver = await new Builder().forBrowser('firefox').usingServer('http://localhost:4445').setFirefoxOptions(opts).build();
const shot = async (name) => writeFileSync(`${OUT}/${TAG}-${name}.png`, await driver.takeScreenshot(), 'base64');
const api = async (path) => (await fetch(API + path, { headers: { 'PRIVATE-TOKEN': process.env.TOKEN } })).json();

try {
  await driver.installAddon(process.env.XPI, true);

  // Sign in.
  await driver.get(`${GITLAB}/users/sign_in`);
  await driver.wait(until.elementLocated(By.id('user_login')), 60000);
  await driver.findElement(By.id('user_login')).sendKeys('root');
  const pw = await driver.findElement(By.id('user_password'));
  await pw.sendKeys(process.env.ROOT_PW);
  await pw.submit();
  await driver.wait(async () => !(await driver.getCurrentUrl()).includes('sign_in'), 60000);

  // Add the self-managed instance in the options page.
  // WebDriver may not navigate to extension pages; load it from the chrome context.
  await driver.setContext(firefox.Context.CHROME);
  await driver.executeScript(
    `gBrowser.selectedBrowser.loadURI(Services.io.newURI(arguments[0]), { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });`,
    `moz-extension://${UUID}/options.html`,
  );
  await driver.setContext(firefox.Context.CONTENT);
  await driver.wait(until.elementLocated(By.id('origin')), 10000);
  await driver.findElement(By.id('origin')).sendKeys(GITLAB);
  await driver.findElement(By.css('#add-form button')).click();
  await driver.wait(async () => (await driver.findElement(By.id('instances')).getText()).includes('gitlab.rmd-test'), 10000);
  const optionsText = await driver.findElement(By.id('instances')).getText();
  check('options: instance added with access', /gitlab\.rmd-test.*\n?.*Granted/.test(optionsText), optionsText.replace(/\n/g, ' | '));
  await shot('01-options');

  // Open the MR changes tab.
  await driver.get(`${GITLAB}/${path}/-/merge_requests/${iid}/diffs${QUERY}`);
  const toggle = await driver.wait(until.elementLocated(By.css('.rmd-toggle')), 90000).catch(() => null);
  check('toggle appears on the changed .md file', !!toggle);
  if (!toggle) {
    await shot('02-no-toggle');
    const html = await driver.executeScript(
      "return [...document.querySelectorAll('.diff-file, [data-testid=\"file-holder-container\"], diff-file')].map(e => e.outerHTML.slice(0, 1500)).join('\\n\\n----\\n\\n')",
    );
    writeFileSync(`${OUT}/diff-dom.html`, String(html));
    throw new Error('toggle missing');
  }
  await shot('02-raw-diff');
  await toggle.click();
  const diff = await driver.wait(until.elementLocated(By.css('.rmd-diff')), 60000).catch(() => null);
  if (!diff) {
    const status = await driver.executeScript("return document.querySelector('.rmd-status')?.textContent");
    check('rendered diff appears', false, String(status));
    await shot('03-failed');
    throw new Error('no diff');
  }
  const stats = await driver.executeScript(`
    const d = document.querySelector('.rmd-diff');
    const t = (sel) => [...d.querySelectorAll(sel)].map(e => e.tagName + ':' + e.textContent.trim().slice(0, 60));
    return {
      rawHidden: getComputedStyle(document.querySelector('.rmd-active .diff-content, .rmd-active .rd-diff-file-body') || document.body).display === 'none',
      added: t(':scope .rmd-added'), removed: t(':scope .rmd-removed'),
      ins: t('.rmd-word-ins'), del: t('.rmd-word-del'),
      seeSame: [...d.querySelectorAll('p')].find(p => p.textContent.startsWith('See'))?.className,
      link: d.querySelector('a[href*="other.md"]')?.href, img: d.querySelector('img[src*="logo"]')?.getAttribute('src'),
      detailsOpen: d.querySelector('details')?.open,
      footnoteSame: [...d.querySelectorAll('p')].find(p => p.textContent.startsWith('Footnote'))?.className,
      status: document.querySelector('.rmd-status')?.textContent,
    };`);
  writeFileSync(`${OUT}/stats.json`, JSON.stringify(stats, null, 2));
  check('raw diff hidden', stats.rawHidden);
  check('reworded paragraph shown as changed with word highlights', stats.del.some((x) => x.includes('will')) && stats.ins.some((x) => x.includes('was')), JSON.stringify([stats.del, stats.ins]));
  check('added paragraph marked', stats.added.some((x) => x.includes('brand new')));
  check('removed paragraph marked', stats.removed.some((x) => x.includes('removed entirely')));
  check('list item change limited to the item', stats.added.some((x) => x.startsWith('LI:2nd')) && !stats.added.some((x) => x.startsWith('UL')));
  check('table row change limited to the row', stats.added.some((x) => x.startsWith('TR:')) && !stats.added.some((x) => x.startsWith('TABLE')));
  check('unchanged paragraph with relative link is unchanged', stats.seeSame?.includes('rmd-same'), stats.seeSame);
  check('relative link resolves to blob at head', /\/-\/blob\/[0-9a-f]{40}\/docs\/other\.md$/.test(stats.link ?? ''), stats.link);
  check('relative image resolves to raw at head', /\/-\/raw\/[0-9a-f]{40}\/docs\/img\/logo\.png$/.test(stats.img ?? ''), stats.img);
  check('changed details block is open', stats.detailsOpen === true);
  check('footnote paragraph is unchanged', stats.footnoteSame?.includes('rmd-same'), stats.footnoteSame);
  const rich = await driver
    .wait(async () => {
      const r = await driver.executeScript(`
        const d = document.querySelector('.rmd-diff');
        return { svgs: d.querySelectorAll('pre.rmd-rich-host svg').length, math: d.querySelectorAll('.rmd-rich-host math').length };`);
      return r.svgs >= 2 && r.math >= 1 ? r : null;
    }, 30000)
    .catch(() => null);
  check('Mermaid diagrams (old and new) and math rendered', !!rich, JSON.stringify(rich));
  await driver.executeScript("document.querySelector('.rmd-panel').scrollIntoView()");
  await shot('03-rendered');

  // Comment on three kinds of blocks.
  async function comment(xpathText, text) {
    const block = await driver.findElement(By.xpath(`//div[contains(@class,'rmd-diff')]//p[starts-with(normalize-space(.), '${xpathText}')]`));
    await driver.executeScript('arguments[0].scrollIntoView({block: "center"})', block);
    await block.click();
    const ta = await driver.wait(until.elementLocated(By.css('.rmd-form textarea')), 5000);
    const label = await driver.findElement(By.css('.rmd-form-label')).getText();
    await ta.sendKeys(text);
    await driver.findElement(By.css('.rmd-form button[type=submit]')).click();
    await driver.wait(async () => (await driver.findElements(By.css('.rmd-form'))).length === 0, 15000).catch(() => {});
    const err = await driver.executeScript("return document.querySelector('.rmd-form .rmd-error')?.textContent || ''");
    return { label, err };
  }
  const c1 = await comment('This paragraph was reworded', `${TAG}: comment on changed paragraph`);
  check('comment on changed paragraph posts', !c1.err, `${c1.label} ${c1.err}`);
  const c2 = await comment('Intro paragraph', `${TAG}: comment on unchanged paragraph`);
  check('comment on unchanged paragraph posts', !c2.err, `${c2.label} ${c2.err}`);
  const c3 = await comment('This paragraph will be removed', `${TAG}: comment on removed paragraph`);
  check('comment on removed paragraph posts', !c3.err, `${c3.label} ${c3.err}`);
  await shot('04-commented');

  const discussions = await api(`/projects/${projectId}/merge_requests/${iid}/discussions`);
  const pos = Object.fromEntries(
    discussions.filter((d) => d.notes[0].body.startsWith(TAG + ':')).map((d) => [d.notes[0].body, d.notes[0].position]),
  );
  writeFileSync(`${OUT}/positions.json`, JSON.stringify(pos, null, 2));
  const p1 = pos[`${TAG}: comment on changed paragraph`];
  const p2 = pos[`${TAG}: comment on unchanged paragraph`];
  const p3 = pos[`${TAG}: comment on removed paragraph`];
  check('changed paragraph -> new_line 5 only', p1?.new_line === 5 && p1?.old_line == null, JSON.stringify(p1 && [p1.old_line, p1.new_line]));
  check('unchanged paragraph -> old 3 / new 3', p2?.new_line === 3 && p2?.old_line === 3, JSON.stringify(p2 && [p2.old_line, p2.new_line]));
  check('removed paragraph -> old_line 7 only', p3?.old_line === 7 && p3?.new_line == null, JSON.stringify(p3 && [p3.old_line, p3.new_line]));

  // After reload, threads appear in the rendered view and GitLab's raw diff knows them.
  await driver.navigate().refresh();
  await driver.wait(until.elementLocated(By.css('.rmd-toggle')), 60000);
  await driver.sleep(3000);
  const notesInRaw = await driver.findElements(By.xpath(`//*[(self::diff-file or contains(@class,'diff-file')) and not(ancestor::*[contains(@class,'rmd-panel')])]//p[starts-with(normalize-space(.), '${TAG}:')]`));
  check('comments visible in GitLab raw diff', notesInRaw.length >= 3, `${notesInRaw.length} notes`);
  await (await driver.wait(until.elementLocated(By.css('.rmd-toggle')), 60000)).click();
  await driver.wait(until.elementLocated(By.css('.rmd-diff')), 60000);
  const threads = await driver.wait(until.elementsLocated(By.css('.rmd-thread')), 15000).catch(() => []);
  check('existing threads shown in rendered view', threads.length >= 3, `${threads.length} threads`);
  await driver.executeScript("document.querySelector('.rmd-panel').scrollIntoView()");
  await shot('05-threads');

  // Toggle back to the raw diff.
  await driver.findElement(By.css('.rmd-toggle')).click();
  await driver.sleep(500);
  const panels = await driver.findElements(By.css('.rmd-panel'));
  check('toggle off restores raw diff', panels.length === 0);
} catch (e) {
  console.log('ERROR', e.message);
  await shot('99-error').catch(() => {});
} finally {
  writeFileSync(`${OUT}/${TAG}-results.json`, JSON.stringify(results, null, 2));
  await driver.quit();
}
