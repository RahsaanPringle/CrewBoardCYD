import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const assets = ['../CrewBoard_CYD/sd-card/crewboard/www/', '../crewboard/www/'];

function fixture(asset, { saved = null, site = '', storageBlocked = false } = {}) {
  const html = fs.readFileSync(new URL('index.html', new URL(asset, import.meta.url)), 'utf8');
  const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script);
  const attributes = new Map();
  const timers = new Map();
  const warnings = [];
  const writes = [];
  let nextTimer = 1;
  const head = {
    children: [],
    appendChild(node) { node.parentNode = this; this.children.push(node); return node; },
    insertBefore(node, anchor) {
      const index = this.children.indexOf(anchor);
      assert.notEqual(index, -1);
      node.parentNode = this;
      this.children.splice(index, 0, node);
    },
    removeChild(node) {
      const index = this.children.indexOf(node);
      assert.notEqual(index, -1);
      this.children.splice(index, 1);
      node.parentNode = null;
    }
  };
  const document = {
    head,
    documentElement: {
      setAttribute(name, value) { attributes.set(name, value); },
      removeAttribute(name) { attributes.delete(name); }
    },
    createComment() { return {}; },
    createElement(name) { assert.equal(name, 'link'); return { tagName: 'LINK' }; }
  };
  const window = {
    CREWBOARD_SITE_THEME: site,
    setTimeout(callback, delay) { const id = nextTimer++; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); }
  };
  const localStorage = {
    getItem(key) { assert.equal(key, 'crewboard.theme'); if (storageBlocked) throw new Error('blocked'); return saved; },
    setItem(key, value) { if (storageBlocked) throw new Error('blocked'); writes.push([key, value]); },
    removeItem(key) { if (storageBlocked) throw new Error('blocked'); writes.push([key, null]); }
  };
  vm.runInNewContext(script, { document, window, localStorage, console: { warn: (message) => warnings.push(message) } });
  return {
    html, attributes, timers, warnings, writes, theme: window.CrewBoardTheme,
    links: () => head.children.filter((node) => node.tagName === 'LINK'),
    fireTimer() {
      const [id, timer] = timers.entries().next().value;
      timers.delete(id);
      timer.callback();
    }
  };
}

for (const asset of assets) {
  test(`${asset} shows a loading status until the chosen initial theme is ready`, () => {
    const f = fixture(asset, { saved: 'sketchy.min.css', site: 'cosmo.min.css' });
    assert.match(f.html, /id="theme-loading" role="status">Loading CrewBoard\.\.\.<\/div>/);
    assert.ok(f.attributes.has('data-crew-theme-pending'));
    assert.equal([...f.timers.values()][0].delay, 3000);
    const initial = f.links()[0];
    assert.equal(initial.href, 'css/sketchy.min.css');
    initial.onload();
    assert.equal(f.attributes.has('data-crew-theme-pending'), false);
    assert.equal(f.timers.size, 0);

    f.theme.choose('classic');
    const replacement = f.links()[1];
    assert.equal(replacement.href, 'vendor/bootstrap.min.css');
    assert.ok(initial.parentNode);
    assert.equal(f.attributes.has('data-crew-theme-pending'), false);
    replacement.onload();
    assert.equal(initial.parentNode, null);
    assert.equal(f.attributes.get('data-crew-palette'), 'classic');
    assert.deepEqual(f.writes, [['crewboard.theme', 'classic']]);
    assert.deepEqual(f.warnings, []);
  });

  test(`${asset} falls back to classic and stops retrying if its stylesheet also fails`, () => {
    const f = fixture(asset, { saved: 'missing.css' });
    f.links()[0].onerror();
    assert.equal(f.links().length, 1);
    assert.equal(f.links()[0].href, 'vendor/bootstrap.min.css');
    assert.ok(f.attributes.has('data-crew-theme-pending'));
    f.links()[0].onerror();
    assert.equal(f.links().length, 0);
    assert.equal(f.attributes.has('data-crew-theme-pending'), false);
    assert.equal(f.timers.size, 0);
    assert.equal(f.warnings.length, 2);

    const success = fixture(asset, { saved: 'missing.css' });
    success.links()[0].onerror();
    success.links()[0].onload();
    assert.equal(success.attributes.get('data-crew-palette'), 'classic');
    assert.equal(success.attributes.has('data-crew-theme-pending'), false);
  });

  test(`${asset} reveals the page if a theme stalls or storage is unavailable`, () => {
    const slow = fixture(asset, { saved: 'sketchy.min.css' });
    slow.fireTimer();
    assert.equal(slow.attributes.has('data-crew-theme-pending'), false);
    assert.equal(slow.warnings.length, 1);
    slow.links()[0].onload();
    assert.equal(slow.attributes.has('data-crew-theme-pending'), false);

    const blocked = fixture(asset, { site: 'cosmo.min.css', storageBlocked: true });
    assert.equal(blocked.links()[0].href, 'css/cosmo.min.css');
    blocked.links()[0].onload();
    assert.doesNotThrow(() => blocked.theme.choose('classic'));
    assert.equal(blocked.links()[1].href, 'vendor/bootstrap.min.css');
  });
}
