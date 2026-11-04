import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const assets = ['../CrewBoard_CYD/sd-card/crewboard/www/', '../crewboard/www/'];

function fixture(asset) {
  let fields = '';
  const form = {
    controls: [],
    addEventListener() {},
    querySelector(selector) { return this.controls.find((control) => '#' + control.id === selector) || null; },
    querySelectorAll() { return this.controls; }
  };
  const document = {
    getElementById(id) {
      if (id === 'record-form') return form;
      if (id.startsWith('field-')) return form.controls.find((control) => control.id === id) || null;
      return { id };
    },
    querySelectorAll() { return []; }
  };
  const chain = {
    on() { return this; }, removeClass() { return this; }, addClass() { return this; },
    text() { return this; }, html() { return this; }, scrollTop() { return this; }
  };
  function $(selector) {
    if (selector === '<div>') {
      return {
        text(value) { this.value = String(value); return this; },
        html() { return this.value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
      };
    }
    if (selector === '#record-fields') {
      return { html(value) { fields = value; return this; }, scrollTop() { return this; } };
    }
    if (typeof selector === 'string' && selector.startsWith('#field-')) {
      return { val() { return form.querySelector(selector)?.value; } };
    }
    return chain;
  }
  $.extend = (...args) => Object.assign(...args.filter((value) => typeof value !== 'boolean'));
  $.ajax = () => ({ done() { return this; }, fail() { return this; } });
  const window = {};
  const context = {
    document, window, jQuery: $, console, Event,
    localStorage: { getItem() { return null; } },
    bootstrap: { Modal: class { show() {} }, Tab: { getOrCreateInstance() {} } }
  };
  const file = new URL('app.js', new URL(asset, import.meta.url));
  const source = fs.readFileSync(file, 'utf8').replace(
    '})(jQuery);',
    'window.formTest = { state, field, openEditor, validCalendarDate, validTime, updateFormConstraints, captureInitialValues, fieldValue, formRecord, toggleCoordinateSign }; })(jQuery);'
  );
  vm.runInNewContext(source, context);
  const api = window.formTest;
  api.state.session = { isAdmin: true, username: 'owner', employeeId: 'emp-1' };
  api.state.roster = [{ id: 'emp-1', name: 'A "quoted" employee', role: 'Crew Member', active: true,
    phone: '+44 20 1234 5678', email: 'crew@example.test', birthday: '02-29' }];
  api.state.locations = [{ id: 'loc-1', name: 'Site', latitude: 38.123456, longitude: -79.123456 }];
  api.state.schedule = [{ id: 'job-1', title: 'Job', date: '2024-02-29', startTime: '08:00',
    endTime: '09:00', locationId: 'loc-1', crewIds: ['emp-1'] }];
  api.state.messages = [{ id: 'msg-1', author: 'owner', title: 'Post', body: 'Hello', expiresAt: '' }];
  api.state.accounts = [{ employeeId: 'emp-1', username: 'crew' }];
  return { api, form, markup: () => fields };
}

function control(markup, id) {
  const match = markup.match(new RegExp('<(?:input|select|textarea)\\b[^>]*\\bid="field-' + id + '"[^>]*>'));
  assert.ok(match, `Missing ${id}`);
  assert.match(markup, new RegExp('<label\\b[^>]*for="field-' + id + '"'));
  return match[0];
}

function fakeControl(id, value, options = {}) {
  return {
    id: 'field-' + id, value, required: false, type: 'text', dataset: {}, selectedOptions: [],
    classList: { contains() { return false; } },
    setCustomValidity(message) { this.message = message; },
    removeAttribute(name) { delete this[name]; },
    ...options
  };
}

for (const asset of assets) {
  test(`${asset} generates semantic, labeled controls with context-specific autofill`, () => {
    const f = fixture(asset);
    f.api.openEditor('roster', 'emp-1', '', null);
    let markup = f.markup();
    for (const id of ['name', 'role', 'phone', 'email', 'birthday', 'emergencyContactName',
      'emergencyContactPhone', 'notes', 'username', 'password', 'active']) control(markup, id);
    assert.match(control(markup, 'name'), /required.*maxlength="60".*autocomplete="off"/);
    assert.match(control(markup, 'phone'), /type="tel".*autocomplete="off"/);
    assert.match(control(markup, 'email'), /type="email".*maxlength="100".*autocomplete="off"/);
    assert.match(control(markup, 'birthday'), /type="text".*inputmode="text".*pattern=/);
    assert.match(markup, /id="field-birthday-help" class="form-text"/);
    assert.match(control(markup, 'password'), /type="password".*autocomplete="new-password"/);
    assert.doesNotMatch(control(markup, 'password'), /\bvalue=/);
    assert.match(control(markup, 'active'), /type="checkbox"/);
    assert.match(markup, /A &quot;quoted&quot; employee/);

    f.api.state.session.isAdmin = false;
    f.api.openEditor('profile', '', '', null);
    markup = f.markup();
    assert.match(control(markup, 'phone'), /autocomplete="tel"/);
    assert.match(control(markup, 'email'), /autocomplete="email"/);
    assert.match(control(markup, 'emergencyContactPhone'), /type="tel".*autocomplete="off"/);

    f.api.state.session.isAdmin = true;
    f.api.openEditor('locations', 'loc-1', '', null);
    markup = f.markup();
    assert.match(control(markup, 'address'), /autocomplete="section-jobsite street-address"/);
    assert.match(control(markup, 'city'), /autocomplete="section-jobsite address-level2"/);
    assert.match(control(markup, 'region'), /autocomplete="section-jobsite address-level1"/);
    assert.match(control(markup, 'postalCode'), /type="text".*autocomplete="section-jobsite postal-code"/);
    assert.match(control(markup, 'latitude'), /type="number".*inputmode="decimal".*min="-90".*max="90".*step="any"/);
    assert.match(control(markup, 'longitude'), /min="-180".*max="180".*step="any"/);
    assert.match(markup, /aria-controls="field-latitude" aria-label="Change the sign of latitude"/);
    assert.match(markup, /aria-controls="field-longitude" aria-label="Change the sign of longitude"/);

    f.api.openEditor('schedule', 'job-1', '', null);
    markup = f.markup();
    assert.match(control(markup, 'date'), /type="date".*required/);
    assert.match(control(markup, 'startTime'), /type="time".*required/);
    assert.match(control(markup, 'endTime'), /type="time"/);
    assert.match(control(markup, 'locationId'), /required/);
    assert.match(control(markup, 'crewIds'), /multiple.*aria-describedby="crew-help"/);
    assert.match(control(markup, 'notes'), /maxlength="500"/);

    f.api.openEditor('messages', 'msg-1', '', null);
    markup = f.markup();
    assert.match(control(markup, 'title'), /required.*maxlength="80"/);
    assert.match(control(markup, 'body'), /required.*maxlength="1000"/);
    assert.match(control(markup, 'expiresAt'), /type="date"/);
    f.api.openEditor('reply', '', 'msg-1', null);
    assert.match(control(f.markup(), 'body'), /required.*maxlength="1000"/);
  });

  test(`${asset} validates birthdays and times without losing legacy or quoted values`, () => {
    const f = fixture(asset);
    for (const value of ['02-29', '2000-02-29', '2024-02-29', '12-31']) {
      assert.equal(f.api.validCalendarDate(value, true), true, value);
    }
    for (const value of ['02-30', '1900-02-29', '2023-02-29', '0000-01-01', '2-01']) {
      assert.equal(f.api.validCalendarDate(value, true), false, value);
    }
    assert.equal(f.api.validCalendarDate('02-29', false), false);
    assert.equal(f.api.validTime('23:59'), true);
    assert.equal(f.api.validTime('24:00'), false);
    const legacy = f.api.field('date', 'Date', 'date', '02/29/2024', { required: true });
    assert.match(legacy, /type="text" value="02\/29\/2024".*data-legacy-format="date"/);
    assert.match(legacy, /This saved value is not a valid date/);
    const escaped = f.api.field('name', 'Name', 'text', '" onfocus="bad() & <tag>', {});
    assert.match(escaped, /value="&quot; onfocus=&quot;bad\(\) &amp; &lt;tag&gt;"/);
  });

  test(`${asset} updates dependent validation before native submission`, () => {
    const f = fixture(asset);
    f.api.openEditor('roster', '', '', null);
    const username = fakeControl('username', 'new-user');
    const password = fakeControl('password', '', { type: 'password' });
    const birthday = fakeControl('birthday', '02-30');
    const start = fakeControl('startTime', '10:00', { type: 'time', required: true });
    const end = fakeControl('endTime', '09:00', { type: 'time' });
    const crew = fakeControl('crewIds', '', { selectedOptions: Array(13).fill({}) });
    f.form.controls = [username, password, birthday, start, end, crew];
    f.api.updateFormConstraints();
    assert.equal(password.required, true);
    assert.match(birthday.message, /valid birthday/);
    assert.equal(end.min, '10:00');
    assert.match(end.message, /earlier/);
    assert.match(crew.message, /12/);
    password.value = '  ';
    f.api.updateFormConstraints();
    assert.equal(password.message, '');
    birthday.value = '02-29'; end.value = ''; crew.selectedOptions = [];
    username.value = '';
    f.api.updateFormConstraints();
    assert.equal(password.required, false);
    assert.equal(birthday.message, '');
    assert.equal(end.message, '');
    assert.equal(crew.message, '');
  });

  test(`${asset} changes coordinate signs without converting empty input to zero`, () => {
    const f = fixture(asset);
    const latitude = fakeControl('latitude', '', {
      validity: { badInput: false },
      reportValidity() { this.reported = true; },
      focus() { this.focused = true; },
      dispatchEvent(event) { this.event = event; }
    });
    f.api.toggleCoordinateSign(latitude);
    assert.equal(latitude.value, '');
    assert.match(latitude.message, /Enter a coordinate/);
    assert.equal(latitude.reported, true);
    assert.equal(latitude.focused, true);
    assert.equal(latitude.event, undefined);

    latitude.value = '38.5';
    f.api.toggleCoordinateSign(latitude);
    assert.equal(latitude.value, '-38.5');
    assert.equal(latitude.event.type, 'input');
    assert.equal(latitude.event.bubbles, true);
    f.api.toggleCoordinateSign(latitude);
    assert.equal(latitude.value, '38.5');

    latitude.value = 'invalid';
    latitude.validity.badInput = true;
    latitude.event = undefined;
    f.api.toggleCoordinateSign(latitude);
    assert.equal(latitude.value, 'invalid');
    assert.equal(latitude.event, undefined);
  });

  test(`${asset} retains unchanged missing, null, formatted and numeric values`, () => {
    const f = fixture(asset);
    const phone = fakeControl('phone', '  +44 20 1234  ', { name: 'phone' });
    const region = fakeControl('region', '', { name: 'region' });
    const postal = fakeControl('postalCode', '', { name: 'postalCode' });
    const latitude = fakeControl('latitude', '38.123456', { name: 'latitude', type: 'number' });
    f.form.controls = [phone, region, postal, latitude];
    f.api.captureInitialValues();
    const previous = { phone: '  +44 20 1234  ', region: null, latitude: 38.123456 };
    assert.equal(f.api.fieldValue('phone', previous, (value) => value.trim()), previous.phone);
    assert.equal(f.api.fieldValue('region', previous, (value) => value.trim()), null);
    assert.equal(f.api.fieldValue('postalCode', previous, (value) => value.trim()), undefined);
    assert.equal(f.api.fieldValue('latitude', previous, Number), previous.latitude);
    phone.value = '  +44 20 5678  ';
    assert.equal(f.api.fieldValue('phone', previous, (value) => value.trim()), '+44 20 5678');
  });

  test(`${asset} preserves unchanged roster fields and an account not duplicated in the roster`, () => {
    const f = fixture(asset);
    f.api.state.roster[0] = { id: 'emp-1', name: 'Employee', role: null, active: true,
      phone: ' +44 20 1234 ', birthday: '02-29', extra: 'preserve me' };
    f.api.openEditor('roster', 'emp-1', '', null);
    f.form.controls = [
      fakeControl('name', 'Employee', { name: 'name' }),
      fakeControl('role', '', { name: 'role' }),
      fakeControl('username', 'crew', { name: 'username' }),
      fakeControl('password', '', { name: 'password', type: 'password' }),
      fakeControl('notes', '', { name: 'notes' }),
      fakeControl('active', 'on', { name: 'active', type: 'checkbox', checked: true }),
      fakeControl('phone', ' +44 20 1234 ', { name: 'phone' }),
      fakeControl('email', '', { name: 'email' }),
      fakeControl('birthday', '02-29', { name: 'birthday' }),
      fakeControl('emergencyContactName', '', { name: 'emergencyContactName' }),
      fakeControl('emergencyContactPhone', '', { name: 'emergencyContactPhone' })
    ];
    f.api.captureInitialValues();
    const record = JSON.parse(JSON.stringify(f.api.formRecord()));
    assert.deepEqual(record, { ...f.api.state.roster[0], _accountUsername: 'crew', _password: '' });
    f.form.querySelector('#field-phone').value = ' +44 20 5678 ';
    assert.equal(f.api.formRecord().phone, '+44 20 5678');
  });
}
