/*
 * Стенд: проверяет то, что ломается молча — подстановку переменных, условия
 * блоков, нумерацию приложений, правила проверки и структуру собранного DOCX.
 *
 *   npm test
 *
 * Модули рассчитаны на globalThis и не знают про DOM, поэтому исполняются
 * здесь как есть — тем же кодом, что уходит в браузер.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const src = path.join(root, 'src');

for (const file of ['data.js', 'okb.js', 'import.js', 'store.js', 'doc.js']) {
  new Function(fs.readFileSync(path.join(src, file), 'utf8'))();
}
const D = globalThis.ZData;
const S = globalThis.ZStore;
const X = globalThis.ZDoc;
const O = globalThis.ZOkb;
const I = globalThis.ZImport;

let failed = 0, passed = 0;

function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ok   ' + name); }
  else { failed++; console.log('  FAIL ' + name + (detail ? '\n       ' + detail : '')); }
}
const eq = (name, got, want) => ok(name, got === want, `получено: ${JSON.stringify(got)}\n       ждали:    ${JSON.stringify(want)}`);
const group = (name) => console.log('\n' + name + '\n' + '-'.repeat(name.length));

/* ================= образец дела ================= */

function sample() {
  const db = S.newDb();
  db.profile.name = 'Иванов Иван Иванович';
  db.profile.sro = 'Ассоциация «СРО АУ»';

  const c = S.newCase();
  c.court = 'Арбитражный суд города Москвы';
  c.number = 'А40-123456/2025';
  c.procedure = 'bankruptcy';
  c.caseStartDate = '2025-12-01';
  c.judicialAct = 'Решением Арбитражного суда города Москвы от 12.03.2026';
  c.creditorsSum = '15000000';

  const debtor = S.debtorOf(c);
  debtor.nameFull = 'Общество с ограниченной ответственностью «Ромашка»';
  debtor.nameShort = 'ООО «Ромашка»';
  debtor.inn = '1234567890';
  debtor.ogrn = '1234567890123';
  debtor.addressLegal = 'г. Москва, ул. Полевая, д. 1';

  const cp = S.newParty('org');
  cp.nameFull = 'Общество с ограниченной ответственностью «Василёк»';
  cp.nameShort = 'ООО «Василёк»';
  cp.inn = '9876543210';
  cp.ogrn = '9876543210987';
  c.parties.push(cp);

  const d = S.newDeal();
  d.type = 'sale';
  d.date = '2025-04-15';
  d.number = '15';
  d.amount = '8400000';
  d.counterpartyId = cp.id;
  d.object = Object.assign(S.newObject('realty'), {
    realtyKind: 'Квартира', address: 'г. Москва, ул. Садовая, д. 2, кв. 3',
    cadastral: '77:01:0001001:1234', area: '84,5', value: '12000000'
  });
  c.deals.push(d);
  db.cases.push(c);
  return { db, c, d, cp, debtor };
}

/* ================= переменные и шаблоны ================= */

group('Переменные и подстановка');
{
  const { db, c, d } = sample();
  const v = S.context(db, c, d);

  eq('дата сделки прописью', v.DEAL_DATE, '15 апреля 2025 года');
  eq('дата сделки цифрами', v.DEAL_DATE_SHORT, '15.04.2025');
  eq('должник', v.DEBTOR_NAME, 'Общество с ограниченной ответственностью «Ромашка»');
  eq('контрагент кратко', v.COUNTERPARTY_SHORT, 'ООО «Василёк»');
  eq('реквизиты должника', v.DEBTOR_REQUISITES, 'ИНН 1234567890, ОГРН 1234567890123');
  eq('управляющий из профиля', v.MANAGER_NAME, 'Иванов Иван Иванович');
  eq('статус управляющего', v.MANAGER_ROLE, 'конкурсный управляющий');
  eq('статус в творительном падеже', v.MANAGER_ROLE_INS, 'конкурсным управляющим');
  eq('период до возбуждения дела', v.DEAL_PERIOD, 'за 7 месяцев');
  eq('сумма прописью', v.DEAL_AMOUNT_WORDS, 'Восемь миллионов четыреста тысяч рублей 00 копеек');

  // Пример подстановки прямо из ТЗ (§7).
  const tpl = '{{DEAL_DATE}} между {{DEBTOR_NAME}} и\n{{COUNTERPARTY_NAME}} был заключен {{DEAL_TYPE}}\n№ {{DEAL_NUMBER}}.';
  eq('шаблон из ТЗ', S.render(tpl, v, false),
    '15 апреля 2025 года между Общество с ограниченной ответственностью «Ромашка» и\n' +
    'Общество с ограниченной ответственностью «Василёк» был заключен договор купли-продажи\n№ 15.');

  eq('незаполненное — прочерк', S.render('Суд: {{COURT_ADDRESS}}', v, false), 'Суд: __________');
  ok('незаполненное помечается', S.render('{{COURT_ADDRESS}}', v, true).startsWith(S.MISS_A));
  ok('список незаполненных', S.missingVars('{{COURT_ADDRESS}} {{CASE_NUMBER}}', v).join() === 'COURT_ADDRESS');

  eq('описание объекта', v.OBJECT_DESCRIPTION,
    'квартира, расположенный по адресу: г. Москва, ул. Садовая, д. 2, кв. 3, ' +
    'кадастровый номер 77:01:0001001:1234, площадью 84,5 кв. м');
  eq('стоимость объекта отдельно от суммы сделки', v.OBJECT_VALUE, '12\u00A0000\u00A0000,00');
}

