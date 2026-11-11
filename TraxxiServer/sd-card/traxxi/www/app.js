'use strict';

const statusMessage = document.getElementById('status');
const details = document.getElementById('device-details');
const refresh = document.getElementById('refresh');

function validStatus(value) {
  return value && value.stage === 'firmware-foundation' &&
    ['serverName', 'hostname', 'ipAddress', 'firmwareVersion', 'apiVersion']
      .every(key => typeof value[key] === 'string' && value[key].length > 0) &&
    typeof value.mdnsReady === 'boolean' && typeof value.netbiosReady === 'boolean' &&
    Number.isSafeInteger(value.storage?.totalBytes) && value.storage.totalBytes > 0 &&
    Number.isSafeInteger(value.storage.usedBytes) && value.storage.usedBytes >= 0 &&
    value.storage.usedBytes <= value.storage.totalBytes;
}

async function loadStatus() {
  refresh.disabled = true;
  details.hidden = true;
  statusMessage.textContent = 'Reading device status...';
  try {
    const response = await fetch('/api/v1/status', { cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Device returned HTTP ${response.status}.`);
    const value = await response.json();
    if (!validStatus(value)) throw new Error('Device returned an invalid status response.');
    document.getElementById('server-name').textContent = value.serverName;
    document.getElementById('hostname').textContent = value.hostname;
    document.getElementById('ip-address').textContent = value.ipAddress;
    document.getElementById('discovery').textContent =
      `mDNS: ${value.mdnsReady ? 'ready' : 'unavailable'}; NetBIOS: ${value.netbiosReady ? 'ready' : 'unavailable'}. IP access is the fallback.`;
    document.getElementById('version').textContent = `${value.firmwareVersion} / ${value.apiVersion}`;
    const gib = bytes => (bytes / (1024 ** 3)).toFixed(2);
    document.getElementById('storage').textContent =
      `${gib(value.storage.totalBytes)} GiB total, ${gib(value.storage.usedBytes)} GiB used. Shared-file quota is not implemented.`;
    details.hidden = false;
    statusMessage.textContent = 'Device is responding. Business apps are not installed yet.';
  } catch (error) {
    statusMessage.textContent = `Unable to read device status: ${error.message} Check your connection and login, then retry.`;
  } finally {
    refresh.disabled = false;
  }
}

refresh.addEventListener('click', loadStatus);
loadStatus();
