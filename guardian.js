const API = 'https://content.guardianapis.com/search';
const PAGE_SIZE = 100;
export const GUARDIAN_QUERY_VERSION = 4;
const AI_QUERY = '"artificial intelligence" OR "generative AI" OR "machine learning" OR "large language model" OR ChatGPT OR OpenAI OR Anthropic OR Gemini OR Copilot OR AI';
export const AI_TERMS = /\b(?:artificial intelligence|generative ai|machine learning|neural network|large language model|\bllm\b|chatgpt|openai|anthropic|gemini|copilot|ai model|ai chatbot|AI)\b|\bA\.I\.(?=\W|$)/i;

// Política, governo, geopolítica, mercado e guerra não são pauta de tecnologia e inovação.
// Eleições e protestos nunca são salvos por um termo de tecnologia no título (ex.: protesto contra datacenters).
const HARD_POLITICS = /\b(?:elections?|midterms?|democrats?|republicans?|voters?|protest(?:s|ers?)?|activists?)\b/i;
const OFF_TOPIC =/\b(?:elections?|midterms?|democrats?|republicans?|trump|biden|putin|starmer|campaign spending|voters?|politic(?:s|al|ally|ians?)|geopolitic\w*|parliament(?:ary)?|lawmakers?|ministers?|senators?|congress(?:ional)?|white house|downing street|prime minister|diplomat\w*|sanctions?|tariffs?|brexit|protest(?:s|ers?)?|activists?|interest rates?|inflation|stock markets?|stocks|wall street|nasdaq|ftse|war|prison|sentenced|literary prize|prix goncourt)\b/i;
// Países, regiões e lugares: matéria sobre geografia não é pauta. Vale só para o título,
// porque o resumo cita países de passagem em matérias de produto.
const GEOGRAPHY = /\b(?:uk|britain|british|england|scotland|wales|ireland|europe|european|eu|france|french|germany|german|italy|spain|ukraine|ukrainian|russia|russian|china|chinese|hong kong|taiwan|japan|japanese|korea|korean|india|indian|iran|iranian|israel|israeli|gaza|middle east|africa|brazil|mexico|canada|australia|california|texas|london|beijing|moscow|brussels|kyiv|tehran)\b/i;
// Termos de produto, pesquisa ou infraestrutura no título salvam a matéria da lista acima.
export const TECH_TITLE = /\b(?:smart glasses|quantum|cyber(?:attacks?|security)?|hack(?:ers?|ed)?|drones?|satellites?|wearables?|launch(?:es|ed)?|models?|chips?|robots?|software|apps?|reviews?|startups?|data ?cent(?:er|re)s?|smartphones?|gadgets?|semiconductors?)\b/i;

const SEARCHES = [
  {},
  { tag: 'technology/artificialintelligenceai' },
  { tag: 'technology/technology' },
  { tag: 'technology/gadgets' },
  { tag: 'business/technology' },
  { tag: 'games/games' },
  { query: AI_QUERY }
];

// Guias de compra e ofertas nunca entram, mesmo que citem um produto tech no título.
const SHOPPING = /\b(?:deals?|black friday|cyber monday|coupons?|discounts?|gift guide|gifts? for|best .{0,50} of 20\d\d|the best .{0,40} (?:in the|for))\b/i;

export function isOffTopic(article) {
  const title = article.title || '';
  if (SHOPPING.test(title)) return true;
  if (HARD_POLITICS.test(`${title} ${article.summary || ''}`)) return true;
  if (TECH_TITLE.test(title)) return false;
  return OFF_TOPIC.test(`${title} ${article.summary || ''}`) || GEOGRAPHY.test(title);
}

// Seção technology/science entra sempre; as demais só se a IA ou a infraestrutura estiver no título.
export function isRelevant(article) {
  if (isOffTopic(article)) return false;
  if (/^(technology|science)$/i.test(article.sectionId || '')) return true;
  return AI_TERMS.test(article.title) || TECH_TITLE.test(article.title);
}

export function makeGuardianUrl(date, page, key, { query, tag, from, to } = {}) {
  const url = new URL(API);
  const params = {
    'api-key': key,
    'from-date': from || date,
    'to-date': to || date,
    'use-date': 'published',
    'order-by': 'newest',
    'page-size': String(PAGE_SIZE),
    page: String(page),
    'show-fields': 'headline,trailText,thumbnail,byline'
  };
  if (query) params.q = query;
  else if (tag) params.tag = tag;
  else params.section = 'technology';
  params['show-elements'] = 'image';
  url.search = new URLSearchParams(params);
  return url;
}

export function plainText(input = '') {
  return String(input).replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
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
    sectionId: item.sectionId || '',
    topics: ai ? ['ai', 'technology'] : ['technology']
  };
}

export async function fetchGuardianDay(date, key, { from, to, fetchImpl = fetch, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Data inválida');
  if (!key) throw new Error('GUARDIAN_API_KEY não configurada');
  const byId = new Map();
  let requestCount = 0;
  // Seção technology, tags afins e uma busca ampla de IA; a dedupe por id junta tudo.
  for (const { query, tag } of SEARCHES) {
    let pages = 1;
    for (let page = 1; page <= pages; page++) {
      if (requestCount++) await wait(1100); // mantém o limite de uma chamada por segundo
      let result;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt) await wait(attempt * 2200);
        const response = await fetchImpl(makeGuardianUrl(date, page, key, { query, tag, from, to }), { signal: AbortSignal.timeout(20000) });
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
        // A busca por seção já é technology; tags e busca ampla passam pelo filtro estrito.
        if (query || tag ? !isRelevant(article) : isOffTopic(article)) continue;
        const previous = byId.get(article.id);
        if (!previous) byId.set(article.id, article);
        else if (!previous.thumbnail && article.thumbnail) previous.thumbnail = article.thumbnail;
      }
    }
  }
  const articles = [...byId.values()].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  return { date, fetchedAt: new Date().toISOString(), count: articles.length, queryVersion: GUARDIAN_QUERY_VERSION, windowEnd: to || null, articles };
}

