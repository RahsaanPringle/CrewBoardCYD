import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const assetRoot = path.join(repository, 'CrewBoard_CYD', 'sd-card', 'crewboard');
const defaultStorage = path.join(repository, '.local-dev');
const roles = ['Owner', 'Crew Lead', 'Crew Member', 'Equipment Operator', 'Trainee'];
const limits = { roster: 50, locations: 100, schedule: 250, messages: 200 };
const maxBody = 24576;
const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml'
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function requireCondition(condition, status, message) {
  if (!condition) throw new HttpError(status, message);
}
function exists(file) { return fs.existsSync(file); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function safePath(root, relative = '') {
  let target = root;
  for (const segment of relative.split('/').filter(Boolean)) {
    requireCondition(/^[a-zA-Z0-9._ -]+$/.test(segment) && segment !== '.' && segment !== '..' &&
      !/[. ]$/.test(segment) && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i.test(segment),
    400, 'Invalid path.');
    target = path.join(target, segment);
    requireCondition(!exists(target) || !fs.lstatSync(target).isSymbolicLink(), 403, 'Symbolic links are not served.');
  }
  return target;
}
function install(file, body) {
  const temporary = file + '.tmp';
  fs.writeFileSync(temporary, body, { mode: 0o600 });
  if (exists(file)) fs.copyFileSync(file, file + '.bak');
  fs.renameSync(temporary, file);
}
function writeJson(file, value) { install(file, JSON.stringify(value, null, 2) + '\n'); }
const themeName = (name) => typeof name === 'string' && name.length >= 5 && name.length <= 64 &&
  /^[a-zA-Z0-9_-][a-zA-Z0-9._-]*\.css$/i.test(name) && !name.includes('..');
function themeFiles() {
  const files = new Map();
  for (const root of [safePath(repository, 'crewboard/css'), safePath(assetRoot, 'css')]) {
    if (!exists(root)) continue;
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isFile() && themeName(entry.name) && !files.has(entry.name)) {
        files.set(entry.name, safePath(root, entry.name));
      }
    }
  }
  return files;
}
const text = (value, max, required = true) => value == null ? !required :
  typeof value === 'string' && Buffer.byteLength(value) <= max && (!required || value.length > 0);

function validate(collection, records) {
  requireCondition(Array.isArray(records), 422, 'The collection must be a JSON array.');
  requireCondition(records.length <= limits[collection], 422, 'This collection has too many records.');
  const ids = new Set();
  for (const record of records) {
    requireCondition(record && text(record.id, 64), 422, 'Every record needs a short ID.');
    requireCondition(!ids.has(record.id), 422, 'Record IDs must be unique.');
    ids.add(record.id);
    const fields = (spec) => Object.entries(spec).every(([key, [max, required = true]]) => text(record[key], max, required));
    if (collection === 'roster') {
      requireCondition(fields({ name: [60], role: [40, false], username: [40, false],
        phone: [30, false], email: [100, false], birthday: [10, false],
        emergencyContactName: [80, false], emergencyContactPhone: [30, false], notes: [300, false] }) &&
        typeof record.active === 'boolean', 422, 'A roster record is invalid.');
      requireCondition(!record.role || roles.includes(record.role), 422, 'Choose a role from the defined role list.');
    } else if (collection === 'locations') {
      requireCondition(fields({ name: [80], address: [120], city: [60], region: [30, false], postalCode: [16, false] }),
        422, 'A location record is invalid.');
      requireCondition(Number.isFinite(record.latitude) && Number.isFinite(record.longitude), 422, 'Latitude and longitude are required.');
      requireCondition(Math.abs(record.latitude) <= 90 && Math.abs(record.longitude) <= 180, 422, 'Location coordinates are out of range.');
    } else if (collection === 'schedule') {
      requireCondition(fields({ title: [80], date: [10], startTime: [5], endTime: [5, false],
        locationId: [64], notes: [500, false] }) && Array.isArray(record.crewIds), 422, 'A schedule record is invalid.');
      requireCondition(record.crewIds.length <= 12, 422, 'A job has too many crew assignments.');
    } else {
      requireCondition(fields({ title: [80, !record.parentId], body: [1000], postedAt: [25],
        expiresAt: [10, false], author: [40, false], parentId: [64, false] }), 422, 'A message record is invalid.');
    }
  }
}

