const { app, BrowserWindow, ipcMain, shell, screen, dialog, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
// Установщик задаёт папку приложения. В сборке держим ZenTrap, настройки и Roblox
// в одном выбранном пользователем месте; в режиме разработки используем обычную папку данных.
if (app.isPackaged) process.env.ZENTRAP_HOME = path.dirname(process.execPath);
if (app.isPackaged && process.env.ZENTRAP_HOME) {
  app.setPath('userData', path.join(process.env.ZENTRAP_HOME, 'ZenTrapData', 'UserData'));
}
const paths = require('./core/paths');
const { createStore } = require('./core/store');
const { applyPerf, isRobloxRunning } = require('./core/apply');
const { installRoblox } = require('./core/robloxInstaller');
const { restoreFramerateCap } = require('./core/robloxSettings');
const { restoreAllWindowsSettings } = require('./core/windowsSettings');
const { autoUpdater } = require('electron-updater');

// Preserve settings from earlier development builds when moving to the chosen install root.
if (app.isPackaged) {
  const current = path.join(paths.dataDir(), 'Settings.json');
  const legacy = path.join(paths.localAppData(), 'ZenTrap', 'Settings.json');
  if (!fs.existsSync(current) && fs.existsSync(legacy)) {
    try { fs.mkdirSync(path.dirname(current), { recursive: true }); fs.copyFileSync(legacy, current); } catch {}
  }
}

// DESIGN: размеры окон. Лаунчер маленький, полное приложение большое.
const LAUNCHER = { w: 780, h: 480 };
const FULL = { w: 1240, h: 800 };

let win, anim, tray, isQuitting = false, robloxBusy = false, lastCpuSample = null, backgroundAppSnapshot = new Map();
let gpuSampleAt = 0, gpuSampleValue = null, gpuSamplePending = null;
let managedGameSession = false, managedGameSeen = false, managedGamePoll = null;
let appUpdateStarted = false;
let lastAppUpdateStatus = { state: 'idle' };
let appUpdateDownloadStarted = false, appUpdateReady = false, appUpdateInstallStarted = false;
let appUpdateRequestedByUser = false;
async function withRobloxLock(task) {
  if (robloxBusy) return { ok: false, error: 'ZenTrap уже выполняет операцию с Roblox. Дождитесь её завершения.' };
  robloxBusy = true;
  try { return await task(); }
  finally { robloxBusy = false; }
}
function removeEmptyDirectory(dir) {
  try { if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir); } catch {}
}
function showWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
function managedVersionDirs(root = paths.installRoot()) {
  const install = paths.readManagedInstall(root);
  if (!install) return [];
  return install.managedVersions.map((version) => path.join(root, 'Versions', version));
}
async function managedRobloxProcesses(root = paths.installRoot()) {
  if (process.platform !== 'win32') return [];
  const dirs = managedVersionDirs(root);
  if (!dirs.length) return [];
  const quoted = dirs.map((dir) => `'${path.join(dir, 'RobloxPlayerBeta.exe').replace(/'/g, "''")}'`).join(',');
  const script = `$ErrorActionPreference='SilentlyContinue';$targets=@(${quoted}|ForEach-Object{[IO.Path]::GetFullPath($_).ToLowerInvariant()});@(Get-CimInstance Win32_Process -Filter "Name='RobloxPlayerBeta.exe'"|Where-Object{$_.ExecutablePath -and $targets -contains ([IO.Path]::GetFullPath($_.ExecutablePath).ToLowerInvariant())}|Select-Object ProcessId,ExecutablePath|ConvertTo-Json -Compress)`;
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 5000, encoding: 'utf8' });
    const parsed = JSON.parse(stdout.trim() || '[]');
    return (Array.isArray(parsed) ? parsed : [parsed]).filter((item) => Number.isInteger(Number(item.ProcessId)));
  } catch { return []; }
}
async function closeManagedRoblox() {
  const processes = await managedRobloxProcesses();
  for (const item of processes) {
    try { process.kill(Number(item.ProcessId), 'SIGTERM'); } catch {}
  }
  if (processes.length) await new Promise((resolve) => setTimeout(resolve, 1200));
  const remaining = await managedRobloxProcesses();
  for (const item of remaining) {
    try { process.kill(Number(item.ProcessId), 'SIGKILL'); } catch {}
  }
  return { ok: true, closed: processes.length };
}
function monitorManagedGameSession() {
  clearInterval(managedGamePoll);
  managedGamePoll = setInterval(async () => {
    if (!managedGameSession) { clearInterval(managedGamePoll); managedGamePoll = null; return; }
    if (!store.get('app', {}).tray) { managedGameSession = false; managedGameSeen = false; return; }
    const running = await managedRobloxProcesses();
    if (running.length) managedGameSeen = true;
    else if (managedGameSeen) {
      managedGameSession = false; managedGameSeen = false;
      isQuitting = true; app.quit();
    }
  }, 2000);
}
function setTrayEnabled(enabled) {
  if (!enabled) {
    managedGameSession = false;
    managedGameSeen = false;
    clearInterval(managedGamePoll);
    managedGamePoll = null;
    if (tray) tray.destroy();
    tray = null;
    return;
  }
  if (tray) return;
  const icon = path.join(__dirname, 'assets', 'zentrap-icon.ico');
  tray = new Tray(icon);
  tray.setToolTip('ZenTrap');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть ZenTrap', click: showWindow },
    { label: 'Закрыть Roblox', click: async () => { await closeManagedRoblox(); } },
    { type: 'separator' },
    { label: 'Выход', click: () => { isQuitting = true; app.quit(); } }
  ]));
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
  managedRobloxProcesses().then((running) => {
    if (running.length && store.get('app', {}).tray === true) {
      managedGameSession = true;
      managedGameSeen = true;
      monitorManagedGameSession();
    }
  });
}
function robloxCachePaths(root) {
  const result = [path.join(root, 'Downloads', 'ZenTrap')];
  const versions = path.join(root, 'Versions');
  try {
    for (const entry of fs.readdirSync(versions, { withFileTypes: true })) {
      if (entry.isDirectory() && /^version-[a-z0-9]+\.zt-stage-\d+$/i.test(entry.name)) result.push(path.join(versions, entry.name));
    }
  } catch {}
  return result;
}
function directorySize(dir) {
  let total = 0;
  const pending = [dir];
  while (pending.length) {
    const current = pending.pop();
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(file);
      else if (entry.isFile()) { try { total += fs.statSync(file).size; } catch {} }
    }
  }
  return total;
}

