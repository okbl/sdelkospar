/*
 * Счета должника: разбор сведений ФНС и банковских справок об остатках.
 *
 * Задача узкая. Ходатайство об отсрочке уплаты госпошлины держится на одном
 * доводе — платить нечем, — и подтверждается ответами банков об остатках.
 * Значит, документу нужны названия банков, остаток по каждому, общая сумма
 * и по строке приложения на банк. Привязка «какой счёт в каком банке» в текст
 * не попадает никогда, поэтому и добывать её не нужно.
 *
 * Главная трудность — сами файлы. Справка ФНС приходит сканом, прогнанным
 * через распознавание: половина страниц лежит вверх ногами, кириллица
 * распознана латиницей по форме букв («ОТКРЫТ» → «OTKPBIT»), а на
 * перевёрнутых страницах врут и цифры. Поэтому здесь нет ни одной догадки:
 * пара «БИК — номер счёта» принимается только если сходится ключ проверки
 * (Положение Банка России № 579-П). Ключ ловит любую подменённую цифру,
 * и всё, что его не прошло, в дело не попадает — вместо выдуманного банка
 * приложение честно скажет, сколько страниц прочитать не удалось.
 */
(function () {
  'use strict';

  /* ================= ключ проверки счёта ================= */

  const WEIGHTS = [7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1];

  /**
   * Ключ проверки: к номеру счёта слева приписывается «условный номер»
   * банка — три последние цифры БИК, а для счетов в подразделении Банка
   * России «0» и разряды 5–6 БИК. Сумма поразрядных произведений на веса,
   * взятая по последней цифре, должна делиться на 10.
   */
  function checkKey(bik, account) {
    if (!/^\d{9}$/.test(bik) || !/^\d{20}$/.test(account)) return false;
    const tail = bik.slice(6);
    const prefix = tail === '000' ? '0' + bik.slice(4, 6) + '0' : tail;
    const s = prefix + account;
    let sum = 0;
    for (let i = 0; i < 23; i++) sum += (Number(s[i]) * WEIGHTS[i]) % 10;
    return sum % 10 === 0;
  }

  /** Контрольные разряды ИНН юридического лица — второй независимый сторож. */
  function innValid(inn) {
    if (!/^\d{10}$/.test(inn)) return false;
    const w = [2, 4, 10, 3, 5, 9, 4, 6, 8];
    let sum = 0;
    for (let i = 0; i < 9; i++) sum += Number(inn[i]) * w[i];
    return (sum % 11) % 10 === Number(inn[9]);
  }

  /* ================= чтение распознанного текста ================= */

  /*
   * Латинские буквы, которыми распознавание подменяет кириллицу по форме.
   * Свёртка нужна ровно для одного вопроса — открыт счёт или закрыт, — и
   * для него её точности хватает с запасом: «ОТКРЫТ» и «ЗАКРЫТ» не спутать
   * даже с половиной угаданных букв. Названия банков так не восстановить,
   * и попыток здесь нет.
   */
  const FOLD = {
    A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', K: 'К', M: 'М', O: 'О', P: 'Р',
    T: 'Т', X: 'Х', Y: 'У', a: 'а', c: 'с', e: 'е', o: 'о', p: 'р', x: 'х',
    y: 'у', '3': 'З', '0': 'О', 'I': 'І', 'J': 'Ј'
  };

  const fold = (s) => String(s || '').replace(/[ABCEHKMOPTXYaceopxy30IJ]/g, (ch) => FOLD[ch] || ch).toLowerCase();

  const OPEN = /откр/;
  const CLOSED = /закр|прекра/;

  /** Открыт ли счёт по обрывку текста рядом с его номером. */
  function accountState(chunk) {
    const f = fold(chunk);
    // Закрытие важнее: у закрытого счёта в строке стоят обе даты, и слово
    // «открытия» из заголовка колонки попадает в тот же обрывок.
    if (CLOSED.test(f)) return 'closed';
    if (OPEN.test(f)) return 'open';
    return 'unknown';
  }

  /**
   * Сборка текста страницы с учётом поворота.
   *
   * Сканы этого рода лежат в файле боком: матрица текста повёрнута на ±90°,
   * и строка идёт вдоль оси X, а не Y. Если читать «как обычно», строки
   * рассыпаются на отдельные буквы. Здесь ось строки выбирается по матрице.
   */
  function pageText(items) {
    if (!items.length) return { text: '', angle: 0 };
    const m = items[0].transform || [1, 0, 0, 1, 0, 0];
    const turned = Math.abs(m[1]) > Math.abs(m[0]) && Math.abs(m[2]) > Math.abs(m[3]);
    const angle = !turned ? 0 : (m[2] > 0 ? 90 : -90);

    // Для повёрнутого текста «номер строки» — это X, а порядок внутри
    // строки задаёт Y; знак зависит от того, в какую сторону повёрнута
    // страница.
    const lineOf = (it) => Math.round((turned ? it.transform[4] : it.transform[5]) / 4);
    const posOf = (it) => (turned ? it.transform[5] : it.transform[4]);
    const desc = angle === 90;

    const rows = new Map();
    for (const it of items) {
      const k = lineOf(it);
      if (!rows.has(k)) rows.set(k, []);
      rows.get(k).push(it);
    }
    const keys = [...rows.keys()].sort((a, b) => (turned ? (desc ? a - b : b - a) : b - a));
    const lines = keys.map((k) => rows.get(k)
      .sort((a, b) => (desc ? posOf(b) - posOf(a) : posOf(a) - posOf(b)))
      .map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim())
      .filter((s) => s);
    return { text: lines.join('\n'), angle: angle };
  }

  /* ================= сведения ФНС ================= */

  const BIK_RE = /\b(04\d{7})\b/g;
  const ACC_RE = /\b(\d{20})\b/g;
  const INN_RE = /\b(\d{10})\s*[/／]\s*\d{9}\b/g;

  const all = (re, text) => {
    const out = [];
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) out.push({ value: m[1], at: m.index });
    return out;
  };

  /**
   * Разбор одной страницы сведений об открытых и закрытых счетах.
   *
   * Порядок такой: собрать кандидатов в БИК и номера счетов, а затем
   * связать их ключом проверки. Ни один счёт не приписывается банку
   * «по соседству» — только по сошедшемуся ключу.
   */
  function parseFnsPage(text, num) {
    const biks = all(BIK_RE, text);
    const accs = all(ACC_RE, text).filter((a) => !biks.some((b) => Math.abs(b.at - a.at) < 3));
    const inns = all(INN_RE, text).filter((i) => innValid(i.value));

    const found = [];
    let orphans = 0;
    for (const acc of accs) {
      const fits = biks.filter((b) => checkKey(b.value, acc.value));
      if (!fits.length) { orphans++; continue; }
      // Если ключ сошёлся с несколькими БИК (бывает, когда у банков
      // совпадают три последние цифры), берём ближайший по тексту.
      fits.sort((a, b) => Math.abs(a.at - acc.at) - Math.abs(b.at - acc.at));
      const bik = fits[0].value;
      // Состояние счёта ищем в тексте после номера — до следующего
      // двадцатизначного номера или до конца абзаца.
      const next = accs.find((a) => a.at > acc.at);
      const chunk = text.slice(acc.at + 20, next ? next.at : Math.min(text.length, acc.at + 220));
      found.push({ bik: bik, account: acc.value, state: accountState(chunk), page: num });
    }

    // ИНН приписываем БИК, ближайшему по тексту: в справке они стоят
    // в одной строке реквизитов банка.
    const innFor = {};
    for (const b of biks) {
      const near = inns.filter((i) => Math.abs(i.at - b.at) < 200)
        .sort((a, b2) => Math.abs(a.at - b.at) - Math.abs(b2.at - b.at))[0];
      if (near) innFor[b.value] = near.value;
    }

    // Название банка — строка перед строкой реквизитов, но только если
    // распознавание не превратило её в латиницу.
    const nameFor = {};
    const lines = text.split('\n');
    let pos = 0;
    const starts = lines.map((l) => { const p = pos; pos += l.length + 1; return p; });
    for (const b of biks) {
      let li = 0;
      while (li + 1 < starts.length && starts[li + 1] <= b.at) li++;
      for (let i = li; i >= 0 && i >= li - 3; i--) {
        const cand = cleanName(lines[i]);
        if (cand) { nameFor[b.value] = cand; break; }
      }
    }

    return { accounts: found, inn: innFor, names: nameFor, orphans: orphans, biks: biks.length };
  }

  /** Строка похожа на название банка? Латинская каша сюда не проходит. */
  function cleanName(line) {
    const s = String(line || '').trim();
    if (s.length < 6 || s.length > 160) return '';
    const cyr = (s.match(/[А-Яа-яЁё]/g) || []).length;
    if (cyr < s.replace(/[^A-Za-zА-Яа-яЁё]/g, '').length * 0.8) return '';
    if (/^(РегНом|ИНН|БИК|Адрес|Дата|Форма|Сведения|№)/i.test(s)) return '';
    if (!/(банк|bank|кредит|казначейств|НКО|организаци)/i.test(s)) return '';
    return s.replace(/\s+/g, ' ');
  }

  /**
   * Как читать страницу.
   *
   * На перевёрнутом скане цифры распознаются чужими глифами: «28.06.2018»
   * превращается в «810C°90°8C». Поэтому несколько правильных дат — дешёвый
   * и надёжный признак того, что цифрам страницы можно верить.
   *
   *   good    — читаем, цифры верны;
   *   garbled — таблица счетов есть, но прочитана неправильно: о такой
   *             странице нужно сказать вслух, иначе банк тихо пропадёт;
   *   plain   — титул, подпись, продолжение адреса: брать нечего и терять
   *             тоже нечего.
   */
  function pageKind(text) {
    const s = String(text || '');
    const dates = (s.match(/\b\d{2}\.\d{2}\.(?:19|20)\d{2}\b/g) || []).length;
    if (dates >= 3) return 'good';
    // Перевёрнутый номер счёта распознаётся вперемешку с буквами —
    // «10000000000L018L180Y». Два таких обрывка на странице означают, что
    // таблица счетов там есть, а прочитать её не вышло.
    const junk = (s.match(/[0-9A-Za-z°]{16,}/g) || [])
      .filter((t) => (t.match(/\d/g) || []).length >= 8 && /[A-Za-z°]/.test(t)).length;
    return junk >= 2 ? 'garbled' : 'plain';
  }

  /**
   * Сведения ФНС целиком.
   * pages — [{ text, angle, num }]. Возвращает банки с открытыми счетами
   * и честный отчёт о том, что прочитать не удалось.
   */
  function parseFns(pages) {
    const byBik = new Map();
    const unreadable = [];
    let closed = 0;

    // Первый проход: страницы, которым можно верить, и БИК с них. На
    // перевёрнутых страницах цифры переставлены, и подмешивать их БИК
    // в общий список нельзя — ключ проверки сойдётся у одной пары
    // из десяти случайно, и в деле окажется несуществующий банк.
    const good = pages.filter((p) => pageKind(p.text) === 'good');
    for (const p of pages) if (pageKind(p.text) === 'garbled') unreadable.push(p.num);

    const pool = [];
    const parsed = good.map((p) => {
      const r = parseFnsPage(p.text, p.num);
      for (const a of r.accounts) if (!pool.includes(a.bik)) pool.push(a.bik);
      return { page: p, res: r };
    });

    for (const { page, res } of parsed) {
      // Второй проход: счёт, чей банк напечатан на другой странице
      // (так разрывается таблица), привязываем по общему списку БИК —
      // по-прежнему только через сошедшийся ключ проверки.
      const known = new Set(res.accounts.map((a) => a.account));
      for (const orphan of orphanAccounts(page.text, known)) {
        const fits = pool.filter((b) => checkKey(b, orphan.account));
        if (fits.length === 1) res.accounts.push({ bik: fits[0], account: orphan.account, state: orphan.state, page: page.num });
      }

      for (const a of res.accounts) {
        if (!byBik.has(a.bik)) {
          byBik.set(a.bik, {
            bik: a.bik, inn: res.inn[a.bik] || '', name: res.names[a.bik] || '',
            open: [], closed: [], pages: []
          });
        }
        const bank = byBik.get(a.bik);
        if (!bank.inn && res.inn[a.bik]) bank.inn = res.inn[a.bik];
        if (!bank.name && res.names[a.bik]) bank.name = res.names[a.bik];
        if (!bank.pages.includes(a.page)) bank.pages.push(a.page);
        if (bank.open.includes(a.account) || bank.closed.includes(a.account)) continue;
        if (a.state === 'closed') { bank.closed.push(a.account); closed++; }
        else bank.open.push(a.account);
      }
    }

    const banks = [...byBik.values()].filter((b) => b.open.length);
    banks.sort((a, b) => b.open.length - a.open.length || a.bik.localeCompare(b.bik));
    return {
      banks: banks,
      closedOnly: [...byBik.values()].filter((b) => !b.open.length),
      closed: closed,
      unreadable: unreadable,
      pages: pages.length
    };
  }

  /** Номера счетов страницы, которым банк на своей же странице не нашёлся. */
  function orphanAccounts(text, known) {
    const accs = all(ACC_RE, text).filter((a) => !known.has(a.value));
    return accs.map((a, i) => {
      const next = accs[i + 1];
      const chunk = text.slice(a.at + 20, next ? next.at : Math.min(text.length, a.at + 220));
      return { account: a.value, state: accountState(chunk) };
    });
  }

  /* ================= справочник банков ================= */

  /*
   * Справочника банков в приложении, по сути, нет — и это осознанно.
   * Полный список БИК живёт на сайте Банка России и меняется каждый месяц;
   * зашитая копия через год начнёт называть банки их прежними именами,
   * а один неверно подставленный банк в ходатайстве хуже пустого поля.
   *
   * Поэтому здесь только те записи, которые проверены по самим документам,
   * а дальше справочник наполняет работа: название, введённое руками или
   * взятое из имени файла справки, запоминается в настройках и в следующем
   * деле подставляется само.
   */
  const KNOWN = [
    { bik: '044525225', inn: '7707083893', name: 'ПАО «Сбербанк России»' },
    { bik: '044525593', inn: '7728168971', name: 'АО «Альфа-Банк»' },
    { bik: '044525974', inn: '7710140679', name: 'АО «ТБанк»' },
    { bik: '044525272', inn: '7729405872', name: 'ПАО Банк ЗЕНИТ' },
    { bik: '044525232', inn: '7702045051', name: 'ПАО «МТС-Банк»' },
    { bik: '044525245', inn: '7735057951', name: 'ООО «Хоум Кредит энд Финанс Банк»' },
    { bik: '044525054', inn: '7729496647', name: 'НКО «ЭЛЕКСНЕТ» (ООО)' }
  ];

  /**
   * Название банка: сперва то, что человек уже вводил (dir), затем
   * проверенный справочник, затем прочитанное из справки. Если ничего нет —
   * пустая строка, а не «Банк неизвестен»: поле должно выглядеть незаполненным.
   */
  function bankName(bik, inn, dir, read) {
    const own = dir || {};
    if (bik && own[bik]) return own[bik];
    if (inn && own[inn]) return own[inn];
    const k = KNOWN.find((b) => (bik && b.bik === bik) || (inn && b.inn === inn));
    if (k) return k.name;
    return read || '';
  }

  /* ================= справка банка об остатке ================= */

  // Разряды разделяются пробелом только по три: иначе «38 52 5230» из
  // соседних колонок склеится в одно число 3852.
  const NUM = '(\\d{1,3}(?:[ \\u00A0\\u202F]\\d{3})+(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)';
  const toNum = (s) => {
    const n = Number(String(s).replace(/[\s  ]/g, '').replace(',', '.'));
    return isFinite(n) ? n : null;
  };

  /*
   * Единой формы справки об остатке не существует: у каждого банка своя.
   * Поэтому здесь не «парсер», а несколько узнаваемых форм, и каждая
   * говорит, откуда взяла цифру. Что не узнано — остаётся пустым: остаток
   * вводится руками, а не угадывается.
   */
  const SHAPES = [
    {
      id: 'table',
      // Табличная выписка (так печатает Сбербанк): строка счёта — дата
      // открытия, прочерк вместо даты закрытия, остаток и служебные коды.
      name: 'таблица счетов',
      run: (text) => {
        const re = new RegExp('\\d{2}\\.\\d{2}\\.\\d{4}\\s+[-–—]\\s+' + NUM + '\\s+\\d+\\s+\\d+\\s+\\d+', 'g');
        const vals = [];
        let m;
        while ((m = re.exec(text))) { const n = toNum(m[1]); if (n != null) vals.push(n); }
        return vals.length ? { total: vals.reduce((a, b) => a + b, 0), parts: vals } : null;
      }
    },
    {
      id: 'final',
      name: 'остаток на конец периода',
      run: (text) => {
        const m = text.match(new RegExp('Остаток\\s+на\\s+конец[^\\d]{0,20}' + NUM));
        const n = m ? toNum(m[1]) : null;
        return n == null ? null : { total: n, parts: [n] };
      }
    },
    {
      id: 'outgoing',
      name: 'исходящий остаток',
      run: (text) => {
        const re = new RegExp('Исходящий\\s+остаток[^\\d]{0,20}' + NUM, 'g');
        let last = null, m;
        while ((m = re.exec(text))) last = toNum(m[1]);
        return last == null ? null : { total: last, parts: [last] };
      }
    },
    {
      id: 'plain',
      name: 'остаток денежных средств',
      run: (text) => {
        const m = text.match(new RegExp('Остаток(?:\\s+(?:собственных|денежных)\\s+средств)?[^\\d\\n]{0,30}' + NUM));
        const n = m ? toNum(m[1]) : null;
        return n == null ? null : { total: n, parts: [n] };
      }
    }
  ];

  function parseBalance(text) {
    for (const shape of SHAPES) {
      const hit = shape.run(text || '');
      if (hit) return { total: hit.total, parts: hit.parts, method: shape.name, id: shape.id };
    }
    return { total: null, parts: [], method: '', id: '' };
  }

  /** БИК банка, выдавшего справку: он же стоит в реквизитах самого банка. */
  function bikFromStatement(text) {
    const hits = all(BIK_RE, text || '').map((h) => h.value);
    if (!hits.length) return '';
    const count = {};
    for (const b of hits) count[b] = (count[b] || 0) + 1;
    return Object.keys(count).sort((a, b) => count[b] - count[a])[0];
  }

  /**
   * Название банка из имени файла: «…открытых в ПАО Сбербанк.pdf».
   * Так их выгружает рабочая система, и это самый надёжный источник
   * названия из всех доступных — банк сам себя назвал.
   */
  function nameFromFile(filename) {
    let s = String(filename || '').replace(/\.[a-z0-9]+$/i, '').trim();
    const m = s.match(/(?:открыт[а-я]*\s+в|в\s+банке?)\s+(.+)$/i);
    if (m) s = m[1];
    else s = s.replace(/^\s*\d+[.)]\s*/, '');
    s = s.replace(/^Сведения об остатке[^,]*,?\s*/i, '').trim();
    if (!/[А-Яа-яЁё]/.test(s) || s.length > 90) return '';
    return s;
  }

  globalThis.ZAccounts = {
    checkKey, innValid, fold, accountState, pageText,
    parseFns, parseFnsPage, pageKind, cleanName,
    parseBalance, bikFromStatement, nameFromFile, toNum,
    KNOWN, bankName
  };
})();