// Каждая переменная стандартных блоков должна быть и в реестре (иначе её не
// вставить кнопкой), и в контексте (иначе она молча превратится в прочерк).
group('Реестр переменных');
{
  const { db, c, d } = sample();
  const v = S.context(db, c, d);
  const used = new Set();
  for (const b of D.BLOCKS) {
    String(b.template).replace(/\{\{\s*([A-Z_][A-Z0-9_]*)\s*\}\}/g, (all, n) => used.add(n));
  }

  const notInRegistry = [...used].filter((n) => !D.VAR_INDEX.has(n));
  const notInContext = [...used].filter((n) => !(n in v));
  ok('все переменные блоков есть в реестре', notInRegistry.length === 0, notInRegistry.join(', '));
  ok('все переменные блоков отдаёт контекст', notInContext.length === 0, notInContext.join(', '));

  const registered = [];
  for (const g of D.VARS) for (const it of g.items) registered.push(it.name);
  const notProduced = registered.filter((n) => !(n in v));
  ok('реестр не обещает лишнего', notProduced.length === 0, notProduced.join(', '));
  ok('имена переменных не повторяются', new Set(registered).size === registered.length);
  ok('идентификаторы блоков уникальны',
    new Set(D.BLOCKS.map((b) => b.id)).size === D.BLOCKS.length);
}

/* ================= суммы прописью ================= */

group('Сумма прописью');
{
  eq('ноль', D.moneyWords(0), 'Ноль рублей 00 копеек');
  eq('один', D.moneyWords(1), 'Один рубль 00 копеек');
  eq('тысяча — женский род', D.moneyWords(2000), 'Две тысячи рублей 00 копеек');
  eq('копейки', D.moneyWords(1234567.01), 'Один миллион двести тридцать четыре тысячи пятьсот шестьдесят семь рублей 01 копейка');
  eq('подростковые числа', D.moneyWords(114), 'Сто четырнадцать рублей 00 копеек');
  eq('пустое значение', D.moneyWords(''), '');
}

/* ================= условия ================= */

group('Условная логика');
{
  const { db, c, d } = sample();
  const ctx = () => S.condContext(c, d);

  ok('пустое условие истинно', S.evalCondition('', ctx()));
  ok('флаг выключен', !S.evalCondition('deal.unequal = true', ctx()));
  d.flags.unequal = true;
  ok('флаг включён', S.evalCondition('deal.unequal = true', ctx()));
  ok('условие из ТЗ §11', S.evalCondition('deal.hasUnequalPerformance = true', ctx()));
  ok('неравенство', S.evalCondition('deal.unequal != false', ctx()));
  ok('сравнение чисел', S.evalCondition('deal.amount > 1000000', ctx()));
  ok('AND', S.evalCondition('deal.unequal = true AND deal.amount > 100', ctx()));
  ok('AND с ложной частью', !S.evalCondition('deal.unequal = true AND deal.harm = true', ctx()));
  ok('OR', S.evalCondition('deal.harm = true OR deal.unequal = true', ctx()));
  ok('строковое поле', S.evalCondition('deal.objectType = realty', ctx()));
  ok('поле дела', S.evalCondition('case.procedure = bankruptcy', ctx()));
  ok('непонятное условие не прячет блок', S.evalCondition('какая-то ерунда', ctx()));
}

/* ================= состав заявления ================= */

