// Игровое API. Клиент присылает только команды, состояние считает и хранит сервер.
import { STAGES, TOOL, JOB, PART, SUPPLIERS, ADS, PRICE_LEVELS, GRADES, partPrice } from '../shared/content';
import { BUILD } from '../shared/build';
import { mskDay } from '../shared/time';
import { verifyInitData, signInitData, type TgUser } from './auth';
import { loadWorld, saveWorld, hasChanges, ConflictError } from './db';
import * as G from './game';
import releases from '../../releases.json';

export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  BOT_TOKEN: string;
  WEBHOOK_SECRET?: string;
  ADMIN_IDS?: string;
  ADMINS?: string;
  CHANNEL_ID?: string;
  CHANNEL_USERNAME?: string;
  APP_URL?: string;
  DEV_AUTH?: string;
  RATE_LIMIT?: string; // '0' отключает ограничение частоты (только для тестов)
}

export const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

// Ограничение частоты: не больше 12 запросов за 2 секунды с одного игрока (в пределах экземпляра воркера).
const hits = new Map<number, number[]>();
function rateLimited(id: number, now: number) {
  const arr = (hits.get(id) || []).filter(t => now - t < 2000);
  arr.push(now); hits.set(id, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > 12;
}

async function auth(req: Request, env: Env): Promise<TgUser | null> {
  const h = req.headers.get('authorization') || '';
  return h.startsWith('tma ') ? verifyInitData(h.slice(4), env.BOT_TOKEN) : null;
}

async function touchPlayer(env: Env, u: TgUser, now: number) {
  await env.DB.prepare(`INSERT INTO players (tg_id, username, first_name, lang, created_at, last_seen) VALUES (?1, ?2, ?3, ?4, ?5, ?5)
    ON CONFLICT(tg_id) DO UPDATE SET username = ?2, first_name = ?3, lang = ?4, last_seen = ?5`)
    .bind(u.id, u.username?.slice(0, 64) ?? null, u.first_name?.slice(0, 64) ?? null, u.language_code?.slice(0, 8) ?? null, now).run();
  return env.DB.prepare('SELECT banned FROM players WHERE tg_id = ?1').bind(u.id).first<{ banned: number }>();
}

// Что видит клиент. Скрытое (результат осмотра до осмотра, реальное время доставки,
// будущие претензии) наружу не отдаётся.
async function view(env: Env, w: G.World, now: number) {
  const c = w.c, s = G.stage(w), next = STAGES[c.stage + 1] || null;
  const [feed, report] = await env.DB.batch([
    env.DB.prepare('SELECT at, kind, text FROM feed WHERE company_id = ?1 ORDER BY id DESC LIMIT 40').bind(c.id),
    env.DB.prepare('SELECT day, category, SUM(amount) amount FROM ledger WHERE company_id = ?1 AND day >= ?2 GROUP BY day, category ORDER BY day DESC').bind(c.id, mskDay(now - 6 * 86400_000)),
  ]);
  const jobs = [...w.jobs.values()].filter(j => j.status === 'waiting' || j.status === 'accepted' || j.status === 'in_progress').map(j => {
    const types = j.inspected ? j.job_types : [];
    const base = {
      id: j.id, status: j.status, customer: j.customer, car: { ...j.car, name: G.modelName(j.car.model) }, symptom: j.symptom,
      arrived_at: j.arrived_at, leave_at: j.leave_at, inspected: j.inspected, job_types: types,
      nh: types.length ? G.jobNh(types) : null, tools: types.length ? G.jobTools(types) : [],
      parts: types.length ? G.jobParts(j).map(([part, qty]) => ({ part, qty })) : [],
      parts_by_type: Object.fromEntries(types.map(t => [t, G.jobParts(j, [t]).map(([part, qty]) => ({ part, qty }))])),
      price_level: j.price_level, grade: j.grade, labor: j.labor, parts_price: j.parts_price, started_at: j.started_at,
      done_at: j.status === 'in_progress' ? j.done_at : 0,
      // Для каждой работы — цена по каждому уровню и качеству, чтобы клиент мог показать смету.
      quotes: j.inspected && j.status === 'waiting' ? Object.fromEntries(Object.keys(PRICE_LEVELS).flatMap(l => (Object.keys(GRADES) as ('eco' | 'orig')[]).map(g => {
        const q = G.quoteFor(w, j, j.job_types, l, g), qm = G.quoteFor(w, j, [j.job_types[0]], l, g);
        return [`${l}|${g}`, { all: q, main: qm }];
      }))) : null,
    };
    return base;
  });
  return {
    now, build: BUILD,
    company: { name: c.name, stage: c.stage, cash: c.cash, reputation: Math.floor(c.reputation * 10) / 10, orders_done: c.orders_done, status: c.status,
      ad: c.ad_id && c.ad_until > now ? { id: c.ad_id, until: c.ad_until } : null, created_at: c.created_at },
    stageInfo: { cur: s, next, blockers: G.upgradeBlockers(w) },
    demand: Math.round(G.demandPerDay(w, now) * 10) / 10,
    tools: [...w.tools.values()],
    stock: [...w.stock.values()].filter(x => x.qty > 0),
    jobs,
    deliveries: [...w.pos.values()].filter(p => p.status === 'pending').map(p => ({ id: p.id, supplier_id: p.supplier_id, lines: p.lines, total: p.total, fee: p.fee, ordered_at: p.ordered_at, eta_promised: p.eta_promised })),
    feed: feed.results,
    report: report.results,
  };
}

const COMMANDS: Record<string, (w: G.World, now: number, a: Record<string, unknown>, opId: string) => unknown> = {
  buy_tool: (w, now, a) => G.cmdBuyTool(w, now, a.tool_id),
  repair_tool: (w, now, a) => G.cmdRepairTool(w, now, a.tool_id),
  inspect: (w, now, a) => G.cmdInspect(w, now, a.job_id),
  quote: (w, now, a) => G.cmdQuote(w, now, a.job_id, a.types, a.level, a.grade),
  send_away: (w, now, a) => G.cmdSendAway(w, now, a.job_id),
  start_job: (w, now, a) => G.cmdStart(w, now, a.job_id),
  order_parts: (w, now, a, opId) => G.cmdOrderParts(w, now, a.supplier_id, a.lines, 'po_' + opId.replace(/[^a-z0-9]/gi, '').slice(0, 16)),
  buy_ad: (w, now, a) => G.cmdBuyAd(w, now, a.ad_id),
  upgrade: (w, now) => G.cmdUpgrade(w, now),
};

export async function handleApi(req: Request, env: Env, path: string): Promise<Response> {
  const now = Date.now();
  if (path === '/api/release') return json(releaseInfo(await releasePostUrl(env)));
  if (path === '/api/catalog') return json(catalog());
  if (path === '/api/dev-login' && env.DEV_AUTH === '1') {
    const id = Number(new URL(req.url).searchParams.get('id') || 1);
    return json({ initData: await signInitData({ id, first_name: 'Dev ' + id }, env.BOT_TOKEN) });
  }
  if (req.method !== 'POST') return json({ ok: false, error: 'Not found' }, 404);
  const user = await auth(req, env);
  if (!user) return json({ ok: false, error: 'Нужно открыть игру через Telegram' }, 401);
  if (env.RATE_LIMIT !== '0' && rateLimited(user.id, now)) return json({ ok: false, error: 'Слишком часто' }, 429);
  const player = await touchPlayer(env, user, now);
  if (player?.banned) return json({ ok: false, error: 'Доступ закрыт администрацией' }, 403);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* пустое тело допустимо */ }

  if (path === '/api/state') {
    for (let attempt = 0; attempt < 3; attempt++) {
      const w = await loadWorld(env.DB, user.id);
      if (!w) return json({ ok: true, company: null, build: BUILD, now });
      G.advance(w, now);
      try {
        if (hasChanges(w)) await saveWorld(env.DB, w);
        return json({ ok: true, ...(await view(env, w, now)) });
      } catch (e) { if (!(e instanceof ConflictError)) throw e; }
    }
    return json({ ok: false, error: 'Сервер занят, попробуй ещё раз' }, 409);
  }

  if (path === '/api/cmd') {
    const type = String(body.type || ''), opId = String(body.op_id || '');
    if (!/^[A-Za-z0-9-]{8,64}$/.test(opId)) return json({ ok: false, error: 'Нет op_id' }, 400);
    const done = await env.DB.prepare('SELECT result FROM ops WHERE tg_id = ?1 AND op_id = ?2').bind(user.id, opId).first<{ result: string }>();
    if (done) return replay(env, user.id, now, JSON.parse(done.result));
    if (type === 'create_company') return createCompany(env, user, body, opId, now);
    if (type === 'restart') return restart(env, user, opId, now);
    const fn = COMMANDS[type];
    if (!fn) return json({ ok: false, error: 'Неизвестная команда' }, 400);
    for (let attempt = 0; attempt < 3; attempt++) {
      const w = await loadWorld(env.DB, user.id);
      if (!w) return json({ ok: false, error: 'Сначала открой мастерскую' }, 400);
      G.advance(w, now);
      let result: unknown;
      try {
        result = fn(w, now, (body.args as Record<string, unknown>) || {}, opId) ?? null;
      } catch (e) {
        if (!(e instanceof G.GameError)) throw e;
        // Ошибку правил не запоминаем как выполненную операцию: игрок может исправить ситуацию и повторить.
        // Но прошедшее время всё равно записываем.
        const w2 = await loadWorld(env.DB, user.id);
        if (w2) { G.advance(w2, now); try { await saveWorld(env.DB, w2); } catch { /* не критично */ } return json({ ok: false, error: e.message, ...(await view(env, w2, now)) }); }
        return json({ ok: false, error: e.message });
      }
      try {
        await saveWorld(env.DB, w, { op: { tgId: user.id, opId, type, result: { ok: true, result }, at: now } });
        return json({ ok: true, result, ...(await view(env, w, now)) });
      } catch (e) {
        if (!(e instanceof ConflictError)) throw e;
        const again = await env.DB.prepare('SELECT result FROM ops WHERE tg_id = ?1 AND op_id = ?2').bind(user.id, opId).first<{ result: string }>();
        if (again) return replay(env, user.id, now, JSON.parse(again.result));
      }
    }
    return json({ ok: false, error: 'Сервер занят, попробуй ещё раз' }, 409);
  }
  return json({ ok: false, error: 'Not found' }, 404);
}

