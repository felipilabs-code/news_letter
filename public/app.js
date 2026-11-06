const $ = id => document.getElementById(id);
const state = { articles: [], index: 0, paused: false, started: performance.now(), duration: 30000, editionSignature: null, imageRequest: 0 };
const fmtDate = date => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' }).format(new Date(`${date}T12:00:00-03:00`));
const fmtTime = date => new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(new Date(date));
const safeImage = raw => { try { const url = new URL(raw); return url.protocol === 'https:' ? url.href : null; } catch { return null; } };

function render() {
  const { articles, index } = state;
  if (!articles.length) return;
  const item = articles[index];
  $('title').textContent = item.title;
  $('summary').textContent = item.summary || 'Leia a matéria completa no link original.';
  $('story-number').textContent = `NOTÍCIA ${String(index + 1).padStart(2, '0')} / ${String(articles.length).padStart(2, '0')}`;
  $('story-source').textContent = (item.source || 'The Guardian').toUpperCase();
  $('story-category').textContent = item.topics?.includes('ai') ? 'IA EM FOCO' : 'TECNOLOGIA';
  $('source-link').textContent = (() => { try { return new URL(item.url).hostname.replace(/^www\./, '').toUpperCase(); } catch { return ''; } })();
  $('published').textContent = `PUBLICADO ${fmtTime(item.publishedAt)}`;
  const image = safeImage(item.thumbnail);
  showFeatureImage(image);
  const copy = $('feature-copy');
  copy.classList.remove('story-enter');
  void copy.offsetWidth;
  copy.classList.add('story-enter');
  $('up-next').replaceChildren(...[1, 2, 3].filter(n => n < articles.length).map(n => {
    const next = articles[(index + n) % articles.length];
    const box = document.createElement('div'); box.className = 'next-item';
    box.style.setProperty('--item-index', String(n - 1));
    const kicker = document.createElement('div'); kicker.className = 'next-kicker'; kicker.textContent = `A SEGUIR · ${String((index + n) % articles.length + 1).padStart(2, '0')}`;
    const title = document.createElement('div'); title.className = 'next-title'; title.textContent = next.title;
    box.append(kicker, title); return box;
  }));
  state.started = performance.now();
}

function showFeatureImage(url) {
  const layer = $('feature-image');
  const fallback = $('image-fallback');
  const request = ++state.imageRequest;
  layer.classList.remove('visible');
  if (!url) {
    layer.style.backgroundImage = 'none';
    fallback.style.opacity = '1';
    return;
  }
  const probe = new Image();
  probe.onload = () => {
    if (request !== state.imageRequest) return;
    layer.style.backgroundImage = `url("${url.replaceAll('"', '%22')}")`;
    fallback.style.opacity = '0';
    requestAnimationFrame(() => layer.classList.add('visible'));
  };
  probe.onerror = () => {
    if (request !== state.imageRequest) return;
    layer.style.backgroundImage = 'none';
    fallback.style.opacity = '1';
  };
  probe.src = url;
}

function move(step) { if (!state.articles.length) return; state.index = (state.index + step + state.articles.length) % state.articles.length; render(); }
function updateClock() {
  const now = new Date();
  $('clock').textContent = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }).format(now);
  $('date').textContent = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: 'short' }).format(now);
}
async function load() {
  try {
    const response = await fetch('/api/news', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const fresh = data.edition;
    const ready = fresh && fresh.articles.every(item => item.language === 'pt-BR');
    const signature = ready ? `${fresh.date}:${fresh.count}:${fresh.translatedAt || ''}:${fresh.sources?.guardian?.fetchedAt || ''}` : null;
    if (ready && signature !== state.editionSignature) {
      state.editionSignature = signature; state.articles = fresh.articles || []; state.index = 0;
      $('edition-date').textContent = fmtDate(fresh.date);
      $('edition-count').textContent = `${fresh.count} notícias de tecnologia`;
      $('ticker').replaceChildren(...state.articles.flatMap((item, i) => {
        const text = document.createElement('span'); text.textContent = item.title;
        const sep = document.createElement('b'); sep.textContent = '✳'; return [text, sep];
      }));
      render();
    }
    // Durante a tradução da rodada seguinte, a TV segue exibindo o que já estava no ar.
    if (!ready && !state.articles.length) {
      state.articles = [];
      $('title').textContent = data.configured ? 'Buscando notícias de tecnologia.' : 'Configure sua chave do Guardian.';
      $('summary').textContent = data.configured ? 'A primeira edição está sendo preparada. O painel começará automaticamente.' : 'Preencha GUARDIAN_API_KEY no arquivo .env e reinicie o servidor.';
      if (fresh) {
        $('title').textContent = data.translationConfigured ? 'Traduzindo a edição para português.' : 'Configure a tradução com OpenAI.';
        $('summary').textContent = data.translationConfigured ? (data.error || 'Títulos e resumos estão sendo traduzidos. O painel começará automaticamente.') : 'Preencha OPENAI_API_KEY no arquivo .env e reinicie o servidor.';
        $('edition-date').textContent = fmtDate(fresh.date);
        $('edition-count').textContent = `${fresh.count} notícias coletadas`;
      }
    }
    $('status-text').textContent = data.error ? 'VERIFICAR API' : data.translating ? 'TRADUZINDO' : data.syncing ? 'ATUALIZANDO' : ready ? 'NO AR' : 'AGUARDANDO';
    $('status-dot').classList.toggle('warn', Boolean(data.error));
  } catch { $('status-text').textContent = 'OFFLINE'; $('status-dot').classList.add('warn'); }
}
function tick(now) {
  if (state.articles.length && !state.paused) {
    const elapsed = now - state.started;
    $('progress-bar').style.transform = `scaleX(${Math.min(1, elapsed / state.duration)})`;
    if (elapsed >= state.duration) move(1);
  }
  requestAnimationFrame(tick);
}
$('prev').onclick = () => move(-1);
$('next').onclick = () => move(1);
$('pause').onclick = () => { state.paused = !state.paused; $('pause').textContent = state.paused ? '▶' : 'Ⅱ'; $('pause').setAttribute('aria-label', state.paused ? 'Retomar' : 'Pausar'); if (!state.paused) state.started = performance.now(); };
$('fullscreen').onclick = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
document.addEventListener('keydown', event => {
  if (event.key === 'ArrowRight') move(1);
  if (event.key === 'ArrowLeft') move(-1);
  if (event.code === 'Space') { event.preventDefault(); $('pause').click(); }
  if (event.key.toLowerCase() === 'f') $('fullscreen').click();
});
updateClock(); load(); requestAnimationFrame(tick);
setInterval(updateClock, 10_000);
setInterval(load, 60_000);
