// Installs the official Windows Player packages into ZenTrap's own data root.
// Roblox's version feed and CDN are queried at runtime because client builds change often.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');

const execFileAsync = promisify(execFile);
const CLIENT_VERSION_URL = 'https://clientsettingscdn.roblox.com/v2/client-version/WindowsPlayer';
const CDN = 'https://setup.rbxcdn.com';
const APP_SETTINGS = '<?xml version="1.0" encoding="UTF-8"?>\r\n<Settings>\r\n\t<ContentFolder>content</ContentFolder>\r\n\t<BaseUrl>http://www.roblox.com</BaseUrl>\r\n</Settings>\r\n';
const PACKAGE_PATHS = {
  'RobloxApp.zip': '', 'Libraries.zip': '', 'redist.zip': '', 'WebView2.zip': '',
  'WebView2RuntimeInstaller.zip': 'WebView2RuntimeInstaller', 'shaders.zip': 'shaders', 'ssl.zip': 'ssl',
  'content-avatar.zip': 'content/avatar', 'content-configs.zip': 'content/configs',
  'content-fonts.zip': 'content/fonts', 'content-sky.zip': 'content/sky',
  'content-sounds.zip': 'content/sounds', 'content-textures2.zip': 'content/textures',
  'content-models.zip': 'content/models', 'content-textures3.zip': 'PlatformContent/pc/textures',
  'content-terrain.zip': 'PlatformContent/pc/terrain',
  'content-platform-fonts.zip': 'PlatformContent/pc/fonts',
  'content-platform-dictionaries.zip': 'PlatformContent/pc/shared_compression_dictionaries',
  'extracontent-luapackages.zip': 'ExtraContent/LuaPackages',
  'extracontent-translations.zip': 'ExtraContent/translations',
  'extracontent-models.zip': 'ExtraContent/models',
  'extracontent-textures.zip': 'ExtraContent/textures',
  'extracontent-places.zip': 'ExtraContent/places'
};

function safeVersion(value) {
  if (typeof value !== 'string' || !/^version-[a-z0-9]+$/i.test(value)) throw new Error('Сервер Roblox вернул некорректный номер версии.');
  return value.toLowerCase();
}

async function getLatestVersion() {
  const res = await fetch(CLIENT_VERSION_URL, { headers: { 'User-Agent': 'ZenTrap/1.0' } });
  if (!res.ok) throw new Error(`Не удалось проверить версию Roblox (HTTP ${res.status}).`);
  const body = await res.json();
  return safeVersion(body.clientVersionUpload);
}

function parseManifest(body) {
  const lines = body.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  // Current Roblox manifests start with a format tag (for example, "v0")
  // and put MD5 before the two sizes. Older manifests used no tag and put MD5 last.
  if (/^v\d+$/i.test(lines[0] || '')) lines.shift();
  if (lines.length % 4 !== 0) throw new Error('Манифест Roblox имеет неизвестный формат.');
  const packages = new Map();
  for (let i = 0; i < lines.length; i += 4) {
    const name = lines[i];
    const hashFirst = /^[a-f0-9]{32}$/i.test(lines[i + 1] || '');
    const md5 = (hashFirst ? lines[i + 1] : lines[i + 3]).toLowerCase();
    const compressedSize = Number(lines[i + (hashFirst ? 2 : 1)]);
    const uncompressedSize = Number(lines[i + (hashFirst ? 3 : 2)]);
    if (!Object.prototype.hasOwnProperty.call(PACKAGE_PATHS, name)) {
      if (name.toLowerCase().endsWith('.zip')) throw new Error(`Новый пакет Roblox пока не поддерживается ZenTrap: ${name}.`);
      continue;
    }
    if (!Number.isSafeInteger(compressedSize) || compressedSize < 0 || !Number.isSafeInteger(uncompressedSize) || uncompressedSize < 0 || !/^[a-f0-9]{32}$/.test(md5)) {
      throw new Error(`Не удалось проверить пакет ${name}: неверные данные манифеста.`);
    }
    packages.set(name, { name, compressedSize, uncompressedSize, md5 });
  }
  if (!packages.has('RobloxApp.zip')) throw new Error('В манифесте Roblox отсутствует основной пакет.');
  return [...packages.values()];
}

