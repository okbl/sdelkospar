/*
 * Прототип СделкоСпара по концепту «один путь от сделки до документа».
 *
 *   Главная: «Новая сделка» или «Открыть сохранённую».
 *   1 Данные сделки → 2 Основание → 3 Обстоятельства → 4 Доказательства
 *   → 5 Проверка → 6 Документ сформирован.
 *
 * Движок настоящий, тот же, что в рабочем приложении: шаблоны, склонение,
 * расчёт пошлины, сборка DOCX. Поэтому в конце скачивается настоящее
 * заявление, а не картинка.
 *
 * Обстоятельства спрашиваются вопросами «да / нет / неизвестно», и текст
 * для заявления собирается из ответов сам. Заинтересованность
 * и осведомлённость контрагента — тоже ответы на вопросы, а не отдельные
 * основания, которые надо знать заранее.
 *
 * Данные прототипа лежат отдельно от рабочего приложения, под своим ключом:
 * он не видит настоящих дел и не может их испортить.
 */
(function () {
  'use strict';

  const D = globalThis.ZData;
  const S = globalThis.ZStore;
  const X = globalThis.ZDoc;
  const IMP = globalThis.ZImport;

  /* ================= хранение ================= */

  const KEY = 'sdelkospar-proto';

  function load() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { /* приватный режим */ }
    let db = S.newDb();
    if (raw) { try { db = S.migrate(JSON.parse(raw)); } catch (e) { /* битая копия — начинаем с чистого */ } }
    db.ui = Object.assign({ theme: 'system', lastBackup: null, savedAt: null }, db.ui || {});
    return db;
  }

  let db = load();
  let timer = null;

  function writeNow() {
    clearTimeout(timer);
    const d = deal();
    if (d) d.updatedAt = new Date().toISOString();
    db.ui.savedAt = new Date().toISOString();
    try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* ничего */ }
    savedState('ok');
  }
  function save() { savedState('busy'); clearTimeout(timer); timer = setTimeout(writeNow, 350); }
  window.addEventListener('beforeunload', writeNow);

  /* ================= служебное ================= */

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const attr = (s) => esc(s).replace(/'/g, '&#39;');
  const normMoney = (s) => String(s).replace(/\s| /g, '').replace(',', '.');
  const hhmm = (iso) => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  function whenSaved(iso) {
    if (!iso) return '';
    const d = new Date(iso), now = new Date();
    const day = (x) => Date.UTC(x.getFullYear(), x.getMonth(), x.getDate());
    const diff = Math.round((day(now) - day(d)) / 86400000);
    return diff === 0 ? 'сегодня в ' + hhmm(iso) : diff === 1 ? 'вчера в ' + hhmm(iso) : D.dateShort(iso.slice(0, 10)) + ' в ' + hhmm(iso);
  }
  const initials = (name) => String(name || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '—';

  const ICON = {
    scales: '<path d="M12 3v18M6 21h12M5 7h14M5 7l-3 7a3 3 0 0 0 6 0L5 7zm14 0-3 7a3 3 0 0 0 6 0l-3-7z"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    disk: '<path d="M5 3h11l3 3v15H5zM8 3v5h8V3M8 21v-7h8v7"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
    more: '<circle cx="12" cy="5" r=".8"/><circle cx="12" cy="12" r=".8"/><circle cx="12" cy="19" r=".8"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    down: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    up: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
    chev: '<path d="m6 9 6 6 6-6"/>',
    left: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
    right: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    gear: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
    warn: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/>',
    app: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
    sample: '<path d="M4 4h16v16H4zM8 9h8M8 13h8M8 17h5"/>'
  };
  const icon = (name) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;

  /* ================= состояние экрана ================= */

  // view: home | list | deal | profile | backup; step: 1..6 для сделки.
  let ui = { view: 'home', step: 1, caseId: null, dealId: null, menu: null, tried: [] };

  const kase = () => db.cases.find((c) => c.id === ui.caseId) || null;
  const deal = () => { const c = kase(); return c ? c.deals.find((d) => d.id === ui.dealId) || null : null; };
  const stmt = (d) => (d.statements || []).find((s) => s.kind === 'statement') || d.statements[0];

  function roots() {
    const c = kase(), d = deal();
    return { case: c, deal: d, profile: db.profile, debtor: c ? S.debtorOf(c) : null, cp: c && d ? S.counterpartyOf(c, d) : null };
  }
  function resolve(path) {
    const seg = String(path).split('.');
    let o = roots()[seg[0]];
    for (let i = 1; i < seg.length - 1 && o; i++) o = o[seg[i]];
    return o ? { obj: o, key: seg[seg.length - 1] } : null;
  }
  const getPath = (p) => { const r = resolve(p); return r ? r.obj[r.key] : ''; };
  const setPath = (p, v) => { const r = resolve(p); if (r) r.obj[r.key] = v; };

  /* ================= верхняя панель ================= */

  function savedState(state) {
    const el = $('#saved');
    if (!el) return;
    el.classList.toggle('busy', state === 'busy');
    el.innerHTML = state === 'busy' ? icon('disk') + '<span class="hide-m">Сохраняется…</span>'
      : icon('disk') + `<span class="hide-m">Сохранено${db.ui.savedAt ? ' в ' + hhmm(db.ui.savedAt) : ''}</span>`;
  }

  function renderBar() {
    const name = db.profile.name;
    $('#bar').innerHTML = `
      <button class="logo" data-act="home">${icon('scales')}СделкоСпар</button><span class="tag">прототип</span>
      <div class="sp">
        <span class="saved" id="saved"></span>
        <button class="ghost hide-m" data-act="menu" data-id="profile">${icon('user')}Профиль ${icon('chev')}</button>
        <button class="ghost" data-act="menu" data-id="more" aria-label="Ещё">${icon('more')}</button>
      </div>
      ${ui.menu === 'profile' ? `<div class="menu">
        <div class="who"><span class="ava">${esc(initials(name))}</span><div><b>${esc(name || 'Профиль не заполнен')}</b>
          <div class="small muted">финансовый управляющий</div></div></div>
        <button data-act="go" data-id="profile">${icon('user')}Профиль</button>
        <button data-act="go" data-id="backup">${icon('disk')}Резервные копии</button>
        <button data-act="go" data-id="settings">${icon('gear')}Настройки</button>
      </div>` : ''}
      ${ui.menu === 'more' ? `<div class="menu">
        <button data-act="go" data-id="profile" class="only-m">${icon('user')}Профиль</button>
        <button data-act="go" data-id="backup">${icon('disk')}Резервные копии</button>
        <hr>
        <button data-act="demo">${icon('sample')}Пример на вымышленных данных</button>
        <button data-act="old-app">${icon('app')}Рабочее приложение (прежний вид)</button>
        <hr>
        <button data-act="wipe" style="color:var(--bad)">${icon('trash')}Очистить данные прототипа</button>
      </div>` : ''}`;
    savedState('ok');
  }

  /* ================= главная и список ================= */

  function allDeals() {
    const out = [];
    for (const c of db.cases) for (const d of c.deals) out.push({ c, d });
    return out.sort((a, b) => String(b.d.updatedAt || '').localeCompare(String(a.d.updatedAt || '')));
  }

  // Сделка, в которую ничего не ввели, в список не попадает: это просто
  // нажатая и брошенная «Новая сделка».
  const isEmpty = (c, d) => !S.partyName(S.debtorOf(c)) && !d.date && !d.amount && !c.number;
  function dropEmpty() {
    for (const c of db.cases) c.deals = c.deals.filter((d) => d.id === ui.dealId || !isEmpty(c, d));
    db.cases = db.cases.filter((c) => c.deals.length);
  }

  function screenHome() {
    const last = allDeals()[0];
    return `<div class="wrap home">
      <h1>СделкоСпар</h1>
      <p class="lead">Подготовка документов по оспариванию сделок</p>
      <button class="bigcard" data-act="new">
        <span class="plus">${icon('plus')}</span>
        <b>НОВАЯ СДЕЛКА</b>
        <span class="muted">Подготовить заявление об оспаривании</span>
      </button>
      <button class="linecard" data-act="go" data-id="list">
        ${icon('folder')}<span><b>Открыть сохранённую</b><span class="muted small">Продолжить работу</span></span>
      </button>
      ${last ? `<div class="last">
        <div class="cap">Последняя работа</div>
        <div class="box">
          <div><b>${esc(last.c.number ? 'Дело № ' + last.c.number : 'Номер дела не указан')}</b>
            <div>${esc(S.partyName(S.debtorOf(last.c)) || 'Должник не указан')}</div>
            <div class="small muted">Сохранено ${esc(whenSaved(last.d.updatedAt))}</div></div>
          <button class="btn pri" data-act="open" data-case="${last.c.id}" data-deal="${last.d.id}">Продолжить ${icon('right')}</button>
        </div>
      </div>` : ''}
    </div>`;
  }

  function screenList() {
    const rows = allDeals().map(({ c, d }) => `<div class="item">
        <div class="who"><b>${esc(S.partyName(S.debtorOf(c)) || 'Должник не указан')}</b>
          <span class="small muted">${esc(c.number ? '№ ' + c.number : 'без номера')} · ${esc(S.dealTypeName(d))}${d.date ? ' от ' + esc(D.dateShort(d.date)) : ''}
          · сохранено ${esc(whenSaved(d.updatedAt))}</span></div>
        <button class="btn sm" data-act="open" data-case="${c.id}" data-deal="${d.id}">Открыть</button>
        <button class="ghost" data-act="del-deal" data-case="${c.id}" data-deal="${d.id}" aria-label="Удалить">${icon('trash')}</button>
      </div>`).join('');
    return `<div class="wrap">
      <div class="head"><button class="ghost" data-act="home">${icon('left')}Назад</button><h1>Сохранённые сделки</h1><span class="spacer"></span></div>
      <div class="card list">${rows || '<p class="muted" style="margin:0">Сохранённых сделок пока нет.</p>'}</div>
    </div>`;
  }

  /* ================= поля ================= */

  // Поле, без которого документ не собрать, подсвечивается, только когда
  // человек уже нажал «Далее»: пустая форма не должна встречать красным.
  function field(o) {
    const val = o.value != null ? o.value : getPath(o.bind);
    const empty = val === '' || val == null;
    const miss = o.required && empty && ui.tried.includes(ui.step);
    let control;
    if (o.type === 'select') {
      control = `<select data-bind="${attr(o.bind)}">${o.options.map((op) =>
        `<option value="${attr(op.id)}"${String(op.id) === String(val) ? ' selected' : ''}>${esc(op.name)}</option>`).join('')}</select>`;
    } else if (o.type === 'textarea') {
      control = `<textarea data-bind="${attr(o.bind)}" placeholder="${attr(o.placeholder || '')}" rows="${o.rows || 5}">${esc(val)}</textarea>`;
    } else {
      control = `<div class="inp"><input type="${o.type || 'text'}" data-bind="${attr(o.bind)}" value="${attr(val == null ? '' : val)}"
        placeholder="${attr(o.placeholder || '')}"${o.money ? ' class="money" data-kind="money" inputmode="decimal"' : ''}${o.list ? ` list="${o.list}"` : ''}>
        ${o.money ? '<span class="suf">₽</span>' : ''}</div>`;
    }
    return `<div class="f${miss ? ' miss' : ''}"><label>${esc(o.label)}${o.required ? ' <span class="req">*</span>' : ''}</label>${control}
      ${miss ? '<span class="help m">Нужно для заявления</span>' : o.help ? `<span class="help">${esc(o.help)}</span>` : ''}</div>`;
  }

  /* ================= шаги сделки ================= */

  const STEPS = [
    { no: 1, name: 'Данные сделки', stage: 0 },
    { no: 2, name: 'Основание', stage: 0 },
    { no: 3, name: 'Обстоятельства', stage: 1 },
    { no: 4, name: 'Доказательства', stage: 1 },
    { no: 5, name: 'Проверка', stage: 2 },
    { no: 6, name: 'Готово', stage: 2 }
  ];
  const STAGES = [{ name: 'Сделка', first: 1 }, { name: 'Обстоятельства', first: 3 }, { name: 'Результат', first: 5 }];

  function progress() {
    const cur = STEPS[ui.step - 1].stage;
    const parts = [];
    STAGES.forEach((s, i) => {
      if (i) parts.push(`<span class="line${i <= cur ? ' done' : ''}"></span>`);
      parts.push(`<button class="dot${i < cur ? ' done' : i === cur ? ' on' : ''}" data-act="step" data-id="${s.first}"><i></i><span>${esc(s.name)}</span></button>`);
    });
    return `<div class="progress">${parts.join('')}</div>
      <div class="substep">Шаг ${Math.min(ui.step, 5)} из 5 · ${esc(STEPS[ui.step - 1].name)}</div>`;
  }

  function screenDeal() {
    const c = kase(), d = deal();
    if (!c || !d) { ui.view = 'home'; return screenHome(); }
    const title = S.partyShort(S.debtorOf(c)) ? 'Сделка · ' + S.partyShort(S.debtorOf(c)) : 'Новая сделка';
    const body = [null, s1, s2, s3, s4, s5, s6][ui.step](c, d);
    const wide = ui.step === 3;
    return `<div class="wrap${wide ? ' wide' : ''}">
      <div class="head"><button class="ghost" data-act="back">${icon('left')}Назад</button><h1>${esc(title)}</h1><span class="spacer"></span></div>
      ${ui.step < 6 ? progress() : ''}
      ${body}
    </div>`;
  }

  function dock() {
    if (ui.view !== 'deal' || ui.step >= 6) return '';
    if (ui.step === 5) {
      return `<div class="dock"><div class="in">
        <button class="btn" data-act="back">${icon('left')}Назад</button><span class="grow"></span>
        <button class="btn pri" data-act="form">Сформировать</button></div></div>`;
    }
    return `<div class="dock"><div class="in">
      <button class="btn" data-act="save">Сохранить</button>
      <span class="grow">Шаг ${ui.step} из 5 · сохраняется автоматически</span>
      <button class="btn pri" data-act="next">Далее ${icon('right')}</button></div></div>`;
  }

  /* ---------- 1. данные сделки ---------- */

  function s1(c, d) {
    const cp = S.counterpartyOf(c, d);
    const org = cp && cp.kind === 'org';
    const debtor = S.debtorOf(c);
    return `<div class="card" style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:16px 20px">
        <span style="flex:1;min-width:220px" class="small">Есть печатная форма из рабочей системы? Поля заполнятся сами.</span>
        <button class="btn sm" data-act="import-form">${icon('up')}Загрузить печатную форму</button>
      </div>

      <div class="card">
        <h2>Информация о сделке</h2>
        <div class="row2" style="margin-top:14px">
          ${field({ label: 'Дата сделки', bind: 'deal.date', type: 'date', required: true })}
          ${field({ label: 'Вид сделки', bind: 'deal.type', type: 'select', options: D.DEAL_TYPES })}
        </div>
        ${field({ label: 'Стоимость сделки', bind: 'deal.amount', money: true, required: true, placeholder: '1 250 000' })}
        ${field({ label: 'Что передано', bind: 'deal.subject', placeholder: 'квартира, г. Пятигорск, ул. Примерная, д. 1, кв. 1, кадастровый № …',
          help: 'Одной строкой — так предмет попадёт в заявление' })}
      </div>

      <div class="card">
        <h2>Должник</h2>
        ${field({ label: 'ФИО', bind: 'debtor.fio', required: true, placeholder: 'Иванов Иван Иванович' })}
        <div class="row2" style="margin-top:14px">
          ${field({ label: 'ИНН', bind: 'debtor.inn', placeholder: '000000000000' })}
          ${field({ label: 'Номер дела', bind: 'case.number', required: true, placeholder: 'А00-12345/2026' })}
        </div>
        ${field({ label: 'Адрес регистрации', bind: 'debtor.address' })}
        <div class="row2" style="margin-top:14px">
          ${field({ label: 'Арбитражный суд', bind: 'case.court', required: true, placeholder: 'Арбитражный суд Ставропольского края', list: 'courts' })}
          ${field({ label: 'Дата решения о банкротстве', bind: 'case.procedureDate', type: 'date' })}
        </div>
        <datalist id="courts">${['Арбитражный суд Ставропольского края', 'Арбитражный суд города Москвы', 'Арбитражный суд Московской области',
          'Арбитражный суд Челябинской области', 'Арбитражный суд Кабардино-Балкарской Республики'].map((s) => `<option value="${s}">`).join('')}</datalist>
      </div>

      <div class="card">
        <h2>Стороны сделки</h2>
        <div class="row2" style="margin-top:12px;align-items:start">
          <div>
            <div class="small muted" style="font-weight:600;margin-bottom:8px">Должник</div>
            <div id="debtor-card" style="padding:12px 14px;border:1px solid var(--border);border-radius:var(--r-sm);background:var(--surface-2)">
              ${debtorCard(debtor)}
            </div>
          </div>
          <div>
            <div class="small muted" style="font-weight:600;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">Контрагент
              <span class="seg" style="height:30px"><button data-act="cp-kind" data-id="person" class="${org ? '' : 'on'}" style="padding:0 10px;font-size:12.5px">Гражданин</button><button data-act="cp-kind" data-id="org" class="${org ? 'on' : ''}" style="padding:0 10px;font-size:12.5px">Организация</button></span></div>
            ${field({ label: org ? 'Наименование' : 'ФИО', bind: org ? 'cp.nameFull' : 'cp.fio', required: true })}
            ${field({ label: 'ИНН', bind: 'cp.inn' })}
            ${field({ label: 'Адрес', bind: org ? 'cp.addressLegal' : 'cp.address' })}
          </div>
        </div>
      </div>`;
  }

  /* ---------- 2. основание ---------- */

  // В законе у статьи 61.2 пункты, а не части: «п. 1», «п. 2».
  const GROUNDS = [
    { id: 'unequal', law: 'п. 1 ст. 61.2', name: 'Неравноценное встречное исполнение',
      text: 'Цена или условия сделки существенно хуже для должника, чем в сравнимых сделках.' },
    { id: 'harm', law: 'п. 2 ст. 61.2', name: 'Причинение вреда кредиторам',
      text: 'Сделка совершена, чтобы причинить вред кредиторам, и вред причинён.' },
    { id: 'preference', law: 'ст. 61.3', name: 'Предпочтение одному кредитору',
      text: 'Один кредитор получил больше, чем получил бы при расчётах по очереди.' },
    { id: 'sham', law: 'ст. 170 ГК РФ', name: 'Мнимая сделка', extra: true,
      text: 'Сделка совершена лишь для вида: имущество фактически осталось у должника.' }
  ];
  const groundName = (id) => (GROUNDS.find((g) => g.id === id) || {}).name || id;

  function s2(c, d) {
    const base = d.baseGrounds || [];
    const showExtra = ui.showExtra || base.includes('sham');
    const card = (g) => {
      const on = base.includes(g.id);
      return `<button class="gcard${on ? ' on' : ''}" data-act="ground" data-id="${g.id}">
        ${on ? `<span class="chk">${icon('check')}</span>` : ''}
        <span class="law">${esc(g.law)}</span>
        <b>${esc(g.name)}</b>
        ${on ? '' : `<p>${esc(g.text)}</p><span class="pick">Выбрать ${icon('right')}</span>`}
      </button>`;
    };
    return `<h2 style="font-size:18px;margin-top:18px">Выберите основание оспаривания</h2>
      <p class="lead small">Можно выбрать несколько — в заявлении они часто идут вместе.</p>
      ${GROUNDS.filter((g) => !g.extra).map(card).join('')}
      ${showExtra ? GROUNDS.filter((g) => g.extra).map(card).join('')
        : '<p style="margin-top:14px"><button class="link" data-act="more-grounds">Ещё основание: мнимая сделка (ст. 170 ГК)</button></p>'}
      ${ui.tried.includes(2) && !base.length ? '<p class="small" style="color:var(--bad);margin-top:12px">Выберите хотя бы одно основание — от него зависит текст заявления.</p>' : ''}`;
  }

  /* ---------- 3. обстоятельства ---------- */

  /*
   * Вопросы вместо текста. Ответ «да» добавляет в заявление готовую фразу;
   * «нет» и «неизвестно» не добавляют ничего, а в подсказке справа
   * обстоятельство остаётся недоказанным — видно, что ещё выяснить.
   * Фразы — только о фактах; правовые выводы уже стоят в шаблоне заявления.
   */
  const QS = {
    harm: [
      { id: 'h_insolvent', t: 'На дату сделки должник уже не исполнял обязательства перед кредиторами?', el: 'Неплатёжеспособность на дату сделки',
        yes: 'На дату совершения Сделки должник отвечал признаку неплатёжеспособности: у него имелись неисполненные обязательства перед кредиторами.' },
      { id: 'h_use', t: 'После сделки должник продолжал пользоваться имуществом?', el: 'Имущество фактически осталось у должника',
        yes: 'После совершения Сделки должник продолжал владеть и пользоваться отчуждённым имуществом.' },
      { id: 'h_nopay', t: 'Оплата по сделке должнику фактически не поступала?', el: 'Встречного предоставления не было',
        yes: 'Доказательства поступления должнику оплаты по Сделке отсутствуют.' }
    ],
    preference: [
      { id: 'p_earlier', t: 'Сделкой погашен долг перед контрагентом, возникший раньше других?', el: 'Погашено более раннее требование', pref: 'earlier_claim' },
      { id: 'p_order', t: 'Долги перед другими кредиторами той же очереди остались непогашенными?', el: 'Нарушена очерёдность', pref: 'order' },
      { id: 'p_security', t: 'Контрагенту дано обеспечение по уже существовавшему долгу?', el: 'Обеспечение по старому долгу', pref: 'security' }
    ],
    sham: [
      { id: 's_kept', t: 'Имущество фактически осталось у должника?', el: 'Имущество фактически не передавалось',
        yes: 'Имущество фактически осталось во владении и пользовании должника.' },
      { id: 's_nopay', t: 'Расчётов по сделке фактически не было?', el: 'Расчёты не производились',
        yes: 'Расчёты по Сделке фактически не производились.' }
    ],
    party: [
      { id: 'a_related', t: 'Контрагент — заинтересованное лицо: родственник, общий руководитель или участник?', el: 'Заинтересованность контрагента' },
      { id: 'w_knew', t: 'Контрагент знал или должен был знать о долгах должника?', el: 'Осведомлённость контрагента' }
    ]
  };

  /** Состав правовых разделов следует за основаниями и способом передачи. */
  function syncBlocks(c, d) {
    for (const st of d.statements || []) {
      for (const b of S.statementBlocks(db, c, d, st)) if (b.condition) b.ref.enabled = b.available;
    }
  }

  /** Ответы → поля движка: пояснения, основания, заинтересованность. */
  function applyAnswers(c, d) {
    const qa = d.qa || (d.qa = {});
    const base = d.baseGrounds || [];
    const yes = (id) => qa[id] === 'yes';
    const on = (g) => base.includes(g);
    d.harmNote = on('harm') ? QS.harm.filter((q) => yes(q.id)).map((q) => q.yes).join(' ') : '';
    d.shamNote = on('sham') ? QS.sham.filter((q) => yes(q.id)).map((q) => q.yes).join(' ') : '';
    d.preferenceGrounds = on('preference') ? QS.preference.filter((q) => yes(q.id)).map((q) => q.pref) : [];
    const party = on('harm') || on('preference');
    const grounds = base.slice();
    if (party && yes('a_related')) grounds.push('affiliation');
    if (party && yes('w_knew')) grounds.push('awareness');
    d.affiliationGrounds = grounds.includes('affiliation') ? [qa.a_type || 'family'] : [];
    S.setGrounds(d, grounds);
    syncBlocks(c, d);
  }

  function yn(q, qa) {
    const v = qa[q.id];
    const b = (val, name) => `<button class="${v === val ? 'on' : ''}" data-act="qa" data-q="${q.id}" data-v="${val}">${name}</button>`;
    return `<div class="q"><div class="t">${esc(q.t)}</div><div class="yn">${b('yes', 'Да')}${b('no', 'Нет')}${b('unknown', 'Неизвестно')}</div>
      ${q.id === 'a_related' && v === 'yes' ? `<div class="sub">${field({ label: 'Кем приходится', bind: 'deal.qa.a_type', type: 'select',
        options: D.AFFILIATION_GROUNDS.filter((g) => g.id !== 'other') })}</div>` : ''}</div>`;
  }

  function monthsBetween(a, b) {
    const x = a.split('-').map(Number), y = b.split('-').map(Number);
    let m = (y[0] - x[0]) * 12 + (y[1] - x[1]);
    if (y[2] < x[2]) m--;
    return m;
  }
  const LIMIT = { unequal: [12, 'один год'], harm: [36, 'три года'], preference: [6, 'шесть месяцев'] };

  function periodHtml(c, d) {
    const base = d.baseGrounds || [];
    if (!d.date || !c.caseStartDate) {
      return '<div class="per">Укажите дату принятия заявления о банкротстве — подскажу, укладывается ли сделка в период подозрительности.</div>';
    }
    if (d.date >= c.caseStartDate) return '<div class="per">Сделка совершена после принятия заявления о банкротстве.</div>';
    const m = monthsBetween(d.date, c.caseStartDate);
    const rows = base.filter((g) => LIMIT[g]).map((g) => {
      const ok = m < LIMIT[g][0];
      return `<div class="el"><span class="st ${ok ? 'y' : 'n'}">${ok ? '✓' : '✕'}</span><span>${esc(groundName(g))}: не ранее чем за ${LIMIT[g][1]} — ${ok ? 'укладывается' : 'за пределами'}</span></div>`;
    }).join('');
    return `<div class="per">Сделка совершена <b>${esc(S.periodBefore(d.date, c.caseStartDate))}</b> до принятия заявления.${rows ? '<div style="margin-top:9px">' + rows + '</div>' : ''}</div>`;
  }

  function hintPanel(c, d) {
    const qa = d.qa || {};
    const base = d.baseGrounds || [];
    const st = (v) => (v === 'yes' ? ['y', '✓'] : v === 'no' ? ['n', '✕'] : ['u', '?']);
    const el = (v, text) => { const [cls, ch] = st(v); return `<div class="el"><span class="st ${cls}">${ch}</span><span>${esc(text)}</span></div>`; };
    const rows = [];
    if (base.includes('unequal')) {
      const gap = S.valueGap(d);
      rows.push(el(d.valuation.marketValue ? 'yes' : '', 'Рыночная стоимость по оценке'));
      rows.push(el(!gap ? '' : (d.valuation.gratuitous || gap.gap > 0) ? 'yes' : 'no', d.valuation.gratuitous ? 'Передано безвозмездно' : 'Цена существенно ниже рыночной'));
    }
    for (const g of ['harm', 'preference', 'sham']) if (base.includes(g)) for (const q of QS[g]) rows.push(el(qa[q.id], q.el));
    if (base.includes('harm') || base.includes('preference')) for (const q of QS.party) rows.push(el(qa[q.id], q.el));

    const gen = [d.harmNote, d.shamNote].filter(Boolean).join(' ');
    return `<aside class="hintp">
      <h3>Что нужно подтвердить</h3>
      ${rows.join('') || '<p class="small muted" style="margin:0">Выберите основание на предыдущем шаге.</p>'}
      ${periodHtml(c, d)}
      ${gen ? `<div class="gen"><div class="small muted" style="font-family:inherit;margin-bottom:4px">Так войдёт в заявление:</div>${esc(gen)}</div>` : ''}
    </aside>`;
  }

  function verdict(d) {
    const gap = S.valueGap(d);
    if (!gap) return '<div class="verdict">Внесите рыночную стоимость из решения об оценке.</div>';
    if (d.valuation.gratuitous) return `<div class="verdict ok">Встречного предоставления нет. В конкурсную массу заявляется ${esc(D.money(gap.market))} ₽.</div>`;
    if (gap.gap > 0) return `<div class="verdict ok">Рыночная стоимость выше цены договора${gap.ratio ? ' в ' + esc(S.ratioText(gap.ratio)) + ' раза' : ''}: разница ${esc(D.money(gap.gap))} ₽.</div>`;
    return '<div class="verdict">Рыночная стоимость не выше цены договора — неравноценность из этих цифр не следует.</div>';
  }

  function s3(c, d) {
    const base = d.baseGrounds || [];
    const qa = d.qa || {};
    if (!base.length) {
      return `<div class="card"><h2>Сначала основание</h2><p class="lead">Вопросы зависят от того, по какому основанию оспариваем.</p>
        <button class="btn pri" data-act="step" data-id="2">Выбрать основание</button></div>`;
    }
    const sec = (title, law, inner) => `<div class="card"><div class="small" style="font-weight:700;color:var(--accent)">${esc(law)}</div>
      <h2 style="margin-top:2px">${esc(title)}</h2><div style="margin-top:10px">${inner}</div></div>`;
    const parts = [];

    parts.push(`<div class="card"><h2>Обстоятельства сделки</h2>
      <div class="row2" style="margin-top:14px">
        <div class="f"><label>Когда совершена сделка?</label><div style="height:var(--h);display:flex;align-items:center;gap:10px">
          <b>${d.date ? esc(D.dateShort(d.date)) : '—'}</b><button class="link" data-act="step" data-id="1">изменить</button></div></div>
        ${field({ label: 'Когда принято заявление о банкротстве?', bind: 'case.caseStartDate', type: 'date' })}
      </div></div>`);

    if (base.includes('unequal')) {
      const v = d.valuation;
      parts.push(sec('Цена и оценка', 'п. 1 ст. 61.2', `
        <div class="seg"><button data-act="gratuitous" data-id="false" class="${v.gratuitous ? '' : 'on'}">За плату</button><button data-act="gratuitous" data-id="true" class="${v.gratuitous ? 'on' : ''}">Безвозмездно</button></div>
        <div class="row2" style="margin-top:14px">
          ${v.gratuitous ? '' : field({ label: 'Цена по договору', bind: 'deal.valuation.contractPrice', money: true, placeholder: d.amount ? D.money(d.amount) : '' })}
          ${field({ label: 'Рыночная стоимость по оценке', bind: 'deal.valuation.marketValue', money: true })}
        </div>
        ${field({ label: 'Реквизиты решения об оценке', bind: 'deal.valuation.decision', placeholder: 'от 01.07.2025 № 1' })}
        <div id="verdict">${verdict(d)}</div>`));
    }
    if (base.includes('harm')) parts.push(sec('Вред кредиторам', 'п. 2 ст. 61.2', QS.harm.map((q) => yn(q, qa)).join('')));
    if (base.includes('preference')) parts.push(sec('Предпочтение', 'ст. 61.3', QS.preference.map((q) => yn(q, qa)).join('')));
    if (base.includes('sham')) parts.push(sec('Мнимость', 'ст. 170 ГК РФ', QS.sham.map((q) => yn(q, qa)).join('')));
    if (base.includes('harm') || base.includes('preference')) {
      parts.push(sec('Контрагент', 'ст. 19 Закона о банкротстве', QS.party.map((q) => yn(q, qa)).join('')));
    }
    parts.push(`<div class="card"><h2>Дополнительные обстоятельства</h2>
      ${field({ label: '', bind: 'deal.circumstances', type: 'textarea', placeholder: 'Напишите обстоятельства сделки своими словами…' })}</div>`);

    return `<div class="split"><div>${parts.join('')}</div><div style="margin-top:16px" id="hint">${hintPanel(c, d)}</div></div>`;
  }

  /* ---------- 4. доказательства ---------- */

  const PROVES = ['Факт совершения сделки', 'Рыночную стоимость имущества', 'Переход права собственности',
    'Родство или аффилированность сторон', 'Неплатёжеспособность должника', 'Отсутствие оплаты по сделке'];
  const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' МБ' : Math.max(1, Math.round(n / 1024)) + ' КБ');

  function s4(c, d) {
    const docs = d.documents || [];
    const rows = docs.map((doc, i) => `<div class="doc">
        <div class="top">${icon('file')}
          ${doc.fromFile ? `<b title="${attr(doc.fileName)}">${esc(doc.fileName)}</b><span class="ok">${icon('check')}</span>`
            : `<div style="flex:1">${field({ label: '', bind: `deal.documents.${i}.name`, placeholder: 'Название документа' })}</div>`}
        </div>
        ${doc.fromFile ? `<div class="small muted" style="margin:2px 0 0 28px">${esc(kb(doc.size || 0))}</div>` : ''}
        <div style="margin-left:28px">${field({ label: 'Что подтверждает?', bind: `deal.documents.${i}.proves`, list: 'proves', placeholder: 'Факт совершения сделки' })}</div>
        <div style="display:flex;justify-content:flex-end;margin-top:10px">
          <button class="btn sm danger" data-act="del-doc" data-id="${i}">${icon('trash')}Удалить</button></div>
      </div>`).join('');
    return `<div class="card">
        <h2>Доказательства</h2>
        <p class="lead small">Документы, подтверждающие обстоятельства сделки. Файлы остаются у вас —
          в заявление попадает их список в приложениях.</p>
        <div class="drop" id="drop">
          <div>Перетащите файл сюда</div>
          <button class="btn" data-act="pick-files">или выбрать файл</button>
          <div class="small muted">PDF · JPG · PNG · DOCX</div>
        </div>
        <p style="margin:12px 0 0"><button class="link" data-act="add-doc">Добавить документ без файла</button></p>
      </div>
      ${docs.length ? `<h2 style="font-size:16px;margin-top:22px">Загруженные документы</h2>${rows}` : ''}
      <datalist id="proves">${PROVES.map((p) => `<option value="${p}">`).join('')}</datalist>`;
  }

  /* ---------- 5. проверка ---------- */

  function s5(c, d) {
    const debtor = S.debtorOf(c), cp = S.counterpartyOf(c, d);
    const base = d.baseGrounds || [];
    const qa = d.qa || {};
    const kv = (rows) => '<dl class="kv">' + rows.map(([k, v, need]) =>
      `<dt>${esc(k)}</dt><dd class="${!v && need ? 'no' : ''}">${v ? esc(v) : need ? 'не указано' : '—'}</dd>`).join('') + '</dl>';
    const sec = (cap, inner, step) => `<div class="sec"><div class="cap">${esc(cap)}</div>${inner}
      ${step ? `<div class="edit"><button class="link" data-act="${step === 'profile' ? 'go' : 'step'}" data-id="${step}">Изменить</button></div>` : ''}</div>`;

    const asked = [];
    for (const g of ['harm', 'preference', 'sham']) if (base.includes(g)) asked.push(...QS[g]);
    if (base.includes('harm') || base.includes('preference')) asked.push(...QS.party);
    const yesN = asked.filter((q) => qa[q.id] === 'yes').length;
    const unk = asked.filter((q) => !qa[q.id] || qa[q.id] === 'unknown').length;
    const fee = S.feeCalc(d);
    const gap = S.valueGap(d);
    const manager = c.managerName || db.profile.name;

    return `<h2 style="font-size:20px;margin-top:18px">Проверка данных</h2>
      <p class="lead">Перед формированием документа проверьте информацию.</p>
      <div class="card">
        ${sec('Сделка', kv([['Дата', d.date ? D.dateShort(d.date) : '', true], ['Вид', S.dealTypeName(d)],
          ['Стоимость', d.amount ? D.money(d.amount) + ' ₽' : '', true], ['Что передано', d.subject]]), 1)}
        ${sec('Должник', kv([['ФИО', S.partyName(debtor), true], ['ИНН', debtor.inn], ['Дело', c.number ? '№ ' + c.number : '', true],
          ['Суд', c.court, true]]), 1)}
        ${sec('Контрагент', kv([[cp && cp.kind === 'org' ? 'Наименование' : 'ФИО', S.partyName(cp), true], ['ИНН', cp && cp.inn],
          ['Адрес', S.partyAddress(cp)]]), 1)}
        ${sec('Основание', base.length ? base.map((g) => `<div><b>${esc((GROUNDS.find((x) => x.id === g) || {}).law)}</b> — ${esc(groundName(g))}</div>`).join('')
          : '<div style="color:var(--bad)">не выбрано</div>', 2)}
        ${sec('Обстоятельства', kv([
          ...(base.includes('unequal') ? [['Оценка', gap ? D.money(gap.market) + ' ₽' + (gap.ratio && !d.valuation.gratuitous ? ', выше цены в ' + S.ratioText(gap.ratio) + ' раза' : '') : '', true]] : []),
          ...(asked.length ? [['Ответы', yesN + ' подтверждено' + (unk ? ', ' + unk + ' неизвестно' : '')]] : []),
          ['Заявление принято', c.caseStartDate ? D.dateShort(c.caseStartDate) : '']]), 3)}
        ${sec('Доказательства', `<div>${(d.documents || []).length ? esc((d.documents || []).length + ' ' + D.plural(d.documents.length, 'документ', 'документа', 'документов')) +
          '<div class="small muted">' + esc(d.documents.map((x) => x.name || x.fileName).filter(Boolean).join(', ')) + '</div>' : '<span class="muted">не добавлены</span>'}</div>`, 4)}
        ${sec('Госпошлина', `<div><b>${esc(D.money(fee.total))} ₽</b> <span class="small muted">— рассчитана автоматически по ст. 333.21 НК РФ</span></div>`)}
        ${sec('Заявитель', kv([['Управляющий', manager, true]]), manager ? null : 'profile')}
      </div>`;
  }

  /* ---------- 6. документ сформирован ---------- */

  function s6(c, d) {
    return `<div class="finish">
      <div class="ico">${icon('check')}</div>
      <h2 style="font-size:22px">Документ сформирован</h2>
      <p class="lead">Заявление об оспаривании сделки${c.number ? '<br>' + esc(c.number) : ''}</p>
      <div style="max-width:480px;margin:24px auto 0">
        <button class="actbox" data-act="download">${icon('file')}Скачать документ</button>
        <button class="actbox" data-act="preview">${icon('eye')}Открыть предпросмотр</button>
        <p style="margin-top:20px"><button class="btn" data-act="step" data-id="5">${icon('left')}Вернуться к сделке</button></p>
        <p class="small muted">Сохранено автоматически</p>
      </div>
    </div>`;
  }

  function sheetHtml(c, d) {
    const paras = S.buildDocument(db, c, d, { mark: true, statement: stmt(d) });
    return paras.map((p) => {
      if (p.kind === 'table') return X.tableHtml(p);
      const text = esc(p.text).split(S.MISS_A).join('<span class="miss">').split(S.MISS_B).join('</span>');
      return `<p class="${p.align}${p.bold ? ' b' : ''}">${text || '&nbsp;'}</p>`;
    }).join('');
  }

  function download() {
    const c = kase(), d = deal();
    if (!c || !d) return;
    const st = stmt(d);
    const name = X.safeName('Заявление — ' + (c.number || 'дело') + ' — ' + (S.partyShort(S.counterpartyOf(c, d)) || 'контрагент'));
    X.download(X.docxBytes(S.buildDocument(db, c, d, { mark: false, statement: st }), name), name + '.docx', X.DOCX_MIME);
    if (S.validate(db, c, d, st).ok) st.status = 'ready';
    writeNow();
  }

  /* ================= профиль, настройки, резервные копии ================= */

  function screenProfile() {
    const p = db.profile;
    const theme = db.ui.theme;
    const seg = (id, name) => `<button class="${theme === id ? 'on' : ''}" data-act="theme" data-id="${id}">${name}</button>`;
    return `<div class="wrap">
      <div class="head"><button class="ghost" data-act="home">${icon('left')}Назад</button><h1>Профиль</h1><span class="spacer"></span></div>
      <div class="card" style="display:flex;align-items:center;gap:16px">
        <span class="ava big">${esc(initials(p.name))}</span>
        <div><b style="font-size:18px">${esc(p.name || 'Имя не указано')}</b><div class="muted small">финансовый управляющий</div></div>
      </div>
      <div class="card">
        <h2>Данные для документов</h2>
        <p class="lead small">Подставляются в шапку и в сведения о деле каждого заявления.</p>
        ${field({ label: 'ФИО', bind: 'profile.name', placeholder: 'Иванов Иван Иванович' })}
        ${field({ label: 'Адрес для корреспонденции', bind: 'profile.address' })}
        ${field({ label: 'СРО', bind: 'profile.sro' })}
        <div class="row2" style="margin-top:14px">
          ${field({ label: 'ИНН', bind: 'profile.inn' })}
          ${field({ label: 'СНИЛС', bind: 'profile.snils' })}
          ${field({ label: 'Регистрационный номер', bind: 'profile.regNumber' })}
          ${field({ label: 'Телефон, e-mail', bind: 'profile.contacts' })}
        </div>
      </div>
      <div class="card" id="settings">
        <h2>Настройки</h2>
        <div class="setrow"><span>Автосохранение</span><span class="pillok">Всегда включено</span></div>
        <div class="setrow"><span>Где хранятся данные</span><span class="small muted">Только в этом браузере</span></div>
        <div class="setrow"><span>Тема интерфейса</span><span class="seg">${seg('system', 'Системная')}${seg('light', 'Светлая')}${seg('dark', 'Тёмная')}</span></div>
      </div>
      <div class="card">
        <h2>Резервное копирование</h2>
        <p class="lead small">Последняя копия: ${db.ui.lastBackup ? esc(whenSaved(db.ui.lastBackup)) : 'ещё не делалась'}.</p>
        <button class="btn" data-act="go" data-id="backup">Открыть резервные копии</button>
      </div>
      <p class="small muted" style="text-align:center;margin-top:20px">Прототип 0.1</p>
    </div>`;
  }

  function screenBackup() {
    return `<div class="wrap">
      <div class="head"><button class="ghost" data-act="home">${icon('left')}Назад</button><h1>Резервная копия</h1><span class="spacer"></span></div>
      <p class="lead" style="text-align:center">Сохраните данные, чтобы восстановить работу на другом устройстве или после очистки браузера.</p>
      <button class="bigcard" data-act="backup-save" style="margin-top:22px">${icon('down')}<b style="letter-spacing:0">Скачать резервную копию</b><span class="muted">Сохранить все данные в файл</span></button>
      <button class="bigcard" data-act="backup-load" style="margin-top:12px">${icon('up')}<b style="letter-spacing:0">Восстановить из файла</b><span class="muted">Загрузить резервную копию</span></button>
      <p style="text-align:center;margin-top:18px" class="small">Последняя копия: ${db.ui.lastBackup ? esc(whenSaved(db.ui.lastBackup)) : 'ещё не делалась'}</p>
      <div class="warnbox">${icon('warn')}<span>Восстановление заменит текущие данные.</span></div>
    </div>`;
  }

  /* ================= окна ================= */

  function modal(html, wide) {
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal"><div class="box${wide ? ' sheetbox' : ''}">${html}</div></div>`;
    const close = () => { root.innerHTML = ''; };
    root.firstChild.addEventListener('click', (e) => { if (e.target === root.firstChild || e.target.closest('[data-close]')) close(); });
    return close;
  }
  const note = (text) => modal(`<h3>Сообщение</h3><p class="lead">${esc(text)}</p><div class="foot"><button class="btn pri" data-close>Понятно</button></div>`);
  function confirmBox(text, yes, label) {
    const close = modal(`<h3>Подтвердите</h3><p class="lead">${esc(text)}</p><div class="foot">
      <button class="btn" data-close>Отмена</button><button class="btn pri" id="yes">${esc(label || 'Да')}</button></div>`);
    $('#yes').addEventListener('click', () => { close(); yes(); });
  }
  function toast(text) {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 1600);
  }
  function pickFiles(accept, multiple) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = accept; input.multiple = !!multiple; input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', () => { const f = [...(input.files || [])]; input.remove(); resolve(f); });
      input.click();
    });
  }

  /* ================= сделки: создание, печатная форма, пример ================= */

  function newDeal() {
    const c = S.newCase();
    const cp = S.newParty('person');
    c.parties.push(cp);
    const d = S.newDeal();
    d.type = 'sale';
    d.counterpartyId = cp.id;
    d.baseGrounds = [];
    d.qa = {};
    c.deals.push(d);
    db.cases.push(c);
    return { c, d };
  }

  function openDeal(c, d, step) {
    ui = Object.assign(ui, { view: 'deal', caseId: c.id, dealId: d.id, step: step || 1, tried: [], menu: null });
    render();
  }

  // «Решением Арбитражного суда … от …» собирается из суда и даты само:
  // одно поле даты вместо строки, которую каждый раз пишут одинаково.
  function autoAct(c) {
    if (c.actFromForm || !c.court || !c.procedureDate) return;
    const court = c.court.replace(/^Арбитражный\s+суд\s+/i, 'Арбитражного суда ');
    c.judicialAct = 'Решением ' + court + ' от ' + D.dateShort(c.procedureDate);
  }

  // Поля печатной формы → сделка. Пустое в форме ничего не затирает.
  function applyPrintForm(c, d, data) {
    const set = (o, k, v) => { if (v) o[k] = v; };
    for (const [k, v] of [['court', data.court], ['courtAddress', data.courtAddress], ['number', data.caseNumber],
      ['caseStartDate', data.caseStartDate], ['procedure', data.procedure], ['procedureDate', data.procedureDate],
      ['debtorNameGen', data.debtorNameGen], ['managerName', data.managerName], ['managerAddress', data.managerAddress],
      ['managerInn', data.managerInn], ['managerSnils', data.managerSnils], ['managerRegNumber', data.managerRegNumber]]) set(c, k, v);
    if (data.judicialAct) { c.judicialAct = data.judicialAct; c.actFromForm = true; }
    if (data.sroName) c.managerSro = data.sroName + (data.sroOgrn ? ' (ОГРН ' + data.sroOgrn + ')' : '');
    const debtor = S.debtorOf(c);
    for (const [k, v] of [['fio', data.debtorName], ['address', data.debtorAddress], ['inn', data.debtorInn],
      ['birthDate', data.debtorBirthDate], ['birthPlace', data.debtorBirthPlace], ['snils', data.debtorSnils]]) set(debtor, k, v);
    const cp = S.counterpartyOf(c, d);
    if (cp && data.respondentName && !S.partyName(cp)) { cp.kind = 'person'; cp.fio = data.respondentName; set(cp, 'address', data.respondentAddress); }
  }

  async function importForm() {
    const [file] = await pickFiles('.docx');
    if (!file) return;
    let data;
    try { data = IMP.parsePrintForm(await IMP.readDocx(new Uint8Array(await file.arrayBuffer()))); } catch (e) {
      return note('Не удалось прочитать файл: ' + (e && e.message ? e.message : e));
    }
    if (!data.court && !data.caseNumber && !data.debtorName) return note('В файле нет ни суда, ни номера дела, ни должника — похоже, это не печатная форма.');
    applyPrintForm(kase(), deal(), data);
    writeNow(); render();
    toast('Заполнено из печатной формы');
  }

  function addFiles(files) {
    const d = deal();
    if (!d || !files.length) return;
    for (const f of files) {
      d.documents.push(Object.assign(S.newDocument(), {
        type: 'other', name: f.name.replace(/\.[^.]+$/, ''), fileName: f.name, size: f.size, fromFile: true, proves: ''
      }));
    }
    writeNow(); render();
  }

  /*
   * Пример целиком выдуман: люди, номер дела, адреса, кадастровый номер.
   * Прототип лежит в публичном репозитории, настоящих данных в нём нет.
   */
  function demo() {
    const { c, d } = newDeal();
    Object.assign(c, { court: 'Арбитражный суд Ставропольского края', courtAddress: '355029, г. Ставрополь, ул. Мира, 458 «Б»',
      number: 'А63-99999/2025', procedureDate: '2025-03-12', caseStartDate: '2025-02-10', procedure: 'realization' });
    autoAct(c);
    Object.assign(S.debtorOf(c), { kind: 'person', fio: 'Иванова Мария Петровна', birthDate: '1961-04-02',
      address: '357500, Ставропольский край, г. Пятигорск, ул. Примерная, д. 1, кв. 1' });
    Object.assign(S.counterpartyOf(c, d), { fio: 'Петрова Анна Сергеевна', address: '357500, Ставропольский край, г. Пятигорск, ул. Образцовая, д. 2, кв. 3' });
    Object.assign(d, { date: '2022-06-15', number: '1', amount: '150000',
      subject: 'квартира площадью 48,2 кв. м по адресу: Ставропольский край, г. Пятигорск, ул. Примерная, д. 1, кв. 1' });
    d.object = Object.assign(S.newObject('other'), { description: d.subject });
    Object.assign(d.valuation, { contractPrice: '150000', marketValue: '1850000', decision: 'от 01.07.2025 № 1' });
    d.baseGrounds = ['unequal', 'harm'];
    d.qa = { h_insolvent: 'yes', h_use: 'yes', a_related: 'yes', a_type: 'family', w_knew: 'unknown' };
    if (!db.profile.name) Object.assign(db.profile, { name: 'Сидоров Сергей Иванович', sro: 'Ассоциация «Пример СРО»',
      address: '355000, г. Ставрополь, а/я 1' });
    applyAnswers(c, d);
    writeNow();
    openDeal(c, d, 1);
  }

  /* ================= отрисовка ================= */

  function applyTheme() {
    const t = db.ui.theme;
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
  }

  let lastKey = '';
  function render() {
    renderBar();
    if (ui.view === 'home' || ui.view === 'list') dropEmpty();
    $('#app').innerHTML = ui.view === 'list' ? screenList() : ui.view === 'profile' ? screenProfile()
      : ui.view === 'backup' ? screenBackup() : ui.view === 'deal' ? screenDeal() : screenHome();
    $('#dock').innerHTML = dock();
    const key = ui.view + ui.step + ui.dealId;
    if (key !== lastKey) window.scrollTo(0, 0);
    lastKey = key;
    bindDrop();
  }

  // Живые места, которые пересчитываются по ходу ввода без перерисовки формы.
  function debtorCard(debtor) {
    return `<b>${esc(S.partyName(debtor) || '—')}</b>
              <div class="small muted">${debtor && debtor.inn ? 'ИНН ' + esc(debtor.inn) : 'из блока выше'}</div>`;
  }

  function refreshLive() {
    const c = kase(), d = deal();
    if (!c || !d) return;
    const dc = $('#debtor-card'); if (dc) dc.innerHTML = debtorCard(S.debtorOf(c));
    const v = $('#verdict'); if (v) v.innerHTML = verdict(d);
    const h = $('#hint'); if (h) h.innerHTML = hintPanel(c, d);
  }

  function bindDrop() {
    const zone = $('#drop');
    if (!zone) return;
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); addFiles([...(e.dataTransfer.files || [])]); });
  }

  /* ================= события ================= */

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!el.dataset.bind) return;
    const val = el.dataset.kind === 'money' ? normMoney(el.value) : el.value;
    setPath(el.dataset.bind, val);
    const c = kase(), d = deal();
    // «Что передано» — одна строка и для предмета, и для описания объекта.
    if (el.dataset.bind === 'deal.subject' && d) d.object = Object.assign(S.newObject('other'), { description: val });
    if ((el.dataset.bind === 'case.court' || el.dataset.bind === 'case.procedureDate') && c) autoAct(c);
    const f = el.closest('.f.miss');
    if (f && val) { f.classList.remove('miss'); const m = $('.help.m', f); if (m) m.remove(); }
    save();
    refreshLive();
  });

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!el.dataset.bind) return;
    if (el.dataset.kind === 'money') { el.value = normMoney(el.value); setPath(el.dataset.bind, el.value); }
    else setPath(el.dataset.bind, el.value);
    const c = kase(), d = deal();
    if (el.dataset.bind.startsWith('deal.qa.') && c && d) applyAnswers(c, d);
    if ((el.dataset.bind === 'case.court' || el.dataset.bind === 'case.procedureDate') && c) autoAct(c);
    writeNow();
    if (el.tagName === 'SELECT') render(); else refreshLive();
  });

  document.addEventListener('click', (e) => {
    if (ui.menu && !e.target.closest('.menu') && !e.target.closest('[data-act="menu"]')) { ui.menu = null; renderBar(); }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act, id = b.dataset.id;
    const c = kase(), d = deal();

    switch (act) {
      case 'menu': ui.menu = ui.menu === id ? null : id; renderBar(); break;
      case 'home': ui = Object.assign(ui, { view: 'home', menu: null }); render(); break;
      case 'go': {
        ui.menu = null;
        ui.view = id === 'settings' ? 'profile' : id;
        render();
        if (id === 'settings') $('#settings').scrollIntoView({ block: 'start' });
        break;
      }
      case 'new': { const r = newDeal(); writeNow(); openDeal(r.c, r.d, 1); break; }
      case 'open': {
        const k = db.cases.find((x) => x.id === b.dataset.case);
        const dd = k && k.deals.find((x) => x.id === b.dataset.deal);
        if (dd) openDeal(k, dd, dd.formedAt ? 5 : 1);
        break;
      }
      case 'del-deal':
        confirmBox('Удалить сделку? Восстановить её можно будет только из резервной копии.', () => {
          const k = db.cases.find((x) => x.id === b.dataset.case);
          if (k) k.deals = k.deals.filter((x) => x.id !== b.dataset.deal);
          db.cases = db.cases.filter((x) => x.deals.length);
          writeNow(); render();
        }, 'Удалить');
        break;
      case 'demo': ui.menu = null; demo(); break;
      case 'old-app': location.href = 'index.html'; break;
      case 'wipe':
        ui.menu = null;
        confirmBox('Удалить все данные прототипа? Рабочее приложение это не затронет.', () => {
          const theme = db.ui.theme;
          db = S.newDb(); db.ui = { theme: theme, lastBackup: null, savedAt: null };
          ui = { view: 'home', step: 1, caseId: null, dealId: null, menu: null, tried: [] };
          writeNow(); render();
        }, 'Очистить');
        break;

      case 'back':
        if (ui.view !== 'deal') { ui.view = 'home'; render(); break; }
        if (ui.step <= 1) { ui.view = 'home'; render(); break; }
        ui.step = ui.step === 6 ? 5 : ui.step - 1; render();
        break;
      case 'next':
        if (!ui.tried.includes(ui.step)) ui.tried.push(ui.step);
        ui.step = Math.min(5, ui.step + 1); writeNow(); render();
        break;
      case 'step': ui.view = 'deal'; ui.step = Number(id); render(); break;
      case 'save': writeNow(); toast('Сохранено'); break;
      case 'form': {
        const v = S.validate(db, c, d, stmt(d));
        const go = () => { d.formedAt = new Date().toISOString(); writeNow(); ui.step = 6; render(); };
        if (!(d.baseGrounds || []).length) { ui.tried.push(2); ui.step = 2; render(); note('Выберите основание оспаривания — без него заявление не собрать.'); break; }
        if (v.errors.length) confirmBox('Не указано: ' + v.errors.map((x) => x.field.toLowerCase()).join(', ') + '. В документе на этих местах будут прочерки. Сформировать всё равно?', go, 'Сформировать');
        else go();
        break;
      }

      case 'import-form': importForm(); break;
      case 'cp-kind': { const cp = S.counterpartyOf(c, d); if (cp) { cp.kind = id; writeNow(); render(); } break; }
      case 'ground': {
        const set = new Set(d.baseGrounds || []);
        if (set.has(id)) set.delete(id); else set.add(id);
        d.baseGrounds = GROUNDS.map((g) => g.id).filter((g) => set.has(g));
        applyAnswers(c, d); writeNow(); render();
        break;
      }
      case 'more-grounds': ui.showExtra = true; render(); break;
      case 'qa': {
        d.qa = d.qa || {};
        d.qa[b.dataset.q] = b.dataset.v;
        if (b.dataset.q === 'a_related' && b.dataset.v === 'yes' && !d.qa.a_type) d.qa.a_type = 'family';
        applyAnswers(c, d); writeNow(); render();
        break;
      }
      case 'gratuitous': d.valuation.gratuitous = id === 'true'; syncBlocks(c, d); writeNow(); render(); break;
      case 'pick-files': pickFiles('.pdf,.jpg,.jpeg,.png,.docx', true).then(addFiles); break;
      case 'add-doc': d.documents.push(Object.assign(S.newDocument(), { type: 'other', proves: '' })); writeNow(); render(); break;
      case 'del-doc': d.documents.splice(Number(id), 1); writeNow(); render(); break;

      case 'download': download(); break;
      case 'preview':
        modal(`<div style="display:flex;align-items:center;gap:10px"><h3 style="flex:1">Предпросмотр</h3>
          <button class="btn sm" data-act="download">${icon('down')}Скачать</button><button class="btn sm" data-close>Закрыть</button></div>
          <div class="paper">${sheetHtml(c, d)}</div>`, true);
        break;

      case 'theme': db.ui.theme = id; applyTheme(); writeNow(); render(); break;
      case 'backup-save': {
        const stamp = new Date().toISOString();
        db.ui.lastBackup = stamp;
        const bytes = new TextEncoder().encode(JSON.stringify(db, null, 1));
        X.download(bytes, 'СделкоСпар — резервная копия ' + stamp.slice(0, 10) + '.json', 'application/json');
        writeNow(); render();
        break;
      }
      case 'backup-load':
        pickFiles('.json,application/json').then(async ([file]) => {
          if (!file) return;
          let next;
          try { next = JSON.parse(await file.text()); } catch (err) { return note('Файл не читается как резервная копия.'); }
          if (!next || !Array.isArray(next.cases)) return note('Это не резервная копия СделкоСпара.');
          confirmBox('Заменить текущие данные данными из файла? Сейчас в прототипе сделок: ' + allDeals().length + '.', () => {
            db = S.migrate(next);
            db.ui = Object.assign({ theme: 'system', lastBackup: null, savedAt: null }, next.ui || {});
            applyTheme(); writeNow(); ui.view = 'home'; render(); toast('Данные восстановлены');
          }, 'Заменить');
        });
        break;
    }
  });

  applyTheme();
  render();
})();