group('Состав заявления');
{
  const { db, c, d } = sample();
  d.flags.harm = true;

  const blocks = S.statementBlocks(db, c, d);
  const on = (id) => blocks.find((b) => b.id === id);

  ok('обязательные включены', on('title').enabled && on('claims').enabled && on('attachments').enabled);
  ok('блок вреда включён по ответу «Да»', on('harm').enabled);
  ok('блок неравноценности выключен по ответу «Нет»', !on('unequal').enabled);
  ok('условие блока видно в интерфейсе', on('unequal').condition === 'deal.unequal = true');
  ok('порядок сплошной', blocks.every((b, i) => b.ref.order === i));

  // Новый блок в библиотеке должен дописаться в конец, а не потеряться.
  db.customBlocks.push({ id: 'own_1', name: 'Свой блок', group: 'Свои блоки', template: 'Текст.' });
  const again = S.statementBlocks(db, c, d);
  ok('свой блок добавился в конец', again[again.length - 1].id === 'own_1');
  ok('свой блок по умолчанию выключен', !again[again.length - 1].enabled);

  // Правка текста блока живёт в заявлении и не трогает библиотеку.
  const ref = d.statement.blocks.find((b) => b.id === 'title');
  ref.text = 'ЗАЯВЛЕНИЕ';
  ok('текст блока переопределён', S.statementBlocks(db, c, d).find((b) => b.id === 'title').template === 'ЗАЯВЛЕНИЕ');
  ok('библиотека не изменилась', S.library(db).find((b) => b.id === 'title').template !== 'ЗАЯВЛЕНИЕ');
}

/* ================= документ ================= */

