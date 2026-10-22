const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');

test('desktop exposes only narrow Control setting methods and loads them at startup', async () => {
  const root = path.join(__dirname, '..');
  const [main, preload, app, bootstrap] = await Promise.all([
    fs.readFile(path.join(root, 'desktop/main.js'), 'utf8'),
    fs.readFile(path.join(root, 'desktop/preload.js'), 'utf8'),
    fs.readFile(path.join(root, 'public/app.js'), 'utf8'),
    fs.readFile(path.join(root, 'public/js/appBootstrap.js'), 'utf8')
  ]);
  assert.match(preload, /getControlSettings: \(\) => ipcRenderer\.invoke\('cne-desktop:get-control-settings'\)/);
  assert.match(preload, /setZoomSensitivity: \(value\) => ipcRenderer\.invoke\('cne-desktop:set-zoom-sensitivity', value\)/);
  assert.doesNotMatch(preload, /getDesktopSettings|setDesktopSetting|arbitrary.*setting/i);
  assert.match(main, /registerVaultIpcHandler\(IPC\.GET_CONTROL_SETTINGS/);
  assert.match(main, /registerVaultIpcHandler\(IPC\.SET_ZOOM_SENSITIVITY/);
  assert.match(main, /registerVaultIpcHandler\(IPC\.GET_CONTROL_SETTINGS, async \(runtime\)[\s\S]*?zoomSensitivityForVault\(settings, runtime\.vaultInfo\.projectId\)/);
  assert.match(main, /registerVaultIpcHandler\(IPC\.SET_ZOOM_SENSITIVITY, async \(runtime, _event, value\)[\s\S]*?withZoomSensitivityForVault\([\s\S]*?runtime\.vaultInfo\.projectId/);
  assert.match(main, /function registerVaultIpcHandler[\s\S]*?runtimeForEvent\(event\)[\s\S]*?runVaultOperation\(runtime/);
  assert.match(main, /settingsStore\.loadLegacyRaw\(\)[\s\S]*?migrateLegacyZoomSensitivities\([\s\S]*?registry\.vaults\.map\(\(vault\) => vault\.vaultId\)/);
  assert.match(main, /function saveVaultFolderSettings[\s\S]*?mutateDesktopSettings[\s\S]*?withFolderRootsForVault/);
  assert.doesNotMatch(main, /saveSettings: \(next\) => settingsStore\.save\(next\)/);
  assert.match(app, /typeof bridge\.getControlSettings !== 'function'/);
  assert.match(bootstrap, /await loadControlSettings\(\)/);
});
