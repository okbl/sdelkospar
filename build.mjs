/*
 * Сборка в один файл: шрифт и все скрипты встраиваются прямо в HTML, чтобы
 * страница открывалась двойным кликом (file://) без сервера и без интернета.
 *
 *   node build.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, 'dist');
const src = (name) => fs.readFileSync(path.join(root, 'src', name), 'utf8');

/** Внутри <script> последовательность </script> закрыла бы тег раньше времени. */
const safe = (js) => js.replace(/<\/script/gi, '<\\/script');

// Шрифт встроен как data:-URI: ссылка на CDN молча отвалилась бы при работе
// с флешки без интернета, а вместе с ней и вся типографика.
const fontPath = path.join(root, 'src', 'fonts', 'onest.css');
if (!fs.existsSync(fontPath)) {
  throw new Error('нет src/fonts/onest.css — запустите: node tools/fetch-font.mjs');
}

/*
 * pdf.js поставляется только как ES-модуль. Инлайн-модуль в HTML нельзя
 * импортировать, поэтому забираем нужные экспорты через globalThis: читаем
 * финальный `export{...}` бандла и дописываем присваивание с его локальными
 * именами. Имена минифицированы, но берём мы их из самого файла, так что
 * пересборка на новой версии pdf.js ничего не сломает.
 */
function exposeExports(source, globalName, wanted) {
  const tail = source.match(/export\s*\{([^}]*)\}\s*;?\s*$/);
  if (!tail) throw new Error(`не найден export{...} в бандле ${globalName}`);

  const map = new Map();
  for (const part of tail[1].split(',')) {
    const m = part.trim().match(/^(\S+)(?:\s+as\s+(\S+))?$/);
    if (m) map.set(m[2] || m[1], m[1]);
  }
  const fields = wanted.map((name) => {
    const local = map.get(name);
    if (!local) throw new Error(`бандл ${globalName} не экспортирует ${name}`);
    return `${JSON.stringify(name)}:${local}`;
  });
  return `${source}\nglobalThis[${JSON.stringify(globalName)}]={${fields.join(',')}};\n`;
}

const pdfjs = path.join(root, 'node_modules', 'pdfjs-dist', 'legacy', 'build');
if (!fs.existsSync(pdfjs)) {
  throw new Error('нет node_modules/pdfjs-dist — запустите: npm install');
}

// Воркер, поднятый в globalThis, заставляет pdf.js работать в главном потоке:
// отдельный worker-файл не нужен, а из file:// его и не загрузить.
const worker = exposeExports(
  fs.readFileSync(path.join(pdfjs, 'pdf.worker.min.mjs'), 'utf8'),
  'pdfjsWorker', ['WorkerMessageHandler']);
const core = exposeExports(
  fs.readFileSync(path.join(pdfjs, 'pdf.min.mjs'), 'utf8'),
  'pdfjsLib', ['getDocument', 'GlobalWorkerOptions', 'version', 'OPS']);

const html = src('app.html')
  .replace('/* @@FONT@@ */', () => fs.readFileSync(fontPath, 'utf8'))
  .replace('<!-- @@PDFJS_WORKER@@ -->', () => `<script type="module">${safe(worker)}</script>`)
  .replace('<!-- @@PDFJS@@ -->', () => `<script type="module">${safe(core)}</script>`)
  .replace('<!-- @@PARSER@@ -->', () => `<script>${safe(src('parser.js'))}</script>`)
  .replace('<!-- @@DATA@@ -->', () => `<script>${safe(src('data.js'))}</script>`)
  .replace('<!-- @@OKB@@ -->', () => `<script>${safe(src('okb.js'))}</script>`)
  .replace('<!-- @@IMPORT@@ -->', () => `<script>${safe(src('import.js'))}</script>`)
  .replace('<!-- @@STORE@@ -->', () => `<script>${safe(src('store.js'))}</script>`)
  .replace('<!-- @@DOC@@ -->', () => `<script>${safe(src('doc.js'))}</script>`)
  .replace('<!-- @@APP@@ -->', () => `<script>${safe(src('app.js'))}</script>`);

for (const marker of ['@@FONT@@', '@@PDFJS@@', '@@PDFJS_WORKER@@', '@@PARSER@@',
  '@@DATA@@', '@@OKB@@', '@@IMPORT@@', '@@STORE@@', '@@DOC@@', '@@APP@@']) {
  if (html.includes(marker)) throw new Error(`метка ${marker} не подставлена`);
}

fs.mkdirSync(dist, { recursive: true });

// index.html — для хостинга (GitHub Pages и Render раздают его как корень сайта).
// Второй файл с человеческим именем — чтобы открывать двойным кликом локально.
const outputs = ['index.html', 'Оспаривание сделок.html'];
for (const name of outputs) fs.writeFileSync(path.join(dist, name), html, 'utf8');

console.log(`Готово: ${outputs.map((n) => 'dist/' + n).join(', ')}`);
console.log(`Размер: ${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} МБ`);
