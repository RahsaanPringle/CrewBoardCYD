import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const assets = ['../CrewBoard_CYD/sd-card/crewboard/www/', '../crewboard/www/'];
const defaultNow = Date.parse('2024-02-28T15:00:00Z');

function fixture(asset, now = defaultNow) {
  const handlers = [];
  const nodes = new Map();
  const views = ['list', 'calendar'].map((view) => ({
    dataset: { view }, classes: new Set(), attributes: {}
  }));
  let focused = '';
  const form = {
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
  const node = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, { classes: new Set(), attributes: {}, html: '', text: '' });
    return nodes.get(selector);
  };
  const document = {
    getElementById(id) {
      if (id === 'record-form') return form;
      return { id, focus() { focused = id; } };
    },
    querySelectorAll() { return []; },
    querySelector(selector) {
      const markup = node('#schedule-calendar').html;
      const date = /data-date="([^"]+)"/.exec(selector);
      if (date && markup.includes(`data-date="${date[1]}"`)) {
        return { focus() { focused = `date:${date[1]}`; } };
      }
      const step = /data-step="([^"]+)"/.exec(selector);
      if (step) {
        const button = markup.match(new RegExp(`<button[^>]*data-step="${step[1]}"[^>]*>`));
        if (button) return {
          disabled: /\sdisabled(?:\s|>)/.test(button[0]),
          focus() { focused = `nav:${step[1]}`; }
        };
      }
      return null;
    }
  };
  const chain = (element) => ({
    on(event, selector, handler) {
      if (element === document && typeof selector === 'string') handlers.push({ event, selector, handler });
      return this;
    },
    toggleClass(name, enabled) {
      if (enabled) element.classes.add(name);
      else element.classes.delete(name);
      return this;
    },
    removeClass(name) { if (name) element.classes.delete(name); return this; },
    addClass(name) { if (name) element.classes.add(name); return this; },
    attr(name, value) { element.attributes[name] = String(value); return this; },
    data(name) { return element.dataset[name]; },
    text(value) { element.text = value; return this; },
    html(value) { if (value === undefined) return element.html; element.html = value; return this; },
    scrollTop() { return this; }
  });
  function $(selector) {
    if (selector === '<div>') {
      return {
        text(value) { this.value = String(value); return this; },
        html() { return this.value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
      };
    }
    if (selector === '.schedule-view') {
      return { each(callback) { views.forEach((view) => callback.call(view)); return this; } };
    }
    if (selector === document) return chain(document);
    if (typeof selector === 'object') return chain(selector);
    return chain(node(selector));
  }
  $.extend = (...args) => Object.assign(...args.filter((value) => typeof value !== 'boolean'));
  $.ajax = () => ({ done() { return this; }, fail() { return this; } });
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const window = {};
  const context = {
    document, window, jQuery: $, Date: FixedDate, console,
    localStorage: { getItem() { return null; } },
    bootstrap: { Modal: class { show() {} }, Tab: { getOrCreateInstance() {} } }
  };
  const source = fs.readFileSync(new URL('app.js', new URL(asset, import.meta.url)), 'utf8').replace(
    '})(jQuery);',
    'window.scheduleTest = { state, dateKey, localDate, scheduleDate, scheduleDateLabel, renderSchedule, setScheduleView, selectScheduleDay, navigateCalendar, openEditor }; })(jQuery);'
  );
  vm.runInNewContext(source, context);
  const api = window.scheduleTest;
  api.state.session = { isAdmin: true, username: 'owner' };
  api.state.locations = [{ id: 'loc-1', name: 'Test site' }];
  api.state.roster = [{ id: 'emp-1', name: 'Test crew', active: true }];
  return {
    api, views, node, focused: () => focused,
    emit(selector, data) {
      const entry = handlers.find((item) => item.event === 'click' && item.selector === selector);
      assert.ok(entry, `Missing handler for ${selector}`);
      entry.handler.call({ dataset: data });
    }
  };
}

function job(id, title, date, startTime, notes = '') {
  return { id, title, date, startTime, endTime: '17:00', locationId: 'loc-1', crewIds: ['emp-1'], notes };
}

function dateButton(markup, date) {
  const button = markup.match(new RegExp(`<button[^>]*data-date="${date}"[^>]*>`));
  assert.ok(button, `Missing date button ${date}`);
  return button[0];
}

function localizedDate(year, month, day) {
  return new Date(year, month - 1, day, 12).toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });
}

