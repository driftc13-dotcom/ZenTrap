// Правка GlobalBasicSettings_13.xml (общие настройки пользователя Roblox). Меняем только лимит FPS.
const fs = require('fs');

function setFramerateCap(xml, value) {
  const re = /(<int name="FramerateCap">)(-?\d+)(<\/int>)/;
  if (re.test(xml)) return xml.replace(re, `$1${value}$3`);
  const m = xml.match(/<Item class="UserGameSettings"[^>]*>\s*<Properties>/);
  if (!m) throw new Error('UserGameSettings не найден');
  return xml.replace(m[0], `${m[0]}\n\t\t\t<int name="FramerateCap">${value}</int>`);
}
const readFramerateCap = (xml) => { const m = xml.match(/<int name="FramerateCap">(-?\d+)<\/int>/); return m ? Number(m[1]) : null; };

function applyFramerateCap(file, value) {
  if (!fs.existsSync(file)) return { status: 'missing' };
  const xml = fs.readFileSync(file, 'utf8');
  const next = setFramerateCap(xml, value);
  if (next === xml) return { status: 'unchanged' };
  if (!fs.existsSync(file + '.zentrap.bak')) fs.copyFileSync(file, file + '.zentrap.bak');
  fs.writeFileSync(file, next);
  return { status: 'written' };
}

// Restore only the shared FPS-cap field, preserving other settings Roblox or the user changed later.
function restoreFramerateCap(file) {
  const backup = file + '.zentrap.bak';
  if (!fs.existsSync(backup)) return { status: 'no-backup' };
  if (!fs.existsSync(file)) return { status: 'missing' };
  const original = fs.readFileSync(backup, 'utf8');
  let current = fs.readFileSync(file, 'utf8');
  const originalCap = readFramerateCap(original);
  if (originalCap === null) current = current.replace(/\s*<int name="FramerateCap">-?\d+<\/int>/, '');
  else current = setFramerateCap(current, originalCap);
  if (current !== fs.readFileSync(file, 'utf8')) fs.writeFileSync(file, current);
  fs.rmSync(backup, { force: true });
  return { status: 'restored' };
}
module.exports = { setFramerateCap, readFramerateCap, applyFramerateCap, restoreFramerateCap };
