import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchGuardianDay, GUARDIAN_QUERY_VERSION } from './guardian.js';
import { translateEdition, needsTranslation } from './openai.js';
import { fetchRssFeeds } from './rss.js';
import { createEdition, mergeSource, newsletterMarkdown, sourceCollected } from './edition.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(root, 'data');
const publicDir = path.join(root, 'public');
const zone = 'America/Sao_Paulo';

async function loadEnv() {
  try {
    for (const line of (await fs.readFile(path.join(root, '.env'), 'utf8')).split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z_][A-Z_0-9]*)\s*=\s*(.*)\s*$/);
      if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
await loadEnv();
await fs.mkdir(dataDir, { recursive: true });

const localDate = (when = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(when);
const dayBefore = date => new Date(Date.parse(`${date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
const ROUNDS = [7, 14]; // horários (Brasília) das rodadas de coleta
// Rodada vencida agora (0 = antes das 07h) e a data da edição que a TV deve exibir.
function schedule(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', hourCycle: 'h23' }).format(now));
  const dueRound = ROUNDS.filter(start => hour >= start).length;
  const today = localDate(now);
  return { today, dueRound, target: dueRound ? today : dayBefore(today) };
}
// A rodada da tarde só complementa; para exibir a edição basta a da manhã.
const neededRound = (date, { today, dueRound }) => date === today ? dueRound : 2;
// Edição de D cobre de D-1 02h até D 14h (Brasília, UTC-3); a de hoje vai até agora.
// Matérias já publicadas na edição anterior são descartadas no merge (ver previousIds).
function collectionWindow(edition, plan) {
  const guardian = edition.sources?.guardian;
  const resume = guardian?.queryVersion === GUARDIAN_QUERY_VERSION && guardian.windowEnd;
  const from = resume ? new Date(Date.parse(resume) - 5 * 60_000).toISOString() : `${dayBefore(edition.date)}T05:00:00Z`;
  const to = edition.date === plan.today ? new Date().toISOString() : `${edition.date}T17:00:00Z`;
  return { from, to };
}
const safeDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '');
const filename = date => path.join(dataDir, `${date}.json`);
function guardianOnly(value) {
  const articles = (value.articles || []).filter(item => item.source !== 'The New York Times');
  const changed = articles.length !== (value.articles || []).length || Boolean(value.sources?.nyt);
  if (changed) {
    value.articles = articles;
    if (value.sources) delete value.sources.nyt;
    value.count = articles.length;
  }
  return { value, changed };
}
async function saveEdition(value) {
  const temp = path.join(dataDir, `${value.date}.tmp`);
  await fs.writeFile(temp, JSON.stringify(value, null, 2));
  await fs.rename(temp, filename(value.date));
}
let edition = null;
let syncing = false;
let translating = false;
let lastError = null;
let nextAttempt = 0;

async function loadLatest() {
  const dates = (await fs.readdir(dataDir)).filter(name => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort();
  if (dates.length) {
    edition = JSON.parse(await fs.readFile(path.join(dataDir, dates.at(-1)), 'utf8'));
    const migration = guardianOnly(edition);
    if (migration.changed) await saveEdition(edition);
  }
}
await loadLatest();

async function syncIfNeeded() {
  if (syncing || Date.now() < nextAttempt) return;
  const plan = schedule();
  const { target } = plan;
  const guardianKey = process.env.GUARDIAN_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!guardianKey) return;
  const missingSource = edition && !sourceCollected(edition, neededRound(edition.date, plan));
  const pendingTranslation = edition && openaiKey && edition.articles.some(needsTranslation);
  if (edition?.date >= target && !missingSource && !pendingTranslation) return;
  syncing = true;
  try {
    if (edition) await completeEdition(plan);
    const start = edition?.date ? new Date(Date.parse(`${edition.date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10) : target;
    for (let date = start; date <= target; date = new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)) {
      edition = createEdition(date);
      await completeEdition(plan);
    }
    lastError = null;
  } catch (error) {
    lastError = error.message;
    nextAttempt = Date.now() + 30 * 60 * 1000;
    console.error('Falha na coleta:', error.message);
  } finally { syncing = false; }
}

