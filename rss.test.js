import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchRssFeeds, parseFeed } from './rss.js';
import { mergeSource } from './edition.js';

const bbc = `<rss><channel>
<item><title><![CDATA[Chipmaker launches new AI chip]]></title><link>https://www.bbc.com/news/articles/c1?at_medium=RSS</link>
<description><![CDATA[A new chip &amp; more]]></description><pubDate>Fri, 06 Nov 2026 09:00:00 GMT</pubDate>
<media:thumbnail width="240" height="135" url="https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/a.jpg"/></item>
<item><title>Sem imagem</title><link>https://www.bbc.com/news/articles/c2</link><pubDate>Fri, 06 Nov 2026 09:00:00 GMT</pubDate></item>
<item><title>Muito antiga</title><link>https://www.bbc.com/news/articles/c3</link><pubDate>Mon, 01 Jan 2026 09:00:00 GMT</pubDate>
<media:thumbnail width="240" url="https://ichef.bbci.co.uk/b.jpg"/></item>
</channel></rss>`;
const wired = `<rss><channel>
<item><title>Why Trump's election win matters</title><link>https://www.wired.com/story/politics/</link><pubDate>Fri, 06 Nov 2026 10:00:00 GMT</pubDate>
<media:content url="https://media.wired.com/p.jpg" width="1200"/></item>
<item><title>A recipe for the perfect sourdough</title><link>https://www.wired.com/story/sourdough/</link><pubDate>Fri, 06 Nov 2026 10:00:00 GMT</pubDate>
<media:content url="https://media.wired.com/s.jpg" width="1200"/></item>
<item><title>Nvidia unveils new GPU</title><link>https://www.wired.com/story/nvidia/</link><pubDate>Fri, 06 Nov 2026 10:00:00 GMT</pubDate>
<media:thumbnail url="https://media.wired.com/t.jpg" width="150"/><media:content url="https://media.wired.com/n.jpg" width="1200"/></item>
</channel></rss>`;

test('parseFeed lê CDATA, limpa a URL e escolhe a maior imagem', () => {
  const [item] = parseFeed(bbc, { name: 'BBC News' });
  assert.equal(item.title, 'Chipmaker launches new AI chip');
  assert.equal(item.summary, 'A new chip & more');
  assert.equal(item.url, 'https://www.bbc.com/news/articles/c1');
  assert.equal(item.thumbnail, 'https://ichef.bbci.co.uk/ace/standard/976/cpsprodpb/a.jpg');
  assert.equal(item.source, 'BBC News');
  assert.deepEqual(item.topics, ['ai', 'technology']);
  assert.equal(parseFeed(bbc, { name: 'BBC News' }).length, 2); // o item sem imagem é descartado
});

test('fetchRssFeeds respeita a janela, filtra o Wired e tolera feed fora do ar', async () => {
  const feeds = [
    { name: 'BBC News', url: 'https://bbc.test/rss', strict: false },
    { name: 'WIRED', url: 'https://wired.test/rss', strict: true },
    { name: 'Caiu', url: 'https://down.test/rss', strict: false }
  ];
  const bodies = { 'https://bbc.test/rss': bbc, 'https://wired.test/rss': wired };
  const fetchImpl = async url => bodies[url] ? { ok: true, text: async () => bodies[url] } : { ok: false, status: 503 };
  const warn = console.warn; console.warn = () => {};
  try {
    const result = await fetchRssFeeds({ from: '2026-11-05T05:00:00Z', to: '2026-11-06T20:00:00Z', fetchImpl, feeds });
    assert.deepEqual(result.articles.map(item => item.title).sort(), ['Chipmaker launches new AI chip', 'Nvidia unveils new GPU']);
    assert.equal(result.articles.find(item => item.source === 'WIRED').thumbnail, 'https://media.wired.com/n.jpg');
  } finally { console.warn = warn; }
});

test('mergeSource junta Guardian e RSS, ignora ids da edição anterior', () => {
  const edition = { date: '2026-11-06', articles: [], sources: {} };
  const guardian = { fetchedAt: 'g', queryVersion: 4, windowEnd: 'w', articles: [{ id: 'g1', title: 'G', publishedAt: '2026-11-06T08:00:00Z', source: 'The Guardian' }, { id: 'old', title: 'O', publishedAt: '2026-11-06T07:00:00Z' }] };
  const rss = { fetchedAt: 'r', count: 1, articles: [{ id: 'rss:x', title: 'R', publishedAt: '2026-11-06T09:00:00Z', source: 'WIRED' }] };
  mergeSource(edition, guardian, 1, { rss, exclude: new Set(['old']) });
  assert.deepEqual(edition.articles.map(item => item.id), ['rss:x', 'g1']);
  assert.equal(edition.sources.rss.count, 1);
  mergeSource(edition, { ...guardian, articles: [] }, 2); // rodada 2 sem RSS preserva o que existia
  assert.equal(edition.count, 2);
  assert.equal(edition.sources.rss.count, 1);
});
