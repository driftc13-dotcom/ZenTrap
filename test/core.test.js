const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const flags = require('../core/flags'), rs = require('../core/robloxSettings'), { createStore } = require('../core/store');
const { applyPerf } = require('../core/apply'), paths = require('../core/paths');
const { installRoblox } = require('../core/robloxInstaller');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'zt-'));
const base = { manageFlags: true, fpsCap: 144, frm: 8, msaa: '2', textures: '2', dpi: true, render: 'd3d11', altEnter: false, grass: 'off' };
const SAMPLE = '<roblox><Item class="UserGameSettings" referent="RBX1">\n\t\t<Properties>\n\t\t\t<bool name="Fullscreen">false</bool>\n\t\t\t<int name="FramerateCap">-1</int>\n\t\t</Properties></Item></roblox>';

test('все флаги из buildFlags входят в allowlist', () => {
  const all = flags.buildFlags({ ...base, altEnter: true, frm: 21, textures: '3', msaa: '4' });
  const allow = flags.loadAllowlist(tmp()).flags;
  for (const k of Object.keys(all)) assert.ok(allow.includes(k), k + ' не в allowlist');
});
test('значения проверяются и ограничиваются', () => {
  const f = flags.buildFlags({ manageFlags: true, frm: 999, msaa: 'evil', textures: '9', grass: 'x', render: 'vulkan' });
  assert.deepEqual(f, { DFIntDebugFRMQualityLevelOverride: 21 });
});
test('manageFlags=false даёт пустой набор и не трогает FPS', () => {
  assert.deepEqual(flags.buildFlags({ ...base, manageFlags: false }), {});
  assert.equal(flags.fpsCapValue({ ...base, manageFlags: false }), null);
});
test('filterAllowed отбрасывает чужие флаги', () => {
  const r = flags.filterAllowed({ FIntDebugForceMSAASamples: 2, FFlagDisablePostFx: true, DFIntTaskSchedulerTargetFps: 999 }, flags.loadAllowlist(tmp()).flags);
  assert.deepEqual(Object.keys(r.kept), ['FIntDebugForceMSAASamples']);
  assert.deepEqual(r.dropped.sort(), ['DFIntTaskSchedulerTargetFps', 'FFlagDisablePostFx']);
});
test('serialize пишет строки как Bloxstrap', () => {
  assert.deepEqual(JSON.parse(flags.serialize({ A: true, B: false, C: 4 })), { A: 'True', B: 'False', C: '4' });
});
test('лимит FPS ограничивается поддерживаемым диапазоном 30–240', () => {
  assert.equal(flags.fpsCapValue({ manageFlags: true, fpsCap: 360 }), 240);
  assert.equal(flags.fpsCapValue({ manageFlags: true, fpsCap: 144 }), 144);
});
test('XML: замена и вставка FramerateCap', () => {
  assert.equal(rs.readFramerateCap(rs.setFramerateCap(SAMPLE, 144)), 144);
  const no = SAMPLE.replace(/\s*<int name="FramerateCap">-1<\/int>/, '');
  assert.equal(rs.readFramerateCap(rs.setFramerateCap(no, 120)), 120);
  assert.ok(rs.setFramerateCap(SAMPLE, 60).includes('<bool name="Fullscreen">false</bool>'));
  assert.throws(() => rs.setFramerateCap('<roblox/>', 60));
});
test('XML: восстановление FPS не затирает другие изменения пользователя', () => {
  const file = path.join(tmp(), 'GlobalBasicSettings_13.xml'); fs.writeFileSync(file, SAMPLE);
  rs.applyFramerateCap(file, 144);
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('<bool name="Fullscreen">false</bool>', '<bool name="Fullscreen">true</bool>'));
  assert.equal(rs.restoreFramerateCap(file).status, 'restored');
  const restored = fs.readFileSync(file, 'utf8');
  assert.equal(rs.readFramerateCap(restored), -1);
  assert.ok(restored.includes('<bool name="Fullscreen">true</bool>'));
  assert.ok(!fs.existsSync(file + '.zentrap.bak'));
});
test('store: запись, чтение, битый файл, плохой ключ', () => {
  const d = tmp(), s = createStore(d); s.set('perf', { a: 1 });
  assert.deepEqual(createStore(d).get('perf'), { a: 1 });
  fs.writeFileSync(path.join(d, 'Settings.json'), '{oops');
  const s2 = createStore(d); assert.deepEqual(s2.all(), {}); assert.ok(fs.existsSync(path.join(d, 'Settings.json.corrupt')));
  assert.throws(() => s2.set('__proto__', 1)); assert.throws(() => s2.set('a/b', 1));
});
test('apply: полный проход с временными папками', async () => {
  const root = tmp(), ver = path.join(root, 'Versions', 'version-abc'); fs.mkdirSync(ver, { recursive: true });
  fs.writeFileSync(path.join(ver, 'RobloxPlayerBeta.exe'), '');
  fs.writeFileSync(path.join(root, 'ZenTrap.Install.json'), JSON.stringify({ schema: 1, owner: 'ZenTrap', clientVersion: 'version-abc', managedVersions: ['version-abc'] }));
  const basic = path.join(root, 'GlobalBasicSettings_13.xml'); fs.writeFileSync(basic, SAMPLE);
  const r = await applyPerf(base, { dataDir: root, robloxDir: root, basicSettingsFile: basic, isRunning: async () => false });
  assert.ok(r.ok, r.error); assert.equal(r.files.basicSettings, 'written');
  const j = JSON.parse(fs.readFileSync(path.join(ver, 'ClientSettings', 'ClientAppSettings.json'), 'utf8'));
  assert.equal(j.FIntDebugForceMSAASamples, '2'); assert.equal(j.DFFlagDisableDPIScale, 'True'); assert.equal(rs.readFramerateCap(fs.readFileSync(basic, 'utf8')), 144);
  assert.ok(fs.existsSync(basic + '.zentrap.bak'));
});
test('apply: Roblox запущен — XML не трогаем; Roblox не найден — без ошибки', async () => {
  const root = tmp(), ver = path.join(root, 'Versions', 'version-abc'); fs.mkdirSync(ver, { recursive: true });
  fs.writeFileSync(path.join(ver, 'RobloxPlayerBeta.exe'), '');
  fs.writeFileSync(path.join(root, 'ZenTrap.Install.json'), JSON.stringify({ schema: 1, owner: 'ZenTrap', clientVersion: 'version-abc', managedVersions: ['version-abc'] }));
  const basic = path.join(root, 'b.xml'); fs.writeFileSync(basic, SAMPLE);
  const r = await applyPerf(base, { dataDir: root, robloxDir: root, basicSettingsFile: basic, isRunning: async () => true });
  assert.ok(r.ok); assert.equal(fs.readFileSync(basic, 'utf8'), SAMPLE); assert.ok(r.notes.some((note) => note.includes('Roblox запущен')));
});
test('latestVersionDir выбирает самую свежую версию', () => {
  const root = tmp();
  for (const [n, t] of [['version-old', 1000], ['version-new', 2000]]) { const d = path.join(root, 'Versions', n); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'RobloxPlayerBeta.exe'), ''); fs.utimesSync(d, t, t); }
  assert.ok(paths.latestVersionDir([root]).endsWith('version-new'));
});
test('installRoblox reuses the current client without redownloading packages', async (t) => {
  if (process.platform !== 'win32') return t.skip('Windows-only Roblox installer behavior');
  const root = tmp(), version = 'version-test123', versionDir = path.join(root, 'Versions', version);
  fs.mkdirSync(versionDir, { recursive: true });
  fs.writeFileSync(path.join(versionDir, 'RobloxPlayerBeta.exe'), 'client');
  fs.writeFileSync(path.join(root, 'ZenTrap.Install.json'), JSON.stringify({ schema: 1, owner: 'ZenTrap', clientVersion: version, managedVersions: [version] }));
  const originalFetch = global.fetch, urls = [];
  global.fetch = async (url) => {
    urls.push(String(url));
    return { ok: true, json: async () => ({ clientVersionUpload: version }) };
  };
  try {
    const offlinePreference = await installRoblox(root, { checkForUpdates: false });
    assert.equal(offlinePreference.updateSkipped, true);
    assert.deepEqual(urls, []);
    const current = await installRoblox(root, { checkForUpdates: true });
    assert.equal(current.installed, false);
    assert.equal(current.versionDir, versionDir);
    assert.deepEqual(urls, ['https://clientsettingscdn.roblox.com/v2/client-version/WindowsPlayer']);
    assert.ok(fs.existsSync(path.join(versionDir, 'AppSettings.xml')));
  } finally { global.fetch = originalFetch; }
});
