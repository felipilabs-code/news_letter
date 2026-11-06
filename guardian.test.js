import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchGuardianDay, makeGuardianUrl, isOffTopic, isRelevant, GUARDIAN_QUERY_VERSION } from './guardian.js';
import { newsletterMarkdown, mergeSource, sourceCollected } from './edition.js';

test('consulta technology, data de publicação e todos os resultados paginados', async () => {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    const page = Number(url.searchParams.get('page'));
    return { ok: true, json: async () => ({ response: { status: 'ok', pages: 2, results: [{
      id: `technology/story-${page}`, webTitle: `Story ${page}`, webPublicationDate: '2026-10-26T12:00:00Z',
      webUrl: `https://www.theguardian.com/technology/story-${page}`, fields: { trailText: '<p>Resumo &amp; contexto</p>' }
    }] } }) };
  };
  const edition = await fetchGuardianDay('2026-10-26', 'secret', { fetchImpl, wait: async () => {} });
  assert.equal(calls.length, 14); // 7 buscas x 2 páginas
  assert.equal(calls[0].searchParams.get('section'), 'technology');
  assert.equal(calls[0].searchParams.get('from-date'), '2026-10-26');
  assert.equal(calls[0].searchParams.get('to-date'), '2026-10-26');
  assert.equal(calls[0].searchParams.get('use-date'), 'published');
  assert.equal(calls[1].searchParams.get('page'), '2');
  assert.equal(calls[2].searchParams.get('tag'), 'technology/artificialintelligenceai');
  assert.equal(calls[2].searchParams.has('section'), false);
  assert.match(calls[12].searchParams.get('q'), /artificial intelligence/);
  assert.equal(edition.count, 2);
  assert.equal(edition.articles[0].summary, 'Resumo & contexto');
  assert.match(newsletterMarkdown(edition), /\[Ler matéria original\]/);
});

test('rejeita erro de autenticação sem salvar edição parcial', async () => {
  await assert.rejects(fetchGuardianDay('2026-10-26', 'bad', {
    fetchImpl: async () => ({ ok: false, status: 403 }), wait: async () => {}
  }), /Guardian HTTP 403/);
  assert.equal(makeGuardianUrl('2026-10-26', 1, 'key').origin, 'https://content.guardianapis.com');
});

test('filtra política e mercado, mas mantém produto e infraestrutura', () => {
  const off = [
    { title: 'Elon Musk’s nearly half a billion dollars in midterms spending was a flop', summary: '' },
    { title: 'Tech barons cozied up to Trump. What will they do in newly blue America?', summary: '' },
    { title: 'Winner of the Prix Goncourt literary prize admits to using AI', summary: '' }
  ];
  for (const item of off) assert.equal(isOffTopic(item), true, item.title);
  assert.equal(isOffTopic({ title: 'Apple iPad mini A20 Pro review: the best small tablet', summary: '' }), false);
  assert.equal(isOffTopic({ title: 'OpenAI launches new model as Trump admin weighs rules', summary: '' }), false);
});

test('busca ampla exige seção tech ou IA/datacenter no título', () => {
  assert.equal(isRelevant({ title: 'Joshua Wong laments city’s fate', summary: 'AI', section: 'World news', sectionId: 'world' }), false);
  assert.equal(isRelevant({ title: 'Activists prepare protests against datacentres', summary: '', sectionId: 'world' }), false);
  assert.equal(isRelevant({ title: 'UK reliant on China for minerals critical to AI', summary: '', sectionId: 'technology' }), false);
  assert.equal(isRelevant({ title: 'Chatbots are changing search', summary: '', sectionId: 'technology' }), true);
});

test('rodadas do mesmo dia acrescentam sem repetir e preservam traduções', () => {
  const edition = { date: '2026-11-06', articles: [], sources: {} };
  const article = (id, at) => ({ id, title: id, publishedAt: at, url: `https://x/${id}` });
  mergeSource(edition, { fetchedAt: 'a', queryVersion: GUARDIAN_QUERY_VERSION, windowEnd: 'w1', articles: [article('a', '2026-11-06T09:00:00Z')] }, 1);
  edition.articles[0].language = 'pt-BR';
  assert.equal(sourceCollected(edition, 1), true);
  assert.equal(sourceCollected(edition, 2), false);
  mergeSource(edition, { fetchedAt: 'b', queryVersion: GUARDIAN_QUERY_VERSION, windowEnd: 'w2', articles: [article('a', '2026-11-06T09:00:00Z'), article('b', '2026-11-06T15:00:00Z')] }, 2);
  assert.deepEqual(edition.articles.map(item => item.id), ['b', 'a']);
  assert.equal(edition.articles.find(item => item.id === 'a').language, 'pt-BR');
  assert.equal(edition.sources.guardian.round, 2);
  assert.equal(edition.sources.guardian.windowEnd, 'w2');
});