export function prepareStorage(storage = defaultStorage) {
  fs.mkdirSync(storage, { recursive: true });
  for (const folder of ['data', 'shared']) {
    const destination = safePath(storage, folder);
    if (!exists(destination)) fs.cpSync(path.join(assetRoot, folder), destination, { recursive: true, errorOnExist: true });
  }
  const configPath = safePath(storage, 'config.json');
  let created = false;
  if (!exists(configPath)) {
    writeJson(configPath, {
      admin: { username: 'owner', password: randomBytes(12).toString('hex') },
      theme: '',
      users: [{ employeeId: 'emp-crew-1', username: 'staff1', password: randomBytes(12).toString('hex') }]
    });
    created = true;
  }
  const config = readJson(configPath);
  requireCondition(text(config.admin?.username, 40) && text(config.admin?.password, 100) &&
    Array.isArray(config.users) && config.users.length <= 12 &&
    config.users.every((user) => text(user.username, 40) && text(user.password, 100)) &&
    (!config.theme || themeName(config.theme)), 500, 'Invalid local development configuration.');
  for (const collection of Object.keys(limits)) {
    const records = readJson(safePath(storage, `data/${collection}.json`));
    validate(collection, records);
    requireCondition(Buffer.byteLength(JSON.stringify(records)) <= maxBody, 500, `${collection} exceeds the CYD size limit.`);
  }
  return { config, created };
}

function respond(response, status, body = '', type = 'application/json; charset=utf-8', headers = {}) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  response.writeHead(status, { 'Content-Type': type, 'Content-Length': bytes.length, 'Cache-Control': 'no-store', ...headers });
  response.end(bytes);
}
function fileResponse(response, file, head = false) {
  requireCondition(exists(file) && fs.statSync(file).isFile(), 404, 'File not found.');
  const body = fs.readFileSync(file);
  response.writeHead(200, { 'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Content-Length': body.length, 'Cache-Control': 'no-cache' });
  response.end(head ? undefined : body);
}
async function bodyBytes(request, maximum, allowEmpty = false) {
  requireCondition(!request.headers['transfer-encoding'] && request.headers['content-length'] !== undefined, 413,
    'Content-Length is required; Transfer-Encoding is not supported.');
  const length = Number(request.headers['content-length']);
  requireCondition(Number.isSafeInteger(length) && length >= (allowEmpty ? 0 : 1) && length <= maximum, 413,
    'The request is empty or too large.');
  const chunks = [];
  let count = 0;
  for await (const chunk of request) {
    count += chunk.length;
    requireCondition(count <= maximum, 413, 'The request is too large.');
    chunks.push(chunk);
  }
  requireCondition(count === length, 408, 'The request body was interrupted.');
  return Buffer.concat(chunks);
}
async function jsonBody(request, maximum, objectOnly = false) {
  requireCondition(request.headers['x-crewboard-request'] === '1', 403, 'Missing same-origin request marker.');
  requireCondition((request.headers['content-type'] || '').toLowerCase().startsWith('application/json'), 415, 'Use application/json.');
  const bytes = await bodyBytes(request, maximum);
  let value;
  try { value = JSON.parse(bytes.toString('utf8')); }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new HttpError(422, 'The request is not valid JSON.');
  }
  requireCondition(!objectOnly || (value !== null && typeof value === 'object' && !Array.isArray(value)), 422, 'The request must be a JSON object.');
  return value;
}
function adminOnly(session) { requireCondition(session.isAdmin, 403, 'Administrator access is required.'); }
function marker(request) { requireCondition(request.headers['x-crewboard-request'] === '1', 403, 'Missing same-origin request marker.'); }
function publicAccounts(config) { return config.users.map(({ employeeId = '', username }) => ({ employeeId, username })); }
function authenticate(request, config) {
  const credential = [config.admin, ...config.users].find((user) =>
    request.headers.authorization === 'Basic ' + Buffer.from(`${user.username}:${user.password}`).toString('base64'));
  if (!credential) return null;
  return { username: credential.username, isAdmin: credential === config.admin, employeeId: credential.employeeId || '', roles };
}

