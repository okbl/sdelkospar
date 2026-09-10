/*
 * Импорт печатной формы.
 *
 * Рабочая система арбитражного управляющего выгружает по каждому делу
 * «печатную форму» — DOCX, в котором реквизиты суда, должника, управляющего
 * и процедуры уже подставлены, а сведения о сделке оставлены пустыми.
 * Ровно те данные, которые иначе пришлось бы перебивать руками.
 *
 * Читаем такой файл прямо в браузере: .docx — это ZIP с XML внутри, а
 * распаковку берёт на себя DecompressionStream, встроенный в браузер и в
 * Node. Никаких библиотек и никакой отправки файла на сервер.
 *
 * Разбор намеренно снисходительный: формулировки в формах гуляют от суда
 * к суду, поэтому каждое поле ищется своим правилом, а ненайденное просто
 * остаётся пустым — пользователь дозаполнит его в форме дела.
 */
(function () {
  'use strict';

  /* ================= чтение ZIP ================= */

  const dv = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  /** Ищет запись по имени в центральном каталоге и возвращает её сырые байты. */
  function findEntry(bytes, wanted) {
    const view = dv(bytes);
    // Конец центрального каталога лежит в хвосте; комментария у .docx не бывает,
    // но ищем сигнатуру назад — так надёжнее.
    let eocd = bytes.length - 22;
    while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054B50) eocd--;
    if (eocd < 0) throw new Error('это не ZIP-архив (а .docx должен им быть)');

    const count = view.getUint16(eocd + 10, true);
    let at = view.getUint32(eocd + 16, true);
    const decoder = new TextDecoder();

    for (let i = 0; i < count; i++) {
      if (view.getUint32(at, true) !== 0x02014B50) throw new Error('повреждён каталог архива');
      const method = view.getUint16(at + 10, true);
      const size = view.getUint32(at + 20, true);
      const nameLen = view.getUint16(at + 28, true);
      const extraLen = view.getUint16(at + 30, true);
      const commentLen = view.getUint16(at + 32, true);
      const offset = view.getUint32(at + 42, true);
      const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLen));

      if (name === wanted) {
        const lnLen = view.getUint16(offset + 26, true);
        const leLen = view.getUint16(offset + 28, true);
        const start = offset + 30 + lnLen + leLen;
        return { method: method, data: bytes.subarray(start, start + size) };
      }
      at += 46 + nameLen + extraLen + commentLen;
    }
    return null;
  }

  /** Распаковка. Метод 8 — deflate, его разжимает сам браузер. */
  async function inflate(entry) {
    if (entry.method === 0) return entry.data;
    if (entry.method !== 8) throw new Error('неизвестный метод сжатия ' + entry.method);
    if (typeof DecompressionStream !== 'function') {
      throw new Error('браузер не умеет распаковывать ZIP — обновите его или заполните дело вручную');
    }
    const stream = new Blob([entry.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /* ================= текст документа ================= */

  const unesc = (s) => String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n))
    .replace(/&amp;/g, '&');

  /**
   * Абзацы и ячейки таблиц — каждый со своей строки.
   *
   * Разбираем XML регулярными выражениями, а не DOMParser: шапка печатной
   * формы свёрстана таблицей, и в разметке важен только порядок текстовых
   * узлов. Заодно это одинаково работает в браузере и в Node.
   */
  function documentText(xml) {
    const lines = [];
    // <w:p> — абзац, </w:tc> — конец ячейки: и то и другое даёт перевод строки.
    for (const chunk of String(xml).split(/<w:p[ >]|<\/w:tc>/)) {
      let text = '';
      const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g;
      let m;
      while ((m = re.exec(chunk))) text += m[1] != null ? unesc(m[1]) : ' ';
      text = text.replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim();
      if (text) lines.push(text);
    }
    return lines.join('\n');
  }

  /** Файл → плоский текст. */
  async function readDocx(bytes) {
    const entry = findEntry(bytes, 'word/document.xml');
    if (!entry) throw new Error('в файле нет word/document.xml — это не документ Word');
    return documentText(new TextDecoder().decode(await inflate(entry)));
  }

  /* ================= разбор печатной формы ================= */

  const one = (re, text, group) => {
    const m = re.exec(text);
    return m ? (m[group || 1] || '').trim() : '';
  };

  /** «28.05.2025» → «2025-05-28». */
  function toIso(d) {
    const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(String(d).trim());
    if (!m) return '';
    return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  }

  // \w кириллицу не ловит, поэтому окончания перечислены явно.
  const PROCEDURES = [
    [/реализаци\S*\s+имущества\s+гражданина/i, 'realization'],
    [/реструктуризаци\S*\s+долгов\s+гражданина/i, 'restructuring'],
    // Печатная форма иногда пишет «конкурсное производство» и по гражданину:
    // для должника-физлица это она же реализация имущества.
    [/конкурсн\S*\s+производств/i, 'realization']
  ];

  /**
   * Шапка формы свёрстана таблицей, и длинный адрес разложен по нескольким
   * абзацам ячейки. Строка, оборванная запятой, — продолжение следующей:
   * склеиваем, иначе адрес приезжает обрезанным по первой же запятой.
   */
  function glueWrapped(text) {
    const out = [];
    for (const line of String(text).split('\n')) {
      const prev = out[out.length - 1];
      if (prev != null && /,$/.test(prev)) out[out.length - 1] = prev + ' ' + line;
      else out.push(line);
    }
    return out.join('\n');
  }

  /**
   * Вытаскивает всё, что удаётся опознать. Ничего не выдумывает: поле, для
   * которого правило не сработало, возвращается пустым — пусть человек
   * увидит пробел в форме, а не правдоподобную ошибку в заявлении.
   */
  function parsePrintForm(text) {
    const t = glueWrapped(String(text).replace(/\r/g, ''));
    const out = { found: [], missing: [] };

    /* --- суд --- */
    out.court = one(/^(?:В\s+)?(Арбитражный суд[^\n]*?)\s*$/mi, t);
    // Адрес суда — строка сразу за наименованием, если она начинается с индекса
    // или со слова «Адрес».
    const courtAt = t.indexOf(out.court);
    if (courtAt >= 0) {
      const after = t.slice(courtAt + out.court.length, courtAt + out.court.length + 300);
      out.courtAddress = one(/^\s*\n(?:Адрес:\s*)?(\d{6},[^\n]+|[А-ЯЁ][^\n]*?ул[^\n]+)/i, after);
    }

    /* --- дело --- */
    out.caseNumber = one(/Дело\s*№\s*([A-ZА-Я]?\d+[-–]\d+\/\d{4})/i, t);
    // Дату возбуждения дела формы пишут двумя способами.
    out.caseStartDate = toIso(
      one(/Заявление\s+о\s+признании\s+должника\s+банкротом\s+было\s+принято\s+(\d{1,2}\.\d{1,2}\.\d{4})/i, t) ||
      one(/Определением[^.]{0,200}?от\s+(\d{1,2}\.\d{1,2}\.\d{4})[^.]{0,120}?принято\s+заявление\s+о\s+признании/i, t));

    /* --- судебный акт и процедура --- */
    const act = /((?:Решением|Определением)\s+Арбитражного суда[^\n]*?от\s+(\d{1,2}\.\d{1,2}\.\d{4})\s*г?\.?\s*(?:по делу\s*№?\s*\S+)?)[^\n]*?призна/i.exec(t) ||
      /((?:Решением|Определением)\s+Арбитражного суда[^\n]*?от\s+(\d{1,2}\.\d{1,2}\.\d{4})\s*г?\.?\s*(?:по делу\s*№?\s*\S+)?)/i.exec(t);
    if (act) {
      out.judicialAct = act[1].replace(/\s+/g, ' ').trim();
      out.procedureDate = toIso(act[2]);
    }
    for (const [re, id] of PROCEDURES) {
      if (re.test(t)) { out.procedure = id; break; }
    }

    /* --- должник --- */
    // Шапка даёт имя в именительном падеже — в отличие от тела, где оно
    // стоит в родительном («Абрамовой Зарият Руслановны»).
    out.debtorName = one(/^Должник\s*:?\s*([^\n]+)/mi, t);
    const debtorBlock = /Должник\s*:?\s*[^\n]+\n(?:Адрес:\s*)([^\n]+)/i.exec(t);
    if (debtorBlock) out.debtorAddress = debtorBlock[1].trim();

    // Реквизиты должника напечатаны в теле, в скобках после его имени.
    const paren = /\(([^)]*?(?:СНИЛС|ИНН)[^)]*)\)\s*призна/i.exec(t) ||
      /призна\w+[^.]*?\(([^)]*(?:СНИЛС|ИНН)[^)]*)\)/i.exec(t);
    if (paren) {
      const p = paren[1];
      out.debtorBirthDate = toIso(one(/(\d{1,2}\.\d{1,2}\.\d{4})\s*г\.?\s*р/i, p));
      out.debtorBirthPlace = one(/место\s+рожд[^:]*:\s*([^,]+(?:,[^,]*?(?:р-на|района|обл|края|РФ))?)/i, p);
      out.debtorInn = one(/ИНН\s*:?\s*(\d{10,12})/i, p);
      out.debtorSnils = one(/СНИЛС\s*:?\s*([\d\s-]{11,20})/i, p).replace(/\s/g, '');
      out.debtorRegAddress = one(/адрес\s+рег[^:]*:\s*([^]*?)(?:,\s*СНИЛС|,\s*ИНН|$)/i, p);
    }
    if (!out.debtorAddress) out.debtorAddress = out.debtorRegAddress || '';

    // Родительный падеж ФИО должника формы печатают готовым — это надёжнее
    // любого склонения по правилам.
    out.debtorNameGen = one(/имуществом\s+должника[ \t]*\n?[ \t]*([А-ЯЁ][^\n]{3,80})/i, t)
      .replace(/^[«"']|[»"']$/g, '').trim();
    // Часть форм печатает здесь именительный падеж — тогда толку от него нет,
    // и склонение по правилам сработает лучше.
    if (out.debtorNameGen === out.debtorName) out.debtorNameGen = '';

    /* --- арбитражный управляющий --- */
    const mgr = /(?:Финансовым|Конкурсным|Внешним|Временным|Административным)\s+управляющим\s+утвержден[аы]?\s+([А-ЯЁ][^(,\n]*?)\s*\(/i.exec(t);
    if (mgr) out.managerName = mgr[1].trim();
    if (!out.managerName) {
      // Запасной путь — шапка: строка под «Заявитель: … имуществом должника …».
      out.managerName = one(/имуществом\s+должника[^\n]*\n([А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+)/i, t);
    }
    const mgrParen = mgr ? /\(([^)]*)\)/.exec(t.slice(mgr.index + mgr[0].length - 1)) : null;
    if (mgrParen) {
      out.managerInn = one(/ИНН\s*:?\s*(\d{10,12})/i, mgrParen[1]);
      out.managerSnils = one(/СНИЛС\s*:?\s*([\d\s-]{11,20})/i, mgrParen[1]).replace(/\s/g, '');
      out.managerRegNumber = one(/рег\.?\s*номер\s*:?\s*(\d+)/i, mgrParen[1]);
    }
    // Адрес управляющего в шапке идёт следом за его ФИО.
    out.managerAddress = one(/имуществом\s+должника[\s\S]{0,200}?Адрес:\s*([^\n]+)/i, t);

    /* --- СРО --- */
    // Имя СРО зажато между закрывающей скобкой реквизитов управляющего и
    // скобкой с ОГРН: без якоря на «)» в него утягивает эти самые реквизиты.
    const sro = /\)\s*(?:–|—|-|,)\s*(?:член\s+)?([^()\n]{3,160}?)\s*\(\s*ОГРН\s*(\d{13,15})\s*,\s*ИНН\s*(\d{10,12})\s*,\s*адрес:\s*([^)]+)\)/i.exec(t);
    if (sro) {
      // Кавычки снимаем только парные: у «ААУ "Горизонт"» внутренняя кавычка
      // закрывающая, и обрубать её нельзя.
      out.sroName = sro[1].trim().replace(/^(["'«])(.*)\1$/, '$2')
        .replace(/^«(.*)»$/, '$1').trim();
      out.sroOgrn = sro[2];
      out.sroInn = sro[3];
      out.sroAddress = sro[4].trim();
    }

    /* --- ответчик, если в форме он уже указан --- */
    // \s захватывал перевод строки и подставлял в ответчика номер дела,
    // когда графа в форме осталась пустой.
    const resp = /^Ответчик[ \t]*\d*[ \t]*:[ \t]*(\S[^\n]*)\n(?:Адрес:[ \t]*([^\n]+))?/mi.exec(t);
    if (resp && resp[1].trim()) {
      out.respondentName = resp[1].trim();
      out.respondentAddress = (resp[2] || '').trim();
    }

    for (const key of ['court', 'caseNumber', 'debtorName', 'managerName', 'procedure',
      'caseStartDate', 'judicialAct', 'sroName']) {
      (out[key] ? out.found : out.missing).push(key);
    }
    return out;
  }

  /** Понятные названия полей — их показывает отчёт об импорте. */
  const FIELD_NAMES = {
    court: 'Наименование суда', courtAddress: 'Адрес суда',
    caseNumber: 'Номер дела', caseStartDate: 'Дата принятия заявления о банкротстве',
    judicialAct: 'Реквизиты судебного акта', procedure: 'Процедура', procedureDate: 'Дата введения процедуры',
    debtorName: 'ФИО должника', debtorAddress: 'Адрес должника', debtorInn: 'ИНН должника',
    debtorSnils: 'СНИЛС должника', debtorBirthDate: 'Дата рождения должника',
    debtorBirthPlace: 'Место рождения должника',
    debtorNameGen: 'ФИО должника в родительном падеже',
    managerName: 'ФИО управляющего', managerAddress: 'Адрес управляющего',
    managerInn: 'ИНН управляющего', managerSnils: 'СНИЛС управляющего',
    managerRegNumber: 'Регистрационный номер управляющего',
    sroName: 'СРО', sroOgrn: 'ОГРН СРО', sroInn: 'ИНН СРО', sroAddress: 'Адрес СРО',
    respondentName: 'Ответчик', respondentAddress: 'Адрес ответчика'
  };

  globalThis.ZImport = { readDocx, documentText, parsePrintForm, toIso, FIELD_NAMES, findEntry, inflate };
})();
