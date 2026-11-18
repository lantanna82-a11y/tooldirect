import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distRoot = path.join(projectRoot, 'dist');
const blockedTerms = [
  [76, 101, 105, 116, 122],
  [1051, 1077, 1081, 1094]
].map(points => String.fromCodePoint(...points));

async function listFiles(root) {
  const result = [];
  async function walk(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else result.push(fullPath);
    }
  }
  await walk(root);
  return result;
}

const files = await listFiles(distRoot);
const violations = [];
for (const file of files) {
  const relative = path.relative(distRoot, file);
  for (const term of blockedTerms) {
    if (relative.toLocaleLowerCase().includes(term.toLocaleLowerCase())) violations.push(`Имя файла: ${relative}`);
  }
  if (!/\.(?:html|js|json|svg|txt|css)$/i.test(file) && path.basename(file) !== '.nojekyll') continue;
  const content = await fs.readFile(file, 'utf8');
  for (const term of blockedTerms) {
    if (content.toLocaleLowerCase().includes(term.toLocaleLowerCase())) violations.push(`Содержимое: ${relative}`);
  }
}

const dataSource = await fs.readFile(path.join(distRoot, 'content-data.js'), 'utf8');
const data = JSON.parse(dataSource.replace(/^window\.KB_DATA=/, '').replace(/;\s*$/, ''));
const articleIds = new Set(data.articles.map(article => article.id));
const titles = new Set();
for (const article of data.articles) {
  const normalized = article.title.toLocaleLowerCase('ru').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  if (titles.has(normalized)) violations.push(`Повтор заголовка: ${article.title}`);
  titles.add(normalized);
  if (!data.sections.some(section => section.id === article.sectionId)) violations.push(`Нет раздела для статьи: ${article.title}`);
  for (const related of article.related) if (!articleIds.has(related)) violations.push(`Некорректная связь: ${article.id} → ${related}`);
  if (article.diagram && !files.includes(path.join(distRoot, article.diagram.src))) violations.push(`Нет SVG: ${article.diagram.src}`);
}

for (const section of data.sections) {
  for (const id of section.articleIds) if (!articleIds.has(id)) violations.push(`Раздел ${section.id} ссылается на отсутствующую статью ${id}`);
}

if (violations.length) {
  console.error(violations.join('\n'));
  process.exit(1);
}

console.log(JSON.stringify({
  status: 'ok',
  files: files.length,
  sections: data.sections.length,
  articles: data.articles.length,
  diagrams: data.articles.filter(article => article.diagram).length
}, null, 2));
