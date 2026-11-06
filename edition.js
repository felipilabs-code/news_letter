import { GUARDIAN_QUERY_VERSION } from './guardian.js';
const AI_TERMS = /\b(?:artificial intelligence|generative ai|machine learning|chatgpt|openai|anthropic|gemini|inteligência artificial|aprendizado de máquina|AI)\b|\bA\.I\.(?=\W|$)/i;

export function isAiArticle(article) {
  return article.topics?.includes('ai') || AI_TERMS.test(`${article.titleOriginal || article.title} ${article.summaryOriginal || article.summary}`);
}

export function createEdition(date) {
  return { date, fetchedAt: new Date().toISOString(), count: 0, sources: {}, articles: [] };
}

// round: 1 = rodada das 07h, 2 = rodada das 14h (a edição só está completa com a rodada pedida).
export function sourceCollected(edition, round = 2) {
  const guardian = edition.sources?.guardian;
  return Boolean(guardian?.fetchedAt) && guardian.queryVersion === GUARDIAN_QUERY_VERSION && (guardian.round ?? 2) >= round;
}

// rss: artigos de feeds extras da mesma rodada; exclude: ids já publicados na edição anterior.
export function mergeSource(edition, fetched, round = 2, { rss = null, exclude = new Set() } = {}) {
  const previous = edition.sources?.guardian;
  const sameQuery = previous?.queryVersion === fetched.queryVersion;
  // Rodadas do mesmo dia acrescentam sem repetir; consulta nova recomeça do zero.
  const byId = new Map((sameQuery ? edition.articles : []).map(item => [item.id, item]));
  const incoming = [...fetched.articles.map(item => ({ ...item, source: item.source || 'The Guardian' })), ...(rss?.articles || [])];
  for (const item of incoming) if (!exclude.has(item.id) && !byId.has(item.id)) byId.set(item.id, item);
  edition.articles = [...byId.values()].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const rssInfo = rss ? { fetchedAt: rss.fetchedAt, count: rss.count } : sameQuery ? edition.sources?.rss : undefined;
  edition.sources = { ...(rssInfo ? { rss: rssInfo } : {}), guardian: {
    fetchedAt: fetched.fetchedAt, count: edition.articles.length, queryVersion: fetched.queryVersion,
    round: Math.max(round, sameQuery ? previous.round ?? 0 : 0), windowEnd: fetched.windowEnd
  } };
  edition.count = edition.articles.length;
  edition.updatedAt = new Date().toISOString();
  return edition;
}

export function newsletterMarkdown(edition) {
  const articles = edition.articles || [];
  const ai = articles.filter(isAiArticle);
  const tech = articles.filter(item => !isAiArticle(item));
  const lines = [
    `# Radar Tech + IA · ${edition.date}`,
    '',
    `${articles.length} notícias de ${[...new Set(articles.map(item => item.source || 'The Guardian'))].join(', ') || 'The Guardian'}`,
    '',
    'Pauta para revisão editorial. Títulos e resumos foram traduzidos automaticamente; confira as matérias antes do envio.',
    ''
  ];
  for (const [heading, group] of [['IA em foco', ai], ['Outras notícias de tecnologia', tech]]) {
    if (!group.length) continue;
    lines.push(`## ${heading} (${group.length})`, '');
    for (const item of group) {
      lines.push(`### ${item.title}`, '', item.summary || 'Leia a matéria completa no link.', '',
        `Fonte: ${item.source || 'The Guardian'} · [Ler matéria original](${item.url})`, '');
    }
  }
  return lines.join('\n');
}
