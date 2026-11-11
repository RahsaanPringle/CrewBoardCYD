import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = fs.readFileSync(path.join(root, 'sd-card', 'traxxi', 'www', 'app.js'), 'utf8');
const status = {
  stage: 'firmware-foundation', serverName: '<b>Sample Business</b>', hostname: 'shop-server',
  ipAddress: '192.0.2.10', apiVersion: '0.1.0', firmwareVersion: '0.1.0',
  mdnsReady: true, netbiosReady: false, storage: { totalBytes: 32 * 1024 ** 3, usedBytes: 1024 ** 3 }
};

function runPage(fetch) {
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, {
        textContent: '', hidden: false, disabled: false,
        addEventListener(event, callback) { this[event] = callback; }
      });
      return elements.get(id);
    }
  };
  vm.runInNewContext(source, { document, fetch, AbortSignal });
  return elements;
}

test('status page renders the actual API response as text and refreshes', async () => {
  let requests = 0;
  const elements = runPage(async (url, options) => {
    ++requests;
    assert.equal(url, '/api/v1/status');
    assert.equal(options.cache, 'no-store');
    assert.ok(options.signal instanceof AbortSignal);
    return { ok: true, json: async () => structuredClone(status) };
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements.get('server-name').textContent, '<b>Sample Business</b>');
  assert.equal(elements.get('device-details').hidden, false);
  assert.match(elements.get('discovery').textContent, /NetBIOS: unavailable/);
  assert.match(elements.get('storage').textContent, /32.00 GiB total, 1.00 GiB used/);
  assert.equal(elements.get('refresh').disabled, false);
  await elements.get('refresh').click();
  assert.equal(requests, 2);
});

test('HTTP, network, malformed JSON and invalid contract errors are visible', async () => {
  const failures = [
    async () => ({ ok: false, status: 401 }),
    async () => { throw new Error('Network disconnected'); },
    async () => ({ ok: true, json: async () => { throw new Error('Malformed JSON'); } }),
    async () => ({ ok: true, json: async () => ({ ...status, storage: { totalBytes: 10, usedBytes: 11 } }) }),
    async () => ({ ok: true, json: async () => ({ ...status, stage: 'production' }) })
  ];
  for (const fetch of failures) {
    const elements = runPage(fetch);
    await new Promise(resolve => setImmediate(resolve));
    assert.match(elements.get('status').textContent, /Unable to read device status:/);
    assert.equal(elements.get('device-details').hidden, true);
    assert.equal(elements.get('refresh').disabled, false);
  }
});

test('SD template uses isolated assets and explicitly labels unavailable apps', () => {
  const sample = JSON.parse(fs.readFileSync(path.join(root, 'sd-card', 'config.sample.json'), 'utf8'));
  assert.equal(sample.hostname, 'traxxi-server');
  const html = fs.readFileSync(path.join(root, 'sd-card', 'traxxi', 'www', 'index.html'), 'utf8');
  for (const app of ['HomePage', 'Employee Roster', 'Schedule', 'Document Share']) {
    assert.ok(html.includes(`<h3>${app}</h3>`));
  }
  assert.match(html, /not installed apps/);
  assert.match(html, /HTTP does not encrypt/);
  for (const asset of ['app.js', 'app.css']) {
    assert.ok(html.includes(`"/${asset}"`));
    assert.ok(fs.existsSync(path.join(root, 'sd-card', 'traxxi', 'www', asset)));
  }
});

test('native production configuration validation', t => {
  const vswhere = path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  const jsonHeaders = path.join(os.homedir(), 'Documents', 'Arduino', 'libraries', 'ArduinoJson', 'src');
  if (process.platform !== 'win32' || !fs.existsSync(vswhere) || !fs.existsSync(jsonHeaders)) {
    t.skip('Requires Windows MSVC and installed ArduinoJson headers; see the setup guide.');
    return;
  }
  const located = spawnSync(vswhere, ['-latest', '-products', '*', '-requires',
    'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8' });
  assert.equal(located.status, 0, located.stderr);
  const installation = located.stdout.trim();
  if (!installation) {
    t.skip('MSVC C++ tools are unavailable; native configuration tests were not run.');
    return;
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'traxxi-config-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const environment = path.join(installation, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
  const executable = path.join(temporary, 'configuration-test.exe');
  const command = `call "${environment}" >nul && cl /nologo /std:c++17 /EHsc /I "${jsonHeaders}" "${path.join(root, 'tests', 'configuration.test.cpp')}" /Fe:"${executable}" /Fo:"${path.join(temporary, 'configuration-test.obj')}"`;
  const compiled = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command],
    { encoding: 'utf8', cwd: temporary, timeout: 120000, windowsVerbatimArguments: true });
  assert.equal(compiled.status, 0, compiled.error?.message || compiled.stdout + compiled.stderr);
  const result = spawnSync(executable, [], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
});
