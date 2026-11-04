import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { createDevServer, prepareStorage, assetRoot } from './dev-server.mjs';

async function fixture(t) {
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'crewboard-test-'));
  const { config } = prepareStorage(storage);
  const errors = [];
  let server = createDevServer({ storage, logger: { error: (...args) => errors.push(args) } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = () => `http://127.0.0.1:${server.address().port}`;
  const auth = (user) => 'Basic ' + Buffer.from(`${user.username}:${user.password}`).toString('base64');
  async function request(url, { user = config.admin, method = 'GET', data, headers = {}, body } = {}) {
    const response = await fetch(base() + url, {
      method,
      headers: { ...(user ? { Authorization: auth(user) } : {}),
        ...(data !== undefined ? { 'Content-Type': 'application/json', 'X-CrewBoard-Request': '1' } : {}), ...headers },
      body: data !== undefined ? JSON.stringify(data) : body
    });
    const content = await response.text();
    return { status: response.status, headers: response.headers,
      body: content && response.headers.get('content-type')?.includes('application/json') ? JSON.parse(content) : content };
  }
  async function restart() {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    server = createDevServer({ storage, logger: { error: (...args) => errors.push(args) } });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
  }
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    fs.rmSync(storage, { recursive: true });
  });
  return { storage, config, request, restart, errors, base, auth };
}

test('serves the exact deployable web assets, Basic auth, sessions, themes and aliases', async (t) => {
  const f = await fixture(t);
  const unauthorized = await f.request('/', { user: null });
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.headers.get('www-authenticate'), 'Basic realm="CrewBoard"');
  assert.equal((await f.request('/', { user: { username: 'bad', password: 'bad' } })).status, 401);
  for (const [url, file] of [['/', 'www/index.html'], ['/crewboard/www/', 'www/index.html'],
    ['/app.js', 'www/app.js'], ['/crewboard/www/app.css', 'www/app.css'],
    ['/vendor/jquery.min.js', 'www/vendor/jquery.min.js']]) {
    const result = await f.request(url);
    assert.equal(result.status, 200, url);
    assert.equal(result.body, fs.readFileSync(path.join(assetRoot, file), 'utf8'));
  }
  const head = await f.request('/app.js', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.body, '');
  assert.equal(Number(head.headers.get('content-length')), fs.statSync(path.join(assetRoot, 'www', 'app.js')).size);
  const session = (await f.request('/api/v1/session')).body;
  assert.equal(session.username, 'owner');
  assert.equal(session.isAdmin, true);
  assert.deepEqual(session.roles, ['Owner', 'Crew Lead', 'Crew Member', 'Equipment Operator', 'Trainee']);
  const staff = (await f.request('/api/v1/session', { user: f.config.users[0] })).body;
  assert.equal(staff.employeeId, 'emp-crew-1');
  assert.equal(staff.isAdmin, false);
  const themes = (await f.request('/api/v1/themes')).body;
  assert.equal(themes.siteTheme, '');
  assert.ok(Array.isArray(themes.themes));
  assert.equal((await f.request('/theme.js')).body, 'window.CREWBOARD_SITE_THEME = "";\n');
  for (const url of ['/config.json', '/data/roster.json', '/crewboard/data/roster.json', '/tools/dev-server.mjs', '/api/v1/missing']) {
    assert.equal((await f.request(url)).status, 404, url);
  }
});

test('top navigation links to the repository in a labeled, isolated new tab', () => {
  const html = fs.readFileSync(path.join(assetRoot, 'www', 'index.html'), 'utf8');
  const navigation = html.match(/<nav\b[^>]*>[\s\S]*?<\/nav>/)?.[0];
  assert.ok(navigation);
  assert.match(navigation, /<a\b[^>]*href="https:\/\/github\.com\/RahsaanPringle\/CrewBoardCYD"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*aria-label="GitHub repository \(opens in a new tab\)">GitHub<\/a>/);
});

test('persists collections across restarts without changing SD-card samples', async (t) => {
  const f = await fixture(t);
  const source = fs.readFileSync(path.join(assetRoot, 'data', 'roster.json'), 'utf8');
  const roster = (await f.request('/api/v1/roster')).body;
  roster[1].name = 'Local development employee';
  const saved = await f.request('/api/v1/roster', { method: 'PUT', data: roster });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body, { ok: true });
  assert.equal(fs.readFileSync(path.join(assetRoot, 'data', 'roster.json'), 'utf8'), source);
  assert.equal(fs.readFileSync(path.join(f.storage, 'data', 'roster.json.bak'), 'utf8'), source);
  assert.equal(prepareStorage(f.storage).created, false);
  await f.restart();
  assert.equal((await f.request('/api/v1/roster')).body[1].name, 'Local development employee');
  for (const collection of ['locations', 'schedule', 'messages']) {
    const records = (await f.request('/api/v1/' + collection)).body;
    assert.equal((await f.request('/api/v1/' + collection, { method: 'PUT', data: records })).status, 200);
  }
  assert.deepEqual(f.errors, []);
});