group('Сборка документа');
{
  const { db, c, d } = sample();
  const paras = S.buildDocument(db, c, d, { mark: false });

  ok('документ не пуст', paras.length > 10);
  ok('шапка справа', paras[0].align === 'right');
  ok('заголовок по центру и жирный', paras.some((p) => p.align === 'center' && p.bold && /ЗАЯВЛЕНИЕ/.test(p.text)));
  ok('нет пустого абзаца в начале', paras[0].text.trim() !== '');
  ok('нет пустого абзаца в конце', paras[paras.length - 1].text.trim() !== '');
  ok('нет двух пустых абзацев подряд',
    !paras.some((p, i) => i > 0 && p.text.trim() === '' && paras[i - 1].text.trim() === ''));
  ok('текст требований на месте', paras.some((p) => p.text.includes('ПРОШУ')));
  ok('переменные подставлены', !paras.some((p) => /\{\{/.test(p.text)));

  // Выключенный блок в документ не попадает.
  d.statement.blocks.find((b) => b.id === 'legal_basis').enabled = false;
  const less = S.buildDocument(db, c, d, { mark: false });
  ok('выключенный блок исключён', less.length < paras.length && !less.some((p) => p.blockId === 'legal_basis'));
}

/* ================= приложения ================= */

group('Приложения');
{
  const { db, c, d } = sample();
  const mk = (o) => Object.assign(S.newDocument(), o);
  d.documents.push(mk({ type: 'contract', name: 'Договор купли-продажи', number: '15', date: '2025-04-15' }));
  d.documents.push(mk({ type: 'payment', name: 'Платёжное поручение', number: '341' }));
  d.documents.push(mk({ type: 'statement', name: 'Выписка по расчётному счёту', attach: false }));

  const list = S.attachments(d);
  eq('в списке только отмеченные', list.length, 2);
  eq('строка приложения', list[0], 'Договор купли-продажи № 15 от 15.04.2025');
  eq('без даты', list[1], 'Платёжное поручение № 341');

  d.documents[2].attach = true;
  eq('нумерация пересобралась', S.context(db, c, d).ATTACHMENTS,
    '1. Договор купли-продажи № 15 от 15.04.2025\n2. Платёжное поручение № 341\n3. Выписка по расчётному счёту');

  d.documents.splice(0, 1);
  ok('после удаления нумерация сдвинулась',
    S.context(db, c, d).ATTACHMENTS.startsWith('1. Платёжное поручение № 341'));
}

/* ================= проверка ================= */

group('Проверка перед выгрузкой');
{
  const { db, c, d } = sample();
  ok('заполненное дело проходит', S.validate(db, c, d).ok);

  const empty = S.newDb();
  const c2 = S.newCase();
  const d2 = S.newDeal();
  c2.deals.push(d2);
  empty.cases.push(c2);
  const v2 = S.validate(empty, c2, d2);
  ok('пустое дело не проходит', !v2.ok);
  ok('названы номер дела, суд, должник, управляющий, дата и контрагент', v2.errors.length >= 6,
    v2.errors.map((e) => e.field).join(', '));

  // Логические предупреждения (§14).
  const { db: db3, c: c3, d: d3 } = sample();
  d3.contractDate = '2025-05-01';
  d3.performance.date = '2025-04-01';
  const w = S.validate(db3, c3, d3).warnings.join(' | ');
  ok('дата исполнения раньше договора', /Дата исполнения/.test(w), w);
  ok('дата договора позже сделки', /Дата договора позже/.test(w), w);

  const { db: db4, c: c4, d: d4 } = sample();
  d4.object = Object.assign(S.newObject('money'), { sum: '100000' });
  d4.amount = '200000';
  ok('сумма платежа расходится с суммой сделки',
    S.validate(db4, c4, d4).warnings.some((x) => /отличается от суммы платежа/.test(x)));

  const { db: db5, c: c5, d: d5 } = sample();
  d5.flags.unequal = true;
  S.statementBlocks(db5, c5, d5);
  ok('неравноценность без стоимостей',
    S.validate(db5, c5, d5).warnings.some((x) => /Неравноценное встречное исполнение/.test(x)));
}

/* ================= копирование и версии ================= */

group('Копирование сделки и версии');
{
  const { db, c, d } = sample();
  d.statement.blocks = [];
  S.statementBlocks(db, c, d);
  d.statement.blocks.find((b) => b.id === 'harm').enabled = true;

  const copy = S.cloneDeal(d);
  ok('новый идентификатор', copy.id !== d.id);
  eq('стороны сохранены', copy.counterpartyId, d.counterpartyId);
  eq('тип сделки сохранён', copy.type, d.type);
  eq('номер очищен', copy.number, '');
  eq('дата очищена', copy.date, '');
  ok('состав блоков перенесён', copy.statement.blocks.find((b) => b.id === 'harm').enabled);
  eq('версии не переносятся', copy.statement.versions.length, 0);

  const v1 = S.saveVersion(db, c, d, 'первая');
  eq('номер версии', v1.no, 1);
  d.statement.blocks.find((b) => b.id === 'legal_basis').enabled = false;
  const v2 = S.saveVersion(db, c, d, '');
  eq('номер второй версии', v2.no, 2);
  ok('текст версий отличается', v1.text !== v2.text);

  const diff = S.diffLines(v1.text, v2.text);
  ok('в сравнении есть удалённые строки', diff.some((l) => l.op === '-'));
  ok('в сравнении есть общие строки', diff.some((l) => l.op === ' '));
  ok('сравнение восстанавливает исходный текст',
    diff.filter((l) => l.op !== '+').map((l) => l.text).join('\n') === v1.text);

  S.restoreVersion(d, v1.id);
  ok('версия восстановлена', d.statement.blocks.find((b) => b.id === 'legal_basis').enabled);
}

/* ================= DOCX ================= */

group('Выгрузка DOCX');
{
  const { db, c, d } = sample();
  const paras = S.buildDocument(db, c, d, { mark: false });
  const bytes = X.docxBytes(paras, 'Заявление');

  ok('это ZIP', bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04);
  ok('размер разумный', bytes.length > 4000 && bytes.length < 400000, bytes.length + ' байт');

  const entries = unzip(bytes);
  const names = [...entries.keys()].sort();
  ok('состав частей', ['[Content_Types].xml', '_rels/.rels', 'docProps/app.xml', 'docProps/core.xml',
    'word/_rels/document.xml.rels', 'word/document.xml', 'word/footer1.xml', 'word/styles.xml']
    .every((n) => names.includes(n)), names.join(', '));

  const doc = new TextDecoder().decode(entries.get('word/document.xml'));
  ok('русский текст читается', doc.includes('ООО «Василёк»') || doc.includes('Василёк'));
  ok('есть шапка справа', doc.includes('<w:jc w:val="right"/>'));
  ok('есть заголовок по центру', doc.includes('<w:jc w:val="center"/>'));
  ok('колонтитул подключён', doc.includes('footerReference'));
  ok('размер листа A4', doc.includes('w:w="11906"'));
  ok('теги сбалансированы', balanced(doc), 'XML не сходится');
  ok('спецсимволы экранированы', !/&(?!amp;|lt;|gt;|quot;|#)/.test(doc));

  const footer = new TextDecoder().decode(entries.get('word/footer1.xml'));
  ok('номер страницы полем PAGE', footer.includes('PAGE'));

  // Кавычки-ёлочки и амперсанд не должны ломать ни XML, ни CRC.
  const tricky = X.docxBytes([{ text: 'ООО «А&Б» <тест> "кавычки"', align: 'justify', bold: false }], 'Тест');
  const t = new TextDecoder().decode(unzip(tricky).get('word/document.xml'));
  ok('амперсанд экранирован', t.includes('&amp;'));
  ok('угловые скобки экранированы', t.includes('&lt;тест&gt;'));
}

/* Разбор ZIP по центральному каталогу — так же, как это делает Word. */
function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = bytes.length - 22;
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054B50) eocd--;
  if (eocd < 0) throw new Error('нет конца центрального каталога');

  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const out = new Map();

  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014B50) throw new Error('битая запись каталога');
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const offset = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen));

    const lnLen = view.getUint16(offset + 26, true);
    const leLen = view.getUint16(offset + 28, true);
    const start = offset + 30 + lnLen + leLen;
    const data = bytes.subarray(start, start + size);
    if (X.crc32(data) !== crc) throw new Error('CRC не сходится: ' + name);

    out.set(name, data);
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Грубая проверка XML: каждый закрывающий тег соответствует последнему открытому. */
function balanced(xml) {
  const stack = [];
  const re = /<(\/?)([A-Za-z][\w:.-]*)([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(xml))) {
    if (m[3].startsWith('?') || m[2] === '?xml') continue;
    if (m[1]) { if (stack.pop() !== m[2]) return false; }
    else if (!m[4]) stack.push(m[2]);
  }
  return stack.length === 0;
}

