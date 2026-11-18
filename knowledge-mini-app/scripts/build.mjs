import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const sourceRoot = path.resolve(projectRoot, '..', '1');
const primaryRoot = path.join(sourceRoot, 'Деревообработка');
const supplementRoot = path.join(sourceRoot, 'Энциклопедия');
const templatePath = path.join(projectRoot, 'src', 'index.html');
const distRoot = path.join(projectRoot, 'dist');
const assetRoot = path.join(distRoot, 'assets');
const diagramRoot = path.join(assetRoot, 'diagrams');

const blockedTerms = [
  [76, 101, 105, 116, 122],
  [1051, 1077, 1081, 1094]
].map(points => String.fromCodePoint(...points));

const sectionDefinitions = [
  { id: 'materials', prefix: '01', title: 'Материалы и физика резания', icon: 'panels', color: '#526d80', description: 'Свойства древесины, плит, композитов и основы резания.' },
  { id: 'cutters', prefix: '02', title: 'Фрезы', icon: 'cutter', color: '#a06b2f', description: 'Концевые, спиральные, профильные и сборные фрезы.' },
  { id: 'saws', prefix: '03', title: 'Пильные диски', icon: 'saw', color: '#5f6a73', description: 'Геометрия зуба и подбор диска под задачу.' },
  { id: 'drills', prefix: '04', title: 'Свёрла и зенкеры', icon: 'drill', color: '#3e7462', description: 'Присадочные, чашечные и специальные свёрла.' },
  { id: 'equipment', prefix: '05', title: 'Ножи, оснастка и станки', icon: 'knives', color: '#6f5d67', description: 'Ножи, системы крепления, приспособления и классы оборудования.' },
  { id: 'modes', prefix: '06', title: 'Режимы и эксплуатация', icon: 'gauge', color: '#315f86', description: 'Обороты, подача, очистка, аспирация и обслуживание.' },
  { id: 'diagnostics', prefix: '07', title: 'Диагностика дефектов', icon: 'inspect', color: '#9b4f54', description: 'Причины сколов, прижогов, вибраций и поломок.' }
];

const uniqueSupplement = new Map([
  ['11.4.6', 'modes'],
  ['11.4.7', 'modes'],
  ['11.4.8', 'equipment'],
  ['11.5.1', 'equipment'],
  ['11.5.2', 'equipment'],
  ['11.5.3', 'equipment'],
  ['11.5.4', 'equipment']
]);

const state = {
  assetCounter: 0,
  copiedAssets: new Map(),
  idByKey: new Map(),
  outputAssets: []
};

function sanitizeBlocked(value = '') {
  let result = String(value);
  for (const term of blockedTerms) {
    result = result.replace(new RegExp(escapeRegExp(term), 'giu'), '');
  }
  return result
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));
}

function escapeXml(value = '') {
  return escapeHtml(sanitizeBlocked(value));
}

async function listFiles(root, extension = '') {
  const result = [];
  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (!extension || entry.name.toLowerCase().endsWith(extension)) result.push(fullPath);
    }
  }
  try { await walk(root); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return result;
}

function parseFrontmatter(raw) {
  const normalized = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return { attributes: {}, body: normalized };
  const end = normalized.indexOf('\n---\n', 4);
  if (end < 0) return { attributes: {}, body: normalized };
  const attributes = {};
  for (const line of normalized.slice(4, end).split('\n')) {
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    if (value.startsWith('[') && value.endsWith(']')) {
      value = value.slice(1, -1).split(',').map(item => sanitizeBlocked(item.trim())).filter(Boolean);
    }
    attributes[key] = typeof value === 'string' ? sanitizeBlocked(value) : value;
  }
  return { attributes, body: normalized.slice(end + 5) };
}

