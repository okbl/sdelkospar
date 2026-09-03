/*
 * Таблицы по кредитному отчёту ОКБ.
 *
 * Разбор PDF делает parser.js — тот же файл, что и в анализаторе отчётов,
 * скопированный без правок. Здесь только выборка: когда по каждому договору
 * возникла просрочка, чему она равнялась и что было на дату оспариваемой
 * сделки.
 *
 * Выводов приложение не делает. «Момент неплатёжеспособности» — правовая
 * квалификация, и её даёт человек; таблица показывает факты из отчёта и
 * самую раннюю просрочку, а формулировку заявления пишет управляющий.
 *
 * Отчёт хранится в деле в урезанном виде: из сотни страниц берутся только
 * поля, нужные таблицам. Иначе одно дело займёт весь localStorage.
 */
(function () {
  'use strict';

  const D = globalThis.ZData;

  /* ================= хранимый вид отчёта ================= */

  /** Из разобранного отчёта оставляем только то, что попадёт в таблицы. */
  function compact(report) {
    const contracts = (report.contracts || []).map((c) => ({
      creditor: c.creditor || '',
      kind: shortKind(c.kind),
      number: c.contractNumber || '',
      date: c.contractDate || null,
      closed: !!c.isClosed,
      assigned: !!c.isAssigned,
      amount: c.amount && c.amount.value != null ? c.amount.value : null,
      page: c.page || null,
      snapshots: (c.debtSnapshots || []).map((s) => ({
        date: s.date, principal: s.principal, total: s.total,
        overdue: s.overdue || 0, since: s.overdueSince || null, days: s.overdueDays || 0
      }))
    })).filter((c) => c.snapshots.length || c.creditor);

    return {
      fio: (report.meta && report.meta.fio) || '',
      reportDate: (report.meta && report.meta.reportDate) || '',
      version: (report.meta && report.meta.version) || '',
      pages: (report.meta && report.meta.pages) || 0,
      loadedAt: new Date().toISOString(),
      contracts: contracts
    };
  }

  /** Вид обязательства ОКБ печатает канцелярской строкой — берём хвост. */
  function shortKind(kind) {
    const k = String(kind || '').replace(/^Договор займа \(кредита\)\s*[-—]\s*/i, '').trim();
    return k || 'заём (кредит)';
  }

  const label = (c) => {
    const bits = [];
    if (c.number) bits.push('№ ' + c.number);
    if (c.date) bits.push('от ' + D.dateShort(c.date));
    return (c.kind || 'договор') + (bits.length ? ', ' + bits.join(' ') : '');
  };

  /* ================= возникновение просрочки ================= */

  /**
   * По каждому договору — первый снимок долга с ненулевой просрочкой.
   * ОКБ печатает не только сумму просрочки, но и дату, с которой она
   * считается; берём именно её, а не дату снимка: снимки редкие, и по ним
   * просрочка «появляется» на месяц-другой позже, чем возникла.
   */
  function overdueStarts(okb) {
    const rows = [];
    for (const c of okb.contracts || []) {
      const first = c.snapshots.find((s) => s.overdue > 0);
      if (!first) continue;
      const last = c.snapshots[c.snapshots.length - 1];
      rows.push({
        creditor: c.creditor,
        contract: label(c),
        since: first.since || first.date,
        exact: !!first.since,          // дата взята из отчёта, а не выведена из снимка
        seenAt: first.date,
        overdue: first.overdue,
        days: first.days,
        cured: last.overdue === 0,
        closed: c.closed,
        lastOverdue: last.overdue,
        lastDate: last.date,
        page: c.page
      });
    }
    rows.sort((a, b) => (a.since < b.since ? -1 : a.since > b.since ? 1 : 0));
    return rows;
  }

  /** Самая ранняя просрочка, которая к последнему снимку так и не погашена. */
  function earliestUncured(rows) {
    const alive = rows.filter((r) => !r.cured);
    return (alive[0] || rows[0] || null);
  }

  /* ================= просрочка на дату ================= */

  /** Снимок долга, ближайший к дате слева: что отчёт знал на этот момент. */
  function snapshotAt(contract, iso) {
    let found = null;
    for (const s of contract.snapshots) {
      if (s.date <= iso) found = s; else break;
    }
    return found;
  }

  function overdueAt(okb, iso) {
    const rows = [];
    for (const c of okb.contracts || []) {
      const s = snapshotAt(c, iso);
      if (!s || !(s.overdue > 0)) continue;
      rows.push({
        creditor: c.creditor,
        contract: label(c),
        principal: s.principal,
        overdue: s.overdue,
        since: s.since,
        days: s.since ? daysBetween(s.since, iso) : s.days,
        snapshot: s.date,
        page: c.page
      });
    }
    rows.sort((a, b) => b.overdue - a.overdue);
    return rows;
  }

  const daysBetween = (a, b) => {
    const x = String(a).split('-').map(Number), y = String(b).split('-').map(Number);
    return Math.round((Date.UTC(y[0], y[1] - 1, y[2]) - Date.UTC(x[0], x[1] - 1, x[2])) / 86400000);
  };

  const plural = (n, a, b, c) => D.plural(n, a, b, c);
  const sum = (rows, key) => rows.reduce((n, r) => n + (Number(r[key]) || 0), 0);

  /* ================= таблицы для заявления ================= */

  /**
   * «Возникновение просроченной задолженности».
   * Итог таблицы — не вывод, а исходные данные для вывода, который делает
   * управляющий: самая ранняя непогашенная просрочка выделена отдельной
   * строкой пояснения под таблицей.
   */
  function tableInsolvency(okb, opts) {
    const rows = overdueStarts(okb);
    if (!rows.length) return null;
    const limit = (opts && opts.limit) || 0;
    const shown = limit ? rows.slice(0, limit) : rows;

    return {
      kind: 'table',
      id: 'insolvency',
      head: ['Кредитор', 'Обязательство', 'Просрочка с', 'Дней', 'Сумма просрочки, ₽', 'Погашена'],
      align: ['left', 'left', 'center', 'right', 'right', 'center'],
      rows: shown.map((r) => [
        r.creditor,
        r.contract,
        r.since ? D.dateShort(r.since) : '—',
        r.days ? String(r.days) : '—',
        D.money(r.overdue),
        r.cured ? 'да' : 'нет'
      ]),
      note: shown.length < rows.length
        ? 'Показаны первые ' + shown.length + ' из ' + rows.length + ' обязательств.' : '',
      meta: { rows: rows, earliest: earliestUncured(rows) }
    };
  }

  /** «Просроченная задолженность на дату сделки». */
  function tableOverdue(okb, iso, opts) {
    if (!iso) return null;
    const rows = overdueAt(okb, iso);
    if (!rows.length) return null;
    const limit = (opts && opts.limit) || 0;
    const shown = limit ? rows.slice(0, limit) : rows;

    const table = {
      kind: 'table',
      id: 'overdue',
      head: ['Кредитор', 'Обязательство', 'Основной долг, ₽', 'Просрочено, ₽', 'Просрочка с', 'Дней'],
      align: ['left', 'left', 'right', 'right', 'center', 'right'],
      rows: shown.map((r) => [
        r.creditor,
        r.contract,
        r.principal == null ? '—' : D.money(r.principal),
        D.money(r.overdue),
        r.since ? D.dateShort(r.since) : '—',
        r.days ? String(r.days) : '—'
      ]),
      total: ['Итого', '', D.money(sum(shown, 'principal')), D.money(sum(shown, 'overdue')), '', ''],
      note: shown.length < rows.length
        ? 'Показаны крупнейшие ' + shown.length + ' из ' + rows.length + ' обязательств.' : '',
      meta: { rows: rows, date: iso, sumOverdue: sum(rows, 'overdue'), sumPrincipal: sum(rows, 'principal') }
    };
    return table;
  }

  /* ================= подстановки в текст ================= */

  /**
   * Переменные, которыми блок заявления может сослаться на цифры отчёта,
   * не вставляя таблицу целиком.
   */
  function vars(okb, dealDate) {
    if (!okb || !(okb.contracts || []).length) {
      return {
        OKB_REPORT_DATE: '', OKB_CREDITORS: '', OKB_FIRST_OVERDUE_DATE: '',
        OKB_FIRST_OVERDUE_CREDITOR: '', OKB_OVERDUE_SUM: '', OKB_OVERDUE_COUNT: '',
        OKB_OVERDUE_TOTAL_WORDS: ''
      };
    }
    const starts = overdueStarts(okb);
    const earliest = earliestUncured(starts);
    const at = dealDate ? overdueAt(okb, dealDate) : [];
    const total = sum(at, 'overdue');

    return {
      OKB_REPORT_DATE: okb.reportDate ? D.dateLong(okb.reportDate) : '',
      OKB_CREDITORS: String((okb.contracts || []).length),
      OKB_FIRST_OVERDUE_DATE: earliest && earliest.since ? D.dateLong(earliest.since) : '',
      OKB_FIRST_OVERDUE_CREDITOR: earliest ? earliest.creditor : '',
      OKB_OVERDUE_SUM: at.length ? D.money(total) : '',
      OKB_OVERDUE_COUNT: at.length ? at.length + ' ' + plural(at.length, 'обязательству', 'обязательствам', 'обязательствам') : '',
      OKB_OVERDUE_TOTAL_WORDS: at.length ? D.moneyWords(total) : ''
    };
  }

  globalThis.ZOkb = {
    compact, shortKind, label,
    overdueStarts, earliestUncured, overdueAt, snapshotAt, daysBetween,
    tableInsolvency, tableOverdue, vars
  };
})();