// Повтор уже выполненной команды: возвращаем сохранённый результат и свежее состояние, ничего не применяя.
async function replay(env: Env, tgId: number, now: number, saved: Record<string, unknown>) {
  const w = await loadWorld(env.DB, tgId);
  if (!w) return json({ ...saved, replay: true });
  G.advance(w, now);
  try { await saveWorld(env.DB, w); } catch (e) { if (!(e instanceof ConflictError)) throw e; }
  return json({ ...saved, replay: true, ...(await view(env, w, now)) });
}

async function createCompany(env: Env, user: TgUser, body: Record<string, unknown>, opId: string, now: number) {
  let name: string;
  try { name = G.validateName((body.args as Record<string, unknown>)?.name); } catch (e) { return json({ ok: false, error: (e as Error).message }); }
  if (await loadWorld(env.DB, user.id)) return json({ ok: false, error: 'Мастерская уже открыта' });
  const w = G.createCompany(crypto.randomUUID(), user.id, name, now);
  try {
    await saveWorld(env.DB, w, { isNew: true, op: { tgId: user.id, opId, type: 'create_company', result: { ok: true }, at: now } });
  } catch (e) {
    if (!(e instanceof ConflictError)) throw e;
    if (/name_norm/.test(e.message)) return json({ ok: false, error: 'Такое название уже занято' });
    const saved = await env.DB.prepare('SELECT result FROM ops WHERE tg_id = ?1 AND op_id = ?2').bind(user.id, opId).first<{ result: string }>();
    if (saved) return replay(env, user.id, now, JSON.parse(saved.result));
    return json({ ok: false, error: 'Мастерская уже открыта' });
  }
  await env.DB.prepare("INSERT INTO audit_log (actor, action, data, at) VALUES (?1, 'create_company', ?2, ?3)").bind(user.id, name, now).run();
  return json({ ok: true, ...(await view(env, w, now)) });
}

