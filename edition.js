import { GUARDIAN_QUERY_VERSION } from './guardian.js';
const AI_TERMS = /\b(?:artificial intelligence|generative ai|machine learning|chatgpt|openai|anthropic|gemini|inteligência artificial|aprendizado de máquina|AI)\b|\bA\.I\.(?=\W|$)/i;

export function isAiArticle(article) {
  return article.topics?.includes('ai') || AI_TERMS.test(`${article.titleOriginal || article.title} ${article.summaryOriginal || article.summary}`);
}

export function createEdition(date) {
  return { date, fetchedAt: new Date().toISOString(), count: 0, sources: {}, articles: [] };
}

export function sourceCollected(edition) {
  if (edition.sources?.guardian?.fetchedAt) return edition.sources.guardian.queryVersion === GUARDIAN_QUERY_VERSION;
  return false;
}

export function mergeSource(edition, fetched) {
  edition.articles = fetched.articles.map(item => ({ ...item, source: 'The Guardian' }))
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  edition.sources ??= {};
  edition.sources = { guardian: { fetchedAt: fetched.fetchedAt, count: fetched.count, queryVersion: fetched.queryVersion } };
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