test('shared editor keeps the form in Bootstrap scrollable content and names the dialog', () => {
  const html = fs.readFileSync(path.join(assetRoot, 'www', 'index.html'), 'utf8');
  assert.match(html, /id="record-modal"[^>]*aria-labelledby="record-modal-title"/);
  assert.match(html, /class="modal-dialog modal-lg modal-dialog-scrollable modal-fullscreen-sm-down">\s*<form id="record-form" class="modal-content" autocomplete="off">/);
  assert.match(html, /id="record-modal-title"[^>]*tabindex="-1"/);
  assert.match(html, /<div id="record-fields" class="modal-body"><\/div>\s*<div class="modal-footer">/);
  assert.match(html, /type="button" class="btn-close"[^>]*aria-label="Close"/);
  assert.match(html, /type="button"[^>]*data-bs-dismiss="modal">Cancel<\/button>/);
  assert.match(html, /type="submit" class="btn btn-primary">Save<\/button>/);
});

test('lists and serves working-copy themes through both web URL layouts', async (t) => {
  const f = await fixture(t);
  const workingThemes = path.resolve(assetRoot, '..', '..', '..', 'crewboard', 'css');
  const files = fs.existsSync(workingThemes) ? fs.readdirSync(workingThemes).filter((name) => name.endsWith('.css')) : [];
  if (!files.length) {
    t.skip('No optional working-copy themes installed.');
    return;
  }
  const listing = (await f.request('/api/v1/themes')).body;
  for (const name of files) {
    assert.ok(listing.themes.includes(name), name);
    assert.equal(listing.themes.filter((theme) => theme === name).length, 1);
    const expected = fs.readFileSync(path.join(workingThemes, name), 'utf8');
    for (const prefix of ['/css/', '/crewboard/www/css/']) {
      const result = await f.request(prefix + name);
      assert.equal(result.status, 200);
      assert.equal(result.headers.get('content-type'), 'text/css; charset=utf-8');
      assert.equal(result.body, expected);
    }
    const head = await f.request('/css/' + name, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(Number(head.headers.get('content-length')), Buffer.byteLength(expected));
  }
  assert.equal((await f.request('/css/README.txt')).status, 404);
  assert.equal((await f.request('/css/nonexistent.css')).status, 404);
  const configPath = path.join(f.storage, 'config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.theme = files[0];
  fs.writeFileSync(configPath, JSON.stringify(config));
  assert.equal((await f.request('/api/v1/themes')).body.siteTheme, files[0]);
  assert.equal((await f.request('/theme.js')).body,
    'window.CREWBOARD_SITE_THEME = ' + JSON.stringify(files[0]) + ';\n');
});

test('enforces CYD write markers, types, permissions, byte limits and collection validation', async (t) => {
  const f = await fixture(t);
  const url = '/api/v1/roster';
  const original = (await f.request(url)).body;
  const put = (data, options = {}) => f.request(url, { method: 'PUT', data, ...options });
  assert.equal((await put(original, { user: f.config.users[0] })).status, 403);
  assert.equal((await put(original, { headers: { 'X-CrewBoard-Request': '0' } })).status, 403);
  assert.equal((await put(original, { headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await put({})).status, 422);
  assert.equal((await put([original[0], original[0]])).status, 422);
  assert.equal((await put([{ ...original[0], role: 'Unknown' }])).status, 422);
  assert.equal((await put([{ ...original[0], name: 'é'.repeat(31) }])).status, 422);
  assert.equal((await put(Array.from({ length: 51 }, (_, i) => ({ ...original[0], id: `emp-${i}` })))).status, 422);
  assert.equal((await put([{ ...original[0], notes: 'x'.repeat(24576) }])).status, 413);
  const malformed = await f.request(url, { method: 'PUT', body: '{',
    headers: { 'Content-Type': 'application/json', 'X-CrewBoard-Request': '1' } });
  assert.equal(malformed.status, 422);
  const location = (await f.request('/api/v1/locations')).body[0];
  for (const latitude of [null, '45', 91]) {
    assert.equal((await f.request('/api/v1/locations', {
      method: 'PUT', data: [{ ...location, latitude }]
    })).status, 422);
  }
  assert.deepEqual((await f.request(url)).body, original);
});

test('validates semantic fields for direct API writes', async (t) => {
  const f = await fixture(t);
  const put = (collection, data) => f.request('/api/v1/' + collection, { method: 'PUT', data });
  const roster = (await f.request('/api/v1/roster')).body;
  for (const birthday of ['02-30', '1900-02-29', '2023-02-29', '0000-01-01', '2-01']) {
    const records = structuredClone(roster); records[1].birthday = birthday;
    assert.equal((await put('roster', records)).status, 422, birthday);
  }
  for (const email of ['not-an-address', 'a@-example.com', 'a@x..com', 'a b@x', 'a@b@c']) {
    const records = structuredClone(roster); records[1].email = email;
    assert.equal((await put('roster', records)).status, 422, email);
  }
  const colon = structuredClone(roster); colon[1].username = 'invalid:name';
  assert.equal((await put('roster', colon)).status, 422);
  for (const birthday of ['02-29', '2000-02-29', '2024-02-29', '']) {
    const records = (await f.request('/api/v1/roster')).body;
    records[1].birthday = birthday;
    records[1].email = 'A+shift@crew.example';
    assert.equal((await put('roster', records)).status, 200, birthday);
    assert.equal((await f.request('/api/v1/roster')).body[1].birthday, birthday);
  }
  assert.equal((await f.request('/api/v1/profile', { method: 'PUT', user: f.config.users[0],
    data: { birthday: '02-30' } })).status, 422);
  assert.equal((await f.request('/api/v1/profile', { method: 'PUT', user: f.config.users[0],
    data: { birthday: '02-29', email: 'a@b' } })).status, 200);

  const schedule = (await f.request('/api/v1/schedule')).body;
  for (const changes of [{ date: '2023-02-29' }, { date: '2026-13-01' }, { startTime: '24:00' },
    { startTime: '9:00' }, { endTime: '12:60' }, { startTime: '10:00', endTime: '09:00' }]) {
    const records = structuredClone(schedule); Object.assign(records[0], changes);
    assert.equal((await put('schedule', records)).status, 422, JSON.stringify(changes));
  }
  const optionalEnd = structuredClone(schedule); optionalEnd[0].endTime = '';
  assert.equal((await put('schedule', optionalEnd)).status, 200);
  assert.equal((await f.request('/api/v1/schedule')).body[0].endTime, '');

  const post = { title: 'Post', body: 'Message', postedAt: '2026-11-03T19:00' };
  assert.equal((await f.request('/api/v1/messages', { method: 'POST',
    data: { ...post, expiresAt: '2023-02-29' } })).status, 422);
  assert.equal((await f.request('/api/v1/messages', { method: 'POST',
    data: { ...post, expiresAt: '2024-02-29' } })).status, 201);
  const messages = (await f.request('/api/v1/messages')).body;
  messages[0].expiresAt = '2026-13-01';
  assert.equal((await put('messages', messages)).status, 422);
});

test('preserves unchanged noncanonical legacy fields while rejecting new invalid values', async (t) => {
  const f = await fixture(t);
  const roster = (await f.request('/api/v1/roster')).body;
  roster[0].birthday = 'legacy'; roster[0].email = 'old@-host';
  const schedule = (await f.request('/api/v1/schedule')).body;
  schedule[0].date = '2026/11/02'; schedule[0].startTime = '8:00';
  const messages = (await f.request('/api/v1/messages')).body;
  messages[0].expiresAt = 'n/a';
  for (const [collection, records] of [['roster', roster], ['schedule', schedule], ['messages', messages]]) {
    fs.writeFileSync(path.join(f.storage, 'data', collection + '.json'), JSON.stringify(records));
  }
  await f.restart();
  for (const [collection, records] of [['roster', roster], ['schedule', schedule], ['messages', messages]]) {
    assert.equal((await f.request('/api/v1/' + collection, { method: 'PUT', data: records })).status, 200, collection);
    assert.deepEqual((await f.request('/api/v1/' + collection)).body, records);
  }
  const otherEdit = structuredClone(roster); otherEdit[1].phone = '+44 20 1234 5678';
  assert.equal((await f.request('/api/v1/roster', { method: 'PUT', data: otherEdit })).status, 200);
  const changedInvalid = structuredClone(otherEdit); changedInvalid[0].birthday = 'bad';
  assert.equal((await f.request('/api/v1/roster', { method: 'PUT', data: changedInvalid })).status, 422);
  changedInvalid[0].birthday = '02-29';
  assert.equal((await f.request('/api/v1/roster', { method: 'PUT', data: changedInvalid })).status, 200);
  const changedDate = structuredClone(schedule); changedDate[0].date = '2026/12/02';
  assert.equal((await f.request('/api/v1/schedule', { method: 'PUT', data: changedDate })).status, 422);
});

test('updates staff logins immediately without exposing passwords and restricts profile edits', async (t) => {
  const f = await fixture(t);
  const oldStaff = f.config.users[0];
  assert.equal((await f.request('/api/v1/accounts', { user: oldStaff })).status, 403);
  const account = { employeeId: oldStaff.employeeId, previousUsername: oldStaff.username, username: 'crew', password: 'new-local-password' };
  const result = await f.request('/api/v1/accounts', { method: 'PUT', data: account });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, [{ employeeId: oldStaff.employeeId, username: 'crew' }]);
  assert.equal((await f.request('/api/v1/session', { user: oldStaff })).status, 401);
  const user = { username: 'crew', password: account.password };
  const update = await f.request('/api/v1/profile', { method: 'PUT', user,
    data: { phone: '555-0100', name: 'Cannot change', role: 'Owner', active: false } });
  assert.equal(update.status, 200);
  let roster = (await f.request('/api/v1/roster')).body;
  assert.equal(roster[1].phone, '555-0100');
  assert.equal(roster[1].name, 'Sample Crew Member');
  assert.equal(roster[1].active, true);
  roster[1].role = 'Owner';
  assert.equal((await f.request('/api/v1/roster', { method: 'PUT', data: roster })).status, 200);
  assert.equal((await f.request('/api/v1/profile', { method: 'PUT', user, data: { phone: 'no' } })).status, 403);
  assert.equal((await f.request('/api/v1/accounts', { method: 'PUT',
    data: { employeeId: 'other', username: 'owner', password: 'test' } })).status, 409);
  assert.equal((await f.request('/api/v1/accounts', { method: 'PUT',
    data: { employeeId: 'other', username: 'new' } })).status, 422);
  assert.equal((await f.request('/api/v1/accounts', { method: 'PUT',
    data: { employeeId: oldStaff.employeeId, username: '' } })).status, 200);
  assert.equal((await f.request('/api/v1/session', { user })).status, 401);
});

test('accepts the exact CYD JSON byte boundary and saves deployable compact files', async (t) => {
  const f = await fixture(t);
  const record = (await f.request('/api/v1/roster')).body[0];
  const records = [{ ...record, padding: '' }];
  records[0].padding = 'x'.repeat(24576 - Buffer.byteLength(JSON.stringify(records)));
  assert.equal(Buffer.byteLength(JSON.stringify(records)), 24576);
  assert.equal((await f.request('/api/v1/roster', { method: 'PUT', data: records })).status, 200);
  assert.equal(fs.statSync(path.join(f.storage, 'data', 'roster.json')).size, 24576);
  records[0].padding += 'x';
  assert.equal((await f.request('/api/v1/roster', { method: 'PUT', data: records })).status, 413);
  assert.equal(fs.statSync(path.join(f.storage, 'data', 'roster.json')).size, 24576);
});

test('supports authored posts, nested replies, permissions and cascading deletion', async (t) => {
  const f = await fixture(t);
  const user = f.config.users[0];
  const post = await f.request('/api/v1/messages', { method: 'POST', user,
    data: { title: 'Test post', body: 'Hello', postedAt: '2026-11-03T19:00', author: 'owner', expiresAt: '2026-11-04' } });
  assert.equal(post.status, 201);
  assert.equal(post.body.author, user.username);
  assert.equal(post.body.expiresAt, '');
  const reply = await f.request('/api/v1/messages', { method: 'POST',
    data: { parentId: post.body.id, body: 'Reply', postedAt: '2026-11-03T19:01' } });
  assert.equal(reply.status, 201);
  const nested = await f.request('/api/v1/messages', { method: 'POST', user,
    data: { parentId: reply.body.id, body: 'Nested', postedAt: '2026-11-03T19:02' } });
  assert.equal(nested.status, 201);
  const remove = (id, headers = { 'X-CrewBoard-Request': '1' }) =>
    f.request('/api/v1/messages/' + id, { method: 'DELETE', user, headers });
  assert.equal((await remove(reply.body.id)).status, 403);
  assert.equal((await remove(post.body.id, {})).status, 403);
  assert.equal((await remove(post.body.id)).status, 200);
  const remaining = (await f.request('/api/v1/messages')).body;
  assert.ok(!remaining.some((message) => [post.body.id, reply.body.id, nested.body.id].includes(message.id)));
  assert.equal((await f.request('/api/v1/messages', { method: 'POST', user,
    data: { parentId: 'missing', body: 'Reply', postedAt: '2026-11-03T19:03' } })).status, 404);
});

test('preserves simultaneous message submissions', async (t) => {
  const f = await fixture(t);
  const original = (await f.request('/api/v1/messages')).body;
  const results = await Promise.all(Array.from({ length: 10 }, (_, index) =>
    f.request('/api/v1/messages', { method: 'POST', user: f.config.users[0],
      data: { title: `Post ${index}`, body: 'Concurrent message', postedAt: '2026-11-03T19:00' } })));
  assert.ok(results.every((result) => result.status === 201));
  const messages = (await f.request('/api/v1/messages')).body;
  assert.equal(messages.length, original.length + 10);
  assert.ok(results.every((result) => messages.some((message) => message.id === result.body.id)));
});

test('mirrors WebDAV files, backups, listings, limits and owner-only writes', async (t) => {
  const f = await fixture(t);
  const staff = f.config.users[0];
  assert.equal((await f.request('/dav/', { method: 'OPTIONS' })).headers.get('dav'), '1');
  assert.equal((await f.request('/dav/test', { method: 'MKCOL', user: staff })).status, 403);
  assert.equal((await f.request('/dav/test', { method: 'MKCOL' })).status, 201);
  for (const body of ['first', 'second']) {
    assert.equal((await f.request('/dav/test/a%20file.txt', { method: 'PUT', body })).status, 201);
  }
  assert.equal((await f.request('/dav/test/a%20file.txt', { user: staff })).body, 'second');
  assert.equal(fs.readFileSync(path.join(f.storage, 'shared', 'test', 'a file.txt.bak'), 'utf8'), 'first');
  const listing = await f.request('/dav/test', { method: 'PROPFIND' });
  assert.equal(listing.status, 207);
  assert.match(listing.body, /a%20file.txt/);
  const shallow = await f.request('/dav/test', { method: 'PROPFIND', headers: { Depth: '0' } });
  assert.doesNotMatch(shallow.body, /a%20file.txt/);
  assert.match((await f.request('/dav/test/')).body, /a%20file.txt/);
  assert.equal((await f.request('/dav/test/a%20file.txt', { method: 'HEAD' })).body, '');
  assert.equal((await f.request('/dav/test/limit.txt', { method: 'PUT', body: 'x'.repeat(8 * 1024 * 1024) })).status, 201);
  assert.equal(fs.statSync(path.join(f.storage, 'shared', 'test', 'limit.txt')).size, 8 * 1024 * 1024);
  assert.equal((await f.request('/dav/test/huge.txt', { method: 'PUT', body: 'x'.repeat(8 * 1024 * 1024 + 1) })).status, 413);
  assert.equal((await f.request('/dav/test', { method: 'DELETE', user: staff })).status, 403);
  assert.equal((await f.request('/dav/', { method: 'DELETE' })).status, 405);
  assert.equal((await f.request('/dav/test', { method: 'DELETE' })).status, 204);
  assert.equal((await f.request('/dav/test')).status, 404);
  assert.equal((await f.request('/dav/', { method: 'LOCK' })).status, 200);
  assert.equal((await f.request('/dav/', { method: 'UNLOCK' })).status, 204);
});

test('rejects raw traversal, Windows aliases and links outside the shared root', async (t) => {
  const f = await fixture(t);
  async function raw(url) {
    return new Promise((resolve, reject) => {
      const request = http.get(f.base() + '/', { path: url, headers: { Authorization: f.auth(f.config.admin) } }, (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode));
      });
      request.on('error', reject);
    });
  }
  for (const url of ['/dav/../config.json', '/dav/%2e%2e/config.json', '/dav/%5cconfig.json',
    '/dav/a:stream', '/dav/test.', '/dav/test%20', '/dav/CON.txt', '/dav/%00', '/dav/%ZZ']) {
    assert.equal(await raw(url), 400, url);
  }
  fs.symlinkSync(f.storage, path.join(f.storage, 'shared', 'escape'), 'junction');
  assert.equal((await f.request('/dav/escape/config.json')).status, 403);
});

test('surfaces corrupt local data rather than resetting it', async (t) => {
  const f = await fixture(t);
  fs.writeFileSync(path.join(f.storage, 'data', 'roster.json'), '{invalid');
  assert.throws(() => prepareStorage(f.storage), SyntaxError);
  const result = await f.request('/api/v1/roster');
  assert.equal(result.status, 500);
  assert.match(result.body.error, /Check the terminal/);
  assert.equal(f.errors.length, 1);
  assert.equal(fs.readFileSync(path.join(f.storage, 'data', 'roster.json'), 'utf8'), '{invalid');
});
