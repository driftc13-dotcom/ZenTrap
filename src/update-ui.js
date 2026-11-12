/* ZenTrap: интерфейс обновлений (GitHub Releases). Подключение: <script src="update-ui.js"></script> перед </body>.
   Самодостаточный файл: сам добавляет стили и разметку, цвета берёт из тем приложения (--acc, --pri, --s1.. и т.д.).

   API для логики:
     ZenUI.update.setCurrent('1.0.3')
     ZenUI.update.setState(state, data)
       state: 'idle' | 'checking' | 'available' | 'downloading' | 'verifying' | 'installing' | 'restarting' | 'uptodate' | 'error'
       data:  { cur, ver, notes (markdown из GitHub), size (байты), date (ISO), channel,
                percent (0-100), loaded, total (байты), speed (байт/с), eta (сек), error, autoOpen }
     ZenUI.update.open() / close() / demo()
   События (window): 'zen:update' { action: 'check'|'install'|'later'|'skip'|'cancel'|'retry'|'log', version }
   Если есть window.api.onUpdate(cb) / window.api.updateAction(action, version), они подключаются автоматически. */
(function () {
  var ZU = window.ZenUI = window.ZenUI || {};
  var D = { cur: '', ver: '', notes: '', size: 0, date: '', channel: 'Стабильная', percent: 0, loaded: 0, total: 0, speed: 0, eta: 0, error: '', autoOpen: false };
  var S = 'idle', dismissed = false, asked = false, demoMode = false, timers = [];

  var CSS = `
.upd-back{position:fixed;inset:0;z-index:200;display:grid;place-items:center;background:color-mix(in srgb,var(--bg,#0d0d10) 72%,transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);opacity:0;visibility:hidden;transition:opacity .28s,visibility .28s}
.upd-back.show{opacity:1;visibility:visible}
.upd{position:relative;width:min(540px,calc(100vw - 40px));padding:26px;border-radius:24px;overflow:hidden;background:linear-gradient(160deg,var(--s2,#141418),var(--s0,#0f0f12));border:1px solid color-mix(in srgb,var(--acc,#47393d) 45%,var(--line,#26262c));box-shadow:0 30px 80px #000c,0 0 70px color-mix(in srgb,var(--acc,#47393d) 24%,transparent);transform:translateY(22px) scale(.95);transition:transform .5s cubic-bezier(.2,.9,.3,1.15)}
.upd-back.show .upd{transform:none}
.upd::before{content:"";position:absolute;left:-20%;right:-20%;top:-60%;height:80%;background:radial-gradient(closest-side,color-mix(in srgb,var(--acc,#47393d) 38%,transparent),transparent);pointer-events:none}
.upd>*{position:relative}
.upd-h{display:flex;align-items:center;gap:16px}.upd-h img.ulogo{flex:none;filter:drop-shadow(0 0 10px color-mix(in srgb,var(--acc,#47393d) 50%,transparent))}
.upd-ht{min-width:0;flex:1}.upd-ht h2{margin:0;font-size:22px;font-weight:800;letter-spacing:-.3px}
.upd-ver{display:flex;align-items:center;gap:8px;margin-top:5px;font-size:14px;color:var(--mut,#9a9aa5)}.upd-ver b{color:#fff;font-weight:700;background:color-mix(in srgb,var(--acc,#47393d) 55%,transparent);padding:2px 10px;border-radius:20px}.upd-ver svg{width:15px;height:15px}
.upd-x{all:unset;cursor:pointer;width:34px;height:34px;border-radius:11px;display:grid;place-items:center;color:var(--mut,#9a9aa5);transition:background .2s,color .2s}.upd-x:hover{background:var(--s4,#1c1c22);color:#fff}.upd-x svg{width:18px;height:18px}
.upd .v{display:none;margin-top:20px}.upd[data-view=available] .v-available,.upd[data-view=progress] .v-progress,.upd[data-view=ok] .v-ok,.upd[data-view=error] .v-error,.upd[data-view=checking] .v-checking{display:block;animation:uIn .45s cubic-bezier(.2,.8,.2,1) backwards}
@keyframes uIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
.upd-meta{display:flex;flex-wrap:wrap;gap:8px}.upd-meta span{font-size:12.5px;color:#cfcfd6;background:var(--s3,#18181d);border:1px solid var(--line,#26262c);border-radius:10px;padding:5px 10px}
.upd-notes{max-height:214px;overflow:auto;margin:16px 0 20px;padding:14px 16px;border-radius:16px;background:var(--s1,#101013);border:1px solid var(--line,#26262c);scrollbar-width:none}.upd-notes::-webkit-scrollbar{display:none}
.upd-notes h4{margin:12px 0 6px;font-size:13.5px;font-weight:700}.upd-notes h4:first-child{margin-top:0}.upd-notes p{margin:6px 0;color:#cfcfd6;font-size:13.5px;line-height:1.5}
.upd-notes ul{list-style:none;margin:0;padding:0}.upd-notes li{position:relative;padding:3px 0 3px 18px;font-size:13.5px;line-height:1.5;color:#dcdce2}.upd-notes li::before{content:"";position:absolute;left:3px;top:11px;width:6px;height:6px;border-radius:50%;background:var(--pri,#7a7073)}
.upd-notes code{background:var(--s4,#1c1c22);padding:1px 6px;border-radius:6px;font-size:12.5px}
.upd-f{display:flex;align-items:center;gap:10px}
.ubtn{all:unset;box-sizing:border-box;position:relative;overflow:hidden;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:8px;height:46px;padding:0 22px;border-radius:14px;font-size:14.5px;font-weight:600;background:var(--s3,#18181d);border:1px solid var(--line,#26262c);transition:transform .18s,background .18s,box-shadow .18s,border-color .18s}
.ubtn:hover{transform:translateY(-2px);box-shadow:0 8px 22px color-mix(in srgb,var(--acc,#47393d) 28%,transparent);border-color:color-mix(in srgb,var(--acc,#47393d) 60%,transparent)}.ubtn:active{transform:scale(.97);transition-duration:.06s}
.ubtn.pri{flex:1;background:linear-gradient(90deg,var(--pri,#7a7073),var(--acc,#47393d));border-color:transparent;font-weight:700;letter-spacing:.2px}
.ubtn:focus-visible{outline:2px solid var(--pri,#7a7073);outline-offset:2px}
.upd-skip{all:unset;cursor:pointer;margin-left:auto;font-size:13px;color:var(--mut,#9a9aa5);padding:6px 4px;transition:color .2s}.upd-skip:hover{color:#fff}
.upd-pct{display:flex;align-items:baseline;gap:4px}.upd-pct b{font-size:48px;font-weight:800;letter-spacing:-1.5px;line-height:1}.upd-pct span{font-size:20px;color:var(--mut,#9a9aa5)}.upd-pct em{font-style:normal;margin-left:auto;font-size:14px;color:#cfcfd6}
.upd-bar{height:12px;margin:14px 0 10px;border-radius:8px;background:var(--s4,#1c1c22);overflow:hidden}
.upd-bar i{display:block;height:100%;width:var(--p,0%);border-radius:8px;background:linear-gradient(90deg,var(--pri2,#372c30),var(--pri,#7a7073));position:relative;overflow:hidden;transition:width .35s cubic-bezier(.2,.8,.2,1)}
.upd-bar i::after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 30%,rgba(255,255,255,.38) 50%,transparent 70%);transform:translateX(-100%);animation:uShine 1.6s infinite}
.upd-bar.ind i{width:38%;transition:none;animation:uInd 1.2s ease-in-out infinite alternate}
@keyframes uShine{to{transform:translateX(100%)}}@keyframes uInd{from{margin-left:0}to{margin-left:62%}}
.upd-stats{display:flex;justify-content:space-between;gap:10px;font-size:13px;color:var(--mut,#9a9aa5);min-height:18px}
.upd-steps{list-style:none;counter-reset:s;margin:22px 0 22px;padding:0;display:grid;grid-template-columns:repeat(4,1fr)}
.upd-steps li{counter-increment:s;position:relative;display:grid;justify-items:center;gap:8px;font-size:12.5px;color:var(--mut,#9a9aa5);transition:color .3s}
.upd-steps li::before{content:counter(s);width:30px;height:30px;display:grid;place-items:center;border-radius:50%;font-weight:700;font-size:13px;background:var(--s3,#18181d);border:1px solid var(--line,#26262c);transition:all .35s cubic-bezier(.3,1.4,.5,1);position:relative;z-index:1}
.upd-steps li::after{content:"";position:absolute;top:15px;left:calc(50% + 21px);right:calc(-50% + 21px);height:2px;background:var(--line,#26262c);transition:background .4s}.upd-steps li:last-child::after{display:none}
.upd-steps li.done{color:#cfcfd6}.upd-steps li.done::before{content:"✓";background:linear-gradient(135deg,var(--pri,#7a7073),var(--acc,#47393d));border-color:transparent;color:#fff}.upd-steps li.done::after{background:var(--pri,#7a7073)}
.upd-steps li.act{color:#fff}.upd-steps li.act::before{border-color:var(--pri,#7a7073);color:#fff;box-shadow:0 0 0 4px color-mix(in srgb,var(--acc,#47393d) 32%,transparent);animation:uPulse 1.4s ease-in-out infinite}
@keyframes uPulse{50%{box-shadow:0 0 0 8px color-mix(in srgb,var(--acc,#47393d) 8%,transparent)}}
.upd-warn{margin-left:auto;font-size:12.5px;color:var(--mut,#9a9aa5)}
.upd-big{display:grid;justify-items:center;gap:14px;padding:10px 0 4px;text-align:center}.upd-big p{margin:0;color:#cfcfd6;font-size:14.5px;line-height:1.5;max-width:360px}
.upd-ico{width:76px;height:76px;border-radius:50%;display:grid;place-items:center;background:color-mix(in srgb,var(--ok,#22c55e) 16%,transparent);border:2px solid var(--ok,#22c55e);color:var(--ok,#22c55e);animation:uPop .6s cubic-bezier(.3,1.5,.5,1) backwards}
.upd-ico svg{width:36px;height:36px;stroke-dasharray:30;stroke-dashoffset:30;animation:uDraw .5s .25s ease-out forwards}.upd-ico.err{background:#f871711f;border-color:#f87171;color:#f87171}.upd-ico.err svg{stroke-dasharray:none;stroke-dashoffset:0;animation:none}
@keyframes uPop{from{transform:scale(.4);opacity:0}}@keyframes uDraw{to{stroke-dashoffset:0}}
.upd-err{display:block;max-width:100%;margin-top:2px;padding:10px 12px;border-radius:12px;background:var(--s1,#101013);border:1px solid var(--line,#26262c);font-size:12.5px;color:#fca5a5;word-break:break-word;text-align:left}
.upd-spin{width:44px;height:44px;border-radius:50%;border:3px solid var(--s4,#1c1c22);border-top-color:var(--pri,#7a7073);animation:uSpin .8s linear infinite}@keyframes uSpin{to{transform:rotate(360deg)}}
.upd-pill{position:fixed;top:12px;left:50%;z-index:150;display:flex;align-items:center;gap:10px;padding:6px 6px 6px 14px;border-radius:30px;font-size:13px;white-space:nowrap;background:color-mix(in srgb,var(--s3,#18181d) 92%,transparent);backdrop-filter:blur(8px);border:1px solid color-mix(in srgb,var(--acc,#47393d) 55%,transparent);box-shadow:0 10px 34px #000a,0 0 24px color-mix(in srgb,var(--acc,#47393d) 25%,transparent);transform:translate(-50%,-90px);opacity:0;pointer-events:none;transition:transform .55s cubic-bezier(.2,.9,.3,1.2),opacity .3s}
.upd-pill.show{transform:translate(-50%,0);opacity:1;pointer-events:auto}body.full .upd-pill{display:none}
.upd-pill>i{width:8px;height:8px;border-radius:50%;background:var(--ok,#22c55e);box-shadow:0 0 0 0 #22c55e88;animation:uDot 2s infinite}@keyframes uDot{70%{box-shadow:0 0 0 8px #22c55e00}}
.upd-pill b{font-weight:700}.upd-pill button{all:unset;cursor:pointer;height:30px;padding:0 14px;border-radius:20px;display:inline-flex;align-items:center;font-weight:600;background:linear-gradient(90deg,var(--pri,#7a7073),var(--acc,#47393d));transition:transform .15s,filter .15s}.upd-pill button:hover{filter:brightness(1.15)}.upd-pill button:active{transform:scale(.95)}
.upd-pill button.x{width:30px;padding:0;justify-content:center;background:none;color:var(--mut,#9a9aa5)}.upd-pill button.x:hover{color:#fff;background:var(--s4,#1c1c22)}.upd-pill button.x svg{width:14px;height:14px}
.upd-badge{all:unset;box-sizing:border-box;display:none;width:100%;align-items:center;gap:10px;margin:0 0 12px;padding:10px 14px;border-radius:14px;cursor:pointer;font-size:13.5px;font-weight:600;background:color-mix(in srgb,var(--acc,#47393d) 30%,var(--s1,#101013));border:1px solid color-mix(in srgb,var(--acc,#47393d) 60%,transparent);transition:transform .18s,box-shadow .18s}.upd-badge.show{display:flex;animation:uIn .5s backwards}.upd-badge:hover{transform:translateY(-2px);box-shadow:0 8px 22px color-mix(in srgb,var(--acc,#47393d) 30%,transparent)}
.upd-badge i{width:8px;height:8px;border-radius:50%;background:var(--ok,#22c55e);flex:none;animation:uDot 2s infinite}.upd-badge span{flex:1}.upd-badge small{font-size:12px;color:var(--mut,#9a9aa5)}
`;
  var st = document.createElement('style'); st.id = 'upd-css'; st.textContent = CSS; document.head.appendChild(st);

  var I = {
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 7v6M12 17h.01"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>'
  };
  var LOGO = '<img class="ulogo" width="52" height="52" src="../assets/zentrap-icon.svg" alt="">';

  var root = document.createElement('div'); root.className = 'upd-back';
  root.innerHTML = '<div class="upd" data-view="available" role="dialog" aria-modal="true" aria-labelledby="upd-title">' +
    '<div class="upd-h">' + LOGO + '<div class="upd-ht"><h2 id="upd-title">Доступно обновление</h2><div class="upd-ver" id="u-ver"></div></div><button class="upd-x" data-ua="close" aria-label="Закрыть">' + I.x + '</button></div>' +
    '<div class="v v-available"><div class="upd-meta" id="u-meta"></div><div class="upd-notes" id="u-notes"></div>' +
      '<div class="upd-f"><button class="ubtn pri" data-ua="install">Обновить сейчас</button><button class="ubtn" data-ua="later">Позже</button><button class="upd-skip" data-ua="skip">Пропустить версию</button></div></div>' +
    '<div class="v v-progress"><div class="upd-pct"><b id="u-pct">0</b><span>%</span><em id="u-step"></em></div><div class="upd-bar" id="u-bar"><i></i></div>' +
      '<div class="upd-stats"><span id="u-mb"></span><span id="u-spd"></span><span id="u-eta"></span></div>' +
      '<ol class="upd-steps" id="u-steps"><li>Скачивание</li><li>Проверка</li><li>Установка</li><li>Перезапуск</li></ol>' +
      '<div class="upd-f"><button class="ubtn" id="u-cancel" data-ua="cancel">Отмена</button><span class="upd-warn" id="u-warn">Не закрывайте ZenTrap</span></div></div>' +
    '<div class="v v-ok"><div class="upd-big"><div class="upd-ico">' + I.check + '</div><p id="u-oktext"></p><button class="ubtn pri" style="flex:none;min-width:180px" data-ua="close">Готово</button></div></div>' +
    '<div class="v v-error"><div class="upd-big"><div class="upd-ico err">' + I.warn + '</div><p>Не удалось обновить ZenTrap. Ничего не сломано, можно повторить или скачать вручную.</p><code class="upd-err" id="u-err"></code>' +
      '<div class="upd-f" style="width:100%"><button class="ubtn pri" data-ua="retry">Повторить</button><button class="ubtn" data-ua="log">Показать лог</button><button class="upd-skip" data-ua="close">Закрыть</button></div></div></div>' +
    '<div class="v v-checking"><div class="upd-big"><div class="upd-spin"></div><p>Проверяем обновления на GitHub…</p></div></div></div>';
  document.body.appendChild(root);
  var card = root.firstChild;

  var pill = document.createElement('div'); pill.className = 'upd-pill';
  pill.innerHTML = '<i></i><span>Доступно обновление <b id="p-ver"></b></span><button data-ua="open">Обновить</button><button class="x" data-ua="dismiss" aria-label="Скрыть">' + I.x + '</button>';
  document.body.appendChild(pill);

  var badge = document.createElement('button'); badge.className = 'upd-badge'; badge.dataset.ua = 'open';
  badge.innerHTML = '<i></i><span>Обновление <b id="b-ver"></b></span><small>Открыть</small>';
  var back = document.getElementById('back-launcher'), foot = document.querySelector('.side-foot');
  if (back) back.insertAdjacentElement('afterend', badge); else if (foot) foot.insertBefore(badge, foot.firstChild);

  var about = document.querySelectorAll('#view-set .card'); about = about[about.length - 1];
  if (about) about.insertAdjacentHTML('beforeend',
    '<div class="row"><div><b>Обновления ZenTrap</b><small id="upd-set-sub">Проверяются на GitHub</small></div><button class="btn sm" data-ua="check">Проверить</button></div>' +
    '<div class="row"><div><b>Бета-версии</b><small>Получать предварительные версии с GitHub</small></div><label class="sw"><input type="checkbox" data-key="betaChannel"><i></i></label></div>');

  function $(i) { return document.getElementById(i); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function inline(s) { return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>'); }
  function notes(md) { // markdown из GitHub -> безопасная разметка
    var out = [], ul = false;
    String(md || '').split(/\r?\n/).forEach(function (l) {
      l = l.trim(); var h = /^#{1,4}\s+(.*)/.exec(l), b = /^[-*+]\s+(.*)/.exec(l);
      if (!l || h || !b) { if (ul) { out.push('</ul>'); ul = false; } }
      if (!l) return;
      if (h) out.push('<h4>' + inline(h[1]) + '</h4>');
      else if (b) { if (!ul) { out.push('<ul>'); ul = true; } out.push('<li>' + inline(b[1]) + '</li>'); }
      else out.push('<p>' + inline(l) + '</p>');
    });
    if (ul) out.push('</ul>'); return out.join('');
  }
  function mb(n) { return (n / 1048576).toFixed(1).replace('.', ','); }
  function eta(s) { return s >= 60 ? 'осталось ' + Math.ceil(s / 60) + ' мин' : 'осталось ' + Math.max(1, Math.round(s)) + ' с'; }
  var STEP = { downloading: 0, verifying: 1, installing: 2, restarting: 3 }, STEPTXT = { downloading: 'Скачивание…', verifying: 'Проверка файла…', installing: 'Установка…', restarting: 'Перезапуск ZenTrap…' };

  function render() {
    var view = S in STEP ? 'progress' : S === 'uptodate' ? 'ok' : S === 'idle' ? card.dataset.view : S;
    card.dataset.view = view;
    var ver = $('u-ver'), title = $('upd-title');
    if (view === 'available' || view === 'progress') ver.innerHTML = '<span>' + esc(D.cur) + '</span>' + I.arrow + '<b>' + esc(D.ver) + '</b>';
    else ver.innerHTML = D.cur ? '<span>ZenTrap ' + esc(D.cur) + '</span>' : '';
    title.textContent = { available: 'Доступно обновление', progress: 'Обновление ZenTrap', ok: 'Всё актуально', error: 'Не удалось обновить', checking: 'Проверка обновлений' }[view] || '';
    if (view === 'available') {
      var meta = []; if (D.size) meta.push('<span>' + mb(D.size) + ' МБ</span>');
      if (D.date) meta.push('<span>' + new Date(D.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) + '</span>');
      meta.push('<span>' + esc(D.channel) + '</span>'); $('u-meta').innerHTML = meta.join('');
      $('u-notes').innerHTML = notes(D.notes) || '<p>Описание изменений не указано.</p>';
    }
    if (view === 'progress') {
      var i = STEP[S], ind = S !== 'downloading', pct = ind ? 100 : Math.round(D.percent || (D.total ? D.loaded / D.total * 100 : 0));
      $('u-pct').textContent = pct; $('u-bar').classList.toggle('ind', ind); $('u-bar').firstChild.style.setProperty('--p', pct + '%');
      $('u-step').textContent = STEPTXT[S];
      $('u-mb').textContent = !ind && D.total ? mb(D.loaded) + ' из ' + mb(D.total) + ' МБ' : ''; $('u-spd').textContent = !ind && D.speed ? mb(D.speed) + ' МБ/с' : ''; $('u-eta').textContent = !ind && D.eta ? eta(D.eta) : '';
      [].forEach.call($('u-steps').children, function (li, k) { li.className = k < i ? 'done' : k === i ? 'act' : ''; });
      $('u-cancel').style.display = S === 'downloading' ? '' : 'none'; $('u-warn').textContent = S === 'restarting' ? 'ZenTrap перезапустится сам' : 'Не закрывайте ZenTrap';
    }
    if (view === 'ok') $('u-oktext').textContent = D.message || ('У вас последняя версия ZenTrap' + (D.cur ? ' ' + D.cur : '') + '.');
    if (view === 'error') $('u-err').textContent = D.error || D.message || 'Неизвестная ошибка';
    var avail = S === 'available' && !dismissed && !root.classList.contains('show');
    pill.classList.toggle('show', avail); badge.classList.toggle('show', S === 'available'); $('p-ver').textContent = $('b-ver').textContent = D.ver;
    var sub = $('upd-set-sub'); if (sub) sub.textContent = S === 'available' ? 'Доступна версия ' + D.ver : S === 'checking' ? 'Проверяем…' : S === 'error' ? 'Не удалось проверить' : 'Версия ' + (D.cur || '—') + ' · актуальная';
  }
  function open() { root.classList.add('show'); render(); }
  function close() { if (S in STEP && S !== 'downloading') return; root.classList.remove('show'); asked = false; render(); }
  function set(s, d) {
    if (d) for (var k in d) D[k] = d[k];
    if (s !== S && s === 'available') dismissed = false; S = s;
    if (s in STEP || (s === 'available' && D.autoOpen) || (asked && (s === 'checking' || s === 'uptodate' || s === 'error'))) root.classList.add('show');
    render();
  }
  function emit(a) { window.dispatchEvent(new CustomEvent('zen:update', { detail: { action: a, version: D.ver } })); if (window.api && api.updateAction) { var request=api.updateAction(a,D.ver); if(request&&request.catch)request.catch(function(err){set('error',{error:err.message||String(err),autoOpen:true})}); } }
  function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
  function runDemoInstall() {
    var p = 0, total = D.size || 80 * 1048576; set('downloading', { percent: 0, loaded: 0, total: total, speed: 0, eta: 0 });
    var t = setInterval(function () { p += 3 + Math.random() * 4; if (p >= 100) { clearInterval(t); set('downloading', { percent: 100, loaded: total, total: total, speed: 6.4 * 1048576, eta: 1 });
        later(function () { set('verifying'); later(function () { set('installing'); later(function () { set('restarting'); later(function () { D.cur = D.ver; set('uptodate'); }, 1400); }, 1500); }, 1200); }, 400); return; }
      set('downloading', { percent: p, loaded: total * p / 100, total: total, speed: (5.5 + Math.random() * 2) * 1048576, eta: (100 - p) / 12 }); }, 140); timers.push(t);
  }
  function act(a) {
    if (a === 'open') { open(); return; } if (a === 'dismiss') { dismissed = true; render(); return; }
    if (a === 'close') { close(); return; }
    if (a === 'later') { emit('later'); close(); return; }
    if (a === 'skip') { emit('skip'); dismissed = true; close(); return; }
    if (a === 'check') { asked = true; if (!demoMode) { emit('check'); return; } set('checking'); later(function () { set('uptodate'); }, 1400); return; }
    emit(a);
    if (a === 'install') { if (demoMode) runDemoInstall(); else set('downloading', { percent: 0 }); }
    if (a === 'cancel') { timers.forEach(clearTimeout); set('available'); }
  }
  document.addEventListener('click', function (e) { var b = e.target.closest('[data-ua]'); if (b) act(b.dataset.ua); if (e.target === root && !(S in STEP)) close(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && root.classList.contains('show')) close(); });
  root.addEventListener('pointerdown', function (e) { var t = e.target.closest('.ubtn'); if (!t) return; var r = t.getBoundingClientRect(), s = Math.max(r.width, r.height) * 2, sp = document.createElement('span');
    sp.style.cssText = 'position:absolute;border-radius:50%;pointer-events:none;background:radial-gradient(circle,rgba(255,255,255,.34),transparent 65%);transform:scale(0);width:' + s + 'px;height:' + s + 'px;left:' + (e.clientX - r.left - s / 2) + 'px;top:' + (e.clientY - r.top - s / 2) + 'px;animation:rip .65s ease-out forwards';
    t.appendChild(sp); setTimeout(function () { sp.remove(); }, 700); });

  ZU.update = {
    setState: set, open: open, close: close, setCurrent: function (v) { D.cur = v; render(); },
    demo: function () { demoMode = true; D.cur = '1.0.3'; set('available', { ver: '1.0.4', size: 82 * 1048576, date: new Date().toISOString(), autoOpen: true,
      notes: '## Новое\n- Вкладка **«Профили»**: свои наборы настроек\n- Меню у кнопки «Играть»: запуск с выбранным профилем\n\n## Исправления\n- Исправлена установка Roblox на диск `D:`\n- Плавнее анимации в слабых компьютерах' }); }
  };
  if (window.api && api.onUpdate) api.onUpdate(function (s) { set(s.state, s); });
  if (window.api && api.getAppVersion) api.getAppVersion().then(function (version) {
    ZU.update.setCurrent(version);
    [].forEach.call(document.querySelectorAll('#view-set .card b'), function (label) {
      if (/^ZenTrap v/.test(label.textContent)) label.textContent = 'ZenTrap v' + version;
    });
    var sideVersion = document.querySelector('.side-foot p');
    if (sideVersion) sideVersion.textContent = 'ZenTrap v' + version;
  });
  if (window.api && api.getAppUpdateStatus) api.getAppUpdateStatus().then(function (status) {
    if (status && status.state && status.state !== 'idle') set(status.state, status);
  });
  if (window.api && api.store) api.store.get().then(function (settings) {
    var beta = document.querySelector('[data-key="betaChannel"]');
    if (beta) beta.checked = !!(settings.app && settings.app.betaChannel);
  });
  render();
})();