export function createDevServer({ storage = defaultStorage, logger = console } = {}) {
  prepareStorage(storage);
  const configPath = safePath(storage, 'config.json');
  const collectionPath = (collection) => safePath(storage, `data/${collection}.json`);
  const load = (collection) => readJson(collectionPath(collection));
  function save(collection, records) {
    validate(collection, records);
    const body = JSON.stringify(records);
    requireCondition(Buffer.byteLength(body) <= maxBody, 422, 'This collection is full. Ask the owner to remove older records.');
    install(collectionPath(collection), body);
  }

  async function api(request, response, resource, session) {
    const method = request.method;
    if (resource === 'session' && method === 'GET') return respond(response, 200, session);
    if (resource === 'themes' && method === 'GET') {
      const themes = [...themeFiles().keys()].sort().slice(0, 40);
      return respond(response, 200, { siteTheme: readJson(configPath).theme || '', themes });
    }
    if (resource === 'accounts') {
      adminOnly(session);
      if (method === 'GET') return respond(response, 200, publicAccounts(readJson(configPath)));
      requireCondition(method === 'PUT', 405, 'Method not supported by the accounts API.');
      const data = await jsonBody(request, 1024, true);
      const { employeeId, username = '', password = '', previousUsername = '' } = data;
      requireCondition(text(employeeId, 64) && text(username, 40, false) && typeof username === 'string' &&
        text(password, 100, false) && typeof password === 'string' &&
        text(previousUsername, 40, false) && typeof previousUsername === 'string' && !username.includes(':'),
      422, 'The account fields are invalid.');
      const config = readJson(configPath);
      requireCondition(username !== config.admin.username, 409, 'That username belongs to the administrator.');
      const index = config.users.findIndex((user) => (user.employeeId && user.employeeId === employeeId) ||
        (previousUsername && user.username === previousUsername) || (!user.employeeId && username && user.username === username));
      requireCondition(!config.users.some((user, i) => i !== index && username && user.username === username),
        409, 'That staff username is already in use.');
      if (!username) {
        if (index >= 0) config.users.splice(index, 1);
      } else if (index >= 0) {
        Object.assign(config.users[index], { employeeId, username });
        if (password) config.users[index].password = password;
      } else {
        requireCondition(password.length > 0, 422, 'A password is required for a new username.');
        requireCondition(config.users.length < 12, 409, 'The maximum number of staff logins has been reached.');
        config.users.push({ employeeId, username, password });
      }
      writeJson(configPath, config);
      return respond(response, 200, publicAccounts(config));
    }
    if (resource === 'profile') {
      requireCondition(method === 'PUT', 405, 'Method not supported by the profile API.');
      const data = await jsonBody(request, 2048, true);
      requireCondition(session.employeeId, 403, 'This login is not linked to a roster record.');
      const roster = load('roster');
      const employee = roster.find((record) => record.id === session.employeeId);
      requireCondition(employee, 404, 'Your roster record was not found.');
      requireCondition(employee.role !== 'Owner', 403, 'Crew members cannot modify the owner record.');
      for (const field of ['phone', 'email', 'birthday', 'emergencyContactName', 'emergencyContactPhone']) {
        if (data[field] == null) continue;
        requireCondition(typeof data[field] === 'string', 422, 'Profile fields must be text.');
        employee[field] = data[field];
      }
      save('roster', roster);
      return respond(response, 200, { ok: true });
    }
    if (resource === 'messages' && method === 'POST') {
      const data = await jsonBody(request, 2048, true);
      const { parentId = '', title = '', body = '', postedAt = '' } = data;
      requireCondition(text(body, 1000) && typeof postedAt === 'string' && postedAt.length >= 10 &&
        (parentId || title), 422, 'A message needs text, and new posts need a title.');
      const messages = load('messages');
      requireCondition(messages.length < 200, 409, 'The message board is full. Ask the owner to remove older posts.');
      requireCondition(!parentId || messages.some((record) => record.id === parentId), 404, 'The message being replied to no longer exists.');
      const record = { id: 'msg-' + randomBytes(8).toString('hex'), author: session.username,
        title, body, postedAt, expiresAt: session.isAdmin ? (data.expiresAt || '') : '' };
      if (parentId) record.parentId = parentId;
      messages.push(record);
      save('messages', messages);
      return respond(response, 201, record);
    }
    if (resource.startsWith('messages/')) {
      const id = resource.slice(9);
      requireCondition(method === 'DELETE' && text(id, 64), 405, 'Method not supported by this message API.');
      marker(request);
      const messages = load('messages');
      const record = messages.find((message) => message.id === id);
      requireCondition(record, 404, 'Message not found.');
      requireCondition(session.isAdmin || record.author === session.username, 403, 'Only the author or the owner can delete this message.');
      const removed = new Set([id]);
      let previousSize;
      do {
        previousSize = removed.size;
        for (const message of messages) if (removed.has(message.parentId)) removed.add(message.id);
      } while (removed.size !== previousSize);
      save('messages', messages.filter((message) => !removed.has(message.id)));
      return respond(response, 200, { ok: true });
    }
    requireCondition(Object.hasOwn(limits, resource), resource === 'themes' || resource === 'session' ? 405 : 404, 'API resource or method not supported.');
    if (method === 'GET') return respond(response, 200, load(resource));
    requireCondition(method === 'PUT', 405, 'Method not supported by this API resource.');
    adminOnly(session);
    const records = await jsonBody(request, maxBody);
    save(resource, records);
    return respond(response, 200, { ok: true });
  }

  async function dav(request, response, relative, session) {
    const root = safePath(storage, 'shared');
    const target = safePath(root, relative);
    const method = request.method;
    if (method === 'OPTIONS') return respond(response, 200, '', 'text/plain', {
      DAV: '1', Allow: 'OPTIONS, PROPFIND, GET, HEAD, PUT, MKCOL, DELETE, LOCK, UNLOCK'
    });
    if (method === 'LOCK') return respond(response, 200,
      '<?xml version="1.0"?><d:prop xmlns:d="DAV:"><d:lockdiscovery/></d:prop>', 'application/xml');
    if (method === 'UNLOCK') return respond(response, 204);
    if (['PUT', 'MKCOL', 'DELETE'].includes(method)) {
      adminOnly(session);
      requireCondition(relative, 405, 'The shared root cannot be changed.');
      if (method === 'PUT') {
        const bytes = await bodyBytes(request, 8 * 1024 * 1024, true);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        install(target, bytes);
        return respond(response, 201);
      }
      if (method === 'MKCOL') {
        requireCondition(!exists(target), 405, 'Folder already exists.');
        fs.mkdirSync(target, { recursive: true });
        return respond(response, 201);
      }
      requireCondition(exists(target), 404, 'Not found.');
      fs.rmSync(target, { recursive: true });
      return respond(response, 204);
    }
    requireCondition(['GET', 'HEAD', 'PROPFIND'].includes(method), 405, 'Method not supported.');
    requireCondition(exists(target), 404, 'Not found.');
    const xml = (value) => value.replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
    })[character]);
    const href = (name, directory) => '/dav/' + name.split('/').map(encodeURIComponent).join('/') + (directory && name ? '/' : '');
    const directory = fs.statSync(target).isDirectory();
    const children = directory ? fs.readdirSync(target).slice(0, 100).map((name) => relative ? relative + '/' + name : name) : [];
    if (method === 'PROPFIND') {
      const property = (name) => {
        const file = safePath(root, name);
        const stat = fs.statSync(file);
        return `<d:response><d:href>${xml(href(name, stat.isDirectory()))}</d:href><d:propstat><d:prop><d:resourcetype>` +
          (stat.isDirectory() ? '<d:collection/>' : '') + '</d:resourcetype>' +
          (stat.isFile() ? `<d:getcontentlength>${stat.size}</d:getcontentlength><d:getcontenttype>${xml(mime[path.extname(file)] || 'application/octet-stream')}</d:getcontenttype>` : '') +
          '</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>';
      };
      return respond(response, 207, '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:">' +
        [relative, ...(request.headers.depth === '0' ? [] : children)].map(property).join('') + '</d:multistatus>', 'application/xml; charset=utf-8');
    }
    if (!directory) return fileResponse(response, target, method === 'HEAD');
    return respond(response, 200, method === 'HEAD' ? '' : '<!doctype html><meta charset="utf-8"><h1>CrewBoard shared files</h1><ul>' +
      children.map((name) => {
        const isDirectory = fs.statSync(safePath(root, name)).isDirectory();
        return `<li><a href="${xml(href(name, isDirectory))}">${xml(path.basename(name))}${isDirectory ? '/' : ''}</a></li>`;
      }).join('') + '</ul>', 'text/html; charset=utf-8');
  }

  const server = http.createServer({ maxHeaderSize: 4096 }, async (request, response) => {
    try {
      const config = readJson(configPath);
      const session = authenticate(request, config);
      if (!session) return respond(response, 401, 'CrewBoard login required\n', 'text/plain; charset=utf-8',
        { 'WWW-Authenticate': 'Basic realm="CrewBoard"' });
      let pathname;
      try { pathname = decodeURIComponent(request.url.split('?')[0]); }
      catch (error) {
        if (!(error instanceof URIError)) throw error;
        throw new HttpError(400, 'Invalid path encoding.');
      }
      requireCondition(pathname.startsWith('/'), 400, 'Invalid path.');
      safePath(storage, pathname);
      const trailingSlash = pathname.endsWith('/');
      pathname = '/' + pathname.split('/').filter(Boolean).join('/');
      if (pathname.startsWith('/api/v1/')) return await api(request, response, pathname.slice(8), session);
      if (pathname === '/dav' || pathname.startsWith('/dav/')) return await dav(request, response, pathname.slice(5), session);
      if (pathname === '/crewboard/www' && !trailingSlash) return respond(response, 302, '', 'text/plain', { Location: '/crewboard/www/' });
      const asset = pathname === '/crewboard/www' ? '/' :
        pathname.startsWith('/crewboard/www/') ? pathname.slice(14) : pathname;
      requireCondition(request.method === 'GET' || request.method === 'HEAD', 404, 'Not found.');
      if (asset === '/theme.js') return respond(response, 200,
        'window.CREWBOARD_SITE_THEME = ' + JSON.stringify(config.theme || '') + ';\n', 'application/javascript; charset=utf-8');
      let relative;
      if (asset === '/') relative = 'www/index.html';
      else if (asset === '/app.js' || asset === '/app.css' || /^\/vendor\/[^/]+$/.test(asset)) relative = 'www' + asset;
      else if (asset.startsWith('/css/') && themeName(asset.slice(5))) {
        const file = themeFiles().get(asset.slice(5));
        requireCondition(file, 404, 'Theme file not found.');
        return fileResponse(response, file, request.method === 'HEAD');
      }
      requireCondition(relative, 404, 'Not found.');
      fileResponse(response, safePath(assetRoot, relative), request.method === 'HEAD');
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status >= 500) logger.error('CrewBoard development server:', error);
      if (!response.headersSent) respond(response, status, { error: status === 500 ? 'Local server error. Check the terminal for details.' : error.message });
      else response.destroy(error);
    }
  });
  server.requestTimeout = 15000;
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const port = Number(process.env.PORT || 8080);
    requireCondition(Number.isInteger(port) && port > 0 && port <= 65535, 500, 'PORT must be between 1 and 65535.');
    const { config, created } = prepareStorage();
    const server = createDevServer();
    server.on('error', (error) => { console.error('Could not start CrewBoard:', error.message); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => {
      console.log(`CrewBoard local development: http://127.0.0.1:${port}`);
      console.log(`Local-only data and credentials: ${defaultStorage}`);
      if (created) {
        console.log(`Owner login: ${config.admin.username} / ${config.admin.password}`);
        console.log(`Staff login: ${config.users[0].username} / ${config.users[0].password}`);
      }
      console.log('Edit the SD-card web assets, then refresh. Press Ctrl+C to stop.');
    });
  } catch (error) {
    console.error('Could not start CrewBoard:', error.message);
    process.exitCode = 1;
  }
}