/* ================= вёрстка листа ================= */

/*
 * Раскладка по страницам верна ровно настолько, насколько скрытый контейнер
 * для замера совпадает по метрикам с настоящим листом. Разъедутся шрифт,
 * кегль или интерлиньяж — текст молча полезет за обрез, и увидит это уже
 * человек в готовом PDF. Поэтому метрики сверяются прямо в CSS.
 */
group('Метрики листа и замера');
{
  const html = fs.readFileSync(path.join(root, 'src', 'app.html'), 'utf8');
  const css = html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>'));

  const rule = (selector) => {
    const at = css.indexOf(selector + '{');
    return at < 0 ? null : css.slice(at + selector.length + 1, css.indexOf('}', at));
  };
  const prop = (body, name) => {
    const m = body && new RegExp('(?:^|;)\\s*' + name + ':([^;]+)').exec(body);
    return m ? m[1].trim() : null;
  };

  const sheet = rule('.sheet');
  const measure = rule('.docmeasure');
  ok('есть правило .sheet', !!sheet);
  ok('есть правило .docmeasure', !!measure);
  for (const name of ['font-family', 'font-size', 'line-height']) {
    eq('совпадает ' + name, prop(measure, name), prop(sheet, name));
  }

  // Абзацы листа и абзацы замера описаны одним правилом — разойтись нечему.
  ok('абзацы описаны общим правилом', css.includes('.sheetbody p,.docmeasure p{'));
  for (const cls of ['center', 'right', 'left', 'b']) {
    ok('вариант .' + cls + ' общий для листа и замера',
      css.includes('.sheetbody p.' + cls + ',.docmeasure p.' + cls + '{'));
  }

  // Правило на голый <p> протекло бы в текст документа и сдвинуло замер.
  ok('нет правила на голый p', !/(?:^|[};])\s*p\s*\{/.test(css));

  // Таблицы меряются тем же кодом, что и печатаются, поэтому их метрики
  // тоже описаны общими правилами.
  for (const sel of ['.dt', '.dt th', '.dt td', '.dnote']) {
    ok('таблицы: общее правило для ' + sel,
      css.includes('.sheetbody ' + sel + ',.docmeasure ' + sel + '{'));
  }

  // Ширина замера и ширина листа за вычетом полей должны быть одним числом.
  const X2 = globalThis.ZDoc;
  eq('поля листа заданы в одном месте',
    X2.SHEET.w - X2.SHEET.left - X2.SHEET.right, 165);
  ok('высота полосы набора считается из полей',
    X2.CONTENT_H === X2.SHEET.h - X2.SHEET.top - X2.SHEET.bottom);
  ok('padding листа совпадает с полями',
    (prop(sheet, 'padding') || '').replace(/\s+/g, ' ').trim() ===
    `${X2.SHEET.top}mm ${X2.SHEET.right}mm ${X2.SHEET.bottom}mm ${X2.SHEET.left}mm`,
    prop(sheet, 'padding'));
}

/* ================= государственная пошлина ================= */

/*
 * Ставки сверяются по четырём заявлениям из практики: цена иска и пошлина
 * взяты из готовых документов, поэтому расхождение здесь означает, что
 * шкала разъехалась с реальностью, а не что тест придирается.
 */
