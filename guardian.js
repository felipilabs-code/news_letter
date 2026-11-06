const API = 'https://content.guardianapis.com/search';
const PAGE_SIZE = 100;
export const GUARDIAN_QUERY_VERSION = 2;
const AI_QUERY = '"artificial intelligence" OR "generative AI" OR "machine learning" OR "large language model" OR ChatGPT OR OpenAI OR Anthropic OR Gemini OR Copilot OR AI';
const AI_TERMS = /\b(?:artificial intelligence|generative ai|machine learning|neural network|large language model|\bllm\b|chatgpt|openai|anthropic|gemini|copilot|ai model|ai chatbot|AI)\b|\bA\.I\.(?=\W|$)/i;

export function makeGuardianUrl(date, page, key, { query } = {}) {
  const url = new URL(API);
  const params = {
    'api-key': key,
    'from-date': date,
    'to-date': date,
    'use-date': 'published',
    'order-by': 'newest',
    'page-size': String(PAGE_SIZE),
    page: String(page),
    'show-fields': 'headline,trailText,thumbnail,byline'
  };
  if (query) params.q = query;
  else params.section = 'technology';
  params['show-elements'] = 'image';
  url.search = new URLSearchParams(params);
  return url;
}

function plainText(input = '') {
  return String(input).replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim();
}

export function normalizeArticle(item) {
  const imageAsset = (item.elements || []).filter(element => element.type === 'image')
    .flatMap(element => element.assets || []).find(asset => asset.file && (asset.typeData?.width >= 1000 || asset.typeData?.isMaster))
    || (item.elements || []).filter(element => element.type === 'image').flatMap(element => element.assets || []).find(asset => asset.file);
  const title = plainText(item.fields?.headline || item.webTitle);
  const summary = plainText(item.fields?.trailText || '');
  const ai = AI_TERMS.test(`${title} ${summary}`);
  return {
    id: item.id,
    source: 'The Guardian',
    title: plainText(item.fields?.headline || item.webTitle),
    summary: plainText(item.fields?.trailText || ''),
    thumbnail: item.fields?.thumbnail || imageAsset?.file || null,
    byline: plainText(item.fields?.byline || ''),
    publishedAt: item.webPublicationDate,
    url: item.webUrl,
    section: item.sectionName || 'Technology',
    topics: ai ? ['ai', 'technology'] : ['technology']
  };
}

export async function fetchGuardianDay(date, key, { fetchImpl = fetch, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Data inválida');
  if (!key) throw new Error('GUARDIAN_API_KEY não configurada');
  const byId = new Map();
  let requestCount = 0;
  const searches = [null, AI_QUERY];
  for (const query of searches) {
    let pages = 1;
    for (let page = 1; page <= pages; page++) {
      if (requestCount++) await wait(1100); // mantém o limite de uma chamada por segundo
      let result;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt) await wait(attempt * 2200);
        const response = await fetchImpl(makeGuardianUrl(date, page, key, { query }), { signal: AbortSignal.timeout(20000) });
        if (response.ok) { result = await response.json(); break; }
        if (response.status !== 429 && response.status < 500) throw new Error(`Guardian HTTP ${response.status}`);
        if (attempt === 2) throw new Error(`Guardian HTTP ${response.status}`);
      }
      const body = result?.response;
      if (body?.status !== 'ok' || !Array.isArray(body.results)) throw new Error('Resposta inválida do Guardian');
      pages = Math.max(1, Number(body.pages) || 1);
      for (const item of body.results) {
        const article = normalizeArticle(item);
        if (!article.id || !article.url) continue;
        // A busca ampla só acrescenta matérias claramente ligadas a IA.
        if (query && !article.topics.includes('ai')) continue;
        const previous = byId.get(article.id);
        if (!previous) byId.set(article.id, article);
        else if (!previous.thumbnail && article.thumbnail) previous.thumbnail = article.thumbnail;
      }
    }
  }
  const articles = [...byId.values()].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  return { date, fetchedAt: new Date().toISOString(), count: articles.length, queryVersion: GUARDIAN_QUERY_VERSION, articles };
}

