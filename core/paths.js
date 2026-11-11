// Пути ZenTrap и Roblox. Все функции принимают параметры, чтобы их можно было тестировать.
const fs = require('fs'), os = require('os'), path = require('path');

const localAppData = () => process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
const installRoot = () => process.env.ZENTRAP_HOME || path.join(localAppData(), 'ZenTrap');
const dataDir = () => process.env.ZENTRAP_HOME ? path.join(process.env.ZENTRAP_HOME, 'ZenTrapData') : installRoot();
// Roblox stores this user setting outside any installer's managed client directory.
const basicSettingsPath = (lad = localAppData()) => path.join(lad, 'Roblox', 'GlobalBasicSettings_13.xml');

// Ищем только папку, выбранную для ZenTrap, и его собственную папку данных.
// Системную установку Roblox и папку Bloxstrap не сканируем и не меняем.
function defaultRoots(lad = localAppData(), extra = []) {
  return [...new Set([...extra.filter(Boolean), installRoot()])];
}

function readManagedInstall(root) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(root, 'ZenTrap.Install.json'), 'utf8'));
    if (value.schema !== 1 || value.owner !== 'ZenTrap' || !/^version-[a-z0-9]+$/i.test(value.clientVersion || '')) return null;
    const managedVersions = Array.isArray(value.managedVersions) ? value.managedVersions : [value.clientVersion];
    const versions = [...new Set([value.clientVersion, ...managedVersions])].filter((v) => /^version-[a-z0-9]+$/i.test(v));
    return { ...value, managedVersions: versions };
  } catch { return null; }
}

function managedVersionDir(root) {
  const install = readManagedInstall(root);
  if (!install) return null;
  const versionsDir = path.join(root, 'Versions');
  const order = [install.clientVersion, ...install.managedVersions.filter((v) => v !== install.clientVersion)];
  for (const version of order) {
    const dir = path.join(versionsDir, version);
    if (fs.existsSync(path.join(dir, 'RobloxPlayerBeta.exe'))) return dir;
  }
  return null;
}

// Самая свежая установленная версия клиента: <корень>\Versions\version-xxxx с RobloxPlayerBeta.exe
function latestVersionDir(roots) {
  let best = null;
  for (const root of roots) {
    const vd = path.join(root, 'Versions');
    let ents;
    try { ents = fs.readdirSync(vd, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      if (!e.isDirectory() || !e.name.startsWith('version-')) continue;
      const dir = path.join(vd, e.name);
      if (!fs.existsSync(path.join(dir, 'RobloxPlayerBeta.exe'))) continue;
      const t = fs.statSync(dir).mtimeMs;
      if (!best || t > best.t) best = { dir, t };
    }
  }
  return best ? best.dir : null;
}

module.exports = { localAppData, installRoot, dataDir, basicSettingsPath, defaultRoots, latestVersionDir, readManagedInstall, managedVersionDir };