function firstHeading(body, fallback) {
  const match = body.match(/^#\s+(.+)$/m);
  const raw = match?.[1] || fallback;
  return sanitizeBlocked(raw.replace(/^(?:\d+\.)+\d*\s*/, '').replace(/[_]+/g, ' '));
}

function normalizeTitle(value) {
  return sanitizeBlocked(value)
    .toLocaleLowerCase('ru')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\b(?:и|в|на|для|по|из|как|к)\b/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stableArticleId(key) {
  const number = key.match(/^\d+(?:\.\d+)+/)?.[0];
  if (number) return `a-${number.replace(/\./g, '-')}`;
  let hash = 0;
  for (const char of key) hash = ((hash << 5) - hash + char.codePointAt(0)) | 0;
  return `a-${Math.abs(hash).toString(36)}`;
}

function plainText(markdown) {
  return sanitizeBlocked(markdown)
    .replace(/^---[\s\S]*?---/m, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/!\[\[[^\]]+\]\]/g, ' ')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, '$2 $1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_>#|$~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function excerptFrom(body) {
  const text = plainText(body.replace(/^#\s+.+$/m, ''));
  return text.length > 190 ? `${text.slice(0, 187).trim()}…` : text;
}

function sectionForPrimary(key) {
  const prefix = key.slice(0, 2);
  return sectionDefinitions.find(section => section.prefix === prefix)?.id || null;
}

function isPrimaryArticle(key) {
  if (key.startsWith('00.00')) return false;
  if (/\.00_MOC_/i.test(key)) return false;
  return /^(?:0[1-7])\./.test(key);
}

function sourceLabel(origin) {
  return origin === 'primary' ? 'Основная база' : 'Дополнительный материал';
}

async function loadArticle(filePath, origin, mappedSection = null) {
  const raw = await fs.readFile(filePath, 'utf8');
  const { attributes, body } = parseFrontmatter(raw);
  const key = path.basename(filePath, path.extname(filePath));
  const title = firstHeading(body, attributes.title || key);
  const sectionId = mappedSection || sectionForPrimary(key);
  const tags = Array.isArray(attributes.tags) ? attributes.tags : [];
  return {
    id: stableArticleId(key),
    key,
    filePath,
    origin,
    sectionId,
    title,
    normalizedTitle: normalizeTitle(title),
    tags: tags.map(tag => sanitizeBlocked(String(tag).replace(/^#/, ''))).filter(Boolean),
    body: sanitizeBlocked(body),
    excerpt: excerptFrom(body),
    sourceLabel: sourceLabel(origin)
  };
}

function parseMainOrder(raw) {
  const order = [];
  const body = parseFrontmatter(raw).body;
  const sectionPattern = /^###\s+(0[1-7])\.[^\n]*\n([\s\S]*?)(?=^###\s+0[1-7]\.|\Z)/gm;
  for (const sectionMatch of body.matchAll(sectionPattern)) {
    const prefix = sectionMatch[1];
    const keys = [...sectionMatch[2].matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)]
      .map(match => path.basename(match[1]))
      .filter(key => !/\.00_MOC_/i.test(key));
    order.push({ prefix, keys });
  }
  return order;
}

function sortByMainOrder(articles, mainOrder) {
  const positions = new Map();
  let index = 0;
  for (const group of mainOrder) {
    for (const key of group.keys) positions.set(key, index++);
  }
  return articles.sort((a, b) => {
    const left = positions.has(a.key) ? positions.get(a.key) : Number.MAX_SAFE_INTEGER;
    const right = positions.has(b.key) ? positions.get(b.key) : Number.MAX_SAFE_INTEGER;
    return left - right || a.key.localeCompare(b.key, 'ru');
  });
}

function sanitizeSvg(svg) {
  return sanitizeBlocked(svg)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*(['"])[\s\S]*?\1/gi, '')
    .replace(/\s(?:href|xlink:href)\s*=\s*(['"])(?:https?:|javascript:)[\s\S]*?\1/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/width="\d+(?:\.\d+)?"\s+height="\d+(?:\.\d+)?"/i, '')
    .replace('<svg ', '<svg class="source-diagram" role="img" ');
}

function slugify(value) {
  const transliteration = {
    а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'i',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya'
  };
  return sanitizeBlocked(value).toLocaleLowerCase('ru').split('').map(char => transliteration[char] ?? char)
    .join('').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'section';
}

function renderInline(value, currentArticle, registerAsset) {
  const tokens = [];
  const token = html => {
    const id = `\u0000${tokens.length}\u0000`;
    tokens.push(html);
    return id;
  };
  let text = sanitizeBlocked(value);

  text = text.replace(/`([^`]+)`/g, (_, code) => token(`<code>${escapeHtml(code)}</code>`));
  text = text.replace(/!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, caption) => {
    const asset = registerAsset(target.trim(), currentArticle.filePath);
    if (!asset) return token(`<span class="missing-asset">Вложение недоступно</span>`);
    return token(`<figure class="article-media"><button type="button" data-zoom="${escapeHtml(asset)}" aria-label="Увеличить изображение"><img loading="lazy" src="${escapeHtml(asset)}" alt="${escapeHtml(caption || 'Иллюстрация к статье')}"></button>${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''}</figure>`);
  });
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, target) => {
    const asset = registerAsset(target.trim(), currentArticle.filePath);
    if (!asset) return token(`<span class="missing-asset">Вложение недоступно</span>`);
    return token(`<figure class="article-media"><button type="button" data-zoom="${escapeHtml(asset)}" aria-label="Увеличить изображение"><img loading="lazy" src="${escapeHtml(asset)}" alt="${escapeHtml(alt || 'Иллюстрация к статье')}"></button>${alt ? `<figcaption>${escapeHtml(alt)}</figcaption>` : ''}</figure>`);
  });
  text = text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, alias) => {
    const key = path.basename(target.trim()).replace(/\.md$/i, '');
    const id = state.idByKey.get(key);
    const label = sanitizeBlocked(alias || key.replace(/^\d+(?:\.\d+)*_?/, '').replace(/_/g, ' '));
    return token(id ? `<a class="internal-link" href="#article/${id}" data-article="${id}">${escapeHtml(label)}</a>` : `<span>${escapeHtml(label)}</span>`);
  });
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (_, label, href) => token(`<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`));
  text = text.replace(/\$([^$\n]+)\$/g, (_, formula) => token(`<span class="math">${escapeHtml(formula)}</span>`));
  text = escapeHtml(text);
  text = text
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
    .replace(/(^|\s)#([\p{L}\p{N}_-]+)/gu, '$1<span class="tag">#$2</span>');
  return text.replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)]);
}

function splitTableRow(line) {
  return line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
}

function isTableSeparator(line = '') {
  return /^\s*\|?\s*:?-{3,}/.test(line) && line.includes('|');
}

function isSpecialLine(lines, index) {
  const line = lines[index] || '';
  const next = lines[index + 1] || '';
  return !line.trim() || /^#{2,3}\s/.test(line) || /^```/.test(line) || /^\$\$/.test(line) || /^>\s*\[!/.test(line) || /^---+$/.test(line.trim()) || /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line) || (line.includes('|') && isTableSeparator(next)) || /^<svg\b/i.test(line.trim());
}

function markdownToHtml(article, registerAsset) {
  const lines = article.body.replace(/^#\s+.+\n?/, '').split('\n');
  const html = [];
  const toc = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }

    if (/^<svg\b/i.test(line.trim())) {
      let svg = line;
      while (!/<\/svg>/i.test(svg) && index + 1 < lines.length) svg += `\n${lines[++index]}`;
      html.push(`<figure class="source-svg">${sanitizeSvg(svg)}<figcaption>Схема из исходной заметки</figcaption></figure>`);
      index++;
      continue;
    }

    if (/^```/.test(line)) {
      const language = line.slice(3).trim() || 'text';
      const code = [];
      index++;
      while (index < lines.length && !/^```/.test(lines[index])) code.push(lines[index++]);
      index++;
      html.push(`<div class="code-block"><div class="code-head"><span>${escapeHtml(language)}</span><button type="button" data-copy>Копировать</button></div><pre><code>${escapeHtml(code.join('\n'))}</code></pre></div>`);
      continue;
    }

    if (/^\$\$/.test(line.trim())) {
      const formula = [];
      let current = line.trim().replace(/^\$\$/, '');
      if (current.endsWith('$$')) {
        formula.push(current.replace(/\$\$$/, ''));
        index++;
      } else {
        if (current) formula.push(current);
        index++;
        while (index < lines.length && !/\$\$$/.test(lines[index])) formula.push(lines[index++]);
        if (index < lines.length) formula.push(lines[index++].replace(/\$\$$/, ''));
      }
      html.push(`<div class="formula">${escapeHtml(formula.join(' '))}</div>`);
      continue;
    }

    const heading = line.match(/^(##|###)\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const title = sanitizeBlocked(heading[2].replace(/^\d+\.\s*/, ''));
      const id = slugify(title);
      toc.push({ level, title, id });
      html.push(`<h${level} id="${id}">${renderInline(title, article, registerAsset)}</h${level}>`);
      index++;
      continue;
    }

    const callout = line.match(/^>\s*\[!(info|note|tip|important|warning|danger)\]\s*(.*)$/i);
    if (callout) {
      const typeMap = { info: 'note', note: 'note', tip: 'note', important: 'important', warning: 'warning', danger: 'warning' };
      const parts = [];
      index++;
      while (index < lines.length && /^>/.test(lines[index])) parts.push(lines[index++].replace(/^>\s?/, ''));
      const title = sanitizeBlocked(callout[2] || ({ note: 'Заметка', important: 'Важно', warning: 'Предупреждение' }[typeMap[callout[1].toLowerCase()]]));
      html.push(`<aside class="callout ${typeMap[callout[1].toLowerCase()]}"><span class="callout-mark">${typeMap[callout[1].toLowerCase()] === 'warning' ? '△' : typeMap[callout[1].toLowerCase()] === 'important' ? '!' : 'i'}</span><div><strong>${escapeHtml(title)}</strong><p>${renderInline(parts.join(' '), article, registerAsset)}</p></div></aside>`);
      continue;
    }

    if (line.includes('|') && isTableSeparator(lines[index + 1])) {
      const header = splitTableRow(line);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) rows.push(splitTableRow(lines[index++]));
      html.push(`<div class="table-wrap" role="region" tabindex="0"><table><thead><tr>${header.map(cell => `<th>${renderInline(cell, article, registerAsset)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${renderInline(cell, article, registerAsset)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) items.push(lines[index++].replace(/^\s*[-*]\s+/, ''));
      html.push(`<ul>${items.map(item => `<li>${renderInline(item, article, registerAsset)}</li>`).join('')}</ul>`);
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) items.push(lines[index++].replace(/^\s*\d+\.\s+/, ''));
      html.push(`<ol>${items.map(item => `<li>${renderInline(item, article, registerAsset)}</li>`).join('')}</ol>`);
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      html.push('<hr>');
      index++;
      continue;
    }

    const paragraph = [line.trim()];
    index++;
    while (index < lines.length && !isSpecialLine(lines, index)) paragraph.push(lines[index++].trim());
    html.push(`<p>${renderInline(paragraph.join(' '), article, registerAsset)}</p>`);
  }

  return { html: html.join('\n'), toc };
}

function resolveAsset(target, articlePath) {
  const cleanTarget = target.split('#')[0].replace(/^<|>$/g, '');
  const decoded = decodeURIComponent(cleanTarget);
  const candidates = [
    path.resolve(path.dirname(articlePath), decoded),
    path.resolve(sourceRoot, decoded),
    path.resolve(supplementRoot, '99_Вложения', path.basename(decoded)),
    path.resolve(primaryRoot, '99_Вложения', path.basename(decoded))
  ];
  return candidates;
}

function assetRegistrar(pendingCopies) {
  return (target, articlePath) => {
    const key = `${articlePath}|${target}`;
    if (state.copiedAssets.has(key)) return state.copiedAssets.get(key);
    const candidates = resolveAsset(target, articlePath);
    const extension = path.extname(target).toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(extension)) return null;
    const fileName = `asset-${String(++state.assetCounter).padStart(3, '0')}${extension}`;
    const publicPath = `assets/media/${fileName}`;
    pendingCopies.push({ candidates, publicPath, extension });
    state.copiedAssets.set(key, publicPath);
    return publicPath;
  };
}

function extractDiagramData(article) {
  const markdown = article.body.replace(/<svg[\s\S]*?<\/svg>/gi, '');
  const numbered = [...markdown.matchAll(/^\s*\d+\.\s+\*{0,2}([^\n:*]+).*$/gm)].map(match => plainText(match[1])).filter(Boolean);
  if (numbered.length >= 3) return { type: 'process', items: numbered.slice(0, 4) };

  const lines = markdown.split('\n');
  for (let index = 0; index < lines.length - 2; index++) {
    if (lines[index].includes('|') && isTableSeparator(lines[index + 1])) {
      const headers = splitTableRow(lines[index]).map(plainText).filter(Boolean);
      const rows = [];
      let cursor = index + 2;
      while (cursor < lines.length && lines[cursor].includes('|') && rows.length < 3) rows.push(splitTableRow(lines[cursor++]).map(plainText));
      if (headers.length >= 2 && rows.length >= 2) return { type: 'comparison', headers: headers.slice(0, 3), rows };
    }
  }

  const values = [...markdown.matchAll(/\b\d+(?:[.,]\d+)?(?:\s*[–-]\s*\d+(?:[.,]\d+)?)?\s*(?:мм|мкм|см|м\/мин|об\/мин|кг\/м³|°C|°)/giu)]
    .map(match => plainText(match[0])).filter((value, index, all) => all.indexOf(value) === index).slice(0, 3);
  if (values.length >= 2) return { type: 'dimensions', values };
  return null;
}

function compactLabel(value, max = 32) {
  const text = sanitizeBlocked(value).replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
}

function svgFrame(title, inner, description) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 400" role="img" aria-labelledby="title description">
  <title id="title">${escapeXml(title)}</title>
  <desc id="description">${escapeXml(description)}</desc>
  <style>
    :root{--bg:#f7f9fb;--panel:#fff;--text:#17232e;--muted:#687685;--line:#526d80;--accent:#315f86;--accent2:#a06b2f;--border:#d9e0e6}
    @media(prefers-color-scheme:dark){:root{--bg:#111a22;--panel:#18232d;--text:#edf2f5;--muted:#9aa8b4;--line:#8bb6d8;--accent:#78a8cc;--accent2:#d7a16b;--border:#30404c}}
    text{font-family:Arial,sans-serif;fill:var(--text)}.muted{fill:var(--muted)}.line{stroke:var(--line)}
  </style>
  <rect width="720" height="400" rx="24" fill="var(--bg)"/>
  <text x="36" y="48" font-size="20" font-weight="700">${escapeXml(compactLabel(title, 56))}</text>
  <text x="36" y="72" class="muted" font-size="12">Автоматический черновик · требуется инженерная проверка</text>
  ${inner}
</svg>`;
}

function generateProcessSvg(article, data) {
  const items = data.items.slice(0, 4);
  const width = 148;
  const gap = 22;
  const start = 30;
  const boxes = items.map((item, index) => {
    const x = start + index * (width + gap);
    const arrow = index < items.length - 1 ? `<path d="M${x + width} 218h${gap - 6}" fill="none" stroke="var(--line)" stroke-width="2"/><path d="m${x + width + gap - 8} 212 8 6-8 6" fill="none" stroke="var(--line)" stroke-width="2"/>` : '';
    return `<rect x="${x}" y="150" width="${width}" height="136" rx="16" fill="var(--panel)" stroke="var(--border)"/>
      <circle cx="${x + 27}" cy="178" r="14" fill="var(--accent)"/><text x="${x + 27}" y="183" text-anchor="middle" fill="#fff" font-size="12" font-weight="700">${index + 1}</text>
      <text x="${x + 18}" y="220" font-size="13" font-weight="700">${escapeXml(compactLabel(item, 18))}</text>
      <text x="${x + 18}" y="246" class="muted" font-size="11">Проверить параметры</text>${arrow}`;
  }).join('');
  return svgFrame(article.title, boxes, 'Последовательность основных этапов, извлечённая из текста статьи.');
}

function generateComparisonSvg(article, data) {
  const columns = Math.min(3, Math.max(2, data.headers.length));
  const width = 204;
  const boxes = Array.from({ length: columns }, (_, index) => {
    const x = 34 + index * 222;
    const values = data.rows.slice(0, 3).map(row => compactLabel(row[index] || '—', 24));
    return `<rect x="${x}" y="122" width="${width}" height="222" rx="16" fill="var(--panel)" stroke="var(--border)"/>
      <rect x="${x}" y="122" width="${width}" height="52" rx="16" fill="${index === 1 ? 'var(--accent2)' : 'var(--accent)'}" opacity=".16"/>
      <text x="${x + 16}" y="153" font-size="14" font-weight="700">${escapeXml(compactLabel(data.headers[index] || `Вариант ${index + 1}`, 22))}</text>
      ${values.map((value, rowIndex) => `<circle cx="${x + 18}" cy="${205 + rowIndex * 48}" r="4" fill="var(--accent)"/><text x="${x + 31}" y="${209 + rowIndex * 48}" font-size="12">${escapeXml(value)}</text>`).join('')}`;
  }).join('');
  return svgFrame(article.title, boxes, 'Сравнение параметров, извлечённое из таблицы статьи.');
}

function generateDimensionsSvg(article, data) {
  const values = data.values;
  const inner = `<rect x="100" y="182" width="520" height="104" rx="10" fill="var(--panel)" stroke="var(--line)" stroke-width="2"/>
    <path d="M100 145h520M100 135v20M620 135v20" class="line" fill="none" stroke-width="2"/>
    <path d="m110 145 12-6v12zm500 0-12-6v12z" fill="var(--line)"/>
    <text x="360" y="136" text-anchor="middle" font-size="14" font-weight="700">${escapeXml(values[0] || 'Размер')}</text>
    <path d="M650 182v104M640 182h20M640 286h20" class="line" fill="none" stroke-width="2"/>
    <text x="670" y="240" font-size="13" font-weight="700" transform="rotate(90 670 240)">${escapeXml(values[1] || 'Параметр')}</text>
    <circle cx="210" cy="234" r="24" fill="none" stroke="var(--accent2)" stroke-width="4"/>
    <circle cx="510" cy="234" r="24" fill="none" stroke="var(--accent)" stroke-width="4"/>
    <text x="360" y="325" text-anchor="middle" class="muted" font-size="12">${escapeXml(values[2] ? `Дополнительное значение: ${values[2]}` : 'Уточнить масштаб и допуски')}</text>`;
  return svgFrame(article.title, inner, 'Размерный эскиз по числовым параметрам, найденным в статье.');
}

async function createDiagram(article) {
  const data = extractDiagramData(article);
  if (!data) return null;
  const generators = { process: generateProcessSvg, comparison: generateComparisonSvg, dimensions: generateDimensionsSvg };
  const svg = sanitizeBlocked(generators[data.type](article, data));
  const fileName = `${article.id}-${data.type}.svg`;
  await fs.writeFile(path.join(diagramRoot, fileName), svg, 'utf8');
  return { type: data.type, src: `assets/diagrams/${fileName}`, label: { process: 'Схема процесса', comparison: 'Сравнительная схема', dimensions: 'Размерный эскиз' }[data.type] };
}

async function copyPendingAssets(pendingCopies) {
  const mediaRoot = path.join(assetRoot, 'media');
  await fs.mkdir(mediaRoot, { recursive: true });
  for (const copy of pendingCopies) {
    let source = null;
    for (const candidate of copy.candidates) {
      try { await fs.access(candidate); source = candidate; break; } catch {}
    }
    if (!source) continue;
    const destination = path.join(distRoot, copy.publicPath);
    if (copy.extension === '.svg') {
      const svg = await fs.readFile(source, 'utf8');
      await fs.writeFile(destination, sanitizeSvg(svg), 'utf8');
    } else {
      await fs.copyFile(source, destination);
    }
    state.outputAssets.push(copy.publicPath);
  }
}

async function main() {
  const primaryFiles = await listFiles(primaryRoot, '.md');
  const supplementFiles = await listFiles(supplementRoot, '.md');
  if (!primaryFiles.length) throw new Error(`Не найдены заметки: ${primaryRoot}`);

  const mainIndexPath = primaryFiles.find(file => path.basename(file).startsWith('00.00_Главная_MOC'));
  if (!mainIndexPath) throw new Error('Не найдено главное оглавление основной базы.');
  const mainOrder = parseMainOrder(await fs.readFile(mainIndexPath, 'utf8'));

  const primaryArticles = [];
  const navigationArticles = [];
  for (const filePath of primaryFiles) {
    const key = path.basename(filePath, '.md');
    if (key.startsWith('00.01') || key.startsWith('00.02')) navigationArticles.push(await loadArticle(filePath, 'primary', key.startsWith('00.01') ? 'materials' : 'equipment'));
    else if (isPrimaryArticle(key)) primaryArticles.push(await loadArticle(filePath, 'primary'));
  }

  const supplementArticles = [];
  for (const filePath of supplementFiles) {
    const key = path.basename(filePath, '.md');
    const prefix = [...uniqueSupplement.keys()].find(item => key.startsWith(item));
    if (prefix) supplementArticles.push(await loadArticle(filePath, 'supplement', uniqueSupplement.get(prefix)));
  }

  const primaryTitleSet = new Set(primaryArticles.map(article => article.normalizedTitle));
  const uniqueTitles = new Set(primaryTitleSet);
  const filteredSupplement = supplementArticles.filter(article => {
    if (uniqueTitles.has(article.normalizedTitle)) return false;
    uniqueTitles.add(article.normalizedTitle);
    return true;
  });

  const articles = sortByMainOrder(primaryArticles, mainOrder).concat(filteredSupplement);
  for (const article of [...articles, ...navigationArticles]) state.idByKey.set(article.key, article.id);

  await fs.rm(distRoot, { recursive: true, force: true });
  await fs.mkdir(diagramRoot, { recursive: true });
  await fs.writeFile(path.join(distRoot, '.nojekyll'), '', 'utf8');

  const pendingCopies = [];
  const registerAsset = assetRegistrar(pendingCopies);
  for (const article of articles) {
    const rendered = markdownToHtml(article, registerAsset);
    article.html = sanitizeBlocked(rendered.html);
    article.toc = rendered.toc;
    article.diagram = await createDiagram(article);
    article.readingMinutes = Math.max(2, Math.ceil(plainText(article.body).split(/\s+/).length / 180));
    article.searchText = sanitizeBlocked([article.title, article.excerpt, article.tags.join(' '), plainText(article.body)].join(' ')).toLocaleLowerCase('ru');
    article.related = [];
  }

  for (const article of articles) {
    const linkedKeys = [...article.body.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)].map(match => path.basename(match[1]).replace(/\.md$/i, ''));
    const linkedIds = linkedKeys.map(key => state.idByKey.get(key)).filter(id => id && id !== article.id);
    const sameSection = articles.filter(candidate => candidate.sectionId === article.sectionId && candidate.id !== article.id).map(candidate => candidate.id);
    article.related = [...new Set([...linkedIds, ...sameSection])].slice(0, 3);
  }

  await copyPendingAssets(pendingCopies);

  const sections = sectionDefinitions.map(section => ({
    ...section,
    articleIds: articles.filter(article => article.sectionId === section.id).map(article => article.id)
  }));

  const quickEntries = navigationArticles.map(article => ({
    title: article.title,
    excerpt: article.excerpt,
    targetSection: article.sectionId
  }));

  const publicArticles = articles.map(({ normalizedTitle, filePath, body, ...article }) => article);
  const data = {
    generatedAt: new Date().toISOString(),
    sections,
    articles: publicArticles,
    quickEntries,
    stats: {
      primaryFiles: primaryFiles.length,
      supplementFiles: supplementFiles.length,
      publishedArticles: publicArticles.length,
      supplementArticles: filteredSupplement.length,
      diagrams: publicArticles.filter(article => article.diagram).length,
      assets: state.outputAssets.length
    }
  };

  const template = await fs.readFile(templatePath, 'utf8');
  await fs.writeFile(path.join(distRoot, 'index.html'), template, 'utf8');
  await fs.writeFile(path.join(distRoot, 'content-data.js'), `window.KB_DATA=${JSON.stringify(data)};\n`, 'utf8');
  await fs.writeFile(path.join(distRoot, 'build-report.json'), JSON.stringify(data.stats, null, 2), 'utf8');
  console.log(JSON.stringify(data.stats, null, 2));
}

await main();
