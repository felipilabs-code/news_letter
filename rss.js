import { AI_TERMS, TECH_TITLE, isOffTopic, plainText } from './guardian.js';

// Só feeds que trazem imagem no próprio RSS (sem imagem a matéria é descartada).
export const FEEDS = [
  { name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', strict: false },
  { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index', strict: false },
  { name: 'WIRED', url: 'https://www.wired.com/feed/rss', strict: true },
  { name: 'Engadget', url: 'https://www.engadget.com/rss.xml', strict: false }
];
export const MAX_PER_FEED = 6;
// Wired mistura cultura e política: só entra o que tem cara de tecnologia.
const TECH_HINT = /\b(?:tech|apple|google|microsoft|meta|amazon|nvidia|tesla|spacex|iphone|android|windows|privacy|startup|crypto|bitcoin|gpu|robotaxi|waymo|openai|anthropic)\b/i;

const unwrap = text => text.replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '');
const tag = (block, name) => {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return match ? unwrap(match[1]).trim() : '';
};
const attr = (markup, name) => markup.match(new RegExp(`${name}="([^"]*)"`, 'i'))?.[1];

function bestImage(block) {
  const found = [];
  for (const match of block.matchAll(/<(?:media:content|media:thumbnail|enclosure)\b[^>]*>/gi)) {
    const markup = match[0];
    const url = attr(markup, 'url');
    const type = attr(markup, 'type') || '';
    if (!url || !/^https:/i.test(url)) continue;
    if (/^<(?:media:content|enclosure)/i.test(markup) && type && !type.startsWith('image/')) continue;
    found.push({ url: url.replace(/&amp;/g, '&'), width: Number(attr(markup, 'width')) || 0 });
  }
  const best = found.sort((a, b) => b.width - a.width)[0];
  // As miniaturas da BBC vêm em 240px; a mesma imagem existe em 976px.
  return best ? best.url.replace('/standard/240/', '/standard/976/') : null;
}

export function parseFeed(xml, feed) {
  const items = [];
  for (const [block] of xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)) {
    const link = tag(block, 'link');
    const title = plainText(tag(block, 'title'));
    const published = Date.parse(tag(block, 'pubDate'));
    const thumbnail = bestImage(block);
    if (!link || !title || Number.isNaN(published) || !thumbnail) continue;
    let url;
    try { const parsed = new URL(link); url = parsed.origin + parsed.pathname; } catch { continue; }
    const summary = plainText(tag(block, 'description')).slice(0, 320);
    const ai = AI_TERMS.test(`${title} ${summary}`);
    items.push({
      id: `rss:${url}`, source: feed.name, title, summary, thumbnail, byline: '',
      publishedAt: new Date(published).toISOString(), url, section: 'Technology', sectionId: 'technology',
      topics: ai ? ['ai', 'technology'] : ['technology']
    });
  }
  return items;
}

export function isTechItem(article, feed) {
  if (isOffTopic(article)) return false;
  if (!feed.strict) return true;
  return AI_TERMS.test(article.title) || TECH_TITLE.test(article.title) || TECH_HINT.test(article.title);
}

export async function fetchRssFeeds({ from, to, fetchImpl = fetch, feeds = FEEDS, perFeed = MAX_PER_FEED } = {}) {
  const start = from ? Date.parse(from) : -Infinity;
  const end = to ? Date.parse(to) : Infinity;
  const results = await Promise.allSettled(feeds.map(async feed => {
    const response = await fetchImpl(feed.url, { headers: { 'User-Agent': 'AtivaNewsTV/1.0 (+newsletter interna)' }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return parseFeed(await response.text(), feed)
      .filter(item => { const at = Date.parse(item.publishedAt); return at >= start && at <= end; })
      .filter(item => isTechItem(item, feed))
      .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
      .slice(0, perFeed);
  }));
  const articles = [];
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') articles.push(...result.value);
    else console.warn(`Feed ${feeds[index].name} falhou: ${result.reason?.message || result.reason}`);
  });
  return { fetchedAt: new Date().toISOString(), count: articles.length, windowEnd: to || null, articles };
}
