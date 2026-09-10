/*
 * Интерфейс конструктора.
 *
 * Устройство: данные вводятся один раз в карточке дела и карточке сделки,
 * дальше человек только отвечает на вопросы и отмечает блоки, а текст
 * собирается сам. Поэтому основной экран — не редактор, а анкета: формы
 * и переключатели слева, готовый документ справа.
 *
 * Разметка перерисовывается целиком на смену экрана и на смену ответа,
 * влияющего на состав полей. Набор текста перерисовку не вызывает — иначе
 * каретка прыгала бы на каждой букве.
 */
(function () {
  'use strict';

  const D = globalThis.ZData;
  const S = globalThis.ZStore;
  const X = globalThis.ZDoc;
  const IMP = globalThis.ZImport;
  const OKB = globalThis.ZOkb;
  const P = globalThis.OKBParser;

  let db = S.load();

  /* ================= служебное ================= */

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];
  const esc = (s) => String(s == null ? '' : s)
    .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const attr = (s) => esc(s).replace(/'/g, '&#39;');

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      touch();
      if (!S.save(db)) note('Не удалось сохранить: в браузере отключено локальное хранилище.');
    }, 200);
  }
  const saveNow = () => { clearTimeout(saveTimer); touch(); S.save(db); };

  /**
   * Отметка «когда дело трогали в последний раз». Ставится только при работе
   * внутри дела: на списке дел ничего не меняется, и переставлять там даты
   * от одного захода на экран значило бы врать в столбце «изменено».
   */
  function touch() {
    if (route.name === 'cases') return;
    const c = currentCase();
    if (c) c.updatedAt = new Date().toISOString();
  }

  /* ================= маршрут ================= */

  let route = { name: 'cases' };
  let tabs = { case: 'req', deal: 'main' };
  let find = '';                              // строка поиска в реестре дел
  let sort = { by: 'updated', dir: 'desc' };  // сортировка реестра
  let openBlocks = new Set();

  function parseHash() {
    const raw = String(location.hash || '').replace(/^#\/?/, '');
    const p = raw.split('/').filter(Boolean).map(decodeURIComponent);
    if (!p.length) return { name: 'cases' };
    if (p[0] === 'case' && p[1]) return { name: 'case', caseId: p[1] };
    if (p[0] === 'deal' && p[2]) return { name: 'deal', caseId: p[1], dealId: p[2] };
    if (p[0] === 'builder' && p[2]) return { name: 'builder', caseId: p[1], dealId: p[2], docId: p[3] || '' };
    if (p[0] === 'blocks') return { name: 'blocks' };
    return { name: 'cases' };
  }

  const go = (hash) => { location.hash = hash; };

  const currentCase = () => db.cases.find((c) => c.id === route.caseId) || null;
  const currentDeal = () => {
    const c = currentCase();
    return c ? (c.deals.find((d) => d.id === route.dealId) || null) : null;
  };

  /** Документ, открытый в конструкторе. Без идентификатора — первый (заявление). */
  const currentDoc = () => {
    const d = currentDeal();
    if (!d) return null;
    return (route.docId && S.findStatement(d, route.docId)) || S.mainStatement(d);
  };

  /* ================= привязка полей ================= */

  let editParty = null, editDoc = null, editBlock = null;

  function roots() {
    return {
      db: db, profile: db.profile,
      case: currentCase(), deal: currentDeal(),
      party: editParty, doc: editDoc, block: editBlock
    };
  }

  function resolve(path) {
    const seg = String(path).split('.');
    let o = roots()[seg[0]];
    for (let i = 1; i < seg.length - 1 && o; i++) o = o[seg[i]];
    return o ? { obj: o, key: seg[seg.length - 1] } : null;
  }

  const getPath = (path) => {
    const r = resolve(path);
    return r ? r.obj[r.key] : '';
  };

  function setPath(path, value) {
    const r = resolve(path);
    if (r) r.obj[r.key] = value;
  }

  /** «8 400 000,55» и «8400000.55» — одно и то же число. */
  const normMoney = (s) => String(s).replace(/\s|\u00A0/g, '').replace(',', '.');

  // Крупные суммы на плитках печатаются без копеек: две лишние цифры в кегле
  // 56 px забирают половину строки и ничего не добавляют.
  const nfInt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
  const money0 = (v) => (v === '' || v == null || !isFinite(v)) ? '—' : nfInt.format(Math.round(Number(v)));

  /* ================= элементы формы ================= */

  function field(o) {
    const type = o.type || 'text';
    const val = o.value != null ? o.value : getPath(o.bind);
    if (o.readonly) {
      return `<div class="f${o.wide ? ' wide' : ''}"><label class="lb">${esc(o.label)}</label>` +
        `<input type="text" value="${attr(val)}" readonly tabindex="-1" ` +
        `style="background:var(--surface-2);color:var(--ink-2)"></div>`;
    }
    const req = o.required ? ' <span class="req">*</span>' : '';
    const cls = 'f' + (o.wide ? ' wide' : '');
    const bad = o.bad ? ' bad' : '';
    let control;

    if (type === 'select') {
      control = `<select data-bind="${attr(o.bind)}" class="${bad}">` +
        o.options.map((op) => `<option value="${attr(op.id)}"${String(op.id) === String(val) ? ' selected' : ''}>` +
          esc(op.name) + '</option>').join('') + '</select>';
    } else if (type === 'textarea') {
      control = `<textarea data-bind="${attr(o.bind)}" rows="${o.rows || 3}" ` +
        `placeholder="${attr(o.placeholder || '')}"${o.grow ? ' data-grow="1"' : ''}>${esc(val)}</textarea>`;
    } else {
      const kind = o.money ? ' data-kind="money"' : '';
      const list = o.list ? ` list="${attr(o.list)}"` : '';
      control = `<input type="${type}" data-bind="${attr(o.bind)}" value="${attr(val)}" ` +
        `placeholder="${attr(o.placeholder || '')}" class="${bad}"${kind}${list}>`;
    }

    return `<div class="${cls}"><label class="lb">${esc(o.label)}${req}</label>${control}` +
      (o.hint ? `<p class="hint">${esc(o.hint)}</p>` : '') + '</div>';
  }

  /** Переключатель «или — или» таблетками: и на телефоне попадаешь пальцем. */
  function radios(bind, options, value) {
    return '<div class="radios">' + options.map((op) =>
      `<label class="radio${String(op.id) === String(value) ? ' on' : ''}">` +
      `<input type="radio" data-bind="${attr(bind)}" value="${attr(op.id)}"` +
      (String(op.id) === String(value) ? ' checked' : '') + `>${esc(op.name)}</label>`).join('') + '</div>';
  }

  const yesNo = (bind, value) => radios(bind, [{ id: 'yes', name: 'Да' }, { id: 'no', name: 'Нет' }], value ? 'yes' : 'no');

  function checkList(bind, options, selected) {
    const set = new Set(selected || []);
    return options.map((op) =>
      `<label class="chk"><input type="checkbox" data-arr="${attr(bind)}" value="${attr(op.id)}"` +
      (set.has(op.id) ? ' checked' : '') + `><span>${esc(op.name)}</span></label>`).join('');
  }

  const dataList = (id, items) =>
    `<datalist id="${id}">` + items.map((s) => `<option value="${attr(s)}">`).join('') + '</datalist>';

  /* ================= экран «Мои дела» ================= */

  /** Сводка по делу: на неё опираются и карточка, и плитки. */
  function caseStats(c) {
    const ready = c.deals.filter((d) => S.mainStatement(d).status === 'ready').length;
    return { deals: c.deals.length, ready: ready, draft: c.deals.length - ready, parties: c.parties.length };
  }

  /**
   * Главная — реестр дел.
   *
   * Это экран, на который возвращаются каждый день, а не витрина. Поэтому
   * здесь нет ни крупных цифр, ни рассказа о том, как работает приложение:
   * человек, который его открыл, уже внутри. Есть то, что нужно в работе, —
   * поиск, сортировка и плотный список, где на экран помещается три десятка
   * дел, а не четыре.
   */
  function screenCases() {
    if (!db.cases.length) return casesEmpty();

    const total = db.cases.reduce((a, c) => {
      const s = caseStats(c);
      return { deals: a.deals + s.deals, ready: a.ready + s.ready, draft: a.draft + s.draft };
    }, { deals: 0, ready: 0, draft: 0 });

    const summary = [
      db.cases.length + ' ' + D.plural(db.cases.length, 'дело', 'дела', 'дел'),
      total.deals + ' ' + D.plural(total.deals, 'сделка', 'сделки', 'сделок'),
      total.draft + ' ' + D.plural(total.draft, 'черновик', 'черновика', 'черновиков')
    ].join(' · ');

    return `<div class="reg">
      <div class="reg-top">
        <div>
          <h1>Мои дела</h1>
          <p class="m">${esc(summary)}</p>
        </div>
        <div class="reg-act">
          <button class="btn" data-act="import-form">Загрузить печатную форму</button>
          <button class="btn pri" data-act="new-case">Новое дело</button>
        </div>
      </div>
      <input class="find" id="find" type="search" value="${attr(find)}"
        placeholder="Номер дела или фамилия должника" autocomplete="off">
      <div class="reg-body" id="reg-body">${casesTable()}</div>
    </div>`;
  }

  /* Столбцы реестра объявлены данными: заголовок, выравнивание и то, по
     какому значению столбец сортируется. Иначе порядок в шапке и порядок
     в строке однажды разъедутся. */
  const COLUMNS = [
    { id: 'number', name: '№ дела', get: (c) => c.number || '' },
    { id: 'debtor', name: 'Должник', get: (c) => S.partyName(S.debtorOf(c)) || '' },
    { id: 'court', name: 'Суд', get: (c) => c.court || '' },
    { id: 'deals', name: 'Сделок', r: true, get: (c) => caseStats(c).deals },
    { id: 'ready', name: 'Готово', r: true, get: (c) => caseStats(c).ready },
    { id: 'updated', name: 'Изменено', r: true, get: (c) => c.updatedAt || c.createdAt || '' }
  ];

  /** Все суды здесь арбитражные — слова «Арбитражный суд» в каждой строке лишние. */
  const shortCourt = (name) => String(name || '').replace(/^Арбитражный\s+суд\s+/i, '');

  /** «сегодня», «вчера», дальше — датой: точность до минуты тут не нужна. */
  function whenShort(iso) {
    if (!iso) return '—';
    const day = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    const diff = Math.round((day(new Date()) - day(new Date(iso))) / 86400000);
    if (diff <= 0) return 'сегодня';
    if (diff === 1) return 'вчера';
    if (diff < 7) return diff + ' ' + D.plural(diff, 'день', 'дня', 'дней') + ' назад';
    return D.dateShort(iso.slice(0, 10));
  }

  function casesFiltered() {
    const q = find.trim().toLowerCase();
    const hit = (c) => !q || [c.number, S.partyName(S.debtorOf(c)), c.court]
      .some((v) => String(v || '').toLowerCase().includes(q));
    const col = D.byId(COLUMNS, sort.by) || COLUMNS[5];
    const sign = sort.dir === 'asc' ? 1 : -1;
    return db.cases.filter(hit).slice().sort((a, b) => {
      const x = col.get(a), y = col.get(b);
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * sign;
      return String(x).localeCompare(String(y), 'ru') * sign;
    });
  }

  function casesTable() {
    const rows = casesFiltered();
    if (!rows.length) {
      return `<p class="hint" style="padding:18px 2px">По запросу «${esc(find)}» ничего не нашлось.</p>`;
    }
    const head = COLUMNS.map((col) =>
      `<th${col.r ? ' class="r"' : ''}><button class="sortb${sort.by === col.id ? ' on' : ''}"
        data-sort="${col.id}">${esc(col.name)}${sort.by === col.id ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}</button></th>`).join('');

    const body = rows.map((c) => {
      const s = caseStats(c);
      const debtor = S.partyName(S.debtorOf(c));
      return `<tr class="click" data-go="#/case/${c.id}">
        <td data-l="№ дела"><span class="no">${esc(c.number || 'без номера')}</span></td>
        <td data-l="Должник"><b>${esc(debtor || 'не указан')}</b></td>
        <td data-l="Суд" class="sub" title="${attr(c.court)}">${esc(shortCourt(c.court) || '—')}</td>
        <td class="r" data-l="Сделок">${s.deals || '—'}</td>
        <td class="r" data-l="Готово">${s.ready ? s.ready : (s.deals ? '<span class="sub">0</span>' : '—')}</td>
        <td class="r sub" data-l="Изменено">${esc(whenShort(c.updatedAt || c.createdAt))}</td>
      </tr>`;
    }).join('');

    return `<table class="reg-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  }

  /** Пустой экран показывается ровно один раз — до первого дела. */
  function casesEmpty() {
    return `<div class="reg">
      <div class="reg-top"><div><h1>Мои дела</h1>
        <p class="m">Пока ни одного дела.</p></div></div>
      <button class="drop" data-act="import-form">
        <b>Загрузите печатную форму</b>
        <span>Суд, номер дела, должник и управляющий подставятся сами</span>
      </button>
      <p class="m" style="margin-top:14px">Дело можно завести и вручную:
        <button class="linkbtn" data-act="new-case">новое дело</button>.
        Всё хранится в этом браузере — сервера у приложения нет, реквизиты должников
        и контрагентов никуда не отправляются, страница работает и без интернета.</p>
    </div>`;
  }

  /* ================= экран дела ================= */

  const tab = (screen, id, name, count) =>
    `<button class="tab${tabs[screen] === id ? ' on' : ''}" data-tab="${screen}:${id}">${name}` +
    (count == null ? '' : `<span class="n">${count}</span>`) + '</button>';

  function screenCase() {
    const c = currentCase();
    if (!c) return notFound();
    const debtor = S.debtorOf(c);
    const s = caseStats(c);
    const pct = s.deals ? Math.round(s.ready / s.deals * 100) : 0;

    const head = `<div class="scr">
        <div class="scr-top">
          <div>
            <h1>${esc(S.partyName(debtor) || 'Должник не указан')}</h1>
            <p class="m">${esc(c.number || 'номер дела не указан')} · ${esc(D.nameOf(D.PROCEDURES, c.procedure))}${c.court ? ' · ' + esc(c.court) : ''}</p>
          </div>
          <div class="scr-act">
            <button class="btn pri" data-act="new-deal">Добавить сделку</button>
            <button class="btn" data-act="import-form">Обновить из печатной формы</button>
            <button class="btn danger" data-act="del-case">Удалить дело</button>
          </div>
        </div>

        <dl class="facts">
          <div><dt>Сделок</dt><dd>${s.deals || '—'}</dd></div>
          <div><dt>Заявлений готово</dt><dd>${s.ready || '—'}</dd></div>
          <div><dt>Черновиков</dt><dd>${s.draft || '—'}</dd></div>
          <div><dt>Сторон</dt><dd>${s.parties}</dd></div>
          <div><dt>Готовность</dt><dd>${s.deals ? pct + ' %' : '—'}</dd></div>
          <div class="wide"><dt>Кредитный отчёт ОКБ</dt><dd>${c.okb
            ? esc((c.okb.contracts || []).length + ' ' + D.plural((c.okb.contracts || []).length, 'обязательство', 'обязательства', 'обязательств')) +
              (c.okb.reportDate ? ' · от ' + esc(D.dateShort(c.okb.reportDate)) : '') +
              ' <button class="linkbtn" data-act="import-okb">заменить</button>' +
              ' <button class="linkbtn" data-act="drop-okb">убрать</button>'
            : 'не загружен <button class="linkbtn" data-act="import-okb">загрузить</button>'}</dd></div>
        </dl>
      </div>

      <div class="tabs">
        ${tab('case', 'req', 'Дело')}
        ${tab('case', 'deals', 'Сделки', c.deals.length)}
      </div>`;

    // Стороны и счета были отдельными вкладками. Ни то, ни другое не экран:
    // это два раздела реквизитов, и счета вдобавок нужны одному документу
    // из трёх. Убраны в свёрнутые разделы — открываются, когда нужны.
    const body = tabs.case === 'deals' ? caseDealsTab(c) : caseReqTab(c, debtor);

    return head + body;
  }

  function caseReqTab(c, debtor) {
    return `<div class="card">
        <h3>Суд и дело</h3>
        <div class="form">
          ${field({ label: 'Арбитражный суд', bind: 'case.court', required: true, placeholder: 'Арбитражный суд города Москвы' })}
          ${field({ label: 'Номер дела', bind: 'case.number', required: true, placeholder: 'А40-000000/2025' })}
          ${field({ label: 'Адрес суда', bind: 'case.courtAddress', wide: true })}
          ${field({ label: 'Процедура', bind: 'case.procedure', type: 'select', options: D.PROCEDURES })}
          ${field({ label: 'Дата введения процедуры', bind: 'case.procedureDate', type: 'date' })}
          ${field({ label: 'Дата возбуждения дела', bind: 'case.caseStartDate', type: 'date', hint: 'От неё считаются периоды подозрительности' })}
          ${field({ label: 'Реквизиты судебного акта', bind: 'case.judicialAct', wide: true, placeholder: 'Решением Арбитражного суда города Москвы от 12.03.2025 по делу № А40-000000/2025' })}
          ${field({ label: 'Должник в родительном падеже', bind: 'case.debtorNameGen', wide: true,
            placeholder: D.genitiveFio(S.partyName(S.debtorOf(c))) || 'Ивановой Марии Петровны',
            hint: 'Для строки «управляющий имуществом должника …». Пусто — просклоняем сами' })}
          ${field({ label: 'Размер требований кредиторов, ₽', bind: 'case.creditorsSum', money: true })}
        </div>
      </div>

      <div class="card">
        <h3>Должник</h3>
        ${partyForm(debtor, 'case.', debtorIndex(c), true)}
      </div>

      <details class="fold"${(c.parties.length > 1) ? ' open' : ''}>
        <summary>Стороны дела<span>${c.parties.length}</span></summary>
        ${casePartiesTab(c)}
      </details>

      <details class="fold"${(c.accounts || []).length ? ' open' : ''}>
        <summary>Счета должника<span>для ходатайства об отсрочке</span></summary>
        ${caseAccountsTab(c)}
      </details>

      <details class="fold">
        <summary>Финансовый управляющий<span>из профиля</span></summary>
        <div class="card">
        <p class="m">Пустые поля берутся из профиля — заполнять по каждому делу не нужно.</p>
        <div class="form">
          ${field({ label: 'ФИО', bind: 'case.managerName', placeholder: db.profile.name || 'Иванов Иван Иванович' })}
          ${field({ label: 'СРО', bind: 'case.managerSro', wide: true, placeholder: db.profile.sro || '' })}
          ${field({ label: 'ИНН', bind: 'case.managerInn', placeholder: db.profile.inn || '' })}
          ${field({ label: 'СНИЛС', bind: 'case.managerSnils', placeholder: db.profile.snils || '' })}
          ${field({ label: 'Регистрационный номер', bind: 'case.managerRegNumber', placeholder: db.profile.regNumber || '' })}
          ${field({ label: 'Адрес для корреспонденции', bind: 'case.managerAddress', wide: true, placeholder: db.profile.address || '' })}
          ${field({ label: 'Контакты', bind: 'case.managerContacts', wide: true, placeholder: db.profile.contacts || 'тел. +7 000 000-00-00, e-mail: ...' })}
          ${field({ label: 'Срок ответа на предложение о возврате, дней', bind: 'case.offerDays', placeholder: '10' })}
        </div>
        </div>
      </details>`;
  }

  const debtorIndex = (c) => c.parties.findIndex((p) => p.id === c.debtorId);

  /**
   * Форма стороны: набор полей зависит от того, кто это — организация, ИП
   * или гражданин. У должника выбора нет: приложение работает только по
   * банкротству физических лиц, и переключатель там был бы вопросом,
   * на который всегда один ответ.
   */
  function partyForm(p, prefix, index, fixedKind) {
    if (!p) return '<p class="hint">Сторона не выбрана.</p>';
    const b = prefix === 'case.' ? `case.parties.${index}.` : 'party.';
    const head = fixedKind ? '' : `<div class="f wide"><label class="lb">Тип стороны</label>
      ${radios(b + 'kind', D.PARTY_KINDS, p.kind)}</div>`;

    let body;
    if (p.kind === 'org') {
      body = field({ label: 'Полное наименование', bind: b + 'nameFull', wide: true, required: true, placeholder: 'Общество с ограниченной ответственностью «Ромашка»' }) +
        field({ label: 'Сокращённое наименование', bind: b + 'nameShort', placeholder: 'ООО «Ромашка»' }) +
        field({ label: 'ИНН', bind: b + 'inn' }) +
        field({ label: 'ОГРН', bind: b + 'ogrn' }) +
        field({ label: 'Юридический адрес', bind: b + 'addressLegal', wide: true }) +
        field({ label: 'Почтовый адрес', bind: b + 'addressPostal', wide: true }) +
        field({ label: 'Руководитель', bind: b + 'director' }) +
        field({ label: 'Представитель', bind: b + 'representative' }) +
        field({ label: 'Основание полномочий', bind: b + 'powerBasis', placeholder: 'Устав, доверенность от ...' });
    } else if (p.kind === 'ip') {
      body = field({ label: 'ФИО', bind: b + 'fio', wide: true, required: true }) +
        field({ label: 'ИНН', bind: b + 'inn' }) +
        field({ label: 'ОГРНИП', bind: b + 'ogrnip' }) +
        field({ label: 'Адрес', bind: b + 'address', wide: true });
    } else {
      body = field({ label: 'ФИО', bind: b + 'fio', wide: true, required: true }) +
        field({ label: 'Дата рождения', bind: b + 'birthDate', type: 'date' }) +
        field({ label: 'Место рождения', bind: b + 'birthPlace' }) +
        field({ label: 'ИНН', bind: b + 'inn' }) +
        field({ label: 'СНИЛС', bind: b + 'snils' }) +
        field({ label: 'Адрес регистрации', bind: b + 'address', wide: true });
    }
    return `<div class="form">${head}${body}</div>`;
  }

  function casePartiesTab(c) {
    const rows = c.parties.map((p) => {
      const isDebtor = p.id === c.debtorId;
      const used = c.deals.filter((d) => d.counterpartyId === p.id).length;
      return `<div class="party">
        <div style="min-width:0">
          <div class="nm">${esc(S.partyName(p) || 'Без наименования')}</div>
          <div class="rq">${esc(D.nameOf(D.PARTY_KINDS, p.kind))}${S.partyRequisites(p) ? ' · ' + esc(S.partyRequisites(p)) : ''}${used ? ' · в сделках: ' + used : ''}</div>
        </div>
        ${isDebtor ? '<span class="tag">Должник</span>' : ''}
        <div class="sp">
          <button class="btn btn-sm" data-act="edit-party" data-id="${p.id}">Изменить</button>
          ${isDebtor ? '' : `<button class="btn btn-sm danger" data-act="del-party" data-id="${p.id}">Удалить</button>`}
        </div>
      </div>`;
    }).join('');

    return `<div class="card">
      ${rows || '<p class="hint">Кроме должника сторон пока нет.</p>'}
      <div style="margin-top:12px"><button class="btn" data-act="new-party">Добавить сторону</button></div>
    </div>`;
  }

  /**
   * Счета должника: сведения ФНС → банки → справки об остатках.
   *
   * Порядок шагов задан самим документом. Сперва видно, где у должника
   * открыты счета, потом по каждому банку подтягивается остаток, и только
   * отмеченные банки попадают в ходатайство и в его приложения.
   */
  function caseAccountsTab(c) {
    const banks = c.accounts || [];
    const meta = c.accountsMeta;
    const total = S.accountsTotal(c);
    const on = S.included(c);

    const step1 = `<div class="card">
      <h3>Шаг 1. Сведения ФНС об открытых счетах</h3>
      ${meta ? `<p class="m">${esc(meta.file || 'файл загружен')} · страниц ${meta.pages} ·
          открытых счетов ${meta.open}${meta.closed ? ', закрытых ' + meta.closed : ''}.</p>
        ${(meta.unreadable || []).length ? `<p class="hint" style="color:var(--acc)">
          Не прочитаны страницы ${meta.unreadable.join(', ')}: скан этих страниц перевёрнут,
          и цифры на нём распознались неверно. Банки с этих страниц придётся добавить
          вручную — или они появятся сами, когда вы загрузите их справки об остатках.</p>` : ''}`
      : `<p class="m">Загрузите PDF «Сведения об открытых и закрытых счетах». Приложение
          возьмёт из него банки, в которых у должника есть <b>открытые</b> счета.
          Пара «БИК — номер счёта» принимается только если сходится ключ проверки,
          поэтому в список не попадёт банк, прочитанный неверно.</p>`}
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn ${meta ? '' : 'pri'}" data-act="import-fns">${meta ? 'Загрузить заново' : 'Загрузить сведения ФНС'}</button>
        ${meta ? '<button class="btn btn-sm danger" data-act="drop-fns">Убрать</button>' : ''}
      </div>
    </div>`;

    if (!banks.length) {
      return step1 + `<div class="empty"><b>Банков пока нет</b>
        Загрузите сведения ФНС или добавьте банк вручную.
        <div style="margin-top:16px"><button class="btn" data-act="add-bank">Добавить банк</button></div></div>`;
    }

    const rows = banks.map((b, i) => {
      return `<div class="party" style="align-items:flex-start;flex-wrap:wrap">
        <label class="chk" style="margin:6px 10px 0 0"><input type="checkbox"
          data-bind="case.accounts.${i}.include"${b.include !== false ? ' checked' : ''}><span></span></label>
        <div style="min-width:220px;flex:1">
          ${field({ bind: `case.accounts.${i}.name`, label: 'Банк', value: b.name,
            placeholder: b.bik ? 'банк с БИК ' + b.bik : 'наименование банка' })}
          <div class="rq">${b.bik ? 'БИК ' + esc(b.bik) : 'БИК не указан'}${b.inn ? ' · ИНН ' + esc(b.inn) : ''}
            ${b.open.length ? ' · открытых счетов: ' + b.open.length : ''}${b.closed.length ? ', закрытых: ' + b.closed.length : ''}
            ${b.statement ? ' · справка: ' + esc(b.statement) : ''}</div>
        </div>
        <div style="min-width:170px">
          ${field({ bind: `case.accounts.${i}.balance`, label: 'Остаток, ₽', money: true, value: b.balance,
            placeholder: '0,00', hint: b.balanceNote ? 'из справки: ' + b.balanceNote : 'из справки или вручную' })}
        </div>
        <div class="sp" style="padding-top:22px">
          <button class="btn btn-sm" data-act="import-balance" data-id="${b.id}">Справка об остатке</button>
          <button class="btn btn-sm danger" data-act="del-bank" data-id="${b.id}">Удалить</button>
        </div>
      </div>`;
    }).join('');

    const step2 = `<div class="card">
      <h3>Шаг 2. Справки банков об остатках</h3>
      <p class="m">Снятая галочка убирает банк из ходатайства и из его приложений.
        Остаток берётся из справки, если её удалось прочитать; со скана — вписывается вручную.</p>
      ${rows}
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button class="btn" data-act="add-bank">Добавить банк</button>
        <span class="m" style="margin-left:auto">В ходатайство войдёт ${on.length} ${D.plural(on.length, 'банк', 'банка', 'банков')},
          остаток ${total == null ? 'не определён' : esc(D.money(total)) + ' ₽'}.</span>
      </div>
    </div>`;

    return step1 + step2;
  }

  function caseDealsTab(c) {
    if (!c.deals.length) {
      return `<div class="empty"><b>Сделок пока нет</b>
        Добавьте сделку — приложение спросит только то, что нужно для заявления.
        <div style="margin-top:16px"><button class="btn pri" data-act="new-deal">Добавить сделку</button></div></div>`;
    }
    const rows = c.deals.map((d) => {
      const ready = S.mainStatement(d).status === 'ready';
      return `<tr class="click" data-go="#/deal/${c.id}/${d.id}">
        <td data-l="Контрагент"><b>${esc(S.partyShort(S.counterpartyOf(c, d)) || '— не выбран —')}</b></td>
        <td data-l="Тип">${esc(S.dealTypeName(d))}</td>
        <td data-l="Дата">${esc(D.dateShort(d.date) || '—')}</td>
        <td class="r" data-l="Сумма">${esc(money0(d.amount))}</td>
        <td class="sub" data-l="Документов">${(d.documents || []).length}</td>
        <td data-l="Статус"><span class="pill ${ready ? 'ready' : 'draft'}">${ready ? 'Готово' : 'Черновик'}</span></td>
      </tr>`;
    }).join('');

    return `<div class="card">
      <table><thead><tr><th>Контрагент</th><th>Тип</th><th>Дата</th><th class="r">Сумма, ₽</th>
        <th>Документов</th><th>Статус</th></tr></thead><tbody>${rows}</tbody></table>
      <div style="margin-top:14px"><button class="btn" data-act="new-deal">Добавить сделку</button></div>
    </div>`;
  }

  /* ================= экран сделки ================= */

  function screenDeal() {
    const c = currentCase(), d = currentDeal();
    if (!c || !d) return notFound();
    const cp = S.counterpartyOf(c, d);
    const debtor = S.debtorOf(c);
    const v = S.validate(db, c, d);
    const ready = S.mainStatement(d).status === 'ready';
    const docs = (d.documents || []).length;

    // Пока сделка пустая, большая плитка с прочерком вместо суммы и кнопкой
    // «Открыть конструктор» только мешает: показываем, что делать дальше.
    const started = (d.grounds || []).length > 0;
    const grounds = S.groundNames(d);

    const head = started
      ? `<div class="scr">
        <div class="scr-top">
          <div>
            <h1>${esc(S.dealTypeName(d))}${d.number ? ' № ' + esc(d.number) : ''}</h1>
            <p class="m">${esc(S.partyShort(debtor) || 'должник')} → ${esc(S.partyShort(cp) || 'контрагент не выбран')}${d.date ? ' · ' + esc(D.dateShort(d.date)) : ''}</p>
          </div>
          <div class="scr-act">
            <button class="btn pri" data-go="#/builder/${c.id}/${d.id}">Открыть конструктор</button>
            <button class="btn" data-act="clone-deal">Создать на основе этой</button>
            <button class="btn danger" data-act="del-deal">Удалить сделку</button>
          </div>
        </div>

        <dl class="facts">
          <div><dt>Сумма сделки</dt><dd>${d.amount !== '' && d.amount != null ? esc(money0(d.amount)) + ' ₽' : '—'}</dd></div>
          <div><dt>Дата</dt><dd>${esc(D.dateShort(d.date) || '—')}</dd></div>
          <div><dt>Объект</dt><dd>${esc(D.nameOf(D.OBJECT_TYPES, d.object.kind))}</dd></div>
          <div><dt>Документов</dt><dd>${docs || '—'}</dd></div>
          <div><dt>Заявление</dt><dd>${ready ? 'готово' : 'черновик'}${v.errors.length
            ? ', <span class="bad">не заполнено ' + v.errors.length + '</span>' : ''}</dd></div>
          <div class="wide"><dt>Основание оспаривания</dt>
            <dd>${esc(grounds.map((g) => g.name).join('; ')) || '<span class="bad">не выбрано</span>'}</dd></div>
        </dl>
      </div>`
      : `<div class="scr">
        <div class="scr-top">
          <div>
            <h1>Новая сделка</h1>
            <p class="m">Выберите ниже, по какому пункту оспариваете сделку. От этого зависят
              и разделы заявления, и то, какие вопросы приложение задаст дальше.</p>
          </div>
          <div class="scr-act">
            <button class="btn danger" data-act="del-deal">Удалить сделку</button>
          </div>
        </div>
      </div>`;

    const tail = `
      <div class="tabs">
        ${tab('deal', 'main', 'Сделка')}
        ${tab('deal', 'docs', 'Документы', docs)}
      </div>`;

    /*
     * Шесть вкладок стали двумя. Основание, объект, обстоятельства и стороны
     * были не экранами, а разделами одной анкеты, которую и заполняют сверху
     * вниз за один заход; пошлина считается по документу, поэтому стоит там,
     * где документы. Прыгать между шестью вкладками, чтобы описать одну
     * сделку, — это и есть «слишком много шагов».
     */
    const body = tabs.deal === 'docs'
      ? dealFeeTab(d) + dealDocsTab(d) + dealPapers(c, d)
      : dealGroundTab(d) + (started
        ? dealMainTab(d) + dealPartiesTab(c, d) + dealObjectTab(d) + dealCircTab(d)
        : '');

    return head + tail + body;
  }

  /**
   * Документы сделки: заявление, ходатайство об отсрочке пошлины, предложение
   * о возврате. Каждый собирается своими блоками, но данные берёт из той же
   * сделки — вводить их повторно не нужно.
   */
  function dealPapers(c, d) {
    const rows = d.statements.map((st) => {
      const kind = S.kindOf(st);
      const check = S.validate(db, c, d, st);
      const on = st.blocks.filter((b) => b.enabled).length;
      return `<div class="party">
        <div style="min-width:0">
          <div class="nm">${esc(kind.name)}</div>
          <div class="rq">${on ? on + ' ' + D.plural(on, 'блок', 'блока', 'блоков') + ' включено' : 'ещё не собран'}${st.versions.length ? ' · версий: ' + st.versions.length : ''}${check.errors.length ? ' · не заполнено: ' + check.errors.length : ''}</div>
        </div>
        <span class="pill ${st.status === 'ready' ? 'ready' : 'draft'}">${st.status === 'ready' ? 'Готово' : 'Черновик'}</span>
        <div class="sp">
          <button class="btn btn-sm pri" data-go="#/builder/${c.id}/${d.id}/${st.id}">Открыть</button>
          ${st.kind === 'statement' ? '' : `<button class="btn btn-sm danger" data-act="del-doc-kind" data-id="${st.id}">Убрать</button>`}
        </div>
      </div>`;
    }).join('');

    const missing = D.DOC_KINDS.filter((k) => !d.statements.some((st) => st.kind === k.id));

    return `<div class="card">
      <h3>Документы по сделке</h3>
      <p class="m">Реквизиты дела, сделки и расчёт пошлины у всех документов общие —
        вводятся один раз.</p>
      ${rows}
      ${missing.length ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        ${missing.map((k) => `<button class="btn" data-act="add-doc-kind" data-id="${k.id}">${esc(k.short)}</button>`).join('')}
      </div>` : ''}
    </div>`;
  }

  /**
   * Шаг первый: по какому пункту оспариваем. От ответа зависит и состав
   * заявления, и то, какие вопросы вообще будут заданы дальше, — поэтому
   * выбор стоит здесь, а не прячется за пятью вопросами «да / нет».
   */
  function dealGroundTab(d) {
    const chosen = new Set(d.grounds || []);
    const cards = D.GROUNDS.map((g) => `<label class="ground${chosen.has(g.id) ? ' on' : ''}">
      <input type="checkbox" data-act="toggle-ground" data-id="${g.id}"${chosen.has(g.id) ? ' checked' : ''}>
      <span class="gb">
        <b>${esc(g.name)}</b>
        <span class="law">${esc(g.law)}</span>
        <span class="m">${esc(g.hint)}</span>
      </span>
    </label>`).join('');

    return `<div class="card">
      <h3>По какому основанию оспариваем сделку?</h3>
      <p class="m">Можно выбрать несколько. Выбранные основания включат нужные разделы
        заявления и оставят в анкете только те вопросы, которые к ним относятся.</p>
      <div class="grounds">${cards}</div>
      ${chosen.size ? ''
        : '<div class="note calm" style="margin:16px 0 0">Пока основание не выбрано, ' +
          'ниже нечего спрашивать: набор вопросов зависит от него.</div>'}
    </div>`;
  }

  function dealMainTab(d) {
    return `<div class="card">
      <h3>Основные сведения</h3>
      <p class="m">Тип сделки определяет формулировки в заявлении. Остальные поля появятся по ходу.</p>
      <div class="form">
        ${field({ label: 'Тип сделки', bind: 'deal.type', type: 'select', options: D.DEAL_TYPES, required: true })}
        ${d.type === 'other' ? field({ label: 'Наименование сделки', bind: 'deal.typeOther', placeholder: 'соглашение о ...' }) : ''}
        ${field({ label: 'Дата сделки', bind: 'deal.date', type: 'date', required: true })}
        ${field({ label: 'Номер договора', bind: 'deal.number' })}
        ${field({ label: 'Дата договора', bind: 'deal.contractDate', type: 'date', hint: 'Если отличается от даты сделки' })}
        ${field({ label: 'Сумма сделки', bind: 'deal.amount', money: true, required: true })}
        ${field({ label: 'Валюта', bind: 'deal.currency', type: 'select', options: D.CURRENCIES })}
        ${field({ label: 'Предмет сделки', bind: 'deal.subject', type: 'textarea', wide: true, rows: 2, placeholder: 'Если не заполнено — соберётся из сведений об объекте' })}
      </div>
    </div>`;
  }

  function dealPartiesTab(c, d) {
    const options = [{ id: '', name: '— выберите сторону —' }]
      .concat(c.parties.filter((p) => p.id !== c.debtorId)
        .map((p) => ({ id: p.id, name: S.partyName(p) || 'без наименования' })));
    const cp = S.counterpartyOf(c, d);
    const debtor = S.debtorOf(c);

    return `<div class="card">
      <h3>Стороны сделки</h3>
      <p class="m">Должник подставляется из дела. Контрагент выбирается из участников — повторно
        вводить реквизиты не нужно.</p>
      <div class="party">
        <div style="min-width:0">
          <div class="nm">${esc(S.partyName(debtor) || 'Должник не заполнен')}</div>
          <div class="rq">${esc(S.partyRequisites(debtor))}</div>
        </div>
        <span class="tag">Должник</span>
        <div class="sp"><button class="btn btn-sm" data-act="edit-party" data-id="${debtor ? debtor.id : ''}">Изменить</button></div>
      </div>
      <div class="form" style="margin-top:14px">
        ${field({ label: 'Контрагент (ответчик)', bind: 'deal.counterpartyId', type: 'select', options: options, required: true, wide: true })}
      </div>
      ${cp ? `<div class="party" style="margin-top:10px">
          <div style="min-width:0">
            <div class="nm">${esc(S.partyName(cp))}</div>
            <div class="rq">${esc(D.nameOf(D.PARTY_KINDS, cp.kind))}${S.partyRequisites(cp) ? ' · ' + esc(S.partyRequisites(cp)) : ''}${S.partyAddress(cp) ? ' · ' + esc(S.partyAddress(cp)) : ''}</div>
          </div>
          <div class="sp"><button class="btn btn-sm" data-act="edit-party" data-id="${cp.id}">Изменить</button></div>
        </div>` : ''}
      <div style="margin-top:12px"><button class="btn" data-act="new-party">Новая сторона</button></div>
    </div>`;
  }

  /** Динамическая форма объекта (§3): показываем только то, что относится к выбранному типу. */
  function dealObjectTab(d) {
    const o = d.object;
    let body;
    if (o.kind === 'realty') {
      body = field({ label: 'Вид объекта', bind: 'deal.object.realtyKind', list: 'realty-kinds', placeholder: 'Квартира' }) +
        field({ label: 'Кадастровый номер', bind: 'deal.object.cadastral' }) +
        field({ label: 'Адрес', bind: 'deal.object.address', wide: true }) +
        field({ label: 'Площадь, кв. м', bind: 'deal.object.area' }) +
        field({ label: 'Назначение', bind: 'deal.object.purpose' }) +
        field({ label: 'Иные характеристики', bind: 'deal.object.features', type: 'textarea', wide: true, rows: 2 });
    } else if (o.kind === 'vehicle') {
      body = field({ label: 'Марка', bind: 'deal.object.brand' }) +
        field({ label: 'Модель', bind: 'deal.object.model' }) +
        field({ label: 'VIN', bind: 'deal.object.vin' }) +
        field({ label: 'Государственный номер', bind: 'deal.object.plate' }) +
        field({ label: 'Год выпуска', bind: 'deal.object.year' });
    } else if (o.kind === 'money') {
      body = field({ label: 'Сумма платежа, ₽', bind: 'deal.object.sum', money: true }) +
        field({ label: 'Дата платежа', bind: 'deal.object.payDate', type: 'date' }) +
        field({ label: 'Номер платёжного поручения', bind: 'deal.object.orderNumber' }) +
        field({ label: 'Счёт отправителя', bind: 'deal.object.accountFrom' }) +
        field({ label: 'Счёт получателя', bind: 'deal.object.accountTo' }) +
        field({ label: 'Назначение платежа', bind: 'deal.object.purposeText', type: 'textarea', wide: true, rows: 2 });
    } else {
      body = field({ label: 'Описание объекта', bind: 'deal.object.description', type: 'textarea', wide: true, rows: 4 });
    }

    return `<div class="card">
      <h3>Объект сделки</h3>
      <p class="m">Что именно выбыло из имущества должника.</p>
      <div class="form"><div class="f wide"><label class="lb">Тип объекта</label>
        ${radios('deal.object.kind', D.OBJECT_TYPES, o.kind)}</div></div>
      <div class="form step" style="margin-top:14px">
        ${body}
        ${field({ label: 'Стоимость объекта, ₽', bind: 'deal.object.value', money: true, hint: 'Если не указана — берётся сумма сделки' })}
      </div>
      ${dataList('realty-kinds', D.REALTY_KINDS)}
      <div class="note calm" style="margin:14px 0 0">Так объект попадёт в заявление:
        <b>${esc(S.objectDescription(d) || '— пока пусто —')}</b></div>
    </div>`;
  }

  /**
   * Итог сравнения цены и оценки. Считается на месте: эти цифры уйдут
   * в заявление, и увидеть их человек должен здесь, а не в готовом документе.
   */
  function valuationVerdict(d) {
    const gap = S.valueGap(d);
    if (!gap) {
      return '<div class="note calm" style="margin:14px 0 0">Внесите рыночную стоимость из решения ' +
        'об оценке — на ней держится всё оспаривание по пункту 1 статьи 61.2.</div>';
    }
    if ((d.valuation || {}).gratuitous) {
      return `<div class="note good" style="margin:14px 0 0">Встречного предоставления нет.
        В конкурсную массу заявляется <b>${esc(D.money(gap.market))} ₽</b> —
        рыночная стоимость переданного имущества.</div>`;
    }
    if (gap.gap > 0) {
      return `<div class="note good" style="margin:14px 0 0">Рыночная стоимость выше цены договора
        ${gap.ratio ? 'в <b>' + esc(S.ratioText(gap.ratio)) + '</b> раза, ' : ''}разница —
        <b>${esc(D.money(gap.gap))} ₽</b>. Цена иска — ${esc(D.money(gap.market))} ₽.</div>`;
    }
    return `<div class="note" style="margin:14px 0 0">Рыночная стоимость не превышает цену
      договора: неравноценность из этих цифр не следует.</div>`;
  }

  /**
   * Обстоятельства: исполнение сделки и уточнения по выбранным основаниям.
   * Вопросов, не относящихся к выбранным пунктам, здесь нет — их незачем
   * задавать.
   */
  function dealCircTab(d) {
    const has = (id) => (d.grounds || []).includes(id);
    const sections = [];

    if (has('unequal')) {
      const v = d.valuation;
      const gap = S.valueGap(d);
      // Итог считается на месте: эти цифры уйдут в заявление, и увидеть их
      // человек должен здесь, а не в готовом документе.
      sections.push(`<div class="card">
        <h3>Неравноценность</h3>
        <p class="m">Пункт 1 статьи 61.2 Закона о банкротстве. Сравниваются цена по договору
          и рыночная стоимость по решению об оценке.</p>
        <div class="form"><div class="f wide"><label class="lb">Как передано имущество</label>
          ${radios('deal.valuation.gratuitous', [
        { id: 'false', name: 'За плату по договору' },
        { id: 'true', name: 'Безвозмездно' }], String(!!v.gratuitous))}</div></div>
        <div class="form step" style="margin-top:14px">
          ${v.gratuitous ? '' : field({ label: 'Цена по договору, ₽', bind: 'deal.valuation.contractPrice',
          money: true, placeholder: D.money(d.amount) || '0,00', hint: 'Пусто — берётся сумма сделки' })}
          ${field({ label: 'Рыночная стоимость по решению об оценке, ₽', bind: 'deal.valuation.marketValue', money: true })}
          ${field({ label: 'Реквизиты решения об оценке', bind: 'deal.valuation.decision', wide: true,
          placeholder: 'от 01.06.2025 № 3' })}
          ${field({ label: 'Пояснения', bind: 'deal.valuation.note', type: 'textarea', wide: true, rows: 2 })}
        </div>
        <div id="valuation-verdict">${valuationVerdict(d)}</div>
      </div>`);
    }
    if (has('harm')) {
      sections.push(`<div class="card">
        <h3>Вред кредиторам</h3>
        <p class="m">Пункт 2 статьи 61.2 Закона о банкротстве.</p>
        <div class="form">${field({ label: 'В чём выразился вред', bind: 'deal.harmNote', type: 'textarea', wide: true, rows: 3, placeholder: 'Имущество выбыло безвозмездно, требования кредиторов остались непогашенными…' })}</div>
      </div>`);
    }
    if (has('sham')) {
      sections.push(`<div class="card">
        <h3>Мнимость</h3>
        <p class="m">Статья 170 Гражданского кодекса.</p>
        <div class="form">${field({ label: 'В чём выразилась мнимость', bind: 'deal.shamNote', type: 'textarea', wide: true, rows: 3, placeholder: 'Имущество осталось во владении должника, страхование оформлено позже даты договора…' })}</div>
      </div>`);
    }
    if (has('affiliation')) {
      sections.push(`<div class="card">
        <h3>Заинтересованность</h3>
        <p class="m">Статья 19 Закона о банкротстве.</p>
        ${checkList('deal.affiliationGrounds', D.AFFILIATION_GROUNDS, d.affiliationGrounds)}
        <div class="form" style="margin-top:10px">${field({ label: 'Пояснения', bind: 'deal.affiliationNote', type: 'textarea', wide: true, rows: 2 })}</div>
      </div>`);
    }
    if (has('preference')) {
      sections.push(`<div class="card">
        <h3>Предпочтение</h3>
        <p class="m">Статья 61.3 Закона о банкротстве.</p>
        ${checkList('deal.preferenceGrounds', D.PREFERENCE_GROUNDS, d.preferenceGrounds)}
        <div class="form" style="margin-top:10px">${field({ label: 'Пояснения', bind: 'deal.preferenceNote', type: 'textarea', wide: true, rows: 2 })}</div>
      </div>`);
    }
    if (has('awareness')) {
      sections.push(`<div class="card">
        <h3>Осведомлённость контрагента</h3>
        <p class="m">Пункт 2 статьи 61.2, статья 61.3.</p>
        <div class="form">${field({ label: 'Чем подтверждается', bind: 'deal.awarenessNote', type: 'textarea', wide: true, rows: 3 })}</div>
      </div>`);
    }

    return `<div class="card">
      <h3>Исполнение сделки</h3>
      <p class="m">Передано ли имущество фактически и когда.</p>
      <div class="form"><div class="f wide"><label class="lb">Сделка исполнена</label>
        ${radios('deal.performance.state', D.PERFORMANCE, d.performance.state)}</div></div>
      <div class="form" style="margin-top:12px">
        ${field({ label: 'Дата исполнения', bind: 'deal.performance.date', type: 'date' })}
        ${field({ label: 'Способ исполнения', bind: 'deal.performance.method', placeholder: 'передача по акту, перечисление на счёт' })}
      </div>
    </div>

    ${sections.join('')}

    <div class="card">
      <h3>Дополнительные обстоятельства</h3>
      <p class="m">Свободный текст — войдёт в раздел «Обстоятельства заключения сделки».</p>
      <div class="form">${field({ label: '', bind: 'deal.circumstances', type: 'textarea', wide: true, rows: 4 })}</div>
    </div>
    ${sections.length ? '' : ''}`;
  }

  /** Расчёт пошлины показывается по шагам: сумму под заявлением подписывает человек. */
  /** Таблица расчёта — обновляется по мере ввода, а не после перехода. */
  function feeTable(d) {
    const calc = S.feeCalc(d);
    const rows = calc.steps.map((s) => `<tr><td>${esc(s.text)}</td>
      <td class="r">${esc(D.money(s.sum))}</td></tr>`).join('');
    return `<table><tbody>${rows}
        <tr class="tot"><td><b>Итого к уплате</b></td>
          <td class="r"><b>${esc(D.money(calc.total))} ₽</b></td></tr>
      </tbody></table>
      ${calc.manual ? '<div class="note calm" style="margin-top:12px">Сумма задана вручную — расчёт выше показан для сверки.</div>' : ''}
      <p class="hint">Прописью: ${esc(D.moneyWords(calc.total))}.</p>`;
  }

  function dealFeeTab(d) {
    const f = d.fee;

    return `<div class="card">
      <h3>Государственная пошлина</h3>
      <p class="m">Считается по статье 333.21 НК РФ в редакции с 09.09.2024.</p>
      <div class="form">
        ${field({ label: 'Цена иска, ₽', bind: 'deal.fee.claim', money: true,
          placeholder: D.money(S.objectValue(d)) || '0,00',
          hint: 'Пусто — берётся стоимость объекта, иначе сумма сделки' })}
        ${field({ label: 'Шкала по цене иска', bind: 'deal.fee.scale', type: 'select', options: [
          { id: 'org', name: 'как для организации' }, { id: 'person', name: 'как для физического лица' }] })}
        ${field({ label: 'Ставка за признание сделки недействительной', bind: 'deal.fee.fixedPayer', type: 'select', options: [
          { id: 'person', name: 'физическое лицо — 15 000 ₽' }, { id: 'org', name: 'организация — 50 000 ₽' }] })}
        ${field({ label: 'Своя сумма, ₽', bind: 'deal.fee.manual', money: true, hint: 'Если суд считает иначе' })}
        <div class="f wide">
          <label class="chk"><input type="checkbox" data-bind="deal.fee.withFixed"${f.withFixed ? ' checked' : ''}>
            <span>Добавлять требование о признании сделки недействительной (пп. 2 п. 1 ст. 333.21 НК РФ)</span></label>
          <label class="chk"><input type="checkbox" data-bind="deal.fee.halved"${f.halved ? ' checked' : ''}>
            <span>Обособленный спор в деле о банкротстве — 50 % (пп. 9 п. 1 ст. 333.21 НК РФ)</span></label>
        </div>
      </div>
    </div>

    <div class="card">
      <h3>Расчёт</h3>
      <div id="fee-calc">${feeTable(d)}</div>
    </div>

    <div class="note calm">Формула сверена по четырём заявлениям из вашего архива: при цене иска
      205 000, 415 150 и 933 114 руб. расчёт совпадает до копейки. В четвёртом (1 418 640 руб.)
      в шаблоне указано 33 779,50 руб. — это только имущественная часть, без 7 500 руб.
      за требование о признании сделки недействительной. Если так и задумано, снимите галочку выше.</div>`;
  }

  function dealDocsTab(d) {
    const docs = d.documents || [];
    const rows = docs.map((doc) => `<tr>
      <td data-l="№">${doc.attach !== false ? attachNo(d, doc) : '—'}</td>
      <td data-l="Документ"><b>${esc(doc.name || D.nameOf(D.DOC_TYPES, doc.type))}</b>
        ${doc.description ? `<div class="sub">${esc(doc.description)}</div>` : ''}</td>
      <td data-l="Тип">${esc(D.nameOf(D.DOC_TYPES, doc.type))}</td>
      <td data-l="Номер">${esc(doc.number || '—')}</td>
      <td data-l="Дата">${esc(D.dateShort(doc.date) || '—')}</td>
      <td data-l="В приложения"><label class="chk" style="padding:0"><input type="checkbox" data-act="toggle-attach"
        data-id="${doc.id}" ${doc.attach !== false ? 'checked' : ''}><span>включён</span></label></td>
      <td><div class="rowact">
        <button class="btn btn-sm" data-act="edit-doc" data-id="${doc.id}">Изменить</button>
        <button class="btn btn-sm danger" data-act="del-doc" data-id="${doc.id}">Удалить</button>
      </div></td>
    </tr>`).join('');

    const list = S.attachments(d);
    return `<div class="card">
      <h3>Документы по сделке</h3>
      <p class="m">Отмеченные документы попадают в раздел «Приложения». Нумерация пересчитывается
        автоматически при любом изменении списка.</p>
      ${docs.length ? `<table><thead><tr><th>№</th><th>Документ</th><th>Тип</th><th>Номер</th><th>Дата</th>
        <th>В приложения</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
        : '<p class="hint">Документов пока нет.</p>'}
      <div style="margin-top:14px"><button class="btn" data-act="new-doc">Добавить документ</button></div>
    </div>
    ${list.length ? `<div class="card"><h3>Приложения к заявлению</h3>
      <ol style="margin:10px 0 0;padding-left:22px;font-size:13.5px;color:var(--ink-2);line-height:1.7">
      ${list.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div>` : ''}
    <div class="note calm">Файлы не загружаются в браузер: приложение хранит только реквизиты документа.
      Так персональные данные не оседают в хранилище, а список приложений всё равно собирается сам.</div>`;
  }

  /** Номер документа в списке приложений — считается по тем, что отмечены. */
  function attachNo(deal, doc) {
    return (deal.documents || []).filter((x) => x.attach !== false).indexOf(doc) + 1;
  }

  /* ================= конструктор ================= */

  function screenBuilder() {
    const c = currentCase(), d = currentDeal(), st = currentDoc();
    if (!c || !d || !st) return notFound();

    const kind = S.kindOf(st);
    const blocks = S.statementBlocks(db, c, d, st);
    const on = blocks.filter((b) => b.enabled).length;
    const versions = st.versions.length;
    const others = d.statements.filter((x) => x.id !== st.id);

    return `<div class="docbar">
        <span class="which">${others.map((x) => `<button class="tab" data-go="#/builder/${c.id}/${d.id}/${x.id}">${esc(S.kindOf(x).short)}</button>`).join('')}
          <button class="tab on">${esc(kind.short)}</button></span>
        <span class="scr-act">
          <button class="btn" data-act="versions">Версии${versions ? ' · ' + versions : ''}</button>
          <button class="btn" data-act="preview-sheets">Листы и печать</button>
          <button class="btn pri" data-act="export-docx">Скачать DOCX</button>
        </span>
      </div>

      <div class="builder">
        <div class="bcol-form">
          <div class="blocks">
            <div class="bh"><h3>Разделы</h3>
              <p class="m">включено ${on} из ${blocks.length}</p></div>
            ${blocks.filter((b) => !offBasis(b)).map(blockRow).join('')}
            ${(() => {
    // Разделы, не относящиеся к выбранным основаниям, раньше стояли в общем
    // списке, каждый со своей пометкой. Шесть серых строк с одинаковой
    // надписью — ровно тот мусор, который мешает найти нужное.
    const rest = blocks.filter(offBasis);
    return rest.length ? `<details class="more"><summary>Ещё ${rest.length} ${D.plural(rest.length, 'раздел', 'раздела', 'разделов')} не по вашему основанию</summary>
              ${rest.map(blockRow).join('')}</details>` : '';
  })()}
          </div>
          <div class="railacts">
            <button class="linkbtn" data-act="reset-blocks">Собрать заново по основаниям</button>
            <button class="linkbtn" data-go="#/blocks">Библиотека блоков</button>
          </div>
        </div>

        <div class="bcol-paper">
          <div class="preview">
            <div class="ph"><h3>${esc(kind.name)}</h3>
              <span class="m">${esc(c.number || 'дело')} · ${esc(S.partyShort(S.debtorOf(c)) || 'должник')}</span></div>
            <div class="paper" id="paper">${previewHtml(c, d, st)}</div>
          </div>
          <div class="check" id="check">${checkPanel(c, d, st)}</div>
        </div>
      </div>`;
  }

  /** Раздел не относится к выбранным основаниям и выключен. */
  const offBasis = (b) => !!b.condition && !b.available && !b.enabled;

  function blockRow(b) {
    const open = openBlocks.has(b.id);
    // Пометка осталась одна: текст правился руками. О том, что раздел не по
    // основанию, говорит сама свёртка, в которой он лежит.
    const flags = b.overridden ? '<span class="flag edit">изменён</span>' : '';

    return `<div class="blk${b.enabled ? '' : ' off'}" data-block="${b.id}" draggable="${open ? 'false' : 'true'}">
      <div class="row">
        <span class="grip" title="Перетащите, чтобы изменить порядок">⠿</span>
        <input type="checkbox" data-act="toggle-block" data-id="${b.id}"${b.enabled ? ' checked' : ''}>
        <span class="nm" data-act="open-block" data-id="${b.id}">
          <b>${esc(b.name)}</b><span>${esc(b.description)}</span></span>
        ${flags}
      </div>
      ${open ? `<div class="body">
        <label class="lb">Текст блока</label>
        <textarea data-blocktext="${b.id}" rows="9">${esc(b.template)}</textarea>
        <div class="tools">
          <button class="btn btn-sm" data-act="insert-var" data-id="${b.id}">Вставить переменную</button>
          ${b.overridden ? `<button class="btn btn-sm" data-act="reset-block" data-id="${b.id}">Вернуть текст из библиотеки</button>` : ''}
          <span class="m">Правка действует только в этом заявлении.</span>
        </div>
      </div>` : ''}
    </div>`;
  }

  /** Предпросмотр: незаполненные переменные подсвечены — сразу видно, чего не хватает. */
  function previewHtml(c, d, st) {
    const paras = S.buildDocument(db, c, d, { mark: true, statement: st });
    if (!paras.length) return '<p class="left" style="color:#8A867F">Не включён ни один блок.</p>';
    return paras.map((p) => {
      if (p.kind === 'table') return X.tableHtml(p);
      const text = esc(p.text)
        .split(S.MISS_A).join('<span class="miss">')
        .split(S.MISS_B).join('</span>');
      return `<p class="${p.align}${p.bold ? ' b' : ''}">${text || '&nbsp;'}</p>`;
    }).join('');
  }

  function checkPanel(c, d, st) {
    const v = S.validate(db, c, d, st);
    let html = '';
    if (v.errors.length) {
      html += '<div class="note warn"><h4>Нельзя сформировать документ</h4><ul>' +
        v.errors.map((e) => `<li>Не заполнено: ${esc(e.field)}</li>`).join('') + '</ul></div>';
    }
    if (v.warnings.length) {
      html += '<div class="note calm"><h4>Проверьте</h4><ul>' +
        v.warnings.map((w) => `<li>${esc(w)}</li>`).join('') + '</ul></div>';
    }
    if (v.missingVars.length) {
      html += '<div class="note calm"><h4>Переменные без значения</h4><ul><li>' +
        v.missingVars.map((n) => esc(D.VAR_INDEX.has(n) ? D.VAR_INDEX.get(n).label : n)).join(', ') +
        '</li></ul></div>';
    }
    if (!html) html = '<div class="note good"><b>Всё заполнено</b> — документ можно выгружать.</div>';
    return html;
  }

  /**
   * На экране сделки перерисовка по каждой букве недопустима — уедет каретка.
   * Но вычисляемые места обновлять надо, иначе человек вводит стоимость,
   * а итог под полем остаётся старым.
   */
  function refreshDeal() {
    const d = currentDeal();
    if (!d) return;
    const verdict = $('#valuation-verdict');
    if (verdict) verdict.innerHTML = valuationVerdict(d);
    const fee = $('#fee-calc');
    if (fee) fee.innerHTML = feeTable(d);
  }

  /** Перерисовка одного реестра: строка поиска при этом не теряет фокус. */
  function refreshRegistry() {
    const body = $('#reg-body');
    if (body) body.innerHTML = casesTable();
  }

  function refreshBuilder() {
    const c = currentCase(), d = currentDeal(), st = currentDoc();
    if (!c || !d || !st) return;
    const paper = $('#paper');
    if (paper) paper.innerHTML = previewHtml(c, d, st);
    const check = $('#check');
    if (check) check.innerHTML = checkPanel(c, d, st);
  }

  /* ================= библиотека блоков ================= */

  function screenBlocks() {
    const lib = S.library(db);
    const own = lib.filter((b) => b.custom).length;
    const rows = lib.map((b) => `<div class="party">
      <div style="min-width:0">
        <div class="nm">${esc(b.name)}</div>
        <div class="rq">${esc(b.group || '')}${b.condition ? ' · условие: ' + esc(b.condition) : ''}${b.edited ? ' · изменён' : ''}${b.custom ? ' · свой блок' : ''}</div>
      </div>
      <div class="sp">
        <button class="btn btn-sm" data-act="edit-lib" data-id="${b.id}">Изменить</button>
        ${b.custom ? `<button class="btn btn-sm danger" data-act="del-lib" data-id="${b.id}">Удалить</button>`
        : (b.edited ? `<button class="btn btn-sm" data-act="reset-lib" data-id="${b.id}">Вернуть исходный</button>` : '')}
      </div>
    </div>`).join('');

    return `<div class="scr">
        <div class="scr-top">
          <div>
            <h1>Библиотека блоков</h1>
            <p class="m">${lib.length} ${D.plural(lib.length, 'блок', 'блока', 'блоков')}, из них своих ${own}.
              Тексты хранятся отдельно от программы: чтобы поменять формулировку, править код не нужно.</p>
          </div>
          <div class="scr-act"><button class="btn pri" data-act="new-lib">Новый блок</button></div>
        </div>
      </div>
      <div class="card">
        <p class="m">Изменения применяются ко всем новым заявлениям. Уже собранные заявления,
          в которых текст блока правился вручную, остаются как есть.</p>
        ${rows}
      </div>`;
  }

  /* ================= модальные окна ================= */

  let closeModal = () => { };

  function openModal(html, onMount) {
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal"><div class="box">${html}</div></div>`;
    const box = $('.modal', root);
    box.addEventListener('click', (e) => { if (e.target === box) close(); });
    function close() { root.innerHTML = ''; closeModal = () => { }; document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    closeModal = close;
    if (onMount) onMount(root, close);
    return close;
  }

  const note = (text) => openModal(`<h3>Сообщение</h3><p class="lead">${esc(text)}</p>
    <div class="foot"><button class="btn pri" data-act="modal-close">Понятно</button></div>`);

  function confirmBox(text, onYes) {
    openModal(`<h3>Подтвердите</h3><p class="lead">${esc(text)}</p>
      <div class="foot"><button class="btn" data-act="modal-close">Отмена</button>
      <button class="btn pri" id="confirm-yes">Да</button></div>`, (root, close) => {
      $('#confirm-yes', root).addEventListener('click', () => { close(); onYes(); });
    });
  }

  function partyModal(party, onDone, fixedKind) {
    editParty = party;
    openModal(`<h3>${fixedKind ? 'Должник' : 'Сторона сделки'}</h3>
      <p class="lead">Реквизиты вводятся один раз и подставляются во все заявления по делу.</p>
      <div id="party-body">${partyForm(party, '', 0, fixedKind)}</div>
      <div class="foot"><button class="btn" data-act="modal-close">Отмена</button>
        <button class="btn pri" id="party-save">Сохранить</button></div>`, (root, close) => {
      // Тип стороны меняет набор полей — перерисовываем только тело окна.
      root.addEventListener('change', (e) => {
        const el = e.target.closest('[data-bind="party.kind"]');
        if (!el) return;
        editParty.kind = el.value;
        $('#party-body', root).innerHTML = partyForm(editParty, '', 0, fixedKind);
      });
      $('#party-save', root).addEventListener('click', () => {
        close();
        editParty = null;
        onDone();
      });
    });
  }

  function docModal(doc, onDone) {
    editDoc = doc;
    openModal(`<h3>Документ</h3>
      <p class="lead">Попадёт в список приложений с автоматическим номером.</p>
      <div class="form">
        ${field({ label: 'Тип', bind: 'doc.type', type: 'select', options: D.DOC_TYPES })}
        ${field({ label: 'Наименование', bind: 'doc.name', placeholder: 'Договор купли-продажи' })}
        ${field({ label: 'Номер', bind: 'doc.number' })}
        ${field({ label: 'Дата', bind: 'doc.date', type: 'date' })}
        ${field({ label: 'Имя файла', bind: 'doc.file', placeholder: 'dogovor-15.pdf', hint: 'Только для вашей ориентировки — файл не загружается' })}
        ${field({ label: 'Примечание', bind: 'doc.description', type: 'textarea', wide: true, rows: 2 })}
      </div>
      <div class="foot"><button class="btn" data-act="modal-close">Отмена</button>
        <button class="btn pri" id="doc-save">Сохранить</button></div>`, (root, close) => {
      $('#doc-save', root).addEventListener('click', () => { close(); editDoc = null; onDone(); });
    });
  }

  function profileModal() {
    openModal(`<h3>Профиль</h3>
      <p class="lead">Подставляется в дела, где поля управляющего оставлены пустыми.</p>
      <div class="form">
        ${field({ label: 'ФИО финансового управляющего', bind: 'profile.name', wide: true })}
        ${field({ label: 'СРО', bind: 'profile.sro', wide: true })}
        ${field({ label: 'ИНН', bind: 'profile.inn' })}
        ${field({ label: 'СНИЛС', bind: 'profile.snils' })}
        ${field({ label: 'Регистрационный номер', bind: 'profile.regNumber' })}
        ${field({ label: 'Адрес для корреспонденции', bind: 'profile.address', wide: true })}
        ${field({ label: 'Контакты', bind: 'profile.contacts', wide: true })}
      </div>
      <div class="foot"><button class="btn pri" data-act="modal-close">Готово</button></div>`);
  }

  function backupModal() {
    openModal(`<h3>Резервная копия</h3>
      <p class="lead">Все дела хранятся только в этом браузере. Выгрузите файл, чтобы перенести их
        на другой компьютер или сохранить перед чисткой кэша.</p>
      <div class="foot">
        <button class="btn left" id="backup-import">Загрузить из файла</button>
        <button class="btn" data-act="modal-close">Закрыть</button>
        <button class="btn pri" id="backup-export">Выгрузить всё</button>
      </div>
      <input type="file" id="backup-file" accept="application/json,.json" hidden>`, (root, close) => {
      $('#backup-export', root).addEventListener('click', () => {
        const bytes = new TextEncoder().encode(JSON.stringify(db, null, 2));
        X.download(bytes, 'Заявления — резервная копия.json', 'application/json');
      });
      $('#backup-import', root).addEventListener('click', () => $('#backup-file', root).click());
      $('#backup-file', root).addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const data = JSON.parse(await file.text());
          if (!data || !Array.isArray(data.cases)) throw new Error('это не резервная копия конструктора');
          db = S.migrate(data);
          saveNow();
          close();
          go('#/');
          render();
        } catch (err) {
          close();
          note('Не удалось прочитать файл: ' + (err && err.message ? err.message : err));
        }
      });
    });
  }

  /** Пикер переменных (§24): вставляет {{ИМЯ}} в позицию каретки. */
  function varsModal(textarea) {
    openModal('<h3>Вставить переменную</h3><p class="lead">Значение подставится при сборке документа.</p>' +
      '<div class="vars">' + D.VARS.map((g) => `<div><h4>${esc(g.group)}</h4>` +
        g.items.map((it) => `<button data-var="${attr(it.name)}">${esc(it.label)}<code>{{${esc(it.name)}}}</code></button>`).join('') +
        '</div>').join('') + '</div>' +
      '<div class="foot"><button class="btn" data-act="modal-close">Закрыть</button></div>',
      (root, close) => {
        root.addEventListener('click', (e) => {
          const b = e.target.closest('[data-var]');
          if (!b) return;
          const token = '{{' + b.dataset.var + '}}';
          const at = textarea.selectionStart == null ? textarea.value.length : textarea.selectionStart;
          const end = textarea.selectionEnd == null ? at : textarea.selectionEnd;
          textarea.value = textarea.value.slice(0, at) + token + textarea.value.slice(end);
          textarea.selectionStart = textarea.selectionEnd = at + token.length;
          close();
          textarea.focus();
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
        });
      });
  }

  function sheetsModal(st) {
    const c = currentCase(), d = currentDeal();
    if (!c || !d || !st) return;
    const paras = S.buildDocument(db, c, d, { mark: false, statement: st });
    if (!paras.length) return note('Не включён ни один блок — печатать нечего.');

    openModal(`<h3>Листы: ${esc(S.kindOf(st).name.toLowerCase())}</h3>
      <p class="lead">Так документ ляжет на бумагу и в PDF. Печать → «Сохранить как PDF».</p>
      <div class="sheets" id="sheets">${X.buildSheets(paras)}</div>
      <div class="foot">
        <span class="left m" id="sheet-count"></span>
        <button class="btn" data-act="modal-close">Закрыть</button>
        <button class="btn" id="sheet-docx">Скачать DOCX</button>
        <button class="btn pri" id="sheet-print">Печать в PDF</button>
      </div>`, (root, close) => {
      const n = $$('.sheet', root).length;
      $('#sheet-count', root).textContent = n + ' ' + D.plural(n, 'лист', 'листа', 'листов');
      fitSheets(root);
      $('#sheet-print', root).addEventListener('click', () => {
        document.body.classList.add('printmode');
        window.print();
        setTimeout(() => document.body.classList.remove('printmode'), 500);
      });
      $('#sheet-docx', root).addEventListener('click', () => exportDocx(st));
    });
  }

  /** Лист A4 шире телефона — ужимаем его под ширину окна, на печать это не влияет. */
  function fitSheets(root) {
    const box = $('#sheets', root);
    if (!box) return;
    const avail = box.clientWidth - 36;
    const z = avail > 0 ? Math.min(1, avail / (210 * X.MM)) : 1;
    box.style.setProperty('--zoom', z.toFixed(3));
    // При масштабе transform не сжимает занимаемую высоту — компенсируем вручную,
    // иначе под последним листом остаётся полоса пустоты.
    for (const s of $$('.sheet', box)) s.style.marginBottom = (z < 1 ? (z - 1) * 297 * X.MM + 14 : 14) + 'px';
  }

  function versionsModal() {
    const c = currentCase(), d = currentDeal(), st = currentDoc();
    if (!c || !d || !st) return;
    const vs = [...st.versions].reverse();

    const list = vs.length ? vs.map((v) => `<div class="v">
        <b>Версия ${v.no}</b>
        <span class="m">${esc(D.dateShort(v.createdAt.slice(0, 10)))} ${esc(v.createdAt.slice(11, 16))}
          ${v.note ? ' · ' + esc(v.note) : ''}</span>
        <button class="btn btn-sm" data-act="view-version" data-id="${v.id}">Посмотреть</button>
        <button class="btn btn-sm" data-act="restore-version" data-id="${v.id}">Восстановить</button>
      </div>`).join('')
      : '<p class="hint">Версий пока нет. Сохраните текущую — потом можно будет сравнить и вернуться.</p>';

    const options = vs.map((v) => `<option value="${v.id}">Версия ${v.no}</option>`).join('');

    openModal(`<h3>Версии — ${esc(S.kindOf(st).name.toLowerCase())}</h3>
      <p class="lead">Каждая версия — снимок состава блоков и собранного текста.</p>
      <div class="versions">${list}</div>
      ${vs.length ? `<div class="card" style="margin:14px 0 0;box-shadow:none">
        <h3>Сравнение</h3>
        <div class="form">
          <div class="f"><label class="lb">Версия A</label><select id="cmp-a">${options}</select></div>
          <div class="f"><label class="lb">Версия B</label><select id="cmp-b"><option value="current">Текущее состояние</option>${options}</select></div>
        </div>
        <div class="diff" id="diff" style="margin-top:12px"></div>
      </div>` : ''}
      <div class="foot"><button class="btn" data-act="modal-close">Закрыть</button>
        <button class="btn pri" id="ver-save">Сохранить текущую версию</button></div>`, (root, close) => {
      $('#ver-save', root).addEventListener('click', () => { close(); saveVersion(); });

      const a = $('#cmp-a', root), b = $('#cmp-b', root);
      if (a && b) {
        const textOf = (id) => id === 'current' ? S.documentText(db, c, d, st)
          : (st.versions.find((v) => v.id === id) || { text: '' }).text;
        const draw = () => {
          $('#diff', root).innerHTML = S.diffLines(textOf(a.value), textOf(b.value))
            .map((l) => `<span class="${l.op === '+' ? 'add' : l.op === '-' ? 'del' : 'same'}">` +
              esc((l.op === ' ' ? '  ' : l.op + ' ') + l.text) + '</span>').join('');
        };
        a.addEventListener('change', draw);
        b.addEventListener('change', draw);
        draw();
      }

      root.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const v = st.versions.find((x) => x.id === btn.dataset.id);
        if (btn.dataset.act === 'view-version' && v) {
          close();
          openModal(`<h3>Версия ${v.no}</h3><div class="diff">${esc(v.text)}</div>
            <div class="foot"><button class="btn pri" data-act="modal-close">Закрыть</button></div>`);
        } else if (btn.dataset.act === 'restore-version' && v) {
          close();
          confirmBox('Восстановить версию ' + v.no + '? Текущий состав блоков будет заменён.', () => {
            S.restoreVersion(st, v.id);
            saveNow();
            render();
          });
        }
      });
    });
  }

  function libModal(block) {
    editBlock = block;
    const isNew = !block.id;
    openModal(`<h3>${isNew ? 'Новый блок' : 'Блок «' + esc(block.name) + '»'}</h3>
      <p class="lead">Условие показа записывается как <code>deal.unequal = true</code>. Доступны поля
        deal.unequal, deal.harm, deal.affiliation, deal.preference, deal.awareness, deal.objectType,
        deal.performance, deal.gratuitous, deal.amount, deal.documents, case.procedure.</p>
      <div class="form">
        ${field({ label: 'Название блока', bind: 'block.name', wide: true, required: true })}
        ${field({ label: 'Описание', bind: 'block.description', wide: true })}
        ${field({ label: 'Раздел', bind: 'block.group' })}
        ${field({ label: 'Выравнивание', bind: 'block.align', type: 'select', options: [
          { id: 'justify', name: 'По ширине' }, { id: 'center', name: 'По центру' },
          { id: 'right', name: 'По правому краю' }, { id: 'left', name: 'По левому краю' }] })}
        ${field({ label: 'Условие показа', bind: 'block.condition', wide: true, placeholder: 'deal.unequal = true' })}
        <div class="f wide"><label class="lb">Текст шаблона</label>
          <textarea data-bind="block.template" rows="12" id="lib-template">${esc(block.template || '')}</textarea></div>
        <div class="f wide"><label class="chk"><input type="checkbox" data-bind="block.required"
          ${block.required ? 'checked' : ''}><span>Обязательный блок</span></label></div>
      </div>
      <div class="foot">
        <button class="btn left" id="lib-var">Вставить переменную</button>
        <button class="btn" data-act="modal-close">Отмена</button>
        <button class="btn pri" id="lib-save">Сохранить</button>
      </div>`, (root, close) => {
      $('#lib-var', root).addEventListener('click', () => {
        const ta = $('#lib-template', root);
        // Окно переменных заменит текущее — сначала запомним, куда вставлять.
        varsModalKeep(ta, block);
      });
      $('#lib-save', root).addEventListener('click', () => {
        if (!editBlock.name) { note('У блока должно быть название.'); return; }
        saveLibBlock(editBlock);
        editBlock = null;
        close();
        render();
      });
    });
  }

  /*
   * Пикер переменных поверх редактора блока: одно модальное окно на всё
   * приложение, поэтому редактор пересобирается после вставки — с уже
   * изменённым текстом.
   */
  function varsModalKeep(textarea, block) {
    block.template = textarea.value;
    const pos = textarea.selectionStart == null ? textarea.value.length : textarea.selectionStart;
    openModal('<h3>Вставить переменную</h3><p class="lead">Значение подставится при сборке документа.</p>' +
      '<div class="vars">' + D.VARS.map((g) => `<div><h4>${esc(g.group)}</h4>` +
        g.items.map((it) => `<button data-var="${attr(it.name)}">${esc(it.label)}<code>{{${esc(it.name)}}}</code></button>`).join('') +
        '</div>').join('') + '</div>' +
      '<div class="foot"><button class="btn" data-act="modal-close">Закрыть</button></div>',
      (root, close) => {
        root.addEventListener('click', (e) => {
          const b = e.target.closest('[data-var]');
          if (!b) return;
          const token = '{{' + b.dataset.var + '}}';
          block.template = block.template.slice(0, pos) + token + block.template.slice(pos);
          close();
          libModal(block);
        });
      });
  }

  function saveLibBlock(block) {
    if (block.custom || !D.BLOCKS.some((b) => b.id === block.id)) {
      block.custom = true;
      if (!block.id) block.id = 'own_' + S.uid();
      const at = db.customBlocks.findIndex((b) => b.id === block.id);
      if (at >= 0) db.customBlocks[at] = block; else db.customBlocks.push(block);
    } else {
      // Для стандартного блока правится только текст: остальное задано программой,
      // иначе обновление приложения молча потеряло бы чужие настройки.
      db.edits[block.id] = block.template;
    }
    saveNow();
  }

  /* ================= действия ================= */

  function newCase() {
    const c = S.newCase();
    c.managerName = db.profile.name;
    c.managerSro = db.profile.sro;
    c.managerAddress = db.profile.address;
    c.managerContacts = db.profile.contacts;
    db.cases.push(c);
    saveNow();
    go('#/case/' + c.id);
  }

  function newDeal() {
    const c = currentCase();
    if (!c) return;
    const d = S.newDeal();
    c.deals.push(d);
    saveNow();
    // Первый вопрос по новой сделке — по какому пункту её оспаривать.
    tabs.deal = 'ground';
    go('#/deal/' + c.id + '/' + d.id);
  }

  function saveVersion() {
    const c = currentCase(), d = currentDeal(), st = currentDoc();
    if (!c || !d || !st) return;
    const v = S.saveVersion(db, c, d, st, '');
    saveNow();
    render();
    note('Сохранена версия ' + v.no + '.');
  }

  function exportDocx(st) {
    const c = currentCase(), d = currentDeal();
    if (!c || !d || !st) return;
    const check = S.validate(db, c, d, st);
    const paras = S.buildDocument(db, c, d, { mark: false, statement: st });
    if (!paras.length) return note('Не включён ни один блок — выгружать нечего.');

    const name = X.safeName(S.kindOf(st).file + ' — ' + (c.number || 'дело') + ' — ' +
      (S.partyShort(S.counterpartyOf(c, d)) || 'контрагент'));
    const make = () => {
      X.download(X.docxBytes(paras, name), name + '.docx', X.DOCX_MIME);
      if (st.status !== 'ready' && check.ok) { st.status = 'ready'; saveNow(); }
    };

    if (check.errors.length) {
      confirmBox('Не заполнено обязательных полей: ' + check.errors.length +
        ' (' + check.errors.map((e) => e.field).join(', ') + '). Выгрузить с прочерками?', make);
    } else {
      make();
    }
  }


  /* ================= импорт печатной формы и отчёта ОКБ ================= */

  /** Разовый выбор файла: скрытый input живёт ровно столько, сколько нужно. */
  function pickFile(accept) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        input.remove();
        resolve(file || null);
      });
      // Отмена в диалоге события change не даёт — вешаемся на фокус окна.
      window.addEventListener('focus', () => setTimeout(() => {
        if (document.body.contains(input) && !(input.files && input.files.length)) {
          input.remove();
          resolve(null);
        }
      }, 400), { once: true });
      input.click();
    });
  }

  /** Поля печатной формы → дело. Пустое в форме ничего не затирает. */
  function applyPrintForm(kase, data) {
    const set = (obj, key, value) => { if (value) obj[key] = value; };

    set(kase, 'court', data.court);
    set(kase, 'courtAddress', data.courtAddress);
    set(kase, 'number', data.caseNumber);
    set(kase, 'caseStartDate', data.caseStartDate);
    set(kase, 'judicialAct', data.judicialAct);
    set(kase, 'procedure', data.procedure);
    set(kase, 'procedureDate', data.procedureDate);
    set(kase, 'debtorNameGen', data.debtorNameGen);
    set(kase, 'managerName', data.managerName);
    set(kase, 'managerAddress', data.managerAddress);
    set(kase, 'managerInn', data.managerInn);
    set(kase, 'managerSnils', data.managerSnils);
    set(kase, 'managerRegNumber', data.managerRegNumber);
    if (data.sroName) {
      kase.managerSro = data.sroName +
        (data.sroOgrn ? ' (ОГРН ' + data.sroOgrn + (data.sroInn ? ', ИНН ' + data.sroInn : '') +
          (data.sroAddress ? ', адрес: ' + data.sroAddress : '') + ')' : '');
    }

    const debtor = S.debtorOf(kase);
    if (debtor && data.debtorName) {
      // Должник в печатной форме — всегда гражданин.
      debtor.kind = 'person';
      set(debtor, 'fio', data.debtorName);
      set(debtor, 'address', data.debtorAddress);
      set(debtor, 'inn', data.debtorInn);
      set(debtor, 'birthDate', data.debtorBirthDate);
      set(debtor, 'birthPlace', data.debtorBirthPlace);
      set(debtor, 'snils', data.debtorSnils);
    }

    // Ответчик заводится стороной дела, только если форма его уже знает.
    if (data.respondentName && !kase.parties.some((p) => S.partyName(p) === data.respondentName)) {
      const party = S.newParty('person');
      party.fio = data.respondentName;
      party.address = data.respondentAddress || '';
      kase.parties.push(party);
      return party;
    }
    return null;
  }

  async function importPrintForm() {
    const file = await pickFile('.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    if (!file) return;

    let data;
    try {
      data = IMP.parsePrintForm(await IMP.readDocx(new Uint8Array(await file.arrayBuffer())));
    } catch (e) {
      return note('Не удалось прочитать файл: ' + (e && e.message ? e.message : e));
    }
    if (!data.court && !data.caseNumber && !data.debtorName) {
      return note('В файле не нашлось ни суда, ни номера дела, ни должника. ' +
        'Похоже, это не печатная форма — заполните дело вручную.');
    }

    const shown = Object.keys(IMP.FIELD_NAMES).filter((k) => data[k]);
    const rows = shown.map((k) => `<tr><td class="sub">${esc(IMP.FIELD_NAMES[k])}</td><td><b>${esc(
      k === 'procedure' ? D.nameOf(D.PROCEDURES, data[k])
        : /Date$/.test(k) ? D.dateShort(data[k]) : data[k])}</b></td></tr>`).join('');
    const lost = data.missing.filter((k) => IMP.FIELD_NAMES[k]).map((k) => IMP.FIELD_NAMES[k]);
    const target = currentCase();

    openModal(`<h3>Печатная форма прочитана</h3>
      <p class="lead">Распознано ${shown.length} ${D.plural(shown.length, 'поле', 'поля', 'полей')}.
        Проверьте и подтвердите — пустые значения ничего не затрут.</p>
      <table><tbody>${rows}</tbody></table>
      ${lost.length ? `<div class="note calm" style="margin-top:14px">Не нашлось: ${esc(lost.join(', '))}.
        Эти поля заполните руками.</div>` : ''}
      <div class="foot">
        <button class="btn" data-act="modal-close">Отмена</button>
        ${target ? '<button class="btn" id="imp-here">Обновить текущее дело</button>' : ''}
        <button class="btn pri" id="imp-new">Создать дело</button>
      </div>`, (root, close) => {
      const finish = (kase) => {
        const respondent = applyPrintForm(kase, data);
        // Ответчика из формы сразу подставляем в новую сделку — иначе его
        // придётся выбирать руками, хотя приложение его уже знает.
        if (respondent) for (const deal of kase.deals) if (!deal.counterpartyId) deal.counterpartyId = respondent.id;
        saveNow();
        close();
        go('#/case/' + kase.id);
        render();
      };
      $('#imp-new', root).addEventListener('click', () => {
        const kase = S.newCase();
        db.cases.push(kase);
        finish(kase);
      });
      if (target) $('#imp-here', root).addEventListener('click', () => finish(target));
    });
  }

  /**
   * Разбор кредитного отчёта. Тот же parser.js, что и в анализаторе отчётов:
   * файл читается в браузере и никуда не отправляется.
   */
  async function importOkb() {
    const kase = currentCase();
    if (!kase) return;
    const file = await pickFile('application/pdf,.pdf');
    if (!file) return;

    const close = openModal(`<h3>Разбираю отчёт</h3>
      <p class="lead" id="okb-text">Читаю файл…</p>
      <div class="meter"><i id="okb-bar" style="width:2%"></i></div>`);
    const step = (text, ratio) => {
      const el = $('#okb-text'), bar = $('#okb-bar');
      if (el) el.textContent = text;
      if (bar) bar.style.width = Math.round(ratio * 100) + '%';
      return new Promise((r) => setTimeout(r, 0));
    };

    try {
      const buf = await file.arrayBuffer();
      const doc = await globalThis.pdfjsLib.getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
      const pages = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const tc = await page.getTextContent();
        pages.push({
          num: n,
          rows: P.buildRows(tc.items.map((it) => ({
            str: it.str, x: it.transform[4], y: it.transform[5], width: it.width
          }))),
          // Нужен старому формату отчёта: статус платежа нарисован иконкой.
          shapes: P.buildShapes(await page.getOperatorList(), globalThis.pdfjsLib.OPS)
        });
        if (n % 4 === 0 || n === doc.numPages) await step(`Страница ${n} из ${doc.numPages}`, n / doc.numPages);
      }

      const parsed = P.parse(pages);
      if (!parsed.contracts.length) {
        throw new Error('в файле не найдено кредитных договоров — похоже, это не отчёт ОКБ или «Кредистории»');
      }
      kase.okb = OKB.compact(parsed);
      // Состав блоков пересобирать не будем: условие `case.okb = true` откроет
      // таблицы, а включать их или нет — решает человек в конструкторе.
      saveNow();
      close();
      render();

      const starts = OKB.overdueStarts(kase.okb);
      const first = OKB.earliestUncured(starts);
      note('Отчёт разобран: ' + kase.okb.contracts.length + ' ' +
        D.plural(kase.okb.contracts.length, 'обязательство', 'обязательства', 'обязательств') +
        ', просрочка отмечена по ' + starts.length + '. ' +
        (first && first.since ? 'Самая ранняя непогашенная — ' + D.dateShort(first.since) +
          ' (' + first.creditor + '). ' : '') +
        'Таблицы включаются в конструкторе заявления.');
    } catch (e) {
      close();
      note('Не удалось разобрать отчёт: ' + (e && e.message ? e.message : e));
    }
  }

  /* ================= счета должника ================= */

  const ACC = () => globalThis.ZAccounts;

  /** Текст PDF постранично — общий шаг для сведений ФНС и справок банков. */
  async function pdfPages(file, onStep) {
    const buf = await file.arrayBuffer();
    const doc = await globalThis.pdfjsLib.getDocument({ data: new Uint8Array(buf), useSystemFonts: true }).promise;
    const out = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const tc = await (await doc.getPage(n)).getTextContent();
      const t = ACC().pageText(tc.items);
      out.push({ num: n, text: t.text, angle: t.angle });
      if (onStep) await onStep(n, doc.numPages);
    }
    return out;
  }

  function progress(title) {
    const close = openModal(`<h3>${esc(title)}</h3>
      <p class="lead" id="pg-text">Читаю файл…</p>
      <div class="meter"><i id="pg-bar" style="width:2%"></i></div>`);
    return {
      close: close,
      step: (n, total) => {
        const el = $('#pg-text'), bar = $('#pg-bar');
        if (el) el.textContent = 'Страница ' + n + ' из ' + total;
        if (bar) bar.style.width = Math.round(n / total * 100) + '%';
        return new Promise((r) => setTimeout(r, 0));
      }
    };
  }

  async function importFns() {
    const kase = currentCase();
    if (!kase) return;
    const file = await pickFile('application/pdf,.pdf');
    if (!file) return;

    const pg = progress('Читаю сведения ФНС');
    try {
      const pages = await pdfPages(file, pg.step);
      const parsed = ACC().parseFns(pages);
      if (!parsed.banks.length && !parsed.closedOnly.length) {
        throw new Error('в файле не нашлось ни одного номера счёта, сошедшегося с БИК по ключу ' +
          'проверки. Похоже, это не сведения ФНС об открытых и закрытых счетах — или скан ' +
          'распознан настолько плохо, что верить ему нельзя');
      }
      const added = S.applyFns(db, kase, parsed, file.name);
      saveNow();
      pg.close();
      tabs.case = 'accounts';
      render();

      const bad = parsed.unreadable;
      note('Найдено ' + parsed.banks.length + ' ' +
        D.plural(parsed.banks.length, 'банк', 'банка', 'банков') + ' с открытыми счетами' +
        (added < parsed.banks.length ? ' (новых — ' + added + ')' : '') + '. ' +
        (parsed.closed ? 'Закрытых счетов: ' + parsed.closed + ' — в ходатайство они не идут. ' : '') +
        (bad.length ? 'Страницы ' + bad.join(', ') + ' прочитать не удалось: скан перевёрнут, ' +
          'и цифры на нём распознались неверно. Банки с этих страниц добавьте вручную либо ' +
          'загрузите их справки об остатках — банк заведётся сам. ' : '') +
        'Проверьте названия банков: в сведениях ФНС они часто не читаются.');
    } catch (e) {
      pg.close();
      note('Не удалось разобрать сведения: ' + (e && e.message ? e.message : e));
    }
  }

  async function importBalance(bankId) {
    const kase = currentCase();
    if (!kase) return;
    const file = await pickFile('application/pdf,.pdf');
    if (!file) return;

    const pg = progress('Читаю справку банка');
    try {
      const pages = await pdfPages(file, pg.step);
      const text = pages.map((p) => p.text).join('\n');
      const bal = ACC().parseBalance(text);
      const bik = ACC().bikFromStatement(text);

      const clicked = bankId ? (kase.accounts || []).find((b) => b.id === bankId) : null;
      const aim = clicked ? targetBank(kase, clicked, bik, file.name) : { bank: null, moved: '', wrong: '' };
      const bank = aim.bank
        ? applyToBank(aim.bank, bal, bik, file.name)
        : S.applyStatement(db, kase, { bik: bik, total: bal.total, method: bal.method }, file.name);

      saveNow();
      pg.close();
      render();

      const head = aim.moved
        ? 'Справка легла не в ту строку, где нажата кнопка, а к «' + S.bankTitle(bank) +
          '»: этот банк назван в самой справке (' + aim.moved + '). '
        : aim.wrong
          ? 'Справка приложена к «' + S.bankTitle(bank) + '», но в имени файла назван другой банк — ' +
            aim.wrong + '. Проверьте, туда ли она легла. '
          : '';

      if (bal.total == null) {
        note(head + 'Остаток из справки прочитать не удалось: в файле нет текстового слоя — это скан. ' +
          'Впишите сумму по «' + S.bankTitle(bank) + '» вручную, приложение ничего не додумывает.');
      } else {
        note(head + 'Остаток по «' + S.bankTitle(bank) + '» — ' + D.money(bal.total) + ' ₽ (' + bal.method +
          (bal.parts.length > 1 ? ', сумма по ' + bal.parts.length + ' счетам' : '') +
          '). Проверьте цифру по справке и поправьте, если банк печатает её иначе.');
      }
    } catch (e) {
      pg.close();
      note('Не удалось разобрать справку: ' + (e && e.message ? e.message : e));
    }
  }

  const sameBank = (a, b) => {
    const n = (s2) => String(s2 || '').toLowerCase().replace(/[«»"'()\s.,-]/g, '');
    if (!n(a) || !n(b)) return false;
    return n(a).includes(n(b)) || n(b).includes(n(a));
  };

  /**
   * Куда лечь справке.
   *
   * По умолчанию — в ту строку, где нажата кнопка: человек знает, что делает.
   * Но если справка сама называет другой банк из списка — БИК в тексте или
   * название в имени файла, — она уходит туда: промахнуться строкой в списке
   * из восьми банков легко, а неверный остаток в ходатайстве не заметен.
   */
  function targetBank(kase, clicked, bik, fileName) {
    const list = kase.accounts || [];
    const byBik = bik ? list.find((b) => b.bik === bik) : null;
    if (byBik && byBik !== clicked) return { bank: byBik, moved: 'БИК ' + bik, wrong: '' };

    const fromFile = ACC().nameFromFile(fileName);
    if (fromFile && !sameBank(clicked.name, fromFile)) {
      const byName = list.find((b) => b !== clicked && sameBank(b.name, fromFile));
      if (byName) return { bank: byName, moved: 'имя файла', wrong: '' };
      // Другого подходящего банка в списке нет: строку не меняем, но и молчать
      // об этом нельзя.
      if (clicked.name) return { bank: clicked, moved: '', wrong: fromFile };
    }
    return { bank: clicked, moved: '', wrong: '' };
  }

  /** Справка, положенная в выбранную строку банка. */
  function applyToBank(bank, bal, bik, fileName) {
    if (!bank.bik && bik) bank.bik = bik;
    if (!bank.name) bank.name = ACC().bankName(bank.bik, bank.inn, db.banks, ACC().nameFromFile(fileName));
    bank.statement = fileName || '';
    bank.balance = bal.total == null ? bank.balance : String(Math.round(bal.total * 100) / 100);
    bank.balanceNote = bal.total == null ? '' : bal.method;
    if (bank.bik && bank.name) db.banks[bank.bik] = bank.name;
    return bank;
  }

  /* ================= отрисовка ================= */

  function notFound() {
    return `<div class="empty"><b>Ничего не найдено</b>Возможно, запись была удалена.
      <div style="margin-top:16px"><button class="btn pri" data-go="#/">К списку дел</button></div></div>`;
  }

  function render() {
    const app = $('#app');
    app.innerHTML = route.name === 'case' ? screenCase()
      : route.name === 'deal' ? screenDeal()
        : route.name === 'builder' ? screenBuilder()
          : route.name === 'blocks' ? screenBlocks()
            : screenCases();
    if (route.name === 'builder') save();     // statementBlocks мог достроить состав
    $('#path').innerHTML = pathLine();
    document.title = titleFor() + ' — Конструктор заявлений';
    // Наверх — только при переходе на другой экран: перерисовка после ответа
    // на вопрос не должна утаскивать страницу от места, где человек читает.
    const key = [route.name, route.caseId, route.dealId].join('/');
    if (key !== lastScreen) { lastScreen = key; window.scrollTo(0, 0); }
  }

  let lastScreen = null;

  /**
   * Путь в верхней строке — единственная постоянная часть оформления.
   * Заголовков экрана и хлебных крошек по отдельности нет: где мы находимся,
   * сказано один раз и в одном месте.
   */
  function pathLine() {
    const bits = [];
    const link = (href, text) => `<a href="${href}">${esc(text)}</a>`;
    const c = currentCase(), d = currentDeal(), st = currentDoc();

    if (route.name === 'cases') return '<b>Мои дела</b>';
    bits.push(link('#/', 'Мои дела'));
    if (route.name === 'blocks') { bits.push('<b>библиотека блоков</b>'); return bits.join('<i>·</i>'); }
    if (!c) return bits.join('<i>·</i>');

    const num = c.number || 'дело без номера';
    const debtor = S.partyShort(S.debtorOf(c));
    if (route.name === 'case') bits.push('<b>' + esc(num) + '</b>', esc(debtor));
    else bits.push(link('#/case/' + c.id, num), esc(debtor));

    if (d) {
      const name = S.dealTypeName(d) + (d.number ? ' № ' + d.number : '');
      if (route.name === 'deal') bits.push('<b>' + esc(name) + '</b>');
      else bits.push(link('#/deal/' + c.id + '/' + d.id, name));
    }
    if (route.name === 'builder' && st) bits.push('<b>' + esc(S.kindOf(st).name.toLowerCase()) + '</b>');
    return bits.filter(Boolean).join('<i>·</i>');
  }

  function titleFor() {
    const c = currentCase();
    if (route.name === 'builder') return 'Конструктор';
    if (route.name === 'blocks') return 'Библиотека блоков';
    if (c) return c.number || 'Дело';
    return 'Мои дела';
  }

  /* ================= события ================= */

  document.addEventListener('input', (e) => {
    const el = e.target;

    if (el.id === 'find') {
      find = el.value;
      refreshRegistry();
      return;
    }

    if (el.dataset.blocktext) {
      const d = currentDeal();
      if (!d) return;
      const st = currentDoc();
      const ref = st && st.blocks.find((b) => b.id === el.dataset.blocktext);
      if (ref) { ref.text = el.value; save(); refreshBuilder(); }
      return;
    }

    if (!el.dataset.bind || el.type === 'radio' || el.type === 'checkbox') return;
    setPath(el.dataset.bind, el.dataset.kind === 'money' ? normMoney(el.value) : el.value);
    save();
    if (route.name === 'builder') refreshBuilder();
    else if (route.name === 'deal') refreshDeal();
  });

  document.addEventListener('change', (e) => {
    const el = e.target;

    if (el.dataset.arr) {
      const r = resolve(el.dataset.arr);
      if (!r) return;
      const list = new Set(r.obj[r.key] || []);
      if (el.checked) list.add(el.value); else list.delete(el.value);
      r.obj[r.key] = [...list];
      saveNow();
      if (route.name === 'builder') refreshBuilder();
      return;
    }

    if (!el.dataset.bind) return;

    // Поля в модальном окне перерисовывает само окно: общий render()
    // трогает только основной экран.
    const inModal = !!(el.closest && el.closest('#modal-root'));

    if (el.type === 'radio') {
      if (!el.checked) return;
      const path = el.dataset.bind;
      // Часть переключателей отвечает «да / нет» — их значение булево.
      setPath(path, el.value === 'true' ? true : el.value === 'false' ? false : el.value);
      // Способ передачи имущества меняет состав правовых блоков так же,
      // как выбор основания.
      if (path === 'deal.valuation.gratuitous') {
        const kase = currentCase(), deal = currentDeal();
        if (kase && deal) syncBlocks(kase, deal);
      }
      saveNow();
      if (!inModal) render();
      return;
    }

    if (el.type === 'checkbox') {
      setPath(el.dataset.bind, el.checked);
      saveNow();
      return;
    }

    if (el.dataset.kind === 'money') {
      el.value = normMoney(el.value);
      setPath(el.dataset.bind, el.value);
    } else {
      setPath(el.dataset.bind, el.value);
    }
    saveNow();

    // Селект может менять состав полей (тип сделки, тип стороны, контрагент).
    if (el.tagName === 'SELECT' && !inModal) render();
    else if (route.name === 'builder') refreshBuilder();
    else if (route.name === 'deal') refreshDeal();
  });

  document.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-go]');
    if (nav) { go(nav.dataset.go); return; }

    const col = e.target.closest('[data-sort]');
    if (col) {
      const by = col.dataset.sort;
      // Повторный клик по тому же столбцу переворачивает порядок. Новый
      // столбец начинается с убывания: свежее и крупное сверху — то, что
      // ищут в реестре чаще всего.
      sort = sort.by === by ? { by: by, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { by: by, dir: 'desc' };
      refreshRegistry();
      return;
    }

    const tab = e.target.closest('[data-tab]');
    if (tab) {
      const [screen, id] = tab.dataset.tab.split(':');
      tabs[screen] = id;
      render();
      return;
    }

    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const id = btn.dataset.id;
    const c = currentCase(), d = currentDeal();

    switch (act) {
      case 'modal-close': closeModal(); break;
      case 'new-case': newCase(); break;
      case 'import-form': importPrintForm(); break;
      case 'import-okb': importOkb(); break;
      case 'import-fns': importFns(); break;
      case 'import-balance': importBalance(id); break;
      case 'add-bank':
        c.accounts.push(S.newBank({ source: 'manual' }));
        saveNow(); render();
        break;
      case 'del-bank':
        c.accounts = c.accounts.filter((b) => b.id !== id);
        saveNow(); render();
        break;
      case 'drop-fns':
        confirmBox('Убрать сведения ФНС? Банки и остатки останутся — удалится только отметка о файле.', () => {
          c.accountsMeta = null;
          saveNow(); render();
        });
        break;

      case 'drop-okb':
        confirmBox('Убрать кредитный отчёт из дела? Таблицы по нему исчезнут из заявлений.', () => {
          c.okb = null;
          saveNow(); render();
        });
        break;

      case 'new-deal': newDeal(); break;

      case 'del-case':
        confirmBox('Удалить дело со всеми сделками и заявлениями?', () => {
          db.cases = db.cases.filter((x) => x.id !== c.id);
          saveNow(); go('#/');
        });
        break;

      case 'del-deal':
        confirmBox('Удалить сделку вместе с заявлением?', () => {
          c.deals = c.deals.filter((x) => x.id !== d.id);
          saveNow(); go('#/case/' + c.id);
        });
        break;

      case 'clone-deal': {
        const copy = S.cloneDeal(d);
        c.deals.push(copy);
        saveNow();
        go('#/deal/' + c.id + '/' + copy.id);
        break;
      }

      case 'new-party': {
        const p = S.newParty('org');
        partyModal(p, () => {
          c.parties.push(p);
          if (d && !d.counterpartyId) d.counterpartyId = p.id;
          saveNow(); render();
        });
        break;
      }

      case 'edit-party': {
        const p = S.findParty(c, id);
        if (p) partyModal(p, () => { saveNow(); render(); }, p.id === c.debtorId);
        break;
      }

      case 'del-party':
        confirmBox('Удалить сторону? В сделках, где она выбрана, контрагент станет пустым.', () => {
          c.parties = c.parties.filter((x) => x.id !== id);
          for (const deal of c.deals) if (deal.counterpartyId === id) deal.counterpartyId = '';
          saveNow(); render();
        });
        break;

      case 'new-doc': {
        const doc = S.newDocument();
        docModal(doc, () => { d.documents.push(doc); saveNow(); render(); });
        break;
      }

      case 'edit-doc': {
        const doc = d.documents.find((x) => x.id === id);
        if (doc) docModal(doc, () => { saveNow(); render(); });
        break;
      }

      case 'del-doc':
        d.documents = d.documents.filter((x) => x.id !== id);
        saveNow(); render();
        break;

      case 'toggle-attach': {
        const doc = d.documents.find((x) => x.id === id);
        if (doc) { doc.attach = btn.checked; saveNow(); render(); }
        break;
      }

      case 'toggle-ground': {
        const set = new Set(d.grounds || []);
        if (btn.checked) set.add(id); else set.delete(id);
        S.setGrounds(d, [...set]);
        // Состав правовых блоков пересобирается по выбору: он и есть ответ
        // на вопрос «что доказываем».
        for (const st of d.statements) {
          for (const b of S.statementBlocks(db, c, d, st)) {
            if (b.condition) b.ref.enabled = b.available;
          }
        }
        saveNow(); render();
        break;
      }

      case 'toggle-block': {
        const st = currentDoc();
        const ref = st && st.blocks.find((b) => b.id === id);
        if (ref) {
          ref.enabled = btn.checked;
          btn.closest('.blk').classList.toggle('off', !ref.enabled);
          const counter = $('.blocks .bh .m');
          if (counter) {
            const on = st.blocks.filter((b) => b.enabled).length;
            counter.textContent = 'включено ' + on + ' из ' + st.blocks.length;
          }
          save(); refreshBuilder();
        }
        break;
      }

      case 'open-block':
        if (openBlocks.has(id)) openBlocks.delete(id); else openBlocks.add(id);
        render();
        break;

      case 'insert-var': {
        const ta = $(`[data-blocktext="${id}"]`);
        if (ta) varsModal(ta);
        break;
      }

      case 'reset-block': {
        const st = currentDoc();
        const ref = st && st.blocks.find((b) => b.id === id);
        if (ref) { ref.text = null; saveNow(); render(); }
        break;
      }

      case 'reset-blocks':
        confirmBox('Собрать состав блоков заново по ответам на вопросы? Ручные правки состава пропадут.', () => {
          const st = currentDoc();
          st.blocks = [];
          S.statementBlocks(db, c, d, st);
          saveNow(); render();
        });
        break;

      case 'save-version': saveVersion(); break;
      case 'versions': versionsModal(); break;
      case 'preview-sheets': sheetsModal(id ? S.findStatement(d, id) : currentDoc()); break;
      case 'export-docx': exportDocx(id ? S.findStatement(d, id) : currentDoc()); break;

      case 'add-doc-kind': {
        const st = S.newStatement(id);
        d.statements.push(st);
        S.statementBlocks(db, c, d, st);
        saveNow();
        go('#/builder/' + c.id + '/' + d.id + '/' + st.id);
        break;
      }

      case 'del-doc-kind': {
        const st = S.findStatement(d, id);
        if (!st) break;
        confirmBox('Удалить «' + S.kindOf(st).name.toLowerCase() + '» вместе с версиями?', () => {
          d.statements = d.statements.filter((x) => x.id !== id);
          saveNow(); render();
        });
        break;
      }

      case 'new-lib':
        libModal({ id: '', name: '', description: '', group: 'Свои блоки', align: 'justify', condition: '', template: '', custom: true });
        break;

      case 'edit-lib': {
        const b = S.library(db).find((x) => x.id === id);
        if (b) libModal(JSON.parse(JSON.stringify(b)));
        break;
      }

      case 'reset-lib':
        delete db.edits[id];
        saveNow(); render();
        break;

      case 'del-lib':
        confirmBox('Удалить свой блок из библиотеки?', () => {
          db.customBlocks = db.customBlocks.filter((x) => x.id !== id);
          saveNow(); render();
        });
        break;
    }
  });

  /* ---------- перетаскивание блоков ---------- */

  let dragId = null;

  document.addEventListener('dragstart', (e) => {
    const blk = e.target.closest ? e.target.closest('.blk') : null;
    if (!blk) return;
    // Из раскрытого блока тянут текст, а не сам блок.
    if (e.target.closest('.body')) { e.preventDefault(); return; }
    dragId = blk.dataset.block;
    blk.classList.add('drag');
    e.dataTransfer.effectAllowed = 'move';
    // Firefox не начнёт перетаскивание без данных в буфере.
    e.dataTransfer.setData('text/plain', dragId);
  });

  document.addEventListener('dragend', () => {
    dragId = null;
    for (const el of $$('.blk')) el.classList.remove('drag', 'over');
  });

  document.addEventListener('dragover', (e) => {
    const blk = e.target.closest ? e.target.closest('.blk') : null;
    if (!dragId || !blk || blk.dataset.block === dragId) return;
    e.preventDefault();
    for (const el of $$('.blk')) el.classList.toggle('over', el === blk);
  });

  document.addEventListener('drop', (e) => {
    const blk = e.target.closest ? e.target.closest('.blk') : null;
    const d = currentDeal();
    if (!dragId || !blk || !d) return;
    e.preventDefault();

    const st = currentDoc();
    if (!st) return;
    const list = st.blocks;
    const from = list.findIndex((b) => b.id === dragId);
    const to = list.findIndex((b) => b.id === blk.dataset.block);
    if (from < 0 || to < 0 || from === to) return;

    list.splice(to, 0, list.splice(from, 1)[0]);
    list.forEach((b, i) => { b.order = i; });
    dragId = null;
    saveNow();
    render();
  });

  /* ---------- шапка и маршрут ---------- */

  $('#btn-profile').addEventListener('click', profileModal);
  $('#btn-backup').addEventListener('click', backupModal);

  addEventListener('hashchange', () => { route = parseHash(); render(); });
  addEventListener('resize', () => { if ($('#sheets')) fitSheets(document); });
  addEventListener('beforeunload', saveNow);

  route = parseHash();
  render();
})();
