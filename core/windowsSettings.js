// Reversible per-user Windows preferences for the ZenTrap-managed Roblox client.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const BACKUP_FILE = 'WindowsSettings.json';
const FEATURES = {
  gpuPref: { key: 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences', data: 'GpuPreference=2;' },
  fsOpt: { key: 'HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers', data: 'DISABLEDXMAXIMIZEDWINDOWEDMODE' }
};

function loadBackups(dataDir) {
  const file = path.join(dataDir, BACKUP_FILE);
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (value.schema === 1 && value.entries && typeof value.entries === 'object' && !Array.isArray(value.entries)) return value.entries;
  } catch (e) {
    if (e.code !== 'ENOENT') { try { fs.copyFileSync(file, file + '.corrupt'); } catch {} }
  }
  return {};
}

function saveBackups(dataDir, entries) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, BACKUP_FILE), tmp = file + '.tmp';
  if (Object.keys(entries).length === 0) {
    fs.rmSync(file, { force: true });
    fs.rmSync(tmp, { force: true });
    return;
  }
  fs.writeFileSync(tmp, JSON.stringify({ schema: 1, entries }, null, 2));
  fs.renameSync(tmp, file);
}

async function queryValue(key, name) {
  try {
    const { stdout } = await execFileAsync('reg.exe', ['query', key, '/v', name], { windowsHide: true });
    const match = stdout.match(/\bREG_SZ\s+([^\r\n]*)/i);
    if (!match) return { exists: false, value: '' };
    return { exists: true, value: match[1].trim() };
  } catch (e) {
    // reg.exe uses the Windows OEM code page, so its localized stderr is not reliable UTF-8.
    if (e.code === 1 || e.code === '1') return { exists: false, value: '' };
    throw new Error(`Не удалось прочитать настройку Windows для Roblox (код ${e.code || 'неизвестен'}).`);
  }
}

async function writeValue(key, name, value) {
  try { await execFileAsync('reg.exe', ['add', key, '/v', name, '/t', 'REG_SZ', '/d', value, '/f'], { windowsHide: true }); }
  catch (e) { throw new Error(`Не удалось изменить настройку Windows для Roblox (код ${e.code || 'неизвестен'}).`); }
}

async function deleteValue(key, name) {
  try { await execFileAsync('reg.exe', ['delete', key, '/v', name, '/f'], { windowsHide: true }); }
  catch (e) {
    if (e.code === 1 || e.code === '1') return;
    throw new Error(`Не удалось восстановить настройку Windows для Roblox (код ${e.code || 'неизвестен'}).`);
  }
}

function managedValue(feature, originalValue) {
  if (feature === 'gpuPref') {
    const rest = originalValue.replace(/(?:^|;)\s*GpuPreference\s*=\s*[^;]*;?/ig, '').replace(/^;+|;+$/g, '').trim();
    return `GpuPreference=2;${rest ? ` ${rest}` : ''}`;
  }
  const flags = originalValue.trim().replace(/^~\s*/, '').trim();
  if (/DISABLEDXMAXIMIZEDWINDOWEDMODE/i.test(flags)) return originalValue.trim();
  return `~ DISABLEDXMAXIMIZEDWINDOWEDMODE${flags ? ` ${flags}` : ''}`;
}

async function restoreEntry(entries, id, dataDir) {
  const old = entries[id];
  if (!old) return;
  const current = await queryValue(old.key, old.name);
  // If the user changed this value after ZenTrap, keep the user's newer choice.
  if (current.exists && current.value === old.managedValue) {
    if (old.originalExists) await writeValue(old.key, old.name, old.originalValue);
    else await deleteValue(old.key, old.name);
  }
  delete entries[id];
  saveBackups(dataDir, entries);
}

async function applyOne(feature, enabled, executable, dataDir) {
  const spec = FEATURES[feature], entries = loadBackups(dataDir);
  const id = `${feature}|${executable.toLowerCase()}`;
  if (!enabled) { await restoreEntry(entries, id, dataDir); return; }

  let backup = entries[id];
  if (!backup) {
    const original = await queryValue(spec.key, executable);
    backup = {
      key: spec.key, name: executable, originalExists: original.exists,
      originalValue: original.value, managedValue: managedValue(feature, original.value)
    };
    entries[id] = backup;
    saveBackups(dataDir, entries);
  }
  await writeValue(backup.key, backup.name, backup.managedValue);
}

async function applyWindowsSettings(settings, { dataDir, versionDir, root } = {}) {
  if (process.platform !== 'win32' || !dataDir || !versionDir) return [];
  const executable = path.join(versionDir, 'RobloxPlayerBeta.exe');
  if (!fs.existsSync(executable)) return [];
  const notes = [];
  for (const feature of Object.keys(FEATURES)) {
    try {
      const entries = loadBackups(dataDir);
      const prefix = `${feature}|`;
      const versionsRoot = root ? path.resolve(root, 'Versions') + path.sep : null;
      const currentPath = path.resolve(executable).toLowerCase();
      for (const id of Object.keys(entries)) {
        if (!id.startsWith(prefix)) continue;
        const oldPath = path.resolve(entries[id].name).toLowerCase();
        if (oldPath === currentPath) continue;
        if (versionsRoot && oldPath.startsWith(versionsRoot.toLowerCase())) await restoreEntry(entries, id, dataDir);
      }
      await applyOne(feature, settings?.[feature] === true, executable, dataDir);
    }
    catch (e) { notes.push(String(e.message || e)); }
  }
  return notes;
}

async function restoreAllWindowsSettings(dataDir) {
  if (process.platform !== 'win32') return;
  const entries = loadBackups(dataDir);
  for (const id of Object.keys(entries)) await restoreEntry(entries, id, dataDir);
}

module.exports = { applyWindowsSettings, restoreAllWindowsSettings };
