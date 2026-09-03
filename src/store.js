/*
 * Модель данных, шаблонизатор и правила проверки.
 *
 * Хранилище — localStorage браузера. Своего сервера у приложения нет
 * намеренно: страница должна открываться двойным кликом с флешки, а
 * реквизиты должников и контрагентов — не покидать компьютер.
 *
 * Ни одна функция отсюда не знает про DOM: то же самое выполняется в Node,
 * и на этом построены тесты.
 */
(function () {
  'use strict';

  const D = globalThis.ZData;
  // Разбор отчёта ОКБ подключается отдельным файлом; без него приложение
  // работает как раньше, просто без таблиц по отчёту.
  const OKB = () => globalThis.ZOkb || null;
  const KEY = 'zayav-db';
  const SCHEMA = 1;

  const uid = () => 'x' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const now = () => new Date().toISOString();

  /* ================= каркасы сущностей ================= */

  function newDb() {
    return {
      schema: SCHEMA,
      profile: { name: '', sro: '', address: '', contacts: '', inn: '', snils: '', regNumber: '' },
      cases: [],
      customBlocks: [],     // блоки, созданные пользователем (§11)
      edits: {}             // правки текстов стандартных блоков: id → template
    };
  }

  function newParty(kind) {
    return {
      id: uid(), kind: kind || 'org',
      nameFull: '', nameShort: '', inn: '', ogrn: '',
      addressLegal: '', addressPostal: '', director: '', representative: '', powerBasis: '',
      fio: '', birthDate: '', birthPlace: '', snils: '', address: '', ogrnip: '',
      role: ''             // 'debtor' — должник дела, подставляется автоматически
    };
  }

  function newCase() {
    const debtor = newParty('org');
    debtor.role = 'debtor';
    return {
      id: uid(), createdAt: now(), updatedAt: now(),
      court: '', courtAddress: '', number: '',
      procedure: 'bankruptcy', procedureDate: '', judicialAct: '', caseStartDate: '',
      managerName: '', managerAddress: '', managerContacts: '', managerSro: '',
      managerInn: '', managerSnils: '', managerRegNumber: '',
      creditorsSum: '',
      accountsBalance: '',  // остаток на счетах должника — для ходатайства об отсрочке
      accountsBanks: '',
      offerDays: '10',      // срок ответа на предложение о возврате
      debtorNameGen: '',    // «…имуществом должника Абрамовой Зарият Руслановны»
      okb: null,            // урезанный кредитный отчёт ОКБ, если он загружен
      debtorId: debtor.id,
      parties: [debtor],
      deals: []
    };
  }

  function newObject(kind) {
    return {
      kind: kind || 'realty',
      // недвижимость
      realtyKind: '', address: '', cadastral: '', area: '', purpose: '', features: '',
      // транспортное средство
      brand: '', model: '', vin: '', plate: '', year: '',
      // денежные средства
      sum: '', payDate: '', orderNumber: '', accountFrom: '', accountTo: '', purposeText: '',
      // иное
      description: '',
      value: ''            // стоимость — общая для всех типов
    };
  }

  function newDeal() {
    return {
      id: uid(), createdAt: now(), updatedAt: now(),
      title: '',
      type: 'sale', typeOther: '',
      date: '', number: '', contractDate: '',
      amount: '', currency: 'RUB', subject: '',
      counterpartyId: '', otherPartyIds: [],
      object: newObject('realty'),
      performance: { state: 'full', date: '', method: '' },
      counter: { state: 'full', debtorValue: '', counterValue: '', note: '', reasons: '' },
      grounds: [],          // по каким пунктам оспариваем — выбирается первым шагом
      flags: {
        unequal: false, harm: false, affiliation: false, preference: false,
        awareness: false, sham: false
      },
      affiliationGrounds: [], affiliationNote: '',
      preferenceGrounds: [], preferenceNote: '',
      harmNote: '', awarenessNote: '', shamNote: '', circumstances: '',
      documents: [],
      // Документов по сделке несколько: заявление, ходатайство об отсрочке
      // пошлины, предложение о возврате. Данные у них общие, состав блоков —
      // свой.
      statements: [newStatement('statement')],
      fee: {
        claim: '',            // цена иска; пусто — берём рыночную стоимость объекта
        scale: 'org',         // шкала пп. 1 п. 1 ст. 333.21 НК РФ
        fixedPayer: 'person', // ставка пп. 2 п. 1 ст. 333.21 НК РФ
        withFixed: true,      // включать требование о признании сделки недействительной
        halved: true,         // пп. 9: обособленный спор в деле о банкротстве
        manual: ''            // ручная сумма, если расчёт расходится с практикой суда
      }
    };
  }

  /** Документ по сделке: заявление, ходатайство или предложение. */
  function newStatement(kind) {
    return { id: uid(), kind: kind || 'statement', status: 'draft', blocks: [], versions: [], seq: 0 };
  }

  const kindOf = (st) => D.byId(D.DOC_KINDS, (st && st.kind) || 'statement') || D.DOC_KINDS[0];
  const findStatement = (deal, id) => (deal.statements || []).find((x) => x.id === id) || null;
  const mainStatement = (deal) => (deal.statements || [])[0] || null;

  function newDocument() {
    return { id: uid(), name: '', type: 'contract', date: '', number: '', file: '', description: '', attach: true };
  }

  /* ================= загрузка и сохранение ================= */

  function load() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { /* приватный режим */ }
    if (!raw) return newDb();
    try {
      const db = JSON.parse(raw);
      return db && db.cases ? migrate(db) : newDb();
    } catch (e) {
      return newDb();
    }
  }

  function save(db) {
    try { localStorage.setItem(KEY, JSON.stringify(db)); return true; }
    catch (e) { return false; }
  }

  /** Дополняет старые записи полями, появившимися позже: чужие данные не теряем. */
  function migrate(db) {
    const base = newDb();
    for (const k of Object.keys(base)) if (db[k] === undefined) db[k] = base[k];
    for (const c of db.cases) {
      const cb = newCase();
      for (const k of Object.keys(cb)) if (c[k] === undefined && k !== 'parties' && k !== 'deals') c[k] = cb[k];
      c.parties = c.parties || [];
      c.deals = c.deals || [];
      for (const d of c.deals) {
        // Единственное заявление стало списком документов — переносим его,
        // сохранив состав блоков и версии.
        if (d.statement && !d.statements) {
          d.statements = [Object.assign(newStatement('statement'), d.statement)];
          delete d.statement;
        }
        const proto = newDeal();
        for (const k of Object.keys(proto)) if (d[k] === undefined) d[k] = proto[k];
        d.object = Object.assign(newObject(d.object && d.object.kind), d.object || {});
        d.statements = (d.statements.length ? d.statements : [newStatement('statement')])
          .map((st) => Object.assign(newStatement(st.kind), st));
      }
    }
    db.schema = SCHEMA;
    return db;
  }

  /* ================= стороны ================= */

  const partyName = (p) => {
    if (!p) return '';
    if (p.kind === 'org') return p.nameFull || p.nameShort || '';
    if (p.kind === 'ip') return p.fio ? 'индивидуальный предприниматель ' + p.fio : '';
    return p.fio || '';
  };

  const partyShort = (p) => {
    if (!p) return '';
    if (p.kind === 'org') return p.nameShort || p.nameFull || '';
    if (p.kind === 'ip') return p.fio ? 'ИП ' + p.fio : '';
    return p.fio || '';
  };

  const partyInn = (p) => (p ? p.inn : '') || '';
  const partyOgrn = (p) => (p ? (p.kind === 'ip' ? p.ogrnip : p.ogrn) : '') || '';
  const partyAddress = (p) => (p ? (p.kind === 'org' ? (p.addressLegal || p.addressPostal) : p.address) : '') || '';

  /** «ИНН 1234567890, ОГРН 1234567890123» — только то, что заполнено. */
  function partyRequisites(p) {
    if (!p) return '';
    const bits = [];
    if (partyInn(p)) bits.push('ИНН ' + partyInn(p));
    if (partyOgrn(p)) bits.push((p.kind === 'ip' ? 'ОГРНИП ' : 'ОГРН ') + partyOgrn(p));
    if (p.kind === 'person' && p.birthDate) bits.push('дата рождения ' + D.dateShort(p.birthDate));
    return bits.join(', ');
  }

  const findParty = (kase, id) => (kase.parties || []).find((p) => p.id === id) || null;
  const debtorOf = (kase) => findParty(kase, kase.debtorId);
  const counterpartyOf = (kase, deal) => findParty(kase, deal.counterpartyId);

  /* ================= описание объекта ================= */

  function objectDescription(deal) {
    const o = deal.object || {};
    const bits = [];
    if (o.kind === 'realty') {
      if (o.realtyKind) bits.push(o.realtyKind.toLowerCase());
      if (o.address) bits.push('расположенный по адресу: ' + o.address);
      if (o.cadastral) bits.push('кадастровый номер ' + o.cadastral);
      if (o.area) bits.push('площадью ' + o.area + ' кв. м');
      if (o.purpose) bits.push('назначение: ' + o.purpose);
      if (o.features) bits.push(o.features);
    } else if (o.kind === 'vehicle') {
      const car = [o.brand, o.model].filter(Boolean).join(' ');
      if (car) bits.push('транспортное средство ' + car);
      if (o.year) bits.push(o.year + ' года выпуска');
      if (o.vin) bits.push('VIN ' + o.vin);
      if (o.plate) bits.push('государственный регистрационный знак ' + o.plate);
    } else if (o.kind === 'money') {
      if (o.sum !== '' && o.sum != null) bits.push('денежные средства в размере ' + D.money(o.sum) + ' руб.');
      if (o.orderNumber) bits.push('платёжное поручение № ' + o.orderNumber);
      if (o.payDate) bits.push('от ' + D.dateShort(o.payDate));
      if (o.accountFrom) bits.push('со счёта ' + o.accountFrom);
      if (o.accountTo) bits.push('на счёт ' + o.accountTo);
      if (o.purposeText) bits.push('назначение платежа: ' + o.purposeText);
    } else {
      if (o.description) bits.push(o.description);
    }
    return bits.join(', ');
  }

  /** Стоимость объекта: явно указанная, а если её нет — сумма сделки. */
  function objectValue(deal) {
    const o = deal.object || {};
    if (o.value !== '' && o.value != null) return o.value;
    if (o.kind === 'money' && o.sum !== '' && o.sum != null) return o.sum;
    return deal.amount;
  }

  const dealTypeName = (deal) => deal.type === 'other'
    ? (deal.typeOther || 'иная сделка')
    : D.nameOf(D.DEAL_TYPES, deal.type);

  const dealTypeGen = (deal) => {
    if (deal.type === 'other') return deal.typeOther || 'иной сделки';
    const t = D.byId(D.DEAL_TYPES, deal.type);
    return t ? t.gen : '';
  };

  /** «за 8 месяцев», «за 2 года 3 месяца» — расстояние от сделки до возбуждения дела. */
  function periodBefore(dealDate, caseStart) {
    if (!dealDate || !caseStart) return '';
    const a = new Date(dealDate + 'T00:00:00Z'), b = new Date(caseStart + 'T00:00:00Z');
    if (isNaN(a) || isNaN(b) || b < a) return '';
    let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
    if (b.getUTCDate() < a.getUTCDate()) months--;
    if (months < 1) {
      const days = Math.round((b - a) / 86400000);
      return 'за ' + days + ' ' + D.plural(days, 'день', 'дня', 'дней');
    }
    const y = Math.floor(months / 12), m = months % 12;
    const out = [];
    if (y) out.push(y + ' ' + D.plural(y, 'год', 'года', 'лет'));
    if (m) out.push(m + ' ' + D.plural(m, 'месяц', 'месяца', 'месяцев'));
    return 'за ' + out.join(' ');
  }

  const grounds = (list, ids, other) => (ids || [])
    .map((id) => (id === 'other' ? (other || 'иное') : D.nameOf(list, id)))
    .filter(Boolean).join('; ').toLowerCase();

  /* ================= контекст переменных ================= */

  /**
   * Плоский набор {{ПЕРЕМЕННАЯ}} → строка. Один источник для предпросмотра,
   * DOCX и печати: расхождений между тем, что видно, и тем, что выгружено,
   * быть не должно.
   */
  function context(db, kase, deal) {
    const debtor = debtorOf(kase);
    const cp = counterpartyOf(kase, deal);
    const proc = D.byId(D.PROCEDURES, kase.procedure);
    const o = deal.object || {};
    const perf = D.byId(D.PERFORMANCE, deal.performance.state);
    const counter = D.byId(D.COUNTER, deal.counter.state);
    const gap = gapValue(deal);
    const claim = claimPrice(deal);
    const fee = feeCalc(deal);
    const feeKnown = fee.manual || claim > 0;

    const v = {
      CASE_NUMBER: kase.number,
      COURT_NAME: kase.court,
      COURT_ADDRESS: kase.courtAddress,
      PROCEDURE: proc ? proc.name : '',
      PROCEDURE_DATE: D.dateLong(kase.procedureDate),
      JUDICIAL_ACT: kase.judicialAct,
      CASE_START_DATE: D.dateLong(kase.caseStartDate),
      MANAGER_ROLE: proc ? proc.manager : '',
      MANAGER_ROLE_GEN: proc ? proc.managerGen : '',
      MANAGER_ROLE_INS: proc ? proc.managerIns : '',
      MANAGER_NAME: kase.managerName || db.profile.name,
      MANAGER_ADDRESS: kase.managerAddress || db.profile.address,
      MANAGER_CONTACTS: kase.managerContacts || db.profile.contacts,
      MANAGER_SRO: kase.managerSro || db.profile.sro,
      MANAGER_INN: kase.managerInn || db.profile.inn,
      MANAGER_SNILS: kase.managerSnils || db.profile.snils,
      MANAGER_REG_NUMBER: kase.managerRegNumber || db.profile.regNumber,
      CREDITORS_SUM: D.money(kase.creditorsSum),

      DEBTOR_NAME: partyName(debtor),
      DEBTOR_NAME_GEN: debtorGen(kase, debtor),
      MANAGER_TITLE: managerTitle(kase, debtor, proc),
      DEBTOR_SHORT: partyShort(debtor),
      DEBTOR_INN: partyInn(debtor),
      DEBTOR_OGRN: partyOgrn(debtor),
      DEBTOR_ADDRESS: partyAddress(debtor),
      DEBTOR_REQUISITES: partyRequisites(debtor),
      DEBTOR_BIRTH_DATE: debtor ? D.dateShort(debtor.birthDate) : '',
      DEBTOR_BIRTH_PLACE: debtor ? debtor.birthPlace : '',
      DEBTOR_SNILS: debtor ? debtor.snils : '',
      // «(15.03.1990 г.р., место рожд.: …, адрес рег.: …, СНИЛС …, ИНН …)» —
      // так реквизиты гражданина печатают в первом абзаце заявления.
      DEBTOR_PASSPORT_BLOCK: debtorBlock(debtor),

      COUNTERPARTY_NAME: partyName(cp),
      COUNTERPARTY_SHORT: partyShort(cp),
      COUNTERPARTY_INN: partyInn(cp),
      COUNTERPARTY_OGRN: partyOgrn(cp),
      COUNTERPARTY_ADDRESS: partyAddress(cp),
      COUNTERPARTY_REQUISITES: partyRequisites(cp),

      DEAL_TYPE: dealTypeName(deal),
      DEAL_TYPE_GEN: dealTypeGen(deal),
      DEAL_DATE: D.dateLong(deal.date),
      DEAL_DATE_SHORT: D.dateShort(deal.date),
      DEAL_NUMBER: deal.number,
      CONTRACT_DATE: D.dateLong(deal.contractDate || deal.date),
      DEAL_AMOUNT: D.money(deal.amount),
      DEAL_AMOUNT_WORDS: D.moneyWords(deal.amount),
      DEAL_CURRENCY: D.nameOf(D.CURRENCIES, deal.currency),
      DEAL_SUBJECT: deal.subject || objectDescription(deal),
      DEAL_PERIOD: periodBefore(deal.date, kase.caseStartDate),

      OBJECT_TYPE: D.nameOf(D.OBJECT_TYPES, o.kind).toLowerCase(),
      OBJECT_DESCRIPTION: objectDescription(deal),
      OBJECT_ADDRESS: o.address,
      CADASTRAL_NUMBER: o.cadastral,
      OBJECT_AREA: o.area,
      OBJECT_VALUE: D.money(objectValue(deal)),
      OBJECT_VALUE_WORDS: D.moneyWords(objectValue(deal)),
      VEHICLE_VIN: o.vin,
      VEHICLE_PLATE: o.plate,
      PAYMENT_ORDER: o.orderNumber,
      PAYMENT_PURPOSE: o.purposeText,
      PAYMENT_DATE: D.dateLong(o.payDate),
      ACCOUNT_FROM: o.accountFrom,
      ACCOUNT_TO: o.accountTo,

      PERFORMANCE_STATE: perf ? perf.name.toLowerCase() : '',
      PERFORMANCE_DATE: D.dateLong(deal.performance.date),
      PERFORMANCE_METHOD: deal.performance.method,
      COUNTER_STATE: counter ? counter.name.toLowerCase() : '',
      DEBTOR_VALUE: D.money(deal.counter.debtorValue),
      COUNTER_VALUE: D.money(deal.counter.counterValue),
      COUNTER_GAP: D.money(gap),
      COUNTER_GAP_WORDS: D.moneyWords(gap),
      COUNTER_NOTE: deal.counter.note || deal.counter.reasons,

      AFFILIATION_GROUNDS: grounds(D.AFFILIATION_GROUNDS, deal.affiliationGrounds, deal.affiliationNote),
      AFFILIATION_NOTE: deal.affiliationNote,
      PREFERENCE_GROUNDS: grounds(D.PREFERENCE_GROUNDS, deal.preferenceGrounds, deal.preferenceNote),
      PREFERENCE_NOTE: deal.preferenceNote,
      HARM_NOTE: deal.harmNote,
      SHAM_NOTE: deal.shamNote,
      AWARENESS_NOTE: deal.awarenessNote,
      CIRCUMSTANCES: deal.circumstances,

      // Пока цена иска не заполнена, пошлины нет: имущественная часть
      // неизвестна, и в предпросмотре это место подсветится как незаполненное,
      // а не покажет уверенную сумму из одной твёрдой ставки.
      CLAIM_PRICE: claim > 0 ? D.money(claim) : '',
      FEE_AMOUNT: feeKnown ? D.money(fee.total) : '',
      FEE_WORDS: feeKnown ? D.moneyWords(fee.total) : '',
      FEE_CALC: feeKnown ? feeText(deal) : '',

      TODAY: D.dateLong(new Date().toISOString().slice(0, 10)),
      ATTACHMENTS: attachments(deal).map((a, i) => (i + 1) + '. ' + a).join('\n'),
      ACCOUNTS_BALANCE: D.money(kase.accountsBalance),
      ACCOUNTS_BANKS: kase.accountsBanks,
      OFFER_DAYS: kase.offerDays || '10'
    };

    // Цифры из кредитного отчёта — отдельным набором, чтобы блоки могли
    // сослаться на них, не вставляя таблицу целиком.
    if (OKB()) Object.assign(v, OKB().vars(kase.okb, deal.date));

    for (const k of Object.keys(v)) if (v[k] == null) v[k] = '';
    return v;
  }

  /** Разница между исполнением должника и встречным исполнением. */
  function gapValue(deal) {
    const a = Number(deal.counter.debtorValue);
    if (deal.counter.debtorValue === '' || !isFinite(a)) return '';
    const b = Number(deal.counter.counterValue);
    const got = deal.counter.counterValue === '' ? 0 : (isFinite(b) ? b : 0);
    return a - got;
  }

  /**
   * Должник в родительном падеже. Склоняем только людей: у организации
   * наименование в кавычках не склоняется, и «ООО «Ромашка»а» — ровно тот
   * мусор, который потом уедет в суд.
   */
  function debtorGen(kase, debtor) {
    if (kase.debtorNameGen) return kase.debtorNameGen;
    if (!debtor) return '';
    if (debtor.kind === 'org') return D.genitiveOrg(partyName(debtor));
    return D.genitiveFio(partyName(debtor));
  }

  /**
   * Как заявитель называет себя в шапке. У гражданина управляющий
   * распоряжается имуществом («финансовый управляющий имуществом должника
   * Ивановой И. И.»), у организации — самой организацией.
   */
  function managerTitle(kase, debtor, proc) {
    const role = proc ? proc.manager : 'арбитражный управляющий';
    const name = debtorGen(kase, debtor);
    if (!name) return role;
    return debtor && debtor.kind === 'org'
      ? role + ' ' + name
      : role + ' имуществом должника ' + name;
  }

  /** Скобка с реквизитами гражданина-должника; пустые поля пропускаются. */
  function debtorBlock(debtor) {
    if (!debtor || debtor.kind === 'org') return '';
    const bits = [];
    if (debtor.birthDate) bits.push(D.dateShort(debtor.birthDate) + ' г.р.');
    if (debtor.birthPlace) bits.push('место рожд.: ' + debtor.birthPlace);
    if (debtor.address) bits.push('адрес рег.: ' + debtor.address);
    if (debtor.snils) bits.push('СНИЛС ' + debtor.snils);
    if (debtor.inn) bits.push('ИНН ' + debtor.inn);
    return bits.length ? '(' + bits.join(', ') + ')' : '';
  }

  /* ================= государственная пошлина ================= */

  /** Цена иска: заданная вручную, иначе рыночная стоимость, иначе сумма сделки. */
  function claimPrice(deal) {
    const f = deal.fee || {};
    if (f.claim !== '' && f.claim != null) return Number(f.claim);
    const v = Number(objectValue(deal));
    return isFinite(v) ? v : 0;
  }

  /**
   * Расчёт пошлины с показом каждого шага: сумму в заявлении подписывает
   * человек, и он должен видеть, из чего она сложилась, а не доверять
   * чёрному ящику.
   *
   * Требований в заявлении обычно два — признать сделку недействительной
   * (пп. 2 п. 1 ст. 333.21 НК РФ, твёрдая ставка) и применить последствия,
   * то есть вернуть имущество (пп. 1, по цене иска). По обособленным спорам
   * в деле о банкротстве платится половина (пп. 9).
   */
  function feeCalc(deal) {
    const f = Object.assign({ scale: 'org', fixedPayer: 'person', withFixed: true, halved: true }, deal.fee || {});
    const claim = claimPrice(deal);
    const steps = [];

    const byValue = D.feeByValue(claim, f.scale);
    const scaleName = (D.FEE_SCALES[f.scale] || D.FEE_SCALES.org).name;
    let sum = byValue.sum;
    steps.push({
      text: 'Требование имущественного характера, подлежащее оценке (пп. 1 п. 1 ст. 333.21 НК РФ), ' +
        'цена иска ' + D.money(claim) + ' руб., ставка для «' + scaleName + '»: ' +
        D.money(byValue.step.base) + (byValue.step.rate
          ? ' руб. + ' + (byValue.step.rate * 100).toString().replace('.', ',') + ' % от суммы свыше ' +
            D.money(byValue.step.over) + ' руб.'
          : ' руб.'),
      sum: byValue.sum
    });

    const fixed = f.withFixed ? (D.FEE_INVALIDATION[f.fixedPayer] || 0) : 0;
    if (fixed) {
      sum += fixed;
      steps.push({
        text: 'Требование о признании сделки недействительной (пп. 2 п. 1 ст. 333.21 НК РФ), ' +
          'ставка для «' + (f.fixedPayer === 'org' ? 'организация' : 'физическое лицо') + '»',
        sum: fixed
      });
    }

    const subtotal = sum;
    let total = subtotal;
    if (f.halved) {
      total = subtotal * D.FEE_BANKRUPTCY_SHARE;
      steps.push({
        text: 'Обособленный спор в деле о банкротстве — 50 % (пп. 9 п. 1 ст. 333.21 НК РФ)',
        sum: total
      });
    }

    const manual = f.manual !== '' && f.manual != null && isFinite(Number(f.manual));
    return {
      claim: claim,
      byValue: byValue.sum,
      fixed: fixed,
      subtotal: subtotal,
      total: manual ? Number(f.manual) : total,
      manual: manual,
      steps: steps
    };
  }

  /** Расчёт одной строкой — для подстановки в текст заявления. */
  function feeText(deal) {
    const c = feeCalc(deal);
    if (c.manual) return D.money(c.total) + ' руб.';
    const parts = c.steps.filter((s) => s.sum !== c.total || !( deal.fee || {}).halved)
      .map((s) => s.text + ' — ' + D.money(s.sum) + ' руб.');
    return parts.join('; ') + (( deal.fee || {}).halved
      ? '; итого с учётом 50 % — ' + D.money(c.total) + ' руб.' : '');
  }

  /* ================= условия ================= */

  /** Контекст для условий блоков: `deal.unequal = true`, `case.procedure = bankruptcy`. */
  function condContext(kase, deal) {
    return {
      deal: {
        unequal: !!deal.flags.unequal,
        harm: !!deal.flags.harm,
        affiliation: !!deal.flags.affiliation,
        preference: !!deal.flags.preference,
        awareness: !!deal.flags.awareness,
        sham: !!deal.flags.sham,
        hasUnequalPerformance: !!deal.flags.unequal,
        type: deal.type,
        objectType: (deal.object || {}).kind,
        performance: deal.performance.state,
        counter: deal.counter.state,
        amount: Number(deal.amount) || 0,
        documents: (deal.documents || []).length
      },
      case: {
        procedure: kase.procedure,
        number: kase.number,
        okb: !!(kase.okb && (kase.okb.contracts || []).length)
      }
    };
  }

  const LEAF = /^\s*([A-Za-z_][\w.]*)\s*(>=|<=|!=|=|>|<)\s*(.+?)\s*$/;

  /**
   * Условия из ТЗ (§11) записаны человекочитаемо, поэтому и разбор здесь
   * простой: сравнения, склеенные AND / OR. Никакого eval — выражение
   * приходит из редактируемого шаблона, а исполнять чужой код не нужно.
   */
  function evalCondition(expr, ctx) {
    const s = String(expr || '').trim();
    if (!s) return true;
    if (/\sOR\s/i.test(s)) return s.split(/\s+OR\s+/i).some((p) => evalCondition(p, ctx));
    if (/\sAND\s/i.test(s)) return s.split(/\s+AND\s+/i).every((p) => evalCondition(p, ctx));

    const m = LEAF.exec(s);
    if (!m) return true;              // непонятное условие блок не прячет
    const left = m[1].split('.').reduce((o, k) => (o == null ? o : o[k]), ctx);
    const right = literal(m[3]);
    const op = m[2];

    if (op === '=') return eq(left, right);
    if (op === '!=') return !eq(left, right);
    const a = Number(left), b = Number(right);
    if (!isFinite(a) || !isFinite(b)) return false;
    return op === '>' ? a > b : op === '<' ? a < b : op === '>=' ? a >= b : a <= b;
  }

  function literal(raw) {
    const t = raw.trim().replace(/^['"]|['"]$/g, '');
    if (/^true$/i.test(t)) return true;
    if (/^false$/i.test(t)) return false;
    if (t !== '' && isFinite(Number(t))) return Number(t);
    return t;
  }

  const eq = (a, b) => (typeof b === 'boolean' ? !!a === b : String(a == null ? '' : a) === String(b));

  /* ================= шаблонизатор ================= */

  // Метки незаполненного значения. Управляющие символы выбраны намеренно:
  // в юридическом тексте их не бывает, поэтому подсветка не сработает
  // случайно на данных, введённых пользователем.
  const MISS_A = '\u0001', MISS_B = '\u0002';
  const VAR_RE = /\{\{\s*([A-Z_][A-Z0-9_]*)\s*\}\}/g;

  /**
   * Подстановка переменных. mark=true оставляет метку вокруг незаполненного
   * значения — предпросмотр подсвечивает такие места; в DOCX и на печать
   * идёт прочерк, чтобы документ можно было дозаполнить от руки.
   */
  function render(tpl, vars, mark) {
    return String(tpl || '').replace(VAR_RE, (all, name) => {
      const val = vars[name];
      if (val != null && String(val).trim() !== '') return String(val);
      const label = D.VAR_INDEX.has(name) ? D.VAR_INDEX.get(name).label : name;
      return mark ? MISS_A + label + MISS_B : '__________';
    });
  }

  /** Какие переменные блока остались незаполненными. */
  function missingVars(tpl, vars) {
    const out = [];
    String(tpl || '').replace(VAR_RE, (all, name) => {
      const val = vars[name];
      if ((val == null || String(val).trim() === '') && !out.includes(name)) out.push(name);
      return all;
    });
    return out;
  }

  /* ================= приложения ================= */

  /** «Договор купли-продажи № 15 от 15.04.2025» — строка приложения. */
  function documentLine(doc) {
    const type = D.nameOf(D.DOC_TYPES, doc.type);
    const bits = [doc.name || type];
    if (doc.number) bits.push('№ ' + doc.number);
    if (doc.date) bits.push('от ' + D.dateShort(doc.date));
    let line = bits.join(' ');
    if (doc.description) line += ' — ' + doc.description;
    return line;
  }

  /** Сквозной список приложений: нумерация пересобирается при каждом изменении (§16). */
  function attachments(deal) {
    return (deal.documents || []).filter((d) => d.attach !== false).map(documentLine);
  }

  /**
   * Выбор оснований — единственный источник правды о том, какие правовые
   * блоки нужны. Флаги пересчитываются из него, а не заводятся отдельно:
   * иначе они рано или поздно разойдутся с тем, что человек отметил.
   */
  function setGrounds(deal, ids) {
    deal.grounds = (ids || []).slice();
    for (const g of D.GROUNDS) deal.flags[g.id] = deal.grounds.includes(g.id);
  }

  const groundNames = (deal) => (deal.grounds || [])
    .map((id) => D.byId(D.GROUNDS, id))
    .filter(Boolean);

  /* ================= блоки заявления ================= */

  /** Библиотека = стандартные блоки (с учётом правок) + пользовательские. */
  function library(db, kind) {
    const has = (id) => Object.prototype.hasOwnProperty.call(db.edits || {}, id);
    const std = D.BLOCKS.map((b) => Object.assign({}, b, {
      kinds: b.kinds || ['statement'],
      template: has(b.id) ? db.edits[b.id] : b.template,
      edited: has(b.id)
    }));
    const own = (db.customBlocks || []).map((b) =>
      Object.assign({ custom: true, kinds: b.kinds || ['statement'] }, b));
    const all = std.concat(own);
    if (!kind) return all;

    // Порядок задан видом документа; всё, что в его перечень не попало,
    // дописывается в конец — так свой блок не теряется.
    const order = (D.byId(D.DOC_KINDS, kind) || {}).blocks || [];
    const mine = all.filter((b) => (b.kinds || ['statement']).includes(kind));
    const rank = (b) => {
      const at = order.indexOf(b.id);
      return at < 0 ? order.length : at;
    };
    return mine.slice().sort((a, b) => rank(a) - rank(b));
  }

  /**
   * Состав заявления. При первом заходе строится из библиотеки: обязательные
   * блоки включены, условные — по фактам сделки. Дальше решает пользователь,
   * и его выбор не перетирается.
   */
  function statementBlocks(db, kase, deal, statement) {
    const st = statement || mainStatement(deal);
    const lib = library(db, st.kind);
    const ctx = condContext(kase, deal);
    const known = new Map(lib.map((b) => [b.id, b]));

    if (!st.blocks.length) {
      st.blocks = lib.map((b, i) => ({
        id: b.id, order: i,
        enabled: b.required ? true : (b.condition ? evalCondition(b.condition, ctx) : true),
        text: null
      }));
    } else {
      // Новый блок в библиотеке (например, свой) должен появиться в конце,
      // а не исчезнуть молча.
      const have = new Set(st.blocks.map((x) => x.id));
      let order = st.blocks.length;
      for (const b of lib) {
        if (have.has(b.id)) continue;
        st.blocks.push({ id: b.id, order: order++, enabled: !!b.required, text: null });
      }
      st.blocks = st.blocks.filter((x) => known.has(x.id));
    }

    st.blocks.sort((a, b) => a.order - b.order);
    st.blocks.forEach((x, i) => { x.order = i; });

    return st.blocks.map((x) => {
      const b = known.get(x.id);
      return {
        ref: x,
        id: b.id, name: b.name, description: b.description || '', group: b.group || 'Прочее',
        align: b.align || 'justify', bold: !!b.bold, required: !!b.required,
        condition: b.condition || '', auto: b.auto || '', custom: !!b.custom, edited: !!b.edited,
        template: x.text != null ? x.text : b.template,
        overridden: x.text != null,
        enabled: !!x.enabled,
        available: b.condition ? evalCondition(b.condition, ctx) : true
      };
    });
  }

  /**
   * Готовый документ: массив абзацев с выравниванием. На этом виде строятся
   * и предпросмотр, и печать, и DOCX — три представления одного результата.
   */
  function buildDocument(db, kase, deal, opts) {
    const mark = !!(opts && opts.mark);
    const st = (opts && opts.statement) || mainStatement(deal);
    const vars = context(db, kase, deal);
    const out = [];

    for (const b of statementBlocks(db, kase, deal, st)) {
      if (!b.enabled) continue;
      const lines = render(b.template, vars, mark).split('\n').map((s) => s.replace(/[ \t]+$/, ''));
      let first = true;
      for (const line of lines) {
        // Пустые строки шаблона — разделители внутри блока. Пустой абзац
        // в начале и в конце документа выглядел бы дырой, поэтому в вывод
        // попадают только те, между которыми есть текст.
        if (line.trim() === '') {
          if (!first && out.length && out[out.length - 1].kind === 'p' && out[out.length - 1].text.trim() !== '') out.push({ kind: 'p', text: '', align: b.align, bold: b.bold, blockId: b.id });
          continue;
        }
        out.push({ kind: 'p', text: line, align: b.align, bold: b.bold, blockId: b.id, first: first });
        first = false;
      }
      if (out.length && out[out.length - 1].kind === 'p' && out[out.length - 1].text.trim() === '') out.pop();

      const table = autoTable(b, kase, deal);
      if (table) out.push(table);
    }
    return out;
  }

  /** Блок с пометкой auto подставляет не текст, а таблицу по отчёту ОКБ. */
  function autoTable(block, kase, deal) {
    if (!OKB() || !kase.okb) return null;
    if (block.auto === 'table_insolvency') return OKB().tableInsolvency(kase.okb, { limit: 30 });
    if (block.auto === 'table_overdue') return OKB().tableOverdue(kase.okb, deal.date, { limit: 30 });
    return null;
  }

  /** Плоский текст документа — для версий и сравнения. */
  const documentText = (db, kase, deal, st) =>
    buildDocument(db, kase, deal, { mark: false, statement: st })
      .map((p) => (p.kind === 'table'
        ? [p.head.join(' | ')].concat(p.rows.map((r) => r.join(' | ')),
          p.total ? [p.total.join(' | ')] : []).join('\n')
        : p.text))
      .join('\n');

  /* ================= проверка ================= */

  /**
   * Ошибки не дают сформировать документ, предупреждения — только сигналят.
   * Все проверки — обычные правила, никакой «оценки перспектив» (§28).
   */
  function validate(db, kase, deal, statement) {
    const st = statement || mainStatement(deal);
    const errors = [], warnings = [];
    const debtor = debtorOf(kase);
    const cp = counterpartyOf(kase, deal);
    const req = (cond, field, where) => { if (!cond) errors.push({ field, where }); };

    req(kase.number, 'Номер дела', 'case');
    req(kase.court, 'Наименование суда', 'case');
    req(partyName(debtor), 'Наименование должника', 'case');
    req(kase.managerName || db.profile.name, 'ФИО арбитражного управляющего', 'case');
    req(deal.date, 'Дата сделки', 'deal');
    req(deal.amount !== '' && deal.amount != null, 'Сумма сделки', 'deal');
    req(cp && partyName(cp), 'Контрагент по сделке', 'deal');

    const blocks = statementBlocks(db, kase, deal, st);
    if (!blocks.some((b) => b.enabled)) errors.push({ field: 'Не выбран ни один блок документа', where: 'builder' });

    // Логические проверки (§14)
    const perfDate = deal.performance.date;
    const base = deal.contractDate || deal.date;
    if (perfDate && base && perfDate < base) {
      warnings.push('Дата исполнения сделки (' + D.dateShort(perfDate) +
        ') раньше даты заключения договора (' + D.dateShort(base) + ').');
    }
    if (deal.date && kase.caseStartDate && deal.date > kase.caseStartDate) {
      warnings.push('Сделка совершена после возбуждения дела о банкротстве — периоды подозрительности ' +
        'по статье 61.2 считаются от даты принятия заявления.');
    }
    if (deal.contractDate && deal.date && deal.contractDate > deal.date) {
      warnings.push('Дата договора позже даты сделки.');
    }
    const o = deal.object || {};
    if (o.kind === 'money' && o.sum !== '' && deal.amount !== '' && Number(o.sum) !== Number(deal.amount)) {
      warnings.push('Сумма сделки (' + D.money(deal.amount) + ' руб.) отличается от суммы платежа (' +
        D.money(o.sum) + ' руб.).');
    }

    const on = (id) => blocks.some((b) => b.id === id && b.enabled);
    if (on('unequal') && (deal.counter.debtorValue === '' || deal.counter.counterValue === '')) {
      warnings.push('Выбран блок «Неравноценное встречное исполнение», но не заполнены стоимости ' +
        'исполнения должника и встречного исполнения.');
    }
    if (on('affiliation') && !(deal.affiliationGrounds || []).length) {
      warnings.push('Выбран блок «Заинтересованность сторон», но основания заинтересованности не указаны.');
    }
    if (on('preference') && !(deal.preferenceGrounds || []).length) {
      warnings.push('Выбран блок «Предпочтительное удовлетворение», но основания предпочтения не указаны.');
    }
    if (on('attachments') && !attachments(deal).length) {
      warnings.push('Блок «Приложения» включён, но к сделке не приложено ни одного документа.');
    }
    if (deal.counter.state === 'partial' && deal.counter.counterValue === '') {
      warnings.push('Встречное исполнение указано как частичное, но его стоимость не заполнена.');
    }

    // Незаполненные переменные включённых блоков
    const vars = context(db, kase, deal);
    const missing = new Set();
    for (const b of blocks) if (b.enabled) for (const n of missingVars(b.template, vars)) missing.add(n);

    return { errors, warnings, missingVars: [...missing], ok: errors.length === 0 };
  }

  /* ================= версии ================= */

  function saveVersion(db, kase, deal, statement, note) {
    const st = statement || mainStatement(deal);
    st.seq = (st.seq || 0) + 1;
    st.versions.push({
      id: uid(), no: st.seq, createdAt: now(), note: note || '',
      text: documentText(db, kase, deal, st),
      blocks: JSON.parse(JSON.stringify(st.blocks))
    });
    return st.versions[st.versions.length - 1];
  }

  function restoreVersion(statement, versionId) {
    const v = statement.versions.find((x) => x.id === versionId);
    if (!v) return false;
    statement.blocks = JSON.parse(JSON.stringify(v.blocks));
    return true;
  }

  /**
   * Построчное сравнение двух версий. Наибольшая общая подпоследовательность:
   * строки заявления длинные и почти не повторяются, поэтому простой LCS
   * даёт понятный человеку результат.
   */
  function diffLines(aText, bText) {
    const a = String(aText).split('\n'), b = String(bText).split('\n');
    const n = a.length, m = b.length;
    const w = m + 1;
    const dp = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * w + j] = a[i] === b[j]
          ? dp[(i + 1) * w + j + 1] + 1
          : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
      }
    }
    const out = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { out.push({ op: ' ', text: a[i] }); i++; j++; }
      else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) { out.push({ op: '-', text: a[i] }); i++; }
      else { out.push({ op: '+', text: b[j] }); j++; }
    }
    while (i < n) out.push({ op: '-', text: a[i++] });
    while (j < m) out.push({ op: '+', text: b[j++] });
    return out;
  }

  /* ================= копирование сделки ================= */

  /** «Создать на основе этой сделки» (§18): стороны и структура сохраняются. */
  function cloneDeal(deal) {
    const copy = JSON.parse(JSON.stringify(deal));
    copy.id = uid();
    copy.createdAt = copy.updatedAt = now();
    // Реквизиты конкретной сделки — то немногое, что заведомо другое.
    copy.number = '';
    copy.date = '';
    copy.contractDate = '';
    copy.documents = [];
    for (const st of copy.statements) {
      st.id = uid();
      st.versions = [];
      st.seq = 0;
      st.status = 'draft';
    }
    return copy;
  }

  globalThis.ZStore = {
    KEY, SCHEMA, uid, now,
    newDb, newCase, newParty, newDeal, newObject, newDocument, newStatement,
    kindOf, findStatement, mainStatement, setGrounds, groundNames,
    load, save, migrate,
    partyName, partyShort, partyInn, partyOgrn, partyAddress, partyRequisites,
    findParty, debtorOf, counterpartyOf,
    objectDescription, objectValue, dealTypeName, dealTypeGen, periodBefore, gapValue,
    claimPrice, feeCalc, feeText, debtorGen, managerTitle, debtorBlock,
    context, condContext, evalCondition, render, missingVars,
    documentLine, attachments,
    library, statementBlocks, buildDocument, documentText, autoTable,
    validate, saveVersion, restoreVersion, diffLines, cloneDeal,
    MISS_A, MISS_B
  };
})();
