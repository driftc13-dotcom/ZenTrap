// Настройки ZenTrap -> Fast Flags Roblox. Пишем ТОЛЬКО флаги из allowlist, значения проверяются.
const fs = require('fs'), path = require('path');

const clampInt = (v, a, b, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : d; };
const oneOf = (v, list, d) => (list.includes(String(v)) ? String(v) : d);

// Единственное место, где настройка превращается в флаги.
function buildFlags(s) {
  const f = {};
  if (!s || s.manageFlags === false) return f;
  const frm = clampInt(s.frm, 0, 21, 0);
  if (frm > 0) f.DFIntDebugFRMQualityLevelOverride = frm;
  const msaa = oneOf(s.msaa, ['auto', '1', '2', '4'], 'auto');
  if (msaa !== 'auto') f.FIntDebugForceMSAASamples = Number(msaa);
  const tex = oneOf(s.textures, ['auto', '1', '2', '3'], 'auto');
  if (tex !== 'auto') { f.DFFlagTextureQualityOverrideEnabled = true; f.DFIntTextureQualityOverride = Number(tex); }
  if (s.dpi === true) f.DFFlagDisableDPIScale = true;
  if (oneOf(s.render, ['auto', 'd3d11'], 'auto') === 'd3d11') f.FFlagDebugGraphicsPreferD3D11 = true;
  // Allowlisted, but this override may be ignored on some Roblox client builds.
  if (oneOf(s.grass, ['auto', 'off'], 'auto') === 'off') { f.FIntFRMMaxGrassDistance = 0; f.FIntFRMMinGrassDistance = 0; }
  return f;
}

// Roblox stores this user setting outside ZenTrap's managed install directory.
function fpsCapValue(s) {
  if (!s || s.manageFlags === false) return null;
  return clampInt(s.fpsCap, 30, 240, 60);
}

// Only use the bundled Roblox-published list; a user data file cannot add local client flags.
function loadAllowlist() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'allowlist.json'), 'utf8'));
}

function filterAllowed(flags, allowed) {
  const ok = new Set(allowed), kept = {}, dropped = [];
  for (const [k, v] of Object.entries(flags)) (ok.has(k) ? (kept[k] = v) : dropped.push(k));
  return { kept, dropped };
}

// Roblox ждёт значения строками, как пишет Bloxstrap: "True"/"False"/"123"
const toRobloxValue = (v) => (typeof v === 'boolean' ? (v ? 'True' : 'False') : String(v));
const serialize = (flags) => JSON.stringify(Object.fromEntries(Object.entries(flags).map(([k, v]) => [k, toRobloxValue(v)])), null, 2);

module.exports = { buildFlags, fpsCapValue, loadAllowlist, filterAllowed, serialize };
