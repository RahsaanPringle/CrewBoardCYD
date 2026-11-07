import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const targets = ['#schedule-pane', '#messages-pane', '#roster-pane', '#locations-pane', '#customers-pane'];
const assets = ['../CrewBoard_CYD/sd-card/crewboard/www/', '../crewboard/www/'];

function fixture(asset, { saved = null, failure, missingPane, disabledTab } = {}) {
  const handlers = [];
  const writes = [];
  const warnings = [];
  const requests = [];
  const shown = [];
  const mapRenders = [];
  const buttons = targets.map((target) => ({
    disabled: target === disabledTab,
    getAttribute: () => target
  }));
  const document = {
    querySelectorAll: () => buttons,
    getElementById: (id) => id === missingPane ? null : { id, addEventListener() {} }
  };
  const window = { CrewBoardTheme: {} };
  const chain = {
    on(event, selector, handler) { handlers.push({ event, selector, handler }); return this; },
    removeClass() { return this; },
    addClass() { return this; },
    text() { return this; },
    html() { return ''; }
  };
  function $(selector) {
    return selector === '#location-map'
      ? { html(value) { mapRenders.push(value); return this; } }
      : chain;
  }
  $.extend = (deep, defaults, options) => ({ ...defaults, ...options });
  $.ajax = (settings) => {
    requests.push(settings.url);
    return { done() { return this; }, fail() { return this; } };
  };
  function emit(button, event = 'shown.bs.tab') {
    const target = button.getAttribute('data-bs-target');
    for (const entry of handlers) {
      if (entry.event === event && (entry.selector === 'button[data-bs-target]' ||
        entry.selector === `button[data-bs-target="${target}"]`)) entry.handler.call(button);
    }
  }
  const context = {
    document, window, jQuery: $, console: { warn: (message) => warnings.push(message) },
    bootstrap: {
      Modal: class {},
      Tab: { getOrCreateInstance: (button) => ({ show() { shown.push(button); emit(button); } }) }
    }
  };
  Object.defineProperty(context, 'localStorage', {
    get() {
      if (failure === 'access') throw new Error('Storage blocked');
      return {
        getItem(key) {
          assert.equal(key, 'crewboard.activeTab');
          if (failure === 'read') throw new Error('Storage read blocked');
          return saved;
        },
        setItem(key, value) {
          if (failure === 'write') throw new Error('Storage quota exceeded');
          writes.push([key, value]);
        }
      };
    }
  });
  const source = fs.readFileSync(new URL('app.js', new URL(asset, import.meta.url)), 'utf8').replace(
    '})(jQuery);', 'window.tabTestState = state; })(jQuery);'
  );
  vm.runInNewContext(source, context);
  return { buttons, writes, warnings, requests, shown, mapRenders, emit, state: window.tabTestState };
}

for (const asset of assets) {
  test(`${asset} restores each primary tab through Bootstrap without blocking API loading`, () => {
    for (const saved of targets) {
      const f = fixture(asset, { saved });
      assert.deepEqual(f.shown, [f.buttons[targets.indexOf(saved)]]);
      assert.deepEqual(f.writes, [['crewboard.activeTab', saved]]);
      assert.deepEqual(f.requests, ['/api/v1/themes', '/api/v1/session']);
      assert.deepEqual(f.warnings, []);
      assert.equal(f.mapRenders.length, saved === '#locations-pane' ? 1 : 0);
    }
  });

  test(`${asset} ignores missing, invalid, unavailable and disabled targets`, () => {
    for (const options of [
      {}, { saved: '' }, { saved: '#obsolete-pane' }, { saved: 'Messages' },
      { saved: '"]' }, { saved: '#messages-pane', missingPane: 'messages-pane' },
      { saved: '#messages-pane', disabledTab: '#messages-pane' }
    ]) {
      const f = fixture(asset, options);
      assert.deepEqual(f.shown, []);
      assert.deepEqual(f.writes, []);
      assert.deepEqual(f.requests, ['/api/v1/themes', '/api/v1/session']);
    }
    const html = fs.readFileSync(new URL('index.html', new URL(asset, import.meta.url)), 'utf8');
    assert.match(html, /class="nav-link active"[^>]*data-bs-target="#schedule-pane"/);
    assert.match(html, /id="schedule-pane" class="tab-pane fade show active"/);
  });

  test(`${asset} persists only completed primary tab selections`, () => {
    const f = fixture(asset);
    for (const button of f.buttons) f.emit(button, 'show.bs.tab');
    assert.deepEqual(f.writes, []);
    for (const button of f.buttons) f.emit(button);
    assert.deepEqual(f.writes, targets.map((target) => ['crewboard.activeTab', target]));
  });

  test(`${asset} storage failures are nonfatal and leave navigation and API loading usable`, () => {
    for (const failure of ['access', 'read', 'write']) {
      const f = fixture(asset, { failure });
      assert.deepEqual(f.shown, []);
      assert.equal(f.state.scheduleView, 'calendar');
      f.emit(f.buttons[3]);
      assert.equal(f.mapRenders.length, 1);
      assert.deepEqual(f.writes, failure === 'read' ? [['crewboard.activeTab', '#locations-pane']] : []);
      assert.ok(f.warnings.length > 0);
      assert.deepEqual(f.requests, ['/api/v1/themes', '/api/v1/session']);
    }
    const f = fixture(asset, { saved: '#messages-pane', failure: 'write' });
    assert.deepEqual(f.shown, [f.buttons[1]]);
    assert.deepEqual(f.writes, []);
    assert.equal(f.warnings.length, 1);
  });

  test(`${asset} restores Schedule with Calendar and retains its subview while switching tabs`, () => {
    const f = fixture(asset, { saved: '#schedule-pane' });
    assert.equal(f.state.scheduleView, 'calendar');
    assert.equal(f.state.selectedDay, '');
    f.state.scheduleView = 'list';
    f.state.selectedDay = '2024-02-29';
    f.emit(f.buttons[1]);
    f.emit(f.buttons[0]);
    assert.equal(f.state.scheduleView, 'list');
    assert.equal(f.state.selectedDay, '2024-02-29');
  });
}