async function fetchManifest(version) {
  const url = `${CDN}/${version}-rbxPkgManifest.txt`;
  const res = await fetch(url, { headers: { 'User-Agent': 'ZenTrap/1.0' } });
  if (!res.ok) throw new Error(`Не удалось получить список файлов Roblox (HTTP ${res.status}).`);
  return parseManifest(await res.text());
}

async function downloadPackage(version, pkg, file, onBytes) {
  const url = `${CDN}/${version}-${pkg.name}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'ZenTrap/1.0' } });
  if (!res.ok || !res.body) throw new Error(`Не удалось скачать ${pkg.name} (HTTP ${res.status}).`);
  const hash = crypto.createHash('md5');
  let received = 0;
  const meter = new Transform({
    transform(chunk, encoding, callback) {
      received += chunk.length;
      hash.update(chunk);
      onBytes(chunk.length);
      callback(null, chunk);
    }
  });
  await pipeline(Readable.fromWeb(res.body), meter, fs.createWriteStream(file));
  if (received !== pkg.compressedSize || hash.digest('hex') !== pkg.md5) {
    fs.rmSync(file, { force: true });
    throw new Error(`Проверка целостности ${pkg.name} не прошла. Повторите установку.`);
  }
}

function psQuote(value) { return `'${value.replace(/'/g, "''")}'`; }

async function extractPackage(zip, destination) {
  fs.mkdirSync(destination, { recursive: true });
  const command = `Expand-Archive -LiteralPath ${psQuote(zip)} -DestinationPath ${psQuote(destination)} -Force`;
  try {
    await execFileAsync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, maxBuffer: 1024 * 1024 });
  } catch (e) {
    throw new Error(`Не удалось распаковать Roblox (${path.basename(zip)}): ${e.message || e}`);
  }
}

async function hasWebView2Runtime() {
  const keys = [
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
    'HKCU\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
  ];
  const results = await Promise.all(keys.map(async (key) => {
    try {
      const { stdout } = await execFileAsync('reg.exe', ['query', key, '/v', 'pv'], { windowsHide: true });
      const match = stdout.match(/\bpv\s+REG_SZ\s+(\d+(?:\.\d+){1,3})/i);
      return Boolean(match && match[1] !== '0.0.0.0');
    } catch { return false; }
  }));
  return results.some(Boolean);
}

function findExecutable(root, names) {
  const wanted = new Set(names.map((x) => x.toLowerCase()));
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (entry.isFile() && wanted.has(entry.name.toLowerCase())) return full;
    }
  }
  return null;
}

async function installWebView2(stageDir, onProgress) {
  const runtimeInstallerDir = path.join(stageDir, 'WebView2RuntimeInstaller');
  const installer = findExecutable(runtimeInstallerDir, [
    'MicrosoftEdgeWebView2RuntimeInstallerX64.exe',
    'MicrosoftEdgeWebView2Setup.exe',
    'MicrosoftEdgeWebview2Setup.exe'
  ]);
  if (!installer) throw new Error('В пакете Roblox отсутствует установщик WebView2, который нужен этому компьютеру.');
  onProgress({ phase: 'dependency', percent: 99, message: 'Установка WebView2 Runtime…' });
  try {
    await execFileAsync(installer, ['/silent', '/install'], { windowsHide: true, maxBuffer: 1024 * 1024 });
  } catch (e) {
    throw new Error(`Не удалось установить WebView2 Runtime: ${e.message || e}`);
  }
  if (!(await hasWebView2Runtime())) throw new Error('Установщик WebView2 завершился, но Runtime не найден в системе.');
}