group('Государственная пошлина');
{
  const fee = (claim, patch) => {
    const d = S.newDeal();
    d.amount = String(claim);
    Object.assign(d.fee, patch || {});
    return S.feeCalc(d);
  };

  eq('205 000 руб.', fee(205000).total, 15125);
  eq('415 150 руб.', fee(415150).total, 20379);
  eq('933 114 руб.', fee(933114).total, 33328);
  eq('1 418 640 руб. без требования о недействительности',
    fee(1418640, { withFixed: false }).total, 33779.5);

  eq('шкала для организации до 100 000', D.feeByValue(50000, 'org').sum, 10000);
  eq('шкала для физлица до 100 000', D.feeByValue(50000, 'person').sum, 4000);
  eq('верхняя ступень ограничена потолком', D.feeByValue(3e9, 'org').sum, 10000000);
  // Незаполненная цена иска — не спор ценой в ноль рублей: пошлина не
  // считается, и в заявлении её место остаётся пустым.
  eq('нулевая цена иска не считается', D.feeByValue(0, 'org').sum, 0);
  eq('и в текст ничего не подставляется',
    S.context(S.newDb(), S.newCase(), S.newDeal()).FEE_AMOUNT, '');

  ok('без скидки по обособленному спору сумма вдвое больше',
    fee(205000, { halved: false }).total === 30250);
  eq('ручная сумма перебивает расчёт', fee(205000, { manual: '1000' }).total, 1000);
  ok('ручная сумма помечена', fee(205000, { manual: '1000' }).manual);

  const d = S.newDeal();
  d.amount = '100000';
  d.object.value = '900000';
  eq('цена иска берётся из стоимости объекта', S.claimPrice(d), 900000);
  d.fee.claim = '250000';
  eq('заданная цена иска важнее', S.claimPrice(d), 250000);
}

/* ================= родительный падеж ================= */

group('Склонение ФИО');
{
  const cases = [
    ['Абрамова Зарият Руслановна', 'Абрамовой Зарият Руслановны'],
    ['Лебедева Галина Николаевна', 'Лебедевой Галины Николаевны'],
    ['Мельник Екатерина Валерьевна', 'Мельник Екатерины Валерьевны'],
    ['Долгая Юлия Николаевна', 'Долгой Юлии Николаевны'],
    ['Иванов Иван Иванович', 'Иванова Ивана Ивановича'],
    ['Белый Пётр Сергеевич', 'Белого Петра Сергеевича'],
    ['Шевченко Тарас Григорьевич', 'Шевченко Тараса Григорьевича'],
    ['Достоевский Фёдор Михайлович', 'Достоевского Фёдора Михайловича']
  ];
  for (const [from, to] of cases) eq(from, D.genitiveFio(from), to);
  eq('пустая строка', D.genitiveFio(''), '');

  // Организацию склонять нельзя: «ООО «Ромашка»а» — готовый ляп в суде.
  const { db, c, d } = sample();
  eq('у организации склоняется только форма', S.context(db, c, d).DEBTOR_NAME_GEN,
    'Общества с ограниченной ответственностью «Ромашка»');
  eq('заявитель по организации', S.context(db, c, d).MANAGER_TITLE,
    'конкурсный управляющий Общества с ограниченной ответственностью «Ромашка»');
  eq('аббревиатура не трогается', D.genitiveOrg('ООО «Ромашка»'), 'ООО «Ромашка»');
  eq('ПАО', D.genitiveOrg('Публичное акционерное общество «Банк»'),
    'Публичного акционерного общества «Банк»');

  const debtor = S.debtorOf(c);
  debtor.kind = 'person';
  debtor.fio = 'Абрамова Зарият Руслановна';
  eq('гражданин склоняется', S.context(db, c, d).DEBTOR_NAME_GEN, 'Абрамовой Зарият Руслановны');
  eq('заявитель по гражданину', S.context(db, c, d).MANAGER_TITLE,
    'конкурсный управляющий имуществом должника Абрамовой Зарият Руслановны');
  c.debtorNameGen = 'Абрамовой З. Р.';
  eq('ручное значение важнее', S.context(db, c, d).DEBTOR_NAME_GEN, 'Абрамовой З. Р.');
}

/* ================= печатная форма ================= */

/*
 * Настоящие печатные формы содержат персональные данные и в репозиторий не
 * попадают, поэтому образец собирается прямо здесь — тем же ZIP-писателем,
 * которым приложение делает DOCX. Заодно проверяется, что писатель и
 * читатель архива понимают друг друга.
 */
