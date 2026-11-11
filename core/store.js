// Простое JSON-хранилище настроек ZenTrap (Settings.json). Запись атомарная, битый файл не теряется.
const fs = require('fs'), path = require('path');
const KEY = /^[A-Za-z0-9_.-]{1,64}$/;
const STORE_KEYS = new Set(['perf', 'profiles', 'app']);

function createStore(dir, file = 'Settings.json') {
  const p = path.join(dir, file);
  let data = {};
  function load() {
    try {
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('bad format');
      data = j;
    } catch (e) {
      if (e.code !== 'ENOENT') { try { fs.copyFileSync(p, p + '.corrupt'); } catch {} }
      data = {};
    }
  }
  function save() {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, p);
  }
  load();
  return {
    path: p,
    all: () => JSON.parse(JSON.stringify(data)),
    get: (k, d) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : d),
    set(k, v) {
      if (!KEY.test(k) || k === '__proto__') throw new Error('bad key');
      data[k] = v; save();
    },
    replace(next) {
      if (!next || typeof next !== 'object' || Array.isArray(next)) throw new Error('bad settings');
      const clean = {};
      for (const [k, v] of Object.entries(next)) {
        if (!STORE_KEYS.has(k)) throw new Error('unknown settings key');
        clean[k] = v;
      }
      data = clean;
      save();
    }
  };
}
module.exports = { createStore };
