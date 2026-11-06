import test from 'node:test';
import assert from 'node:assert/strict';
import { translateEdition } from './openai.js';

test('traduz em português, preserva originais e salva cada lote', async () => {
  const edition = { date: '2026-10-26', articles: [{ id: 'a', title: 'New chip', summary: 'A new chip arrives.' }] };
  let saved = 0;
  const fetchImpl = async (url, options) => {
    assert.match(url, /api\.openai\.com\/v1\/chat\/completions$/);
    assert.equal(options.headers.Authorization, 'Bearer openai-key');
    const input = JSON.parse(JSON.parse(options.body).messages[1].content);
    assert.equal(input[0].title, 'New chip');
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ translations: [{ id: 'a', title: 'Novo chip', summary: 'Um novo chip chega.' }] }) } }] }) };
  };
  await translateEdition(edition, 'openai-key', { fetchImpl, onBatch: async () => { saved++; } });
  assert.equal(edition.articles[0].title, 'Novo chip');
  assert.equal(edition.articles[0].titleOriginal, 'New chip');
  assert.equal(edition.articles[0].language, 'pt-BR');
  assert.equal(saved, 1);
  await translateEdition(edition, 'openai-key', { fetchImpl: async () => { throw new Error('Não deveria chamar API'); } });
});

test('não aceita resposta incompleta do OpenAI', async () => {
  const edition = { articles: [{ id: 'a', title: 'New chip', summary: '' }] };
  await assert.rejects(translateEdition(edition, 'key', {
    fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"translations":[]}' } }] }) })
  }), /lista incompleta/);
  assert.equal(edition.articles[0].title, 'New chip');
});

test('retraduz matérias traduzidas com versão anterior do prompt', async () => {
  const { needsTranslation, TRANSLATION_VERSION } = await import('./openai.js');
  assert.equal(needsTranslation({ language: 'pt-BR', title: 'Nativo' }), false);
  assert.equal(needsTranslation({ language: 'pt-BR', titleOriginal: 'X', translationVersion: TRANSLATION_VERSION }), false);
  assert.equal(needsTranslation({ language: 'pt-BR', titleOriginal: 'X' }), true);
  assert.equal(needsTranslation({ language: 'en', title: 'X' }), true);
});
