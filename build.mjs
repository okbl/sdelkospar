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

const html = src('app.html')
  .replace('/* @@FONT@@ */', () => fs.readFileSync(fontPath, 'utf8'))
  .replace('<!-- @@DATA@@ -->', () => `<script>${safe(src('data.js'))}</script>`)
  .replace('<!-- @@STORE@@ -->', () => `<script>${safe(src('store.js'))}</script>`)
  .replace('<!-- @@DOC@@ -->', () => `<script>${safe(src('doc.js'))}</script>`)
  .replace('<!-- @@APP@@ -->', () => `<script>${safe(src('app.js'))}</script>`);

for (const marker of ['@@FONT@@', '@@DATA@@', '@@STORE@@', '@@DOC@@', '@@APP@@']) {
  if (html.includes(marker)) throw new Error(`метка ${marker} не подставлена`);
}

fs.mkdirSync(dist, { recursive: true });

// index.html — для хостинга (GitHub Pages и Render раздают его как корень сайта).
// Второй файл с человеческим именем — чтобы открывать двойным кликом локально.
const outputs = ['index.html', 'Оспаривание сделок.html'];
for (const name of outputs) fs.writeFileSync(path.join(dist, name), html, 'utf8');

console.log(`Готово: ${outputs.map((n) => 'dist/' + n).join(', ')}`);
console.log(`Размер: ${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} МБ`);