group('Импорт печатной формы');
{
  const p = (t) => '<w:p><w:r><w:t xml:space="preserve">' + t + '</w:t></w:r></w:p>';
  const body = [
    'В Арбитражный суд Тестовой области',
    '625000, г. Тюмень, ул. Ленина, д. 74',
    'Заявитель: Финансовый управляющий имуществом должника',
    'Абрамовой Зарият Руслановны',
    'Королева Ирина Павловна',
    'Адрес: 355000, Ставропольский край, Ставрополь г,',
    'Мира ул, дом № 1, а/я 1',
    'Должник: Абрамова Зарият Руслановна',
    'Адрес: КБР, с. Примерное, ул Садовая, 1/ 1-1',
    'Ответчик: Орлова Екатерина Алексеевна',
    'Адрес: 625000, обл Тюменская, г Тюмень',
    'Дело №А20-9999/2025',
    'Решением Арбитражного суда Тестовой области от 28.05.2025г. по делу №А20-9999/2025 ' +
    'Абрамовой Зарият Руслановны (15.03.1990г.р., место рожд: г. Нальчик, адрес рег: КБР, с. Примерное, ' +
    'СНИЛС11122233344, ИНН 070000000001) признан(а) несостоятельным(ой) (банкротом) и введена ' +
    'процедура реализации имущества гражданина. Финансовым управляющим утвержден Королева Ирина ' +
    'Павловна (03.03.1985г.р., ИНН 740000000002, СНИЛС 55566677788, рег.номер 99901) – член ' +
    'ААУ "Горизонт" (ОГРН 1027400000001, ИНН 7400000001, адрес: 355000, г. Ставрополь, д. 1).',
    'Заявление о признании должника банкротом было принято 12.03.2025 г.'
  ].map(p).join('');

  const xml = '<?xml version="1.0" encoding="UTF-8"?><w:document ' +
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    body + '</w:body></w:document>';
  const archive = X.zip([{ name: 'word/document.xml', data: xml }]);

  const entry = I.findEntry(archive, 'word/document.xml');
  ok('запись находится в архиве', !!entry);
  const text = I.documentText(new TextDecoder().decode(entry.data));
  const r = I.parsePrintForm(text);

  eq('суд', r.court, 'Арбитражный суд Тестовой области');
  eq('адрес суда', r.courtAddress, '625000, г. Тюмень, ул. Ленина, д. 74');
  eq('номер дела', r.caseNumber, 'А20-9999/2025');
  eq('дата возбуждения дела', r.caseStartDate, '2025-03-12');
  eq('процедура', r.procedure, 'realization');
  eq('дата введения процедуры', r.procedureDate, '2025-05-28');
  eq('должник', r.debtorName, 'Абрамова Зарият Руслановна');
  eq('должник в родительном падеже', r.debtorNameGen, 'Абрамовой Зарият Руслановны');
  eq('ИНН должника', r.debtorInn, '070000000001');
  eq('СНИЛС должника', r.debtorSnils, '11122233344');
  eq('дата рождения должника', r.debtorBirthDate, '1990-03-15');
  eq('управляющий', r.managerName, 'Королева Ирина Павловна');
  eq('рег. номер управляющего', r.managerRegNumber, '99901');
  eq('СРО', r.sroName, 'ААУ "Горизонт"');
  eq('ОГРН СРО', r.sroOgrn, '1027400000001');
  eq('ответчик', r.respondentName, 'Орлова Екатерина Алексеевна');
  // Адрес в шапке разбит на два абзаца — склейка по висящей запятой обязана
  // собрать его обратно.
  eq('адрес управляющего собран из двух строк', r.managerAddress,
    '355000, Ставропольский край, Ставрополь г, Мира ул, дом № 1, а/я 1');
  ok('ничего не потеряно', r.missing.length === 0, r.missing.join(', '));

  // Пустая графа «Ответчик:» не должна подтянуть следующую строку.
  const empty = I.parsePrintForm('Ответчик:\nДело №А20-9999/2025');
  ok('пустой ответчик остаётся пустым', !empty.respondentName, empty.respondentName);
}

/* ================= кредитный отчёт ================= */