async function installRoblox(root, { force = false, checkForUpdates = true, onProgress = () => {} } = {}) {
  if (process.platform !== 'win32') throw new Error('Установка Roblox поддерживается только в Windows.');
  fs.mkdirSync(root, { recursive: true });
  const markerPath = path.join(root, 'ZenTrap.Install.json');
  let existingMarker = null;
  if (fs.existsSync(markerPath)) {
    try { existingMarker = JSON.parse(fs.readFileSync(markerPath, 'utf8')); } catch {}
    if (!existingMarker || existingMarker.schema !== 1 || existingMarker.owner !== 'ZenTrap' || !/^version-[a-z0-9]+$/i.test(existingMarker.clientVersion || '')) {
      throw new Error('В папке уже есть файл владения ZenTrap с неизвестным форматом. Ничего не изменено.');
    }
  }
  if (!existingMarker) {
    const versions = path.join(root, 'Versions');
    let containsOtherClient = false;
    try {
      containsOtherClient = fs.readdirSync(versions, { withFileTypes: true }).some((entry) =>
        entry.isDirectory() && entry.name.startsWith('version-') && fs.existsSync(path.join(versions, entry.name, 'RobloxPlayerBeta.exe'))
      );
    } catch {}
    if (containsOtherClient) throw new Error('В выбранной папке уже есть Roblox от другого установщика. Чтобы не затронуть его, установите ZenTrap в отдельную пустую папку.');
  }
  if (!force && !checkForUpdates && existingMarker) {
    const version = existingMarker.clientVersion.toLowerCase();
    const versionDir = path.join(root, 'Versions', version);
    if (fs.existsSync(path.join(versionDir, 'RobloxPlayerBeta.exe'))) {
      const appSettings = path.join(versionDir, 'AppSettings.xml');
      if (!fs.existsSync(appSettings)) fs.writeFileSync(appSettings, APP_SETTINGS);
      onProgress({ phase: 'complete', version, percent: 100, message: 'Проверка обновлений отключена. Запускается установленная версия Roblox.' });
      return { version, versionDir, installed: false, updateSkipped: true };
    }
  }
  let version;
  try { version = await getLatestVersion(); }
  catch (error) {
    const current = existingMarker && path.join(root, 'Versions', existingMarker.clientVersion);
    if (!force && current && fs.existsSync(path.join(current, 'RobloxPlayerBeta.exe'))) {
      onProgress({ phase: 'complete', version: existingMarker.clientVersion, percent: 100, message: 'Сеть недоступна. Запускается последняя установленная версия Roblox.' });
      return { version: existingMarker.clientVersion, versionDir: current, installed: false, offline: true };
    }
    throw error;
  }
  const finalDir = path.join(root, 'Versions', version);
  if (!force && fs.existsSync(path.join(finalDir, 'RobloxPlayerBeta.exe'))) {
    const appSettings = path.join(finalDir, 'AppSettings.xml');
    if (!fs.existsSync(appSettings)) fs.writeFileSync(appSettings, APP_SETTINGS);
    return { version, versionDir: finalDir, installed: false };
  }

  let packages = await fetchManifest(version);
  const webViewInstalled = await hasWebView2Runtime();
  if (webViewInstalled) packages = packages.filter((pkg) => pkg.name !== 'WebView2RuntimeInstaller.zip');
  else if (!packages.some((pkg) => pkg.name === 'WebView2RuntimeInstaller.zip')) {
    throw new Error('Для установки Roblox нужна WebView2 Runtime, но Roblox не передал её установщик.');
  }
  const total = packages.reduce((sum, p) => sum + p.compressedSize, 0) || 1;
  const required = packages.reduce((sum, p) => sum + p.uncompressedSize, 0) + 512 * 1024 * 1024;
  try {
    const space = fs.statfsSync(root);
    if (space.bavail * space.bsize < required) throw new Error('Недостаточно свободного места для установки Roblox. Освободите место в выбранной папке и попробуйте снова.');
  } catch (e) {
    if (e.message && e.message.includes('Недостаточно')) throw e;
    throw new Error('Не удалось проверить свободное место в папке установки. Проверьте права доступа.');
  }
  let completed = 0;
  const downloads = path.join(root, 'Downloads', 'ZenTrap');
  fs.mkdirSync(downloads, { recursive: true });
  const stageDir = path.join(root, 'Versions', `${version}.zt-stage-${process.pid}`);
  fs.rmSync(stageDir, { recursive: true, force: true });
  fs.mkdirSync(stageDir, { recursive: true });
  onProgress({ phase: 'download', version, percent: 0, message: 'Подготовка загрузки Roblox…' });
  try {
    for (const pkg of packages) {
      const zip = path.join(downloads, `${version}-${pkg.name}`);
      let current = 0;
      onProgress({ phase: 'download', version, percent: Math.floor(completed / total * 100), message: `Скачивание ${pkg.name}…` });
      await downloadPackage(version, pkg, zip, (bytes) => {
        current += bytes;
        onProgress({ phase: 'download', version, percent: Math.min(99, Math.floor((completed + current) / total * 100)), message: `Скачивание ${pkg.name}…` });
      });
      completed += pkg.compressedSize;
      const prefix = PACKAGE_PATHS[pkg.name];
      const destination = prefix ? path.join(stageDir, ...prefix.split('/')) : stageDir;
      onProgress({ phase: 'extract', version, percent: Math.min(99, Math.floor(completed / total * 100)), message: `Распаковка ${pkg.name}…` });
      await extractPackage(zip, destination);
      fs.rmSync(zip, { force: true });
    }

    if (!webViewInstalled) await installWebView2(stageDir, onProgress);

    if (!fs.existsSync(path.join(stageDir, 'RobloxPlayerBeta.exe'))) throw new Error('В установленных файлах нет RobloxPlayerBeta.exe. Установка остановлена.');
    const appSettings = path.join(stageDir, 'AppSettings.xml');
    if (!fs.existsSync(appSettings)) fs.writeFileSync(appSettings, APP_SETTINGS);
    fs.mkdirSync(path.dirname(finalDir), { recursive: true });
    const oldDir = `${finalDir}.zt-old-${process.pid}`;
    fs.rmSync(oldDir, { recursive: true, force: true });
    if (fs.existsSync(finalDir)) fs.renameSync(finalDir, oldDir);
    try { fs.renameSync(stageDir, finalDir); }
    catch (e) {
      if (fs.existsSync(oldDir) && !fs.existsSync(finalDir)) fs.renameSync(oldDir, finalDir);
      throw e;
    }
    fs.rmSync(oldDir, { recursive: true, force: true });
    const managedVersions = [...new Set([
      ...(existingMarker?.managedVersions || []),
      ...(existingMarker?.clientVersion ? [existingMarker.clientVersion] : []),
      version
    ])].filter((v) => /^version-[a-z0-9]+$/i.test(v));
    const marker = { schema: 1, owner: 'ZenTrap', clientVersion: version, managedVersions, installedAt: new Date().toISOString() };
    const tmp = markerPath + '.tmp';
    const backup = markerPath + '.replace-bak';
    fs.writeFileSync(tmp, JSON.stringify(marker, null, 2));
    fs.rmSync(backup, { force: true });
    if (fs.existsSync(markerPath)) fs.renameSync(markerPath, backup);
    try { fs.renameSync(tmp, markerPath); }
    catch (e) {
      if (fs.existsSync(backup) && !fs.existsSync(markerPath)) fs.renameSync(backup, markerPath);
      throw e;
    }
    fs.rmSync(backup, { force: true });
    onProgress({ phase: 'complete', version, percent: 100, message: 'Roblox установлен.' });
    return { version, versionDir: finalDir, installed: true };
  } catch (e) {
    fs.rmSync(stageDir, { recursive: true, force: true });
    throw e;
  }
}

module.exports = { getLatestVersion, parseManifest, installRoblox, PACKAGE_PATHS };
