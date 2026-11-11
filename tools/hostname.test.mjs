import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const sketch = fs.readFileSync(path.join(root, 'CrewBoard_CYD', 'CrewBoard_CYD.ino'), 'utf8');

function functionSource(signature) {
  const start = sketch.indexOf(signature);
  assert.notEqual(start, -1, `Missing production function: ${signature}`);
  const body = sketch.indexOf('{', start);
  let depth = 1;
  let end = body + 1;
  for (; depth && end < sketch.length; ++end) {
    if (sketch[end] === '{') ++depth;
    if (sketch[end] === '}') --depth;
  }
  assert.equal(depth, 0, `Unclosed production function: ${signature}`);
  return sketch.slice(start, end);
}

test('both hostname samples use the documented default and HTTP starts before discovery', () => {
  for (const sample of ['CrewBoard_CYD\\sd-card\\config.sample.json', 'crewboard\\config\\config.sample.json']) {
    const config = JSON.parse(fs.readFileSync(path.join(root, ...sample.split('\\')), 'utf8'));
    assert.equal(config.hostname, 'crewboard-cyd');
  }
  const setup = functionSource('void setup()');
  const serverStart = setup.indexOf('server.begin();');
  const namesStart = setup.indexOf('startNetworkNames();');
  assert.notEqual(serverStart, -1);
  assert.notEqual(namesStart, -1);
  assert.ok(serverStart < namesStart);
  assert.match(setup, /if \(!connectToNetwork\(\)\)/);
  assert.match(functionSource('bool loadConfiguration() {'), /if \(deviceHostname\.isEmpty\(\)\)/);
});

test('production hostname/configuration and network flow pass native failure-injection tests', (t) => {
  const vswhere = path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  const jsonHeaders = path.join(os.homedir(), 'Documents', 'Arduino', 'libraries', 'ArduinoJson', 'src');
  if (process.platform !== 'win32' || !fs.existsSync(vswhere) || !fs.existsSync(jsonHeaders)) {
    t.skip('Native firmware harness requires Windows MSVC and the installed ArduinoJson headers; firmware/hardware checks remain separate.');
    return;
  }
  const located = spawnSync(vswhere, ['-latest', '-products', '*', '-requires',
    'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8' });
  assert.equal(located.status, 0, located.stderr);
  const installation = located.stdout.trim();
  if (!installation) {
    t.skip('MSVC C++ tools are not installed; native firmware harness was not run.');
    return;
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'crewboard-hostname-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const marker = sketch.indexOf('  // Login updates also reload configuration;');
  const end = sketch.indexOf('  logEvent("Config: /config.json");', marker);
  assert.ok(marker > 0 && end > marker);
  fs.writeFileSync(path.join(temporary, 'network-under-test.inc'),
    `void loadHostnameUnderTest(JsonDocument& document) {\n${sketch.slice(marker, end)}}\n` +
    functionSource('bool connectToNetwork()') + '\n' + functionSource('void startNetworkNames()'));
  const environment = path.join(installation, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
  const source = path.join(root, 'tools', 'network-startup.test.cpp');
  const executable = path.join(temporary, 'network-test.exe');
  const command = `call "${environment}" >nul && cl /nologo /std:c++17 /EHsc /I "${jsonHeaders}" /I "${temporary}" "${source}" /Fe:"${executable}" /Fo:"${path.join(temporary, 'network-test.obj')}"`;
  const compiled = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command],
    { encoding: 'utf8', cwd: temporary, timeout: 120000, windowsVerbatimArguments: true });
  assert.equal(compiled.status, 0, compiled.error?.message || compiled.stdout + compiled.stderr);
  const result = spawnSync(executable, [], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr);
});