async function previousIds(date) {
  try {
    const previous = JSON.parse(await fs.readFile(filename(dayBefore(date)), 'utf8'));
    return new Set((previous.articles || []).map(item => item.id));
  } catch { return new Set(); }
}

async function completeEdition(plan) {
  const round = neededRound(edition.date, plan);
  if (process.env.GUARDIAN_API_KEY && !sourceCollected(edition, round)) {
    const window = collectionWindow(edition, plan);
    const [fresh, rss, exclude] = await Promise.all([
      fetchGuardianDay(edition.date, process.env.GUARDIAN_API_KEY, window),
      fetchRssFeeds(window),
      previousIds(edition.date)
    ]);
    mergeSource(edition, fresh, round, { rss, exclude });
    await saveEdition(edition);
    console.log(`Guardian ${edition.date} (rodada ${round}): ${fresh.count} do Guardian + ${rss.count} de RSS, ${edition.count} no total`);
  }
  await translateCurrent();
}

async function translateCurrent() {
  if (!edition || !process.env.OPENAI_API_KEY || !edition.articles.some(needsTranslation)) return;
  translating = true;
  try {
    await translateEdition(edition, process.env.OPENAI_API_KEY, {
      model: process.env.OPENAI_MODEL || undefined,
      onBatch: saveEdition
    });
    console.log(`OpenAI ${edition.date}: ${edition.count} notícias traduzidas`);
  } finally { translating = false; }
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function newsletterReady() {
  const plan = schedule();
  // Só a edição vigente (hoje a partir das 07h, ontem antes disso) conta como pronta.
  return Boolean(edition && edition.date === plan.target &&
    (!process.env.GUARDIAN_API_KEY || sourceCollected(edition, 1)) &&
    edition.articles.every(item => item.language === 'pt-BR'));
}

const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method !== 'GET') return send(res, 405, { error: 'Método não permitido' });
    if (url.pathname === '/api/news') return send(res, 200, { edition, syncing, translating, configured: Boolean(process.env.GUARDIAN_API_KEY), guardianConfigured: Boolean(process.env.GUARDIAN_API_KEY), translationConfigured: Boolean(process.env.OPENAI_API_KEY), newsletterReady: newsletterReady(), error: lastError, nextEdition: schedule().target });
    if (url.pathname === '/api/newsletter.json') return newsletterReady() ? send(res, 200, edition) : send(res, 503, { error: 'Edição ainda não está completa e traduzida' });
    if (url.pathname === '/api/newsletter.md') return newsletterReady() ? send(res, 200, newsletterMarkdown(edition), 'text/markdown; charset=utf-8') : send(res, 503, 'Edição ainda não está completa e traduzida', 'text/plain; charset=utf-8');
    if (url.pathname.startsWith('/api/archive/')) {
      const date = url.pathname.slice('/api/archive/'.length);
      if (!safeDate(date)) return send(res, 400, { error: 'Data inválida' });
      try {
        const archived = guardianOnly(JSON.parse(await fs.readFile(filename(date), 'utf8'))).value;
        return send(res, 200, archived);
      }
      catch (error) { if (error.code === 'ENOENT') return send(res, 404, { error: 'Edição não encontrada' }); throw error; }
    }
    const requested = url.pathname === '/' ? '/index.html' : url.pathname;
    if (!['/index.html', '/app.js', '/style.css'].includes(requested)) return send(res, 404, { error: 'Não encontrado' });
    const file = path.join(publicDir, requested);
    return send(res, 200, await fs.readFile(file), mime[path.extname(file)]);
  } catch (error) { console.error(error); send(res, 500, { error: 'Erro interno' }); }
});

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '127.0.0.1';
server.listen(port, host, () => console.log(`Painel Ativa.ai em http://${host}:${port}`));
syncIfNeeded();
setInterval(syncIfNeeded, 60_000);