group('Таблицы по кредитному отчёту');
{
  const okb = {
    fio: 'Абрамова З. Р.', reportDate: '2025-06-01',
    contracts: [
      {
        creditor: 'ПАО «Банк А»', kind: 'потребительский кредит', number: '11', date: '2021-03-01',
        closed: false, snapshots: [
          { date: '2023-01-31', principal: 500000, total: 520000, overdue: 0, since: null, days: 0 },
          { date: '2023-06-30', principal: 480000, total: 510000, overdue: 35000, since: '2023-04-12', days: 79 },
          { date: '2025-05-31', principal: 470000, total: 600000, overdue: 120000, since: '2023-04-12', days: 780 }
        ]
      },
      {
        creditor: 'АО «Банк Б»', kind: 'автокредит', number: '22', date: '2022-01-15',
        closed: true, snapshots: [
          { date: '2023-03-31', principal: 200000, total: 210000, overdue: 9000, since: '2023-02-01', days: 58 },
          { date: '2024-01-31', principal: 0, total: 0, overdue: 0, since: null, days: 0 }
        ]
      },
      {
        creditor: 'ООО МФК «В»', kind: 'микрозаём', number: '33', date: '2023-09-01',
        closed: false, snapshots: [
          { date: '2024-03-31', principal: 15000, total: 22000, overdue: 7000, since: '2024-01-10', days: 81 }
        ]
      }
    ]
  };

  const starts = O.overdueStarts(okb);
  eq('просрочка отмечена по трём обязательствам', starts.length, 3);
  eq('первая по времени', starts[0].creditor, 'АО «Банк Б»');
  ok('погашенная просрочка помечена', starts[0].cured);
  eq('самая ранняя непогашенная', O.earliestUncured(starts).since, '2023-04-12');

  const at = O.overdueAt(okb, '2024-06-01');
  eq('на дату сделки просрочка по двум', at.length, 2);
  eq('сортировка по размеру', at[0].creditor, 'ПАО «Банк А»');
  eq('дни считаются от даты возникновения, а не снимка', at[0].days, O.daysBetween('2023-04-12', '2024-06-01'));
  ok('снимок берётся не позже даты', at[0].snapshot <= '2024-06-01');
  // На 15.02.2023 ни одного снимка с просрочкой ещё не было: ближайшие
  // датированы позже, и заглядывать в них вперёд нельзя.
  eq('будущие снимки не учитываются', O.overdueAt(okb, '2023-02-15').length, 0);

  const t1 = O.tableInsolvency(okb);
  eq('шапка таблицы возникновения', t1.head.length, 6);
  eq('строк в таблице', t1.rows.length, 3);
  const t2 = O.tableOverdue(okb, '2024-06-01');
  ok('в таблице на дату есть итог', !!t2.total);
  eq('итог просрочки', t2.total[3], D.money(35000 + 7000));
  ok('без даты сделки таблицы нет', O.tableOverdue(okb, '') === null);

  const v = O.vars(okb, '2024-06-01');
  eq('переменная первой просрочки', v.OKB_FIRST_OVERDUE_DATE, '12 апреля 2023 года');
  eq('переменная суммы', v.OKB_OVERDUE_SUM, D.money(42000));
  ok('без отчёта переменные пустые', O.vars(null, '2024-06-01').OKB_OVERDUE_SUM === '');
}

/* ================= таблицы в документе ================= */

group('Таблицы в заявлении');
{
  const { db, c, d } = sample();
  c.okb = {
    fio: 'Тест', reportDate: '2025-06-01',
    contracts: [{
      creditor: 'ПАО «Банк А»', kind: 'кредит', number: '11', date: '2021-03-01', closed: false,
      snapshots: [{ date: '2024-12-31', principal: 480000, total: 510000, overdue: 35000, since: '2023-04-12', days: 600 }]
    }]
  };
  d.date = '2025-04-15';
  S.statementBlocks(db, c, d);
  for (const b of d.statement.blocks) if (b.id === 'okb_insolvency' || b.id === 'okb_overdue') b.enabled = true;

  const doc = S.buildDocument(db, c, d, { mark: false });
  const tables = doc.filter((x) => x.kind === 'table');
  eq('в документе две таблицы', tables.length, 2);
  ok('у таблицы есть шапка и строки', tables[0].head.length > 0 && tables[0].rows.length > 0);
  ok('абзацы помечены видом', doc.every((x) => x.kind === 'p' || x.kind === 'table'));
  ok('текст версии включает строки таблиц', /ПАО «Банк А»/.test(S.documentText(db, c, d)));

  // Без отчёта условие блока не выполнено и таблиц быть не должно.
  const c2 = JSON.parse(JSON.stringify(c));
  c2.okb = null;
  ok('без отчёта таблиц нет',
    S.buildDocument(db, c2, c2.deals[0], { mark: false }).every((x) => x.kind !== 'table'));

  // DOCX
  const bytes = X.docxBytes(doc, 'Заявление');
  const xml = new TextDecoder().decode(unzip(bytes).get('word/document.xml'));
  ok('в DOCX есть таблица', xml.includes('<w:tbl>'));
  ok('шапка таблицы повторяется на новом листе', xml.includes('<w:tblHeader/>'));
  ok('у таблицы есть сетка колонок', xml.includes('<w:tblGrid>'));
  ok('XML документа с таблицами сходится', balanced(xml));
  ok('содержимое таблицы попало в DOCX', xml.includes('Банк А'));

  // Разбиение на куски для раскладки по листам
  const flow = X.flow(doc);
  ok('строка таблицы — отдельный кусок', flow.some((x) => x.type === 'row'));
  eq('кусков-строк столько же, сколько строк в таблицах',
    flow.filter((x) => x.type === 'row').length,
    tables.reduce((n, t) => n + t.rows.length + (t.total ? 1 : 0), 0));
}

/* ================= итог ================= */

console.log('\n' + '='.repeat(60));
console.log(`Проверок: ${passed + failed}, успешно: ${passed}, провалено: ${failed}`);
process.exit(failed ? 1 : 0);