function inTimezone(timezone, run) {
  const previous = process.env.TZ;
  process.env.TZ = timezone;
  try { run(); } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

for (const asset of assets) {
  test(`${asset} starts with an unselected calendar and accessible date buttons`, () => inTimezone('America/New_York', () => {
    const html = fs.readFileSync(new URL('index.html', new URL(asset, import.meta.url)), 'utf8');
    assert.match(html, /class="btn btn-outline-secondary schedule-view" data-view="list"[^>]*aria-pressed="false"/);
    assert.match(html, /class="btn btn-outline-secondary schedule-view active" data-view="calendar"[^>]*aria-pressed="true"/);
    assert.match(html, /id="schedule-list" class="d-none"/);
    assert.match(html, /id="schedule-calendar"><\/div>/);

    const f = fixture(asset);
    f.api.state.schedule = [job('leap', 'Leap job', '2024-02-29', '09:00')];
    assert.equal(f.api.state.scheduleView, 'calendar');
    assert.equal(f.api.state.selectedDay, '');
    f.api.renderSchedule();
    const calendar = f.node('#schedule-calendar').html;
    assert.equal(f.api.dateKey(f.api.state.calendarMonth), '2024-02-01');
    assert.equal((calendar.match(/data-date="/g) || []).length, 29);
    assert.match(dateButton(calendar, '2024-02-28'), /is-today.*aria-pressed="false" aria-current="date"/);
    assert.doesNotMatch(dateButton(calendar, '2024-02-28'), /is-selected/);
    assert.ok(dateButton(calendar, '2024-02-29').includes(localizedDate(2024, 2, 29) + ', 1 scheduled job'));
    assert.doesNotMatch(calendar, /<article/);
    assert.equal(f.views[0].attributes['aria-pressed'], 'false');
    assert.equal(f.views[1].attributes['aria-pressed'], 'true');
  }));

  test(`${asset} drills into a sorted date list and preserves it across changes`, () => inTimezone('America/New_York', () => {
    const f = fixture(asset);
    f.api.state.schedule = [
      job('later', 'Later', '2024-02-29', '15:00', 'Bring tools'),
      job('beta', 'Beta', '2024-02-29', '08:00'),
      job('alpha', 'Alpha', '2024-02-29', '08:00'),
      job('early', 'Early', '2024-02-29', '07:30'),
      job('other', 'Other date', '2024-03-01', '06:00'),
      job('invalid', 'Invalid date', '2024-02-30', '06:00'),
      job('legacy', 'Noncanonical date', '__proto__', '06:00')
    ];
    f.api.renderSchedule();
    assert.match(dateButton(f.node('#schedule-calendar').html, '2024-02-29'), /4 scheduled jobs/);
    f.emit('.calendar-day[data-date]', { date: '2024-02-29' });
    assert.equal(f.api.state.scheduleView, 'list');
    assert.equal(f.api.state.selectedDay, '2024-02-29');
    assert.equal(f.focused(), 'schedule-list-heading');
    assert.equal(f.node('#schedule-list-heading').text, 'Jobs for ' + localizedDate(2024, 2, 29));
    const cards = f.node('#schedule-list-cards').html;
    assert.ok(cards.indexOf('Early') < cards.indexOf('Alpha'));
    assert.ok(cards.indexOf('Alpha') < cards.indexOf('Beta'));
    assert.ok(cards.indexOf('Beta') < cards.indexOf('Later'));
    assert.doesNotMatch(cards, /Other date|Invalid date|Noncanonical date/);
    assert.match(cards, /Test site/);
    assert.match(cards, /Test crew/);
    assert.match(cards, /Bring tools/);
    assert.match(cards, /edit-record/);
    assert.match(cards, /delete-record/);
    assert.equal(f.views[0].attributes['aria-pressed'], 'true');
    assert.equal(f.views[1].attributes['aria-pressed'], 'false');

    f.api.state.schedule.push(job('added', 'Added', '2024-02-29', '10:00'));
    f.api.state.schedule[0].date = '2024-03-01';
    f.api.state.schedule = f.api.state.schedule.filter((record) => record.id !== 'beta');
    f.api.renderSchedule();
    const updated = f.node('#schedule-list-cards').html;
    assert.match(updated, /Added/);
    assert.doesNotMatch(updated, /Later|Beta|Other date|Invalid date|Noncanonical date/);
    assert.equal(f.api.state.selectedDay, '2024-02-29');
    f.api.state.session.isAdmin = false;
    f.api.renderSchedule();
    assert.doesNotMatch(f.node('#schedule-list-cards').html, /edit-record|delete-record/);
  }));

  test(`${asset} handles empty days, direct List, navigation, focus, and date prefilling`, () => inTimezone('America/New_York', () => {
    const f = fixture(asset);
    f.api.renderSchedule();
    f.api.openEditor('schedule', '', '', null);
    assert.match(f.node('#record-fields').html, /id="field-date"[^>]*value="2024-02-28"/);
    f.emit('.schedule-view', { view: 'list' });
    assert.equal(f.api.state.selectedDay, '2024-02-28');
    assert.ok(f.node('#schedule-list-cards').html.includes('No jobs are scheduled for ' + localizedDate(2024, 2, 28)));
    f.emit('.schedule-view', { view: 'calendar' });
    assert.equal(f.focused(), 'date:2024-02-28');
    assert.match(dateButton(f.node('#schedule-calendar').html, '2024-02-28'), /is-selected.*aria-pressed="true" aria-current="date"/);

    f.emit('.calendar-nav', { step: 1 });
    assert.equal(f.api.dateKey(f.api.state.calendarMonth), '2024-03-01');
    assert.equal(f.api.state.selectedDay, '2024-02-28');
    assert.equal(f.focused(), 'nav:1');
    f.emit('.calendar-nav', { step: 0 });
    assert.equal(f.api.dateKey(f.api.state.calendarMonth), '2024-02-01');
    assert.equal(f.api.state.selectedDay, '2024-02-28');
    assert.equal(f.focused(), 'nav:0');
    f.emit('.calendar-nav', { step: 1 });
    f.emit('.calendar-day[data-date]', { date: '2024-03-20' });
    assert.equal(f.api.state.selectedDay, '2024-03-20');
    assert.ok(f.node('#schedule-list-cards').html.includes('No jobs are scheduled for ' + localizedDate(2024, 3, 20)));
    f.api.openEditor('schedule', '', '', null);
    assert.match(f.node('#record-fields').html, /id="field-date"[^>]*value="2024-03-20"/);
    f.api.state.schedule = [job('existing', 'Existing', '2024-02-29', '09:00')];
    f.api.openEditor('schedule', 'existing', '', null);
    assert.match(f.node('#record-fields').html, /id="field-date"[^>]*value="2024-02-29"/);
    f.emit('.schedule-view', { view: 'calendar' });
    assert.equal(f.api.dateKey(f.api.state.calendarMonth), '2024-03-01');
    assert.equal(f.focused(), 'date:2024-03-20');
    assert.match(dateButton(f.node('#schedule-calendar').html, '2024-03-20'), /is-selected.*aria-pressed="true"/);
  }));

  test(`${asset} handles year boundaries, leap years, and calendar range limits`, () => inTimezone('America/New_York', () => {
    const f = fixture(asset);
    f.api.state.calendarMonth = f.api.localDate(2023, 11, 1);
    f.api.navigateCalendar(1);
    assert.equal(f.api.dateKey(f.api.state.calendarMonth), '2024-01-01');
    f.api.navigateCalendar(1);
    assert.equal((f.node('#schedule-calendar').html.match(/data-date="/g) || []).length, 29);
    f.api.navigateCalendar(1);
    assert.equal((f.node('#schedule-calendar').html.match(/data-date="/g) || []).length, 31);
    f.api.navigateCalendar(1);
    assert.equal((f.node('#schedule-calendar').html.match(/data-date="/g) || []).length, 30);
    f.api.state.calendarMonth = f.api.localDate(2023, 1, 1);
    f.api.renderSchedule();
    assert.equal((f.node('#schedule-calendar').html.match(/data-date="/g) || []).length, 28);
    f.api.state.calendarMonth = f.api.localDate(1, 0, 1);
    f.api.renderSchedule();
    assert.match(f.node('#schedule-calendar').html, /data-step="-1"[^>]* disabled/);
    assert.equal(f.api.dateKey(f.api.scheduleDate('0001-01-01')), '0001-01-01');
    f.api.navigateCalendar(-1);
    assert.equal(f.api.dateKey(f.api.state.calendarMonth), '0001-01-01');
    f.api.state.calendarMonth = f.api.localDate(9999, 11, 1);
    f.api.renderSchedule();
    assert.match(f.node('#schedule-calendar').html, /data-step="1"[^>]* disabled/);
    f.api.navigateCalendar(1);
    assert.equal(f.api.dateKey(f.api.state.calendarMonth), '9999-12-01');
  }));

  test(`${asset} uses local calendar dates across timezones and daylight-saving transitions`, () => {
    for (const [timezone, instant, expected] of [
      ['America/Los_Angeles', '2024-03-10T07:30:00Z', '2024-03-09'],
      ['Pacific/Kiritimati', '2024-03-10T07:30:00Z', '2024-03-10'],
      ['America/New_York', '2024-03-10T06:59:00Z', '2024-03-10'],
      ['America/New_York', '2024-03-10T07:01:00Z', '2024-03-10'],
      ['America/New_York', '2024-11-03T05:30:00Z', '2024-11-03'],
      ['America/New_York', '2024-11-03T06:30:00Z', '2024-11-03'],
      ['America/Los_Angeles', '2025-01-01T04:30:00Z', '2024-12-31'],
      ['Pacific/Kiritimati', '2024-12-31T12:30:00Z', '2025-01-01']
    ]) {
      inTimezone(timezone, () => {
        const f = fixture(asset, Date.parse(instant));
        f.api.renderSchedule();
        assert.equal(f.api.dateKey(f.api.state.calendarMonth), expected.slice(0, 7) + '-01');
        f.api.setScheduleView('list');
        assert.equal(f.api.state.selectedDay, expected, `${timezone} ${instant}`);
        for (const key of ['2024-02-29', '2024-03-10', '2024-11-03', '2025-01-01']) {
          assert.equal(f.api.dateKey(f.api.scheduleDate(key)), key, `${timezone} ${key}`);
        }
      });
    }
  });
}
