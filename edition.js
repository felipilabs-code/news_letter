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

export function mergeSource(edition, fetched, round = 2) {
  const previous = edition.sources?.guardian;
  const sameQuery = previous?.queryVersion === fetched.queryVersion;
  // Rodadas do mesmo dia acrescentam sem repetir; consulta nova recomeça do zero.
  const byId = new Map((sameQuery ? edition.articles : []).map(item => [item.id, item]));
  for (const item of fetched.articles) if (!byId.has(item.id)) byId.set(item.id, { ...item, source: 'The Guardian' });
  edition.articles = [...byId.values()].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  edition.sources = { guardian: {
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
    `${articles.length} notícias do The Guardian`,
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
