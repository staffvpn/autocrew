// Клиент AUTO CREW. Только показывает состояние с сервера и отправляет команды.
import { STAGES, TOOLS, TOOL, JOB, PART, PARTS, SUPPLIERS, SUPPLIER, ADS, PRICE_LEVELS, GRADES, PLATFORM_NAMES, NH_SECONDS, type Grade } from '../shared/content';
import { BUILD } from '../shared/build';
import { mskHour } from '../shared/time';
import { LINES, voice } from '../shared/lines';
import { draw, W, H } from './scene';

declare global { interface Window { Telegram?: { WebApp: any } } }
const tg = window.Telegram?.WebApp;
let initData: string = tg?.initData || '';

type Any = any;
let S: Any = null;            // последнее состояние с сервера
let skew = 0;                 // разница часов сервера и клиента
let tab = localStorage.getItem('ac_tab') || 'yard';
const pref = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const setPref = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } };
let strong = pref('ac_strong') !== '0';
const say = (text: string) => voice(text, strong);
let pending = 0;              // сколько команд ещё в пути (нельзя перезагружать игру)
let release: Any = null;
let dismissedBuild = '';
const cart = new Map<string, number>();
let shopSupplier = 'corner', shopGrade: Grade = 'orig';
const quoteDraft = new Map<string, { level: string; grade: Grade; extra: boolean }>();