function createWindow() {
  win = new BrowserWindow({
    width: LAUNCHER.w, height: LAUNCHER.h, resizable: false, center: true, show: false,
    frame: false, backgroundColor: '#0d0d10', icon: path.join(__dirname, 'assets', 'zentrap-icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  win.setMenuBarVisibility(false);
  win.on('close', (event) => {
    if (tray && !isQuitting) { event.preventDefault(); win.hide(); }
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.once('ready-to-show', () => {
    // DESIGN: окно плавно проявляется
    win.setOpacity(0); win.show();
    let o = 0; const t = setInterval(() => { o += 0.1; win.setOpacity(Math.min(o, 1)); if (o >= 1) clearInterval(t); }, 16);
  });
}

function startAppUpdateCheck() {
  if (appUpdateStarted || !app.isPackaged) return;
  const appPackage = require('./package.json');
  const repoUrl = appPackage.repository && appPackage.repository.url;
  const match = typeof repoUrl === 'string' && repoUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?$/i);
  if (!match) return;
  appUpdateStarted = true;
  const [, owner, repo] = match;
  autoUpdater.setFeedURL({ provider: 'github', owner, repo });
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  const publish = (status) => {
    lastAppUpdateStatus = { cur: app.getVersion(), ...status };
    if (!win || win.isDestroyed()) return;
    win.webContents.send('app:update-status', lastAppUpdateStatus);
  };
  const notesFor = (info) => Array.isArray(info.releaseNotes)
    ? info.releaseNotes.map((item) => item && (item.note || item.version) || '').filter(Boolean).join('\n')
    : String(info.releaseNotes || info.releaseName || '');
  const updateDetails = (info) => ({
    ver: info.version,
    notes: notesFor(info),
    size: info.files?.find((file) => /\.exe(?:$|\?)/i.test(file.url))?.size || 0,
    date: info.releaseDate || '',
    channel: /(?:alpha|beta|rc)/i.test(info.version) ? 'Бета' : 'Стабильная'
  });
  const logUpdate = (message) => {
    try {
      const logFile = path.join(paths.dataDir(), 'Updater.log');
      fs.mkdirSync(path.dirname(logFile), { recursive: true });
      fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${message}\r\n`, 'utf8');
    } catch {}
  };
  autoUpdater.on('checking-for-update', () => publish({ state: 'checking', autoOpen: appUpdateRequestedByUser }));
  autoUpdater.on('update-available', (info) => {
    const details = updateDetails(info);
    const skipped = store.get('app', {}).skippedUpdateVersion;
    if (skipped === info.version) {
      publish({ state: 'uptodate', ...details, message: `Версия ${info.version} пропущена.`, autoOpen: appUpdateRequestedByUser });
      appUpdateRequestedByUser = false;
      return;
    }
    appUpdateDownloadStarted = false;
    appUpdateReady = false;
    publish({ state: 'available', ...details, autoOpen: true });
    appUpdateRequestedByUser = false;
  });
  autoUpdater.on('update-not-available', () => {
    publish({ state: 'uptodate', message: 'У вас последняя версия ZenTrap.', autoOpen: appUpdateRequestedByUser });
    appUpdateRequestedByUser = false;
  });
  autoUpdater.on('download-progress', (progress) => publish({
    state: 'downloading', percent: Math.round(progress.percent), loaded: progress.transferred,
    total: progress.total, speed: progress.bytesPerSecond, eta: progress.bytesPerSecond > 0
      ? Math.max(0, (progress.total - progress.transferred) / progress.bytesPerSecond) : 0
  }));
  autoUpdater.on('update-downloaded', (info) => {
    appUpdateReady = true;
    publish({ state: 'verifying', ...updateDetails(info), percent: 100 });
    setTimeout(() => {
      if (!appUpdateReady || appUpdateInstallStarted) return;
      publish({ state: 'installing', ...updateDetails(info), percent: 100 });
      setTimeout(() => {
        if (!appUpdateReady || appUpdateInstallStarted) return;
        appUpdateInstallStarted = true;
        publish({ state: 'restarting', ...updateDetails(info), percent: 100 });
        setTimeout(() => autoUpdater.quitAndInstall(true, true), 450);
      }, 650);
    }, 550);
  });
  autoUpdater.on('error', (error) => {
    const message = String(error.message || error);
    logUpdate(message);
    appUpdateDownloadStarted = false;
    publish({ state: 'error', message, autoOpen: appUpdateRequestedByUser });
    appUpdateRequestedByUser = false;
  });
  autoUpdater.checkForUpdates().catch((error) => {
    const message = String(error.message || error);
    logUpdate(message);
    publish({ state: 'error', message });
  });
  const updatePoll = setInterval(() => {
    if (!appUpdateDownloadStarted && !appUpdateReady && !appUpdateInstallStarted) {
      autoUpdater.checkForUpdates().catch((error) => {
        const message = String(error.message || error);
        logUpdate(message);
        publish({ state: 'error', message });
      });
    }
  }, 6 * 60 * 60 * 1000);
  updatePoll.unref();
}

async function runAppUpdateAction(action, version) {
  const allowed = new Set(['check', 'install', 'later', 'skip', 'cancel', 'retry', 'log']);
  if (!allowed.has(action)) return { ok: false, error: 'Неизвестное действие обновления.' };
  if (action === 'later') return { ok: true };
  if (action === 'log') {
    const logFile = path.join(paths.dataDir(), 'Updater.log');
    if (!fs.existsSync(logFile)) fs.writeFileSync(logFile, 'Лог обновлений ZenTrap пока пуст.\r\n', 'utf8');
    const error = await shell.openPath(logFile);
    return error ? { ok: false, error } : { ok: true };
  }
  if (!appUpdateStarted) startAppUpdateCheck();
  if (!appUpdateStarted) return { ok: false, error: 'Проверка обновлений доступна в установленной версии ZenTrap.' };
  if (action === 'skip') {
    if (typeof version === 'string' && /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) {
      const prefs = store.get('app', {});
      store.set('app', { ...prefs, skippedUpdateVersion: version });
    }
    return { ok: true };
  }
  if (action === 'cancel') {
    if (appUpdateDownloadStarted && !appUpdateReady) {
      autoUpdater.cancelDownload();
      appUpdateDownloadStarted = false;
      lastAppUpdateStatus = { ...lastAppUpdateStatus, state: 'available', autoOpen: true };
      win?.webContents.send('app:update-status', { cur: app.getVersion(), ...lastAppUpdateStatus });
    }
    return { ok: true };
  }
  if (action === 'install' && appUpdateReady) {
    if (!appUpdateInstallStarted) {
      appUpdateInstallStarted = true;
      lastAppUpdateStatus = { ...lastAppUpdateStatus, state: 'restarting' };
      win?.webContents.send('app:update-status', { cur: app.getVersion(), ...lastAppUpdateStatus });
      setTimeout(() => autoUpdater.quitAndInstall(true, true), 300);
    }
    return { ok: true };
  }
  appUpdateRequestedByUser = action === 'check' || action === 'retry';
  if (action === 'install') {
    if (appUpdateDownloadStarted) return { ok: true };
    appUpdateDownloadStarted = true;
    try {
      autoUpdater.downloadUpdate().catch((error) => {
        appUpdateDownloadStarted = false;
        const message = String(error.message || error);
        lastAppUpdateStatus = { state: 'error', message, autoOpen: true };
        win?.webContents.send('app:update-status', { cur: app.getVersion(), ...lastAppUpdateStatus });
      });
      return { ok: true };
    } catch (error) {
      appUpdateDownloadStarted = false;
      return { ok: false, error: String(error.message || error) };
    }
  }
  autoUpdater.allowPrerelease = false;
  appUpdateDownloadStarted = false;
  appUpdateReady = false;
  try {
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
}

// DESIGN: плавное изменение размера окна вокруг центра (~320 мс)
function animateTo(w, h, done) {
  const b = win.getBounds();
  const wa = screen.getDisplayMatching(b).workArea;
  w = Math.min(w, wa.width); h = Math.min(h, wa.height);
  const tx = Math.max(wa.x, Math.min(Math.round(b.x + b.width / 2 - w / 2), wa.x + wa.width - w));
  const ty = Math.max(wa.y, Math.min(Math.round(b.y + b.height / 2 - h / 2), wa.y + wa.height - h));
  const t0 = Date.now(), D = 400;
  clearInterval(anim);
  anim = setInterval(() => {
    const k = Math.min(1, (Date.now() - t0) / D), e = k < .5 ? 4*k*k*k : 1 - Math.pow(-2*k + 2, 3)/2;
    win.setBounds({
      x: Math.round(b.x + (tx - b.x) * e), y: Math.round(b.y + (ty - b.y) * e),
      width: Math.round(b.width + (w - b.width) * e), height: Math.round(b.height + (h - b.height) * e)
    });
    if (k === 1) { clearInterval(anim); done && done(); }
  }, 16);
}

ipcMain.on('win:mode', (_, mode) => {
  if (win.isMaximized()) win.unmaximize();
  if (mode === 'full') {
    win.setResizable(true);
    animateTo(FULL.w, FULL.h, () => win.setMinimumSize(1000, 640));
  } else {
    win.setMinimumSize(LAUNCHER.w, LAUNCHER.h);
    animateTo(LAUNCHER.w, LAUNCHER.h, () => win.setResizable(false));
  }
});

ipcMain.on('win:min', () => win.minimize());
ipcMain.on('win:max', () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
ipcMain.on('win:close', () => win.close());
function ensureRobloxLogDirectory() {
  // Roblox writes its bootstrap log to %LOCALAPPDATA%\\Roblox\\logs even when
  // the managed client itself lives in ZenTrap's selected install folder.
  const logDir = path.join(paths.localAppData(), 'Roblox', 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  return logDir;
}
// Устанавливаем/обновляем собственную копию, применяем профиль и запускаем её напрямую.
ipcMain.handle('roblox:launch', async (_, settings) => withRobloxLock(async () => {
  const root = paths.installRoot();
  try {
    if (await isRobloxRunning()) throw new Error('Сначала закрой Roblox, чтобы ZenTrap мог применить профиль.');
    const appPrefs = store.get('app', {});
    const installed = await installRoblox(root, {
      checkForUpdates: appPrefs.autoUpdate !== false,
      onProgress: (p) => win?.webContents.send('roblox:progress', p)
    });
    const result = await applyPerf(settings || {}, { dataDir: paths.dataDir(), robloxDir: root, versionDir: installed.versionDir });
    if (!result.ok) return result;
    const exe = path.join(installed.versionDir, 'RobloxPlayerBeta.exe');
    ensureRobloxLogDirectory();
    activeManagedVersionDir = installed.versionDir;
    const child = spawn(exe, ['roblox-player:1+launchmode:app+robloxLocale:en_us+gameLocale:en_us+LaunchExp:InApp'], {
      cwd: installed.versionDir, detached: true, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: false
    });
    let launchOutput = Buffer.alloc(0);
    child.stderr.on('data', (data) => { launchOutput = Buffer.concat([launchOutput, Buffer.from(data)]).subarray(-2000); });
    const outcome = new Promise((resolve) => {
      child.once('close', (code, signal) => resolve({ exited: true, code, signal }));
      child.once('error', (error) => resolve({ exited: true, error }));
    });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
    let earlyExit = await Promise.race([outcome, new Promise((resolve) => setTimeout(() => resolve(null), 2500))]);
    if (!earlyExit && child.exitCode !== null) earlyExit = { exited: true, code: child.exitCode, signal: child.signalCode };
    if (!earlyExit) child.stderr.destroy();
    if (earlyExit && !(await isRobloxRunning())) {
      const code = earlyExit.error ? earlyExit.error.message : `код ${earlyExit.code}${earlyExit.signal ? `, сигнал ${earlyExit.signal}` : ''}`;
      let details = launchOutput.toString('utf8').trim();
      if (details.includes('\uFFFD')) details = new TextDecoder('windows-1251').decode(launchOutput).trim();
      throw new Error(`Roblox сразу закрылся (${code}).${details ? ` Сообщение клиента: ${details}` : ''} Нажми «Переустановить Roblox» и попробуй ещё раз.`);
    }
    const launchNotes = [...(result.notes || [])];
    if (settings && settings.manageFlags === true && settings.priority === true) {
      try {
        os.setPriority(child.pid, os.constants.priority.PRIORITY_HIGH);
        launchNotes.push('Для Roblox установлен высокий приоритет Windows.');
      } catch (e) { launchNotes.push(`Не удалось повысить приоритет Roblox: ${e.message || e}`); }
    }
    if (appPrefs.minimizeOnPlay !== false) win?.minimize();
    if (appPrefs.tray === true) {
      managedGameSession = true;
      managedGameSeen = (await managedRobloxProcesses()).length > 0;
      monitorManagedGameSession();
    }
    return { ...result, notes: launchNotes, version: installed.version, launched: true };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}));
// Папка с установленным Roblox
ipcMain.on('roblox:folder', () => {
  const dir = paths.installRoot();
  fs.mkdirSync(dir, { recursive: true });
  shell.openPath(dir);
});

// Хранилище настроек и применение к Roblox (логика в core/)
const store = createStore(paths.dataDir());
ipcMain.handle('store:get', () => store.all());
ipcMain.handle('app:update-status', () => lastAppUpdateStatus);
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('app:update-action', (_, action, version) => runAppUpdateAction(action, version));
ipcMain.handle('store:set', (_, k, v) => {
  store.set(k, v);
  if (k === 'app' && v && typeof v === 'object') {
    app.setLoginItemSettings({ openAtLogin: v.autostart === true, path: app.getPath('exe') });
    setTrayEnabled(v.tray === true);
    autoUpdater.allowPrerelease = false;
  }
  return true;
});
ipcMain.handle('store:replace', (_, value) => {
  store.replace(value);
  const prefs = value.app || {};
  app.setLoginItemSettings({ openAtLogin: prefs.autostart === true, path: app.getPath('exe') });
  setTrayEnabled(prefs.tray === true);
  autoUpdater.allowPrerelease = false;
  return true;
});
ipcMain.handle('settings:export', async (_, backup) => {
  const pick = await dialog.showSaveDialog(win, {
    title: 'Экспорт настроек ZenTrap', defaultPath: path.join(app.getPath('documents'), 'ZenTrap Settings.json'),
    filters: [{ name: 'Файл настроек ZenTrap', extensions: ['json'] }]
  });
  if (pick.canceled || !pick.filePath) return { ok: false, cancelled: true };
  try {
    const json = JSON.stringify(backup, null, 2);
    if (Buffer.byteLength(json, 'utf8') > 2 * 1024 * 1024) throw new Error('Файл настроек слишком большой.');
    fs.writeFileSync(pick.filePath, json, 'utf8');
    return { ok: true, filePath: pick.filePath };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
});
ipcMain.handle('settings:import', async () => {
  const pick = await dialog.showOpenDialog(win, {
    title: 'Импорт настроек ZenTrap', properties: ['openFile'],
    filters: [{ name: 'Файл настроек ZenTrap', extensions: ['json'] }]
  });
  if (pick.canceled || !pick.filePaths[0]) return { ok: false, cancelled: true };
  try {
    const file = pick.filePaths[0];
    if (fs.statSync(file).size > 2 * 1024 * 1024) throw new Error('Файл настроек слишком большой.');
    const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!backup || backup.schema !== 1 || backup.product !== 'ZenTrap' || !backup.settings || typeof backup.settings !== 'object' || Array.isArray(backup.settings)) {
      throw new Error('Это не файл настроек ZenTrap или его версия не поддерживается.');
    }
    return { ok: true, backup };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
});
ipcMain.handle('settings:reset', async () => {
  if (await isRobloxRunning()) return { ok: false, error: 'Закрой Roblox перед сбросом настроек.' };
  const confirm = await dialog.showMessageBox(win, {
    type: 'warning', buttons: ['Сбросить ZenTrap', 'Отмена'], defaultId: 1, cancelId: 1,
    title: 'Сброс настроек', message: 'Вернуть настройки ZenTrap к исходным?',
    detail: 'Настройки Roblox, изменённые ZenTrap, будут восстановлены из резервных копий. Игра и её файлы останутся.'
  });
  if (confirm.response !== 0) return { ok: false, cancelled: true };
  const restored = await applyPerf({ manageFlags: false }, { dataDir: paths.dataDir(), robloxDir: paths.installRoot() });
  if (!restored.ok) return { ok: false, error: restored.error || 'Не удалось восстановить настройки Roblox.' };
  try { await restoreAllWindowsSettings(paths.dataDir()); }
  catch (e) { return { ok: false, error: `Не удалось восстановить настройки Windows: ${e.message || e}` }; }
  store.replace({});
  app.setLoginItemSettings({ openAtLogin: false, path: app.getPath('exe') });
  setTrayEnabled(false);
  autoUpdater.allowPrerelease = false;
  return { ok: true };
});
ipcMain.handle('settings:apply', (_, s) => applyPerf(s, { dataDir: paths.dataDir(), robloxDir: paths.installRoot() }));
ipcMain.handle('roblox:status', () => {
  const root = paths.installRoot();
  const versionDir = paths.managedVersionDir(root);
  return { installed: Boolean(versionDir), root, version: versionDir ? path.basename(versionDir) : null };
});
ipcMain.handle('system:stats', () => getSystemStats());
ipcMain.handle('background:list', async () => {
  try { return { ok: true, apps: await listBackgroundApps() }; }
  catch { return { ok: false, error: 'Не удалось получить список открытых приложений.' }; }
});
ipcMain.handle('background:close', async (_, selected) => {
  try { return await closeBackgroundApps(selected); }
  catch { return { ok: false, error: 'Не удалось отправить запрос на закрытие приложений.' }; }
});
ipcMain.handle('roblox:cacheStatus', () => {
  const root = paths.installRoot();
  const bytes = robloxCachePaths(root).reduce((sum, dir) => sum + directorySize(dir), 0);
  return { bytes };
});
ipcMain.handle('roblox:clearCache', async () => withRobloxLock(async () => {
  if (await isRobloxRunning()) return { ok: false, error: 'Закрой Roblox перед очисткой временных файлов.' };
  const root = paths.installRoot();
  const dirs = robloxCachePaths(root);
  const bytes = dirs.reduce((sum, dir) => sum + directorySize(dir), 0);
  const confirm = await dialog.showMessageBox(win, {
    type: 'question', buttons: ['Очистить', 'Отмена'], defaultId: 1, cancelId: 1,
    title: 'Очистка ZenTrap', message: 'Удалить временные файлы загрузки ZenTrap?',
    detail: `Будут удалены только загрузки и незавершённые распаковки ZenTrap (${(bytes / 1024 / 1024).toFixed(1)} МБ). Кэш и файлы других установок Roblox не затрагиваются.`
  });
  if (confirm.response !== 0) return { ok: false, cancelled: true };
  try {
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
    removeEmptyDirectory(path.join(root, 'Downloads'));
    return { ok: true, bytes };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}));

ipcMain.handle('roblox:repair', async () => withRobloxLock(async () => {
  const root = paths.installRoot();
  if (!paths.readManagedInstall(root)) return { ok: false, error: 'Roblox, установленный через ZenTrap, пока не найден.' };
  if (await isRobloxRunning()) return { ok: false, error: 'Закрой Roblox перед восстановлением файлов.' };
  const confirm = await dialog.showMessageBox(win, {
    type: 'warning', buttons: ['Восстановить Roblox', 'Отмена'], defaultId: 1, cancelId: 1,
    title: 'Восстановление Roblox', message: 'Скачать и заново распаковать текущую версию Roblox?',
    detail: 'ZenTrap переустановит только свою копию в выбранной папке. Профили и настройки лаунчера останутся.'
  });
  if (confirm.response !== 0) return { ok: false, cancelled: true };
  try {
    const installed = await installRoblox(root, { force: true, onProgress: (p) => win?.webContents.send('roblox:progress', p) });
    return { ok: true, version: installed.version };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}));

ipcMain.handle('roblox:uninstall', async () => withRobloxLock(async () => {
  const root = paths.installRoot();
  if (!app.isPackaged) return { ok: false, error: 'Удаление приложения доступно в установленной сборке ZenTrap.' };
  const owned = paths.readManagedInstall(root);
  if (await isRobloxRunning()) return { ok: false, error: 'Закрой Roblox перед удалением ZenTrap.' };
  const uninstaller = path.join(path.dirname(process.execPath), `Uninstall ${app.getName()}.exe`);
  if (app.isPackaged && !fs.existsSync(uninstaller)) return { ok: false, error: 'Файл удаления ZenTrap не найден. Файлы игры не удалены.' };
  const confirm = await dialog.showMessageBox(win, {
    type: 'warning', buttons: ['Удалить ZenTrap и Roblox', 'Отмена'], defaultId: 1, cancelId: 1,
    title: 'Удаление ZenTrap', message: 'Удалить ZenTrap вместе с Roblox?',
    detail: owned
      ? `Будут удалены только файлы ZenTrap и его Roblox из этой папки:\n${root}\nДругие установки Roblox не затрагиваются.`
      : `Собственная копия Roblox не найдена. Будет удалён только ZenTrap из:\n${root}\nФайлы других установок Roblox не затрагиваются.`
  });
  if (confirm.response !== 0) return { ok: false, cancelled: true };
  try {
    await restoreAllWindowsSettings(paths.dataDir());
    if (owned) {
      const versionsRoot = path.join(root, 'Versions');
      for (const version of owned.managedVersions) {
        fs.rmSync(path.join(versionsRoot, version), { recursive: true, force: true });
      }
      removeEmptyDirectory(versionsRoot);
    }
    fs.rmSync(path.join(root, 'Downloads', 'ZenTrap'), { recursive: true, force: true });
    removeEmptyDirectory(path.join(root, 'Downloads'));
    fs.rmSync(path.join(root, 'ZenTrap.Install.json'), { force: true });
    fs.rmSync(paths.dataDir(), { recursive: true, force: true });
    const basic = paths.basicSettingsPath();
    restoreFramerateCap(basic);
    const quotePs = (value) => `'${String(value).replace(/'/g, "''")}'`;
    const helperScript = `$launcherPid=${process.pid}; $uninstaller=${quotePs(uninstaller)}; while (Get-Process -Id $launcherPid -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 300 }; if (Test-Path -LiteralPath $uninstaller) { Start-Process -FilePath $uninstaller -ArgumentList '/S' -WorkingDirectory (Split-Path -Parent $uninstaller) }`;
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', helperScript], { detached: true, stdio: 'ignore', windowsHide: true });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
    app.quit();
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}));

app.whenReady().then(() => {
  const prefs = store.get('app', {});
  app.setLoginItemSettings({ openAtLogin: prefs.autostart === true, path: app.getPath('exe') });
  setTrayEnabled(prefs.tray === true);
  lastCpuSample = readCpuTimes();
  createWindow();
  setTimeout(startAppUpdateCheck, 1500);
});
app.on('before-quit', () => { isQuitting = true; if (tray) tray.destroy(); tray = null; });
app.on('window-all-closed', () => { if (!tray) app.quit(); });

function readCpuTimes() {
  try {
    const cpus = os.cpus();
    return cpus.reduce((sum, cpu) => {
      const values = Object.values(cpu.times);
      sum.total += values.reduce((a, b) => a + b, 0);
      sum.idle += cpu.times.idle;
      return sum;
    }, { total: 0, idle: 0 });
  } catch { return null; }
}

async function readGpuLoad() {
  if (process.platform !== 'win32') return null;
  if (Date.now() - gpuSampleAt < 2500) return gpuSampleValue;
  if (gpuSamplePending) return gpuSamplePending;
  const script = "$ErrorActionPreference='Stop';$x=@(Get-CimInstance -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction Stop|Where-Object{$_.Name -match 'engtype_3D'});if(!$x.Count){[Console]::Write('NA')}else{[Console]::Write(($x|Measure-Object -Property UtilizationPercentage -Maximum).Maximum)}";
  gpuSamplePending = execFileAsync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 4000, encoding: 'utf8' })
    .then(({ stdout }) => {
      const value = Number(stdout.trim());
      gpuSampleValue = Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : null;
      gpuSampleAt = Date.now();
      return gpuSampleValue;
    })
    .catch(() => { gpuSampleValue = null; gpuSampleAt = Date.now(); return null; })
    .finally(() => { gpuSamplePending = null; });
  return gpuSamplePending;
}

