import test from 'node:test';
import assert from 'node:assert/strict';
import { translateEdition } from './gemini.js';

test('traduz em português, preserva originais e salva cada lote', async () => {
  const edition = { date: '2026-10-26', articles: [{ id: 'a', title: 'New chip', summary: 'A new chip arrives.' }] };
  let saved = 0;
  const fetchImpl = async (url, options) => {
    assert.match(url, /gemini-3\.5-flash-lite:generateContent$/);
    assert.equal(options.headers['x-goog-api-key'], 'gemini-key');
    const input = JSON.parse(JSON.parse(options.body).contents[0].parts[0].text);
    assert.equal(input[0].title, 'New chip');
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify([{ id: 'a', title: 'Novo chip', summary: 'Um novo chip chega.' }]) }] } }] }) };
  };
  await translateEdition(edition, 'gemini-key', { fetchImpl, onBatch: async () => { saved++; } });
  assert.equal(edition.articles[0].title, 'Novo chip');
  assert.equal(edition.articles[0].titleOriginal, 'New chip');
  assert.equal(edition.articles[0].language, 'pt-BR');
  assert.equal(saved, 1);
  await translateEdition(edition, 'gemini-key', { fetchImpl: async () => { throw new Error('Não deveria chamar API'); } });
});

test('não aceita resposta incompleta do Gemini', async () => {
  const edition = { articles: [{ id: 'a', title: 'New chip', summary: '' }] };
  await assert.rejects(translateEdition(edition, 'key', {
    fetchImpl: async () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '[]' }] } }] }) })
  }), /lista incompleta/);
  assert.equal(edition.articles[0].title, 'New chip');
});