const now = () => Date.now() + skew;
const $ = (s: string, el: ParentNode = document) => el.querySelector(s) as HTMLElement;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const rub = (n: number) => Math.round(n).toLocaleString('ru-RU').replace(/ |,/g, ' ') + ' ₽';
const mins = (ms: number) => { const m = Math.max(0, Math.ceil(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)} ч ${m % 60} мин` : `${m} мин`; };
const clock = (ts: number) => new Date(ts + 3 * 3600_000).toISOString().slice(11, 16);
const partLabel = (id: string) => PART[id].name + (PART[id].platform ? ` (${PLATFORM_NAMES[PART[id].platform!]})` : '');
const haptic = (k: 'success' | 'error' | 'warning') => { try { tg?.HapticFeedback?.notificationOccurred(k); } catch { /* нет в браузере */ } };

function toast(text: string, err = false) {
  document.querySelectorAll('.toast').forEach(e => e.remove());
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ---------- Сеть ----------
async function api(path: string, body?: unknown) {
  const r = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', authorization: 'tma ' + initData }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await r.json().catch(() => ({ ok: false, error: 'Сервер недоступен' }));
  if (r.status === 401) data.error = data.error || 'Нужно открыть игру через Telegram';
  return data;
}

function apply(data: Any) {
  if (data && 'company' in data && data.now) {
    skew = data.now - Date.now();
    S = data.company ? data : null;
  }
}

async function refresh() {
  const d = await api('/api/state', {});
  if (d.ok) apply(d); else if (d.error) toast(d.error, true);
  render();
}

// Команда отправляется с одним op_id; при обрыве связи повторяем тот же op_id,
// сервер выполнит её не больше одного раза.
async function cmd(type: string, args: Any = {}) {
  const op_id = crypto.randomUUID();
  pending++;
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const d = await api('/api/cmd', { type, args, op_id });
        apply(d);
        if (!d.ok) { toast(d.error || 'Не получилось', true); haptic('error'); }
        else haptic('success');
        render();
        return d;
      } catch {
        await new Promise(r => setTimeout(r, 600 * 2 ** attempt));
      }
    }
    toast('Нет связи с сервером', true);
    return { ok: false };
  } finally { pending--; }
}

// ---------- Обновления ----------
async function checkRelease() {
  try {
    const r = await api('/api/release');
    if (r && r.build) { release = r; renderUpdate(); }
  } catch { /* проверим позже */ }
}
function renderUpdate() {
  document.querySelector('.update')?.remove();
  if (!release || release.build.id === BUILD.id || BUILD.id === 'dev' || dismissedBuild === release.build.id) return;
  const el = document.createElement('div');
  el.className = 'update';
  el.innerHTML = `<h3>Вышло обновление AUTO CREW</h3>
    <p class="small" style="margin:4px 0 10px">Версия ${esc(release.version)}: ${esc(release.title)}. Чтобы применить, перезагрузи игру. Прогресс хранится на сервере и не потеряется.</p>
    <div class="row"><button class="btn primary" data-act="reload">Обновить игру</button><button class="btn" data-act="news">Что нового?</button><button class="btn sm" data-act="later" style="margin-left:auto">Позже</button></div>`;
  el.onclick = e => {
    const act = (e.target as HTMLElement).dataset.act;
    if (act === 'reload') safeReload(el);
    if (act === 'news') showNews();
    if (act === 'later') { dismissedBuild = release.build.id; el.remove(); }
  };
  document.body.appendChild(el);
}
function safeReload(el: HTMLElement) {
  // Не перезагружаемся, пока не дошли ответы на отправленные команды.
  const btn = $('[data-act=reload]', el) as HTMLButtonElement;
  btn.disabled = true; btn.textContent = 'Сохраняем…';
  const wait = () => pending > 0 ? setTimeout(wait, 200) : location.reload();
  wait();
}
function showNews() {
  if (!release) return;
  modal(`<h2>Что нового в ${esc(release.version)}</h2>
    <p class="muted small">${esc(release.date)} · ${esc(release.title)}</p>
    ${release.added?.length ? `<h3>Добавлено</h3><ul>${release.added.map((x: string) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${release.fixed?.length ? `<h3>Исправлено</h3><ul>${release.fixed.map((x: string) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    ${release.telegram_url ? `<button class="btn block" data-tg="${esc(release.telegram_url)}">Подробнее в Telegram</button>` : ''}
    <button class="btn block" data-close style="margin-top:8px">Закрыть</button>`);
}
function modal(html: string) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal">${html}</div>`;
  bg.onclick = e => {
    const t = e.target as HTMLElement;
    if (t === bg || t.hasAttribute('data-close')) bg.remove();
    const link = t.getAttribute('data-tg');
    if (link) { if (tg?.openTelegramLink) tg.openTelegramLink(link); else window.open(link, '_blank'); }
  };
  document.body.appendChild(bg);
}

// ---------- Экраны ----------
const ICONS: Record<string, string> = {
  yard: '<path d="M3 17h18M5 17l2-6h10l2 6M7 17v2M17 17v2M8 11l1-3h6l1 3" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
  stock: '<path d="M4 8l8-4 8 4v10l-8 4-8-4zM4 8l8 4 8-4M12 12v10" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linejoin="round"/>',
  tools: '<path d="M14 6a4 4 0 0 0 5 5l-9 9-3-3 9-9a4 4 0 0 1-2-2z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linejoin="round"/>',
  biz: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
  log: '<path d="M6 4h12v16H6zM9 9h6M9 13h6M9 17h4" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
};
const TABS: [string, string][] = [['yard', 'Двор'], ['stock', 'Склад'], ['tools', 'Инструмент'], ['biz', 'Бизнес'], ['log', 'Журнал']];

let canvas: HTMLCanvasElement | null = null;

function render() {
  const app = $('#app');
  if (!initData) { app.innerHTML = noTelegram(); bindNoTelegram(); return; }
  if (pref('ac_age18') !== '1') { ageGate(app); return; }
  if (!S) { renderStart(app); return; }
  const c = S.company;
  if (!$('.top', app)) {
    app.innerHTML = `<div class="top"></div><div class="scene"><canvas width="${W}" height="${H}"></canvas><div class="sign"></div><div class="clock"></div><div class="bubble" hidden></div></div><main></main><nav class="tabs"></nav>`;
    canvas = $('canvas', app) as HTMLCanvasElement;
    $('nav.tabs', app).onclick = e => {
      const b = (e.target as HTMLElement).closest('button') as HTMLElement | null;
      if (b?.dataset.tab) { tab = b.dataset.tab; localStorage.setItem('ac_tab', tab); render(); window.scrollTo({ top: 0 }); }
    };
    $('main', app).addEventListener('click', onMainClick);
    $('main', app).addEventListener('change', onMainChange);
  }
  $('.top', app).innerHTML = `<div class="name">${esc(c.name)}<small>${esc(S.stageInfo.cur.name)}</small></div>
    <div class="stat"><b class="${c.cash < 0 ? 'neg' : ''}">${rub(c.cash)}</b><span>касса</span></div>
    <div class="stat"><b>${Math.floor(c.reputation)}</b><span>репутация</span></div>`;
  $('.sign', app).textContent = c.name;
  const waiting = S.jobs.filter((j: Any) => j.status !== 'in_progress').length;
  $('nav.tabs', app).innerHTML = TABS.map(([id, name]) => `<button data-tab="${id}" class="${tab === id ? 'on' : ''}"><svg viewBox="0 0 24 24">${ICONS[id]}</svg>${name}${id === 'yard' && waiting ? `<span class="dot">${waiting}</span>` : ''}</button>`).join('');
  const main = $('main', app);
  main.innerHTML = c.status === 'bankrupt' ? bankrupt() : tab === 'stock' ? stockTab() : tab === 'tools' ? toolsTab() : tab === 'biz' ? bizTab() : tab === 'log' ? logTab() : yardTab();
}

function noTelegram() {
  return `<div class="start"><h1>AUTO CREW</h1><p>Игра работает внутри Telegram. Открой бота и нажми «Открыть гараж».</p>
    <p><a class="btn primary" style="display:inline-block;text-decoration:none" href="https://t.me/autocrewgame">Канал AUTO CREW</a></p>
    <p class="muted small" id="devbox"></p></div>`;
}
function bindNoTelegram() {
  // Локальная разработка: сервер с DEV_AUTH=1 выдаёт тестовую подпись.
  fetch('/api/dev-login?id=' + (localStorage.getItem('ac_dev_id') || '1')).then(r => r.ok ? r.json() : null).then(d => {
    if (d?.initData) { initData = d.initData; refresh(); }
  }).catch(() => {});
}

function ageGate(app: HTMLElement) {
  app.innerHTML = `<div class="start"><h1>AUTO CREW</h1>
    <div class="card"><h3>Только для взрослых</h3><p>В гаражах разговаривают по-гаражному: грубый юмор и крепкие выражения. Их можно выключить в настройках.</p>
    <p class="small muted" style="margin-bottom:0">Продолжая, ты подтверждаешь, что тебе есть 18 лет.</p></div>
    <button class="btn primary block" id="age18">Мне есть 18</button><button class="btn block" id="age17" style="margin-top:8px">Мне нет 18</button></div>`;
  $('#age18').onclick = () => { setPref('ac_age18', '1'); render(); };
  $('#age17').onclick = () => { $('.start').innerHTML = '<h1>AUTO CREW</h1><p>Тогда до встречи через пару лет. Гараж подождёт.</p>'; };
}

function renderStart(app: HTMLElement) {
  app.innerHTML = `<div class="start">
    <h1>AUTO CREW</h1>
    <p class="muted">Начал с ржавого гаража. Закончил собственной автомобильной империей.</p>
    <div class="card"><p style="margin-top:0">Ты снимаешь старый гараж в кооперативе на окраине. В кармане 60 000 ₽, на стене одна лампочка, клиентов нет. Аренда — 850 ₽ в сутки, и она списывается каждую ночь.</p>
    <p class="small muted" style="margin-bottom:0">Купи инструмент, закажи запчасти, найди клиентов и сделай первый ремонт. Всё остальное придётся заработать.</p></div>
    <label class="small muted" for="nm">Как будет называться мастерская?</label>
    <input id="nm" maxlength="32" placeholder="Например: Гараж у Петровича" autocomplete="off">
    <button class="btn primary block" id="go">Открыть мастерскую</button>
  </div>`;
  const go = $('#go') as HTMLButtonElement, nm = $('#nm') as HTMLInputElement;
  go.onclick = async () => {
    go.disabled = true;
    const d = await cmd('create_company', { name: nm.value });
    go.disabled = false;
    if (d.ok) { tab = 'tools'; render(); }
  };
}

function bankrupt() {
  return `<div class="card"><h3>Мастерская закрыта</h3><p>Долг по аренде вырос до ${rub(-S.company.cash)}. Хозяин гаража сменил замок.</p>
    <p class="muted small">Можно начать с нуля: новый гараж и 60 000 ₽. Старая мастерская останется в истории.</p>
    <button class="btn primary block" data-cmd="restart">Начать заново</button></div>`;
}

// --- Двор: клиенты и заказы
function yardTab() {
  const jobs = [...S.jobs].sort((a: Any, b: Any) => ({ in_progress: 0, accepted: 1, waiting: 2 } as Any)[a.status] - ({ in_progress: 0, accepted: 1, waiting: 2 } as Any)[b.status] || a.arrived_at - b.arrived_at);
  const h = mskHour(now());
  const hint = !S.tools.length
    ? `<div class="card"><h3>С чего начать</h3><p class="small">Без инструмента не сделать ничего. Открой вкладку «Инструмент» и купи хотя бы набор ключей, съёмник фильтров и ёмкость для масла — это нужно для самой частой работы, замены масла.</p><button class="btn primary" data-tab-go="tools">К инструменту</button></div>` : '';
  const closed = h < 8 || h >= 21 ? `<p class="muted small">Сейчас ${clock(now())} по Москве. Клиенты приезжают с 8:00 до 21:00.</p>` : '';
  return hint + closed + (jobs.length ? jobs.map(jobCard).join('') : `<div class="empty">Во дворе пусто.<br><span class="small">Сейчас в среднем ${S.demand} клиента в день. Реклама и репутация приводят больше.</span></div>`);
}

function jobCard(j: Any) {
  const head = `<div class="row between"><h3>${esc(j.car.name)}, ${j.car.year}</h3><span class="tag">${(j.car.mileage / 1000).toFixed(0)} тыс. км</span></div>
    <div class="small muted">${esc(j.customer)}: «${esc(j.symptom)}»</div>`;
  const left = j.leave_at - now();
  const patience = j.status !== 'in_progress' ? `<div class="small ${left < 30 * 60000 ? 'neg' : 'muted'}" style="margin-top:4px">Ждёт ещё ${mins(left)}</div>` : '';
  if (j.status === 'in_progress') {
    const total = j.done_at - j.started_at, p = Math.min(1, (now() - j.started_at) / total);
    return `<div class="card">${head}<div class="small" style="margin:8px 0 4px">Работаешь: ${j.job_types.map((t: string) => esc(JOB[t].name)).join(', ')}</div>
      <div class="bar"><i data-progress="${j.id}" style="width:${p * 100}%"></i></div><div class="small muted" data-left="${j.id}" style="margin-top:4px">Осталось ${mins(j.done_at - now())}</div></div>`;
  }
  if (!j.inspected) {
    return `<div class="card">${head}${patience}<div class="row" style="margin-top:8px"><button class="btn primary" data-cmd="inspect" data-job="${j.id}">Осмотреть машину</button><button class="btn danger sm" data-cmd="send_away" data-job="${j.id}" style="margin-left:auto">Отказать</button></div></div>`;
  }
  if (j.status === 'waiting') return `<div class="card">${head}${patience}${quoteForm(j)}</div>`;
  // Договорились: проверяем инструмент и детали
  const missingTools = j.tools.filter((id: string) => !S.tools.find((t: Any) => t.tool_id === id && !t.broken));
  const missingParts = j.parts.map((p: Any) => ({ ...p, have: stockQty(p.part, j.grade) })).filter((p: Any) => p.have < p.qty);
  const busy = S.jobs.some((x: Any) => x.status === 'in_progress');
  const pend = S.deliveries.length ? `<div class="small muted">Детали в пути: ${S.deliveries.map((d: Any) => `${esc(SUPPLIER[d.supplier_id].name)} ~${clock(d.eta_promised)}`).join(', ')}</div>` : '';
  return `<div class="card">${head}${patience}
    <div class="row between" style="margin-top:8px"><span class="small">Договорились: ${j.job_types.map((t: string) => esc(JOB[t].name)).join(', ')} · ${esc(GRADES[j.grade as Grade].name.toLowerCase())}</span><span class="price">${rub(j.labor + j.parts_price)}</span></div>
    ${missingTools.length ? `<div class="small neg">Нет инструмента: ${missingTools.map((id: string) => esc(TOOL[id].name)).join(', ')}</div>` : ''}
    ${missingParts.length ? `<div class="small neg">Не хватает: ${missingParts.map((p: Any) => `${esc(partLabel(p.part))} ${p.have}/${p.qty}`).join(', ')}</div>${pend}` : ''}
    <div class="row wrap" style="margin-top:8px">
      ${missingParts.length ? `<button class="btn" data-buy-missing="${j.id}">Купить недостающее в «У дома»</button>` : ''}
      <button class="btn primary" data-cmd="start_job" data-job="${j.id}" ${missingTools.length || missingParts.length || busy ? 'disabled' : ''}>${busy ? 'Пост занят' : 'Начать ремонт'}</button>
      <button class="btn danger sm" data-cmd="send_away" data-job="${j.id}" style="margin-left:auto">Отказать</button>
    </div></div>`;
}

const stockQty = (part: string, grade: string) => S.stock.find((s: Any) => s.part_id === part && s.grade === grade)?.qty || 0;

function quoteForm(j: Any) {
  const d = quoteDraft.get(j.id) || { level: 'market', grade: 'orig' as Grade, extra: j.job_types.length > 1 };
  quoteDraft.set(j.id, d);
  const types = d.extra ? j.job_types : [j.job_types[0]];
  const q = j.quotes[`${d.level}|${d.grade}`][d.extra ? 'all' : 'main'];
  const nh = types.reduce((s: number, t: string) => s + JOB[t].nh, 0);
  const parts = new Map<string, number>();
  for (const t of types) for (const p of j.parts_by_type[t]) parts.set(p.part, (parts.get(p.part) || 0) + p.qty);
  return `<div style="margin-top:8px">
    <div class="small">Осмотр показал:</div>
    <div class="check"><input type="checkbox" checked disabled> ${esc(JOB[j.job_types[0]].name)}</div>
    ${j.job_types[1] ? `<label class="check"><input type="checkbox" data-extra="${j.id}" ${d.extra ? 'checked' : ''}> Заодно: ${esc(JOB[j.job_types[1]].name)}</label>` : ''}
    <ul class="list">${[...parts].map(([p, qty]) => { const have = stockQty(p, d.grade); return `<li><span>${esc(partLabel(p))} × ${qty}</span><span class="tag ${have >= qty ? 'ok' : 'no'}">на складе ${have}</span></li>`; }).join('')}
      <li><span>Работа</span><span>${nh.toFixed(1)} н·ч ≈ ${mins(nh * NH_SECONDS * 1000)}</span></li></ul>
    <div class="small muted" style="margin:6px 0 4px">Детали</div>
    <div class="seg">${(Object.keys(GRADES) as Grade[]).map(g => `<button data-grade="${j.id}:${g}" class="${d.grade === g ? 'on' : ''}">${GRADES[g].name}</button>`).join('')}</div>
    <div class="small muted" style="margin:8px 0 4px">Цена работы</div>
    <div class="seg">${Object.entries(PRICE_LEVELS).map(([k, v]) => `<button data-level="${j.id}:${k}" class="${d.level === k ? 'on' : ''}">${v.name}</button>`).join('')}</div>
    <div class="row between" style="margin-top:10px"><span class="small muted">Работа ${rub(q.labor)} + детали ${rub(q.parts)}</span><span class="price">${rub(q.labor + q.parts)}</span></div>
    <p class="small muted" style="margin:4px 0 8px">Аналоги дешевле и выгоднее, но чаще ломаются: клиент вернётся с претензией. Клиент отвечает на смету один раз.</p>
    <div class="row"><button class="btn primary" data-quote="${j.id}">Предложить смету</button><button class="btn danger sm" data-cmd="send_away" data-job="${j.id}" style="margin-left:auto">Отказать</button></div>
  </div>`;
}
// --- Склад и закупки
function stockTab() {
  const sup = SUPPLIER[shopSupplier];
  const sups = SUPPLIERS.map(s => `<button data-sup="${s.id}" class="${shopSupplier === s.id ? 'on' : ''}" ${s.stage > S.company.stage ? 'disabled' : ''}>${esc(s.name)}${s.stage > S.company.stage ? ' 🔒' : ''}</button>`).join('');
  const total = [...cart].reduce((s, [k, q]) => { const [p, g] = k.split('|'); return s + unit(sup.id, p, g as Grade) * q; }, 0);
  const deliveries = S.deliveries.map((d: Any) => `<li><span>${esc(SUPPLIER[d.supplier_id].name)} · ${d.lines.reduce((s: number, l: Any) => s + l.qty, 0)} шт.</span><span>ожидается ~${clock(d.eta_promised)}</span></li>`).join('');
  const stock = S.stock.map((s: Any) => `<li><span>${esc(partLabel(s.part_id))} <span class="tag">${esc(GRADES[s.grade as Grade].name)}</span></span><span>${s.qty} ${esc(PART[s.part_id].unit)} · ${rub(s.avg_cost)}</span></li>`).join('');
  const groups = new Map<string, typeof PARTS>();
  for (const p of PARTS) { const k = p.name; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(p); }
  const shop = [...groups].map(([name, ps]) => `<div class="card" style="padding:10px"><div class="small" style="margin-bottom:4px"><b>${esc(name)}</b></div>${ps.map(p => {
    const k = `${p.id}|${shopGrade}`, q = cart.get(k) || 0;
    return `<div class="row between" style="padding:3px 0"><span class="small">${p.platform ? `<span class="tag">${PLATFORM_NAMES[p.platform]}</span> ` : ''}${rub(unit(sup.id, p.id, shopGrade))} <span class="muted">· есть ${stockQty(p.id, shopGrade)}</span></span>
      <span class="qty"><button data-q="${k}:-1">−</button><span>${q}</span><button data-q="${k}:1">+</button></span></div>`;
  }).join('')}</div>`).join('');
  return `${deliveries ? `<div class="sect">В пути</div><div class="card"><ul class="list">${deliveries}</ul></div>` : ''}
    <div class="sect">На складе</div><div class="card">${stock ? `<ul class="list">${stock}</ul>` : '<div class="muted small">Пусто. Детали покупаются ниже.</div>'}</div>
    <div class="sect">Закупка</div>
    <div class="seg" style="margin-bottom:6px">${sups}</div>
    <p class="small muted" style="margin:4px 2px 8px">${esc(sup.desc)}${sup.fee ? ` Доставка ${rub(sup.fee)}.` : ''}</p>
    <div class="seg" style="margin-bottom:8px">${(Object.keys(GRADES) as Grade[]).map(g => `<button data-sgrade="${g}" class="${shopGrade === g ? 'on' : ''}">${GRADES[g].name}</button>`).join('')}</div>
    <p class="small muted" style="margin:0 2px 8px">Платформы: отеч. — Ладья и Нава, кор. — Хёнда, Кия, Дэу, евр. — Рэно, Фольцваген, Шкадо, Форт, яп. — Тайота, Мицубуси.</p>
    ${shop}
    <div class="card" style="position:sticky;bottom:calc(64px + env(safe-area-inset-bottom))"><div class="row between"><span>В корзине ${[...cart.values()].reduce((a, b) => a + b, 0)} шт.${sup.minOrder ? ` <span class="small muted">мин. ${rub(sup.minOrder)}</span>` : ''}</span><span class="price">${rub(total + (cart.size ? sup.fee : 0))}</span></div>
      <div class="row" style="margin-top:8px"><button class="btn primary" data-order ${!cart.size || total < sup.minOrder ? 'disabled' : ''}>Заказать</button><button class="btn sm" data-clear style="margin-left:auto" ${cart.size ? '' : 'disabled'}>Очистить</button></div></div>`;
}
const unit = (sup: string, part: string, grade: Grade) => Math.round(Math.round(PART[part].retail * GRADES[grade].priceK) * SUPPLIER[sup].priceK);

// --- Инструмент
function toolsTab() {
  const owned = new Map(S.tools.map((t: Any) => [t.tool_id, t]));
  const usedBy = (id: string) => Object.values(JOB).filter(j => j.tools.includes(id)).map(j => j.name.toLowerCase());
  return TOOLS.map(t => {
    const o: Any = owned.get(t.id);
    const locked = t.stage > S.company.stage;
    const uses = usedBy(t.id);
    const state = o ? `<div class="bar ${o.wear > 0.7 ? 'bad' : 'good'}" style="margin:6px 0"><i style="width:${Math.round((1 - o.wear) * 100)}%"></i></div><div class="small ${o.broken ? 'neg' : 'muted'}">${o.broken ? 'Сломан' : `Ресурс ${Math.round((1 - o.wear) * 100)}%`}</div>` : '';
    const action = o
      ? (o.broken || o.wear >= 0.5 ? `<button class="btn sm" data-cmd="repair_tool" data-tool="${t.id}">Ремонт ${rub(t.price * 0.35)}</button>` : '<span class="tag ok">Есть</span>')
      : locked ? `<span class="tag">Ступень ${t.stage}: ${esc(STAGES[t.stage].name)}</span>` : `<button class="btn primary sm" data-cmd="buy_tool" data-tool="${t.id}">${rub(t.price)}</button>`;
    return `<div class="card"><div class="row between"><h3>${esc(t.name)}</h3>${action}</div><div class="small muted">${esc(t.desc)}${uses.length ? `. Нужен: ${esc(uses.join(', '))}` : ''}</div>${state}</div>`;
  }).join('');
}

// --- Бизнес: ступени, реклама, финансы
const CAT: Record<string, string> = { start_capital: 'Стартовый капитал', labor: 'Работа', parts_sale: 'Продажа деталей', supplier_refund: 'Возврат брака', parts_purchase: 'Закупка деталей', delivery: 'Доставка', tools: 'Инструмент', tool_repair: 'Ремонт инструмента', rent: 'Аренда', utilities: 'Коммунальные', tax: 'Налог 6%', consumables: 'Расходники', warranty: 'Гарантийные переделки', ads: 'Реклама', upgrade: 'Развитие' };
function bizTab() {
  const { cur, next, blockers } = S.stageInfo;
  const c = S.company;
  const prog = (v: number, need: number) => `<div class="bar ${v >= need ? 'good' : ''}" style="margin:3px 0 8px"><i style="width:${Math.min(100, (v / Math.max(1, need)) * 100)}%"></i></div>`;
  const nextCard = next ? `<div class="card"><div class="row between"><h3>Следующая ступень: ${esc(next.name)}</h3>${next.available ? '' : '<span class="tag warn">скоро</span>'}</div>
    <p class="small muted" style="margin:4px 0 8px">${esc(next.desc)}</p>
    <div class="small">Репутация ${Math.floor(c.reputation)} / ${next.needRep}</div>${prog(c.reputation, next.needRep)}
    <div class="small">Выполнено заказов ${c.orders_done} / ${next.needOrders}</div>${prog(c.orders_done, next.needOrders)}
    <div class="small">Деньги ${rub(Math.max(0, c.cash))} / ${rub(next.cost)}</div>${prog(c.cash, next.cost)}
    <div class="small" style="margin-bottom:8px">Откроется: ${next.unlocks.map((u: string) => esc(u)).join(', ')}</div>
    <button class="btn primary block" data-cmd="upgrade" ${blockers.length ? 'disabled' : ''}>${next.available ? `Перейти за ${rub(next.cost)}` : 'Откроется в следующем обновлении'}</button></div>` : '';
  const ad = c.ad ? `<p class="small">Сейчас работает: ${esc(ADS.find(a => a.id === c.ad.id)!.name)}, ещё ${mins(c.ad.until - now())}.</p>` : '';
  const ads = ADS.map(a => `<div class="row between" style="padding:4px 0"><span class="small">${esc(a.name)}<br><span class="muted">+${Math.round((a.mult - 1) * 100)}% клиентов на ${a.hours} ч</span></span>${a.stage > c.stage ? '<span class="tag">позже</span>' : `<button class="btn sm" data-cmd="buy_ad" data-ad="${a.id}" ${c.ad ? 'disabled' : ''}>${rub(a.price)}</button>`}</div>`).join('');
  // Финансы за 7 дней
  const days = [...new Set(S.report.map((r: Any) => r.day))].sort().reverse() as string[];
  const cats = [...new Set(S.report.map((r: Any) => r.category))] as string[];
  const val = (d: string, cat: string) => S.report.find((r: Any) => r.day === d && r.category === cat)?.amount || 0;
  const income = cats.filter(k => days.some(d => val(d, k) > 0) && k !== 'start_capital');
  const expense = cats.filter(k => days.some(d => val(d, k) < 0));
  const shown = days.slice(0, 3);
  const line = (k: string) => `<tr><td>${esc(CAT[k] || k)}</td>${shown.map(d => `<td>${val(d, k) ? rub(val(d, k)) : '—'}</td>`).join('')}</tr>`;
  const total = (d: string) => cats.filter(k => k !== 'start_capital').reduce((s, k) => s + val(d, k), 0);
  const fin = shown.length ? `<table class="fin"><tr><th></th>${shown.map(d => `<th>${d.slice(8)}.${d.slice(5, 7)}</th>`).join('')}</tr>
    ${income.map(line).join('')}${expense.map(line).join('')}
    <tr><td><b>Касса за день</b></td>${shown.map(d => `<td class="${total(d) < 0 ? 'neg' : ''}"><b>${rub(total(d))}</b></td>`).join('')}</tr></table>` : '<div class="muted small">Пока нет операций.</div>';
  return `<div class="card"><h3>${esc(cur.name)}</h3><p class="small muted" style="margin:4px 0">${esc(cur.desc)}</p>
      <ul class="list"><li><span>Аренда и коммунальные</span><span>${rub(cur.rent + cur.utilities)} / сутки</span></li><li><span>Ставка норма-часа</span><span>${rub(cur.laborRate)}</span></li>
      <li><span>Поток клиентов сейчас</span><span>≈ ${S.demand} в день</span></li><li><span>Мест во дворе</span><span>${cur.queueCap}</span></li></ul></div>
    ${nextCard}
    <div class="sect">Реклама</div><div class="card">${ad}${ads}</div>
    <div class="sect">Движение кассы за последние дни</div><div class="card" style="overflow-x:auto">${fin}</div>
    <div class="sect">Настройки</div><div class="card"><label class="check"><input type="checkbox" data-strong ${strong ? 'checked' : ''}> Крепкие выражения (18+)</label><div class="small muted">Если выключить, мужики в гараже будут говорить «ёлки-палки».</div></div>
    <p class="small muted" style="text-align:center">AUTO CREW ${esc(BUILD.version)} · <a href="#" data-news style="color:inherit">что нового</a></p>`;
}

function logTab() {
  if (!S.feed.length) return '<div class="empty">Пока ничего не произошло.</div>';
  return `<div class="card"><ul class="list feed">${S.feed.map((f: Any) => `<li class="${esc(f.kind)}"><time>${clock(f.at)}</time>${esc(say(f.text))}</li>`).join('')}</ul></div>`;
}

// ---------- Обработчики ----------
async function onMainClick(e: Event) {
  const t = (e.target as HTMLElement).closest('button, a') as HTMLElement | null;
  if (!t || (t as HTMLButtonElement).disabled) return;
  const ds = t.dataset;
  if (ds.cmd) {
    (t as HTMLButtonElement).disabled = true;
    const args: Any = {};
    if (ds.job) args.job_id = ds.job;
    if (ds.tool) args.tool_id = ds.tool;
    if (ds.ad) args.ad_id = ds.ad;
    if (ds.cmd === 'restart') { const d = await cmd('restart'); if (d.ok) { S = null; render(); } return; }
    const d = await cmd(ds.cmd, args);
    if (d.ok && ds.cmd === 'upgrade') toast('Новая ступень открыта!');
    if (d.ok && ds.cmd === 'start_job') toast('Работа пошла');
    return;
  }
  if (ds.tabGo) { tab = ds.tabGo; render(); return; }
  if (ds.news !== undefined) { e.preventDefault(); if (!release) await checkRelease(); showNews(); return; }
  if (ds.grade) { const [id, g] = ds.grade.split(':'); quoteDraft.get(id)!.grade = g as Grade; render(); return; }
  if (ds.level) { const [id, l] = ds.level.split(':'); quoteDraft.get(id)!.level = l; render(); return; }
  if (ds.quote) {
    const j = S.jobs.find((x: Any) => x.id === ds.quote), d = quoteDraft.get(ds.quote)!;
    (t as HTMLButtonElement).disabled = true;
    const r = await cmd('quote', { job_id: j.id, types: d.extra ? j.job_types : [j.job_types[0]], level: d.level, grade: d.grade });
    if (r.ok) toast(r.result?.accepted ? 'Клиент согласился' : 'Клиент отказался и уехал', !r.result?.accepted);
    return;
  }
  if (ds.buyMissing) {
    const j = S.jobs.find((x: Any) => x.id === ds.buyMissing);
    const lines = j.parts.map((p: Any) => ({ part_id: p.part, grade: j.grade, qty: p.qty - stockQty(p.part, j.grade) })).filter((l: Any) => l.qty > 0);
    (t as HTMLButtonElement).disabled = true;
    await cmd('order_parts', { supplier_id: 'corner', lines });
    return;
  }
  if (ds.sup) { shopSupplier = ds.sup; cart.clear(); render(); return; }
  if (ds.sgrade) { shopGrade = ds.sgrade as Grade; render(); return; }
  if (ds.q) {
    const [k, delta] = [ds.q.slice(0, ds.q.lastIndexOf(':')), Number(ds.q.slice(ds.q.lastIndexOf(':') + 1))];
    const v = Math.max(0, Math.min(50, (cart.get(k) || 0) + delta));
    if (v) cart.set(k, v); else cart.delete(k);
    render(); return;
  }
  if (ds.clear !== undefined) { cart.clear(); render(); return; }
  if (ds.order !== undefined) {
    (t as HTMLButtonElement).disabled = true;
    const lines = [...cart].map(([k, qty]) => { const [part_id, grade] = k.split('|'); return { part_id, grade, qty }; });
    const d = await cmd('order_parts', { supplier_id: shopSupplier, lines });
    if (d.ok) { cart.clear(); render(); toast('Заказ оформлен'); }
  }
}
function onMainChange(e: Event) {
  const t = e.target as HTMLInputElement;
  if (t.dataset.extra) { quoteDraft.get(t.dataset.extra)!.extra = t.checked; render(); }
  if (t.dataset.strong !== undefined) { strong = t.checked; setPref('ac_strong', strong ? '1' : '0'); render(); }
}

// ---------- Анимация и таймеры ----------
let lastDone = 0;
function frame(ts: number) {
  if (canvas && S) {
    const ctx = canvas.getContext('2d')!;
    const w = S.jobs.find((j: Any) => j.status === 'in_progress');
    draw(ctx, {
      stage: S.company.stage, hour: mskHour(now()), tools: S.tools.filter((t: Any) => !t.broken).map((t: Any) => t.tool_id),
      working: w ? { color: w.car.color, progress: Math.min(1, (now() - w.started_at) / (w.done_at - w.started_at)), lifted: w.job_types.some((t: string) => ['brake_pads', 'stab_links'].includes(t)) } : null,
      queue: S.jobs.filter((j: Any) => j.status !== 'in_progress').map((j: Any) => ({ color: j.car.color, flag: !j.inspected })),
    }, ts);
    const ck = $('.scene .clock'); if (ck) ck.textContent = clock(now());
    if (w) {
      const bar = document.querySelector(`[data-progress="${w.id}"]`) as HTMLElement | null;
      if (bar) bar.style.width = Math.min(100, ((now() - w.started_at) / (w.done_at - w.started_at)) * 100) + '%';
      const left = document.querySelector(`[data-left="${w.id}"]`);
      if (left) left.textContent = 'Осталось ' + mins(w.done_at - now());
      // Как только ремонт закончился по часам, спрашиваем сервер о результате
      if (now() > w.done_at + 500 && lastDone !== w.done_at) { lastDone = w.done_at; refresh(); }
    }
    // Владелец бурчит за работой: новая фраза каждые 9 секунд, 6 секунд на экране
    const bubble = $('.scene .bubble');
    if (bubble) {
      const k = Math.floor(ts / 9000), show = w && ts % 9000 < 6000;
      if (show && bubble.dataset.k !== String(k)) { bubble.dataset.k = String(k); bubble.textContent = say(LINES.mutter[(k * 7 + w.id.length) % LINES.mutter.length]); }
      bubble.hidden = !show;
    }
  }
  requestAnimationFrame(frame);
}

// ---------- Запуск ----------
if (tg) {
  tg.ready(); tg.expand();
  try { tg.setHeaderColor('#111215'); tg.setBackgroundColor('#111215'); tg.disableVerticalSwipes?.(); } catch { /* старые клиенты */ }
}
render();
if (initData) refresh();
setInterval(() => { if (initData && document.visibilityState === 'visible') refresh(); }, 20_000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && initData) { refresh(); checkRelease(); } });
setInterval(checkRelease, 120_000);
checkRelease();
requestAnimationFrame(frame);
