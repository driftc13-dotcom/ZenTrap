// Применение разрешённых локальных настроек к копии Roblox, которой управляет ZenTrap.
const fs = require('fs'), path = require('path'), { execFile } = require('child_process');
const paths = require('./paths'), flags = require('./flags'), rs = require('./robloxSettings');
const { applyWindowsSettings } = require('./windowsSettings');

function isRobloxRunning() {
  return new Promise((res) => {
    if (process.platform !== 'win32') return res(false);
    execFile('tasklist', ['/FI', 'IMAGENAME eq RobloxPlayerBeta.exe', '/NH'], { windowsHide: true }, (e, out) => res(!e && /RobloxPlayerBeta\.exe/i.test(out)));
  });
}

function managedVersionDir(opts) {
  if (opts.versionDir) return opts.versionDir;
  const roots = paths.defaultRoots(undefined, [opts.robloxDir]);
  for (const root of roots) {
    const dir = paths.managedVersionDir(root);
    if (dir) return dir;
  }
  return null;
}

// opts: dataDir, robloxDir, versionDir, basicSettingsFile, isRunning (для тестов)
async function applyPerf(settings, opts = {}) {
  const rep = { ok: true, flags: { written: [], dropped: [] }, files: {}, notes: [], allowlist: null };
  try {
    const safeSettings = !settings || settings.manageFlags === false
      ? { ...(settings || {}), manageFlags: false, priority: false, gpuPref: false, fsOpt: false, closeBg: false }
      : settings;
    const allow = flags.loadAllowlist();
    rep.allowlist = allow.checked;
    const { kept, dropped } = flags.filterAllowed(flags.buildFlags(safeSettings), allow.flags);
    rep.flags.written = Object.keys(kept); rep.flags.dropped = dropped;

    const vdir = managedVersionDir(opts);
    if (!vdir) rep.notes.push('Установка Roblox, которой управляет ZenTrap, не найдена: оптимизации не применены.');
    else {
      rep.notes.push(...await applyWindowsSettings(safeSettings, { dataDir: opts.dataDir || paths.dataDir(), versionDir: vdir, root: opts.robloxDir || paths.installRoot() }));
      const dir = path.join(vdir, 'ClientSettings'), file = path.join(dir, 'ClientAppSettings.json');
      const backup = file + '.zentrap.bak', created = file + '.zentrap.created';
      fs.mkdirSync(dir, { recursive: true });
      if (safeSettings.manageFlags === false) {
        if (fs.existsSync(backup)) {
          fs.copyFileSync(backup, file);
          fs.rmSync(backup, { force: true });
          fs.rmSync(created, { force: true });
          rep.files.clientSettings = 'restored';
        } else if (fs.existsSync(created)) {
          fs.rmSync(file, { force: true });
          fs.rmSync(created, { force: true });
          rep.files.clientSettings = 'removed';
        }
      } else {
        if (fs.existsSync(file) && !fs.existsSync(backup) && !fs.existsSync(created)) fs.copyFileSync(file, backup);
        if (!fs.existsSync(file) && !fs.existsSync(backup) && !fs.existsSync(created)) fs.writeFileSync(created, '');
        fs.writeFileSync(file, flags.serialize(kept));
        rep.files.clientSettings = file;
      }
    }

    const cap = flags.fpsCapValue(safeSettings);
    if (safeSettings.manageFlags === false && vdir) {
      const basic = opts.basicSettingsFile || paths.basicSettingsPath();
      const restored = rs.restoreFramerateCap(basic);
      if (restored.status === 'restored') rep.files.basicSettings = 'restored';
    } else if (cap !== null && vdir) {
      const running = opts.isRunning ? await opts.isRunning() : await isRobloxRunning();
      if (running) rep.notes.push('Roblox запущен: лимит FPS применится после его закрытия и повторного сохранения.');
      else {
        const r = rs.applyFramerateCap(opts.basicSettingsFile || paths.basicSettingsPath(), cap);
        rep.files.basicSettings = r.status;
        if (r.status === 'missing') rep.notes.push('Файл настроек Roblox появится после первого запуска игры.');
      }
    }

  } catch (e) { rep.ok = false; rep.error = String(e.message || e); }
  return rep;
}
module.exports = { applyPerf, isRobloxRunning, managedVersionDir };
