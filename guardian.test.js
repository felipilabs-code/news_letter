import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchGuardianDay, makeGuardianUrl } from './guardian.js';
import { newsletterMarkdown } from './edition.js';

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
  assert.equal(calls.length, 4);
  assert.equal(calls[0].searchParams.get('section'), 'technology');
  assert.equal(calls[0].searchParams.get('from-date'), '2026-10-26');
  assert.equal(calls[0].searchParams.get('to-date'), '2026-10-26');
  assert.equal(calls[0].searchParams.get('use-date'), 'published');
  assert.equal(calls[1].searchParams.get('page'), '2');
  assert.match(calls[2].searchParams.get('q'), /artificial intelligence/);
  assert.equal(calls[2].searchParams.has('section'), false);
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