async function getSystemStats() {
  const currentCpu = readCpuTimes();
  let cpu = null;
  if (lastCpuSample && currentCpu && currentCpu.total > lastCpuSample.total) {
    cpu = Math.max(0, Math.min(100, (1 - (currentCpu.idle - lastCpuSample.idle) / (currentCpu.total - lastCpuSample.total)) * 100));
  }
  lastCpuSample = currentCpu;
  const totalMemory = os.totalmem();
  const usedMemory = Math.max(0, totalMemory - os.freemem());
  return {
    gpu: await readGpuLoad(),
    cpu: cpu === null ? null : Math.round(cpu),
    ram: totalMemory ? Math.round(usedMemory / totalMemory * 100) : null,
    ramUsedGb: +(usedMemory / 1024 ** 3).toFixed(1),
    ramTotalGb: +(totalMemory / 1024 ** 3).toFixed(1),
    cpuModel: os.cpus()[0]?.model || 'Процессор не определён',
    system: `${os.version()} · ${os.arch()}`
  };
}

async function runPowerShell(script) {
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script
  ], { windowsHide: true, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' });
  return stdout.trim();
}

async function listBackgroundApps() {
  if (process.platform !== 'win32') return [];
  const skip = [
    'explorer','ZenTrap','RobloxPlayerBeta','RobloxPlayerLauncher','RobloxStudioBeta','dwm','csrss','winlogon',
    'services','lsass','svchost','fontdrvhost','taskhostw','sihost','conhost','SearchHost','SearchApp',
    'ShellExperienceHost','StartMenuExperienceHost','TextInputHost','ApplicationFrameHost','RuntimeBroker','LockApp'
  ];
  const skipLiteral = skip.map((name) => `'${name}'`).join(',');
  const script = `$ErrorActionPreference='Stop';[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);$skip=@(${skipLiteral});$apps=@(Get-Process -ErrorAction SilentlyContinue|Where-Object{$_.MainWindowHandle -ne 0 -and $_.ProcessName -notin $skip}|ForEach-Object{try{$started=$_.StartTime.ToUniversalTime().Ticks}catch{$started=0};[pscustomobject]@{pid=$_.Id;name=$_.ProcessName;title=$_.MainWindowTitle;started=[string]$started}});[Console]::Write((ConvertTo-Json -InputObject $apps -Compress))`;
  const output = await runPowerShell(script);
  let parsed = [];
  try { parsed = output ? JSON.parse(output) : []; } catch { throw new Error('bad process list'); }
  if (!Array.isArray(parsed)) parsed = [parsed];
  backgroundAppSnapshot = new Map();
  const result = [];
  for (const appInfo of parsed) {
    const pid = Number(appInfo.pid), name = String(appInfo.name || '').slice(0, 80);
    if (!Number.isSafeInteger(pid) || pid <= 0 || !name) continue;
    const started = String(appInfo.started || '0');
    if (!/^\d+$/.test(started) || started === '0') continue;
    const entry = { pid, name, title: String(appInfo.title || '').slice(0, 180), started };
    backgroundAppSnapshot.set(pid, entry);
    result.push(entry);
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

async function closeBackgroundApps(selected) {
  if (process.platform !== 'win32') return { ok: false, error: 'Закрытие приложений доступно только в Windows.' };
  if (!Array.isArray(selected)) return { ok: false, error: 'Некорректный список приложений.' };
  const entries = [...new Set(selected.map(Number))]
    .map((pid) => backgroundAppSnapshot.get(pid))
    .filter((entry) => entry && /^\d+$/.test(entry.started) && entry.started !== '0');
  if (!entries.length) return { ok: true, requested: 0 };
  for (const entry of entries) backgroundAppSnapshot.delete(entry.pid);
  const checks = entries.map(({ pid, started }) => `try{$p=Get-Process -Id ${pid} -ErrorAction Stop;if($p.MainWindowHandle -ne 0 -and $p.StartTime.ToUniversalTime().Ticks -eq [long]'${started}'){$sent=[bool]$p.CloseMainWindow();$out+=@([pscustomobject]@{pid=${pid};sent=$sent})}}catch{}`).join(';');
  const script = `$ErrorActionPreference='SilentlyContinue';[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);$out=@();${checks};[Console]::Write((ConvertTo-Json -InputObject $out -Compress))`;
  const output = await runPowerShell(script);
  let results = [];
  try { results = output ? JSON.parse(output) : []; } catch { throw new Error('bad close response'); }
  if (!Array.isArray(results)) results = [results];
  return { ok: true, requested: results.filter((entry) => entry && entry.sent === true).length };
}