// Начать заново можно только после банкротства. Старая компания остаётся в базе со статусом closed.
async function restart(env: Env, user: TgUser, opId: string, now: number) {
  const w = await loadWorld(env.DB, user.id);
  if (!w || w.c.status !== 'bankrupt') return json({ ok: false, error: 'Начать заново можно только после банкротства' });
  await env.DB.batch([
    env.DB.prepare("UPDATE companies SET status = 'closed' WHERE id = ?1 AND status = 'bankrupt'").bind(w.c.id),
    env.DB.prepare('INSERT OR IGNORE INTO ops (tg_id, op_id, type, result, at) VALUES (?1, ?2, ?3, ?4, ?5)').bind(user.id, opId, 'restart', JSON.stringify({ ok: true }), now),
    env.DB.prepare("INSERT INTO audit_log (actor, action, data, at) VALUES (?1, 'restart', ?2, ?3)").bind(user.id, w.c.id, now),
  ]);
  return json({ ok: true, company: null, build: BUILD, now });
}

function catalog() {
  return {
    stages: STAGES, tools: Object.values(TOOL), jobs: Object.values(JOB).map(({ parts: _p, ...j }) => j), parts: Object.values(PART),
    suppliers: SUPPLIERS, ads: ADS, priceLevels: PRICE_LEVELS, grades: GRADES,
    prices: Object.fromEntries(Object.values(PART).flatMap(p => (['eco', 'orig'] as const).map(g => [`${p.id}|${g}`, partPrice(p.id, g)]))),
  };
}

export interface Release { version: string; date: string; title: string; added: string[]; fixed: string[]; min_supported: string }
export function releaseInfo(postUrl: string | null) {
  const latest = (releases as Release[])[0];
  return { ...latest, build: BUILD, telegram_url: postUrl };
}
async function releasePostUrl(env: Env) {
  if (!env.CHANNEL_USERNAME) return null;
  const r = await env.DB.prepare("SELECT message_id FROM telegram_posts WHERE kind = 'release' AND ref = ?1 AND status = 'sent'").bind((releases as Release[])[0].version).first<{ message_id: number }>();
  return r?.message_id ? `https://t.me/${env.CHANNEL_USERNAME}/${r.message_id}` : null;
}
