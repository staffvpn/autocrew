// Бот AUTO CREW: открытие игры, админ-команды и публикация в канал с обязательным одобрением.
import { adminIds } from './auth';
import { json, releaseInfo, type Env, type Release } from './api';
import releases from '../../releases.json';

export async function tgApi(env: Env, method: string, body: unknown) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  return r.json() as Promise<{ ok: boolean; result?: any; description?: string }>;
}

const esc = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
const appUrl = (env: Env, origin: string) => env.APP_URL || origin;

// Текст поста строится только из releases.json: нет релиза — нет поста.
export function releasePostText(r: Release) {
  return [
    `<b>AUTO CREW ${esc(r.version)}: ${esc(r.title)}</b>`, '',
    ...(r.added.length ? ['<b>Добавлено</b>', ...r.added.map(x => '— ' + esc(x)), ''] : []),
    ...(r.fixed.length ? ['<b>Исправлено</b>', ...r.fixed.map(x => '— ' + esc(x)), ''] : []),
    'Начал с ржавого гаража. Закончил собственной автомобильной империей.',
  ].join('\n');
}

export async function handleTelegram(req: Request, env: Env, path: string): Promise<Response> {
  const origin = new URL(req.url).origin;
  if (path === '/tg/setup') {
    if (!env.WEBHOOK_SECRET || new URL(req.url).searchParams.get('key') !== env.WEBHOOK_SECRET) return json({ ok: false }, 403);
    const webhook = await tgApi(env, 'setWebhook', { url: origin + '/tg/webhook', secret_token: env.WEBHOOK_SECRET, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true });
    const menu = await tgApi(env, 'setChatMenuButton', { menu_button: { type: 'web_app', text: 'Играть', web_app: { url: appUrl(env, origin) } } });
    const cmds = await tgApi(env, 'setMyCommands', { commands: [{ command: 'start', description: 'Открыть гараж' }] });
    return json({ ok: webhook.ok && menu.ok, webhook, menu, cmds });
  }
  if (path !== '/tg/webhook' || req.method !== 'POST') return json({ ok: false }, 404);
  if (!env.WEBHOOK_SECRET || req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) return json({ ok: false }, 403);
  let upd: any;
  try { upd = await req.json(); } catch { return json({ ok: true }); }
  const admins = adminIds(env);

  if (upd.callback_query) {
    const q = upd.callback_query, data = String(q.data || '');
    if (!admins.includes(q.from?.id)) { await tgApi(env, 'answerCallbackQuery', { callback_query_id: q.id, text: 'Нет прав' }); return json({ ok: true }); }
    const m = data.match(/^post:(send|cancel):(\d+)$/);
    let text = 'Готово';
    if (m) text = m[1] === 'send' ? await sendPost(env, Number(m[2]), q.from.id, origin) : await cancelPost(env, Number(m[2]), q.from.id);
    await tgApi(env, 'answerCallbackQuery', { callback_query_id: q.id, text });
    if (q.message) await tgApi(env, 'editMessageReplyMarkup', { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } });
    return json({ ok: true });
  }

  const msg = upd.message;
  if (!msg?.text) return json({ ok: true });
  const chat = msg.chat.id, from = msg.from?.id, text = String(msg.text).trim();
  if (text.startsWith('/start')) {
    await tgApi(env, 'sendMessage', { chat_id: chat,
      text: 'AUTO CREW — автомобильный бизнес с нуля. Старый гараж, 60 000 ₽ и ни одного клиента. Дальше всё зависит от тебя. 18+',
      reply_markup: { inline_keyboard: [[{ text: 'Открыть гараж', web_app: { url: appUrl(env, origin) } }]] } });
  } else if (text === '/admin' && admins.includes(from)) {
    const st = await env.DB.batch([
      env.DB.prepare('SELECT COUNT(*) n FROM players'),
      env.DB.prepare("SELECT COUNT(*) n, COALESCE(SUM(cash),0) cash, COALESCE(SUM(orders_done),0) orders FROM companies WHERE status = 'active'"),
      env.DB.prepare('SELECT COUNT(*) n FROM players WHERE last_seen > ?1').bind(Date.now() - 86400_000),
    ]);
    const p = st[0].results[0] as any, c = st[1].results[0] as any, a = st[2].results[0] as any;
    const r = releaseInfo(null);
    await tgApi(env, 'sendMessage', { chat_id: chat, parse_mode: 'HTML', text: [
      '<b>AUTO CREW — админка</b>', '',
      `Игроков: ${p.n}, активных за сутки: ${a.n}`,
      `Мастерских: ${c.n}, деньги у всех: ${Math.round(c.cash).toLocaleString('ru-RU')} ₽, заказов выполнено: ${c.orders}`,
      `Версия: ${r.version} (${r.build.id})`, '',
      '/release_post — подготовить пост о текущем релизе',
    ].join('\n') });
  } else if (text === '/release_post' && admins.includes(from)) {
    await draftReleasePost(env, chat, from);
  }
  return json({ ok: true });
}

async function draftReleasePost(env: Env, chat: number, admin: number) {
  const r = (releases as Release[])[0];
  const exists = await env.DB.prepare("SELECT id, status FROM telegram_posts WHERE kind = 'release' AND ref = ?1 AND status != 'cancelled'").bind(r.version).first<{ id: number; status: string }>();
  if (exists?.status === 'sent') { await tgApi(env, 'sendMessage', { chat_id: chat, text: `Пост о версии ${r.version} уже опубликован.` }); return; }
  const body = releasePostText(r);
  let id = exists?.id;
  if (!id) {
    const ins = await env.DB.prepare("INSERT INTO telegram_posts (kind, ref, body, status, created_at) VALUES ('release', ?1, ?2, 'draft', ?3) RETURNING id").bind(r.version, body, Date.now()).first<{ id: number }>();
    id = ins!.id;
  } else await env.DB.prepare('UPDATE telegram_posts SET body = ?2 WHERE id = ?1').bind(id, body).run();
  await env.DB.prepare("INSERT INTO audit_log (actor, action, data, at) VALUES (?1, 'post_draft', ?2, ?3)").bind(admin, String(id), Date.now()).run();
  await tgApi(env, 'sendMessage', { chat_id: chat, parse_mode: 'HTML', text: '<i>Предпросмотр поста для канала:</i>\n\n' + body,
    reply_markup: { inline_keyboard: [[{ text: 'Опубликовать', callback_data: `post:send:${id}` }, { text: 'Отменить', callback_data: `post:cancel:${id}` }]] } });
}

async function sendPost(env: Env, id: number, admin: number, origin: string) {
  if (!env.CHANNEL_ID) return 'Не задан CHANNEL_ID';
  // Захватываем черновик атомарно, чтобы двойное нажатие не отправило пост дважды.
  const claimed = await env.DB.prepare("UPDATE telegram_posts SET attempts = attempts + 1, status = 'sent' WHERE id = ?1 AND status IN ('draft', 'failed') RETURNING body").bind(id).first<{ body: string }>();
  if (!claimed) return 'Уже отправлен или отменён';
  const r = await tgApi(env, 'sendMessage', { chat_id: env.CHANNEL_ID, parse_mode: 'HTML', text: claimed.body,
    reply_markup: { inline_keyboard: [[{ text: 'Играть', url: env.APP_URL || origin }]] } });
  if (!r.ok) {
    await env.DB.prepare("UPDATE telegram_posts SET status = 'failed', last_error = ?2 WHERE id = ?1").bind(id, r.description || 'error').run();
    return 'Ошибка: ' + (r.description || 'неизвестно').slice(0, 150);
  }
  await env.DB.batch([
    env.DB.prepare('UPDATE telegram_posts SET message_id = ?2, sent_at = ?3, last_error = NULL WHERE id = ?1').bind(id, r.result.message_id, Date.now()),
    env.DB.prepare("INSERT INTO audit_log (actor, action, data, at) VALUES (?1, 'post_send', ?2, ?3)").bind(admin, String(id), Date.now()),
  ]);
  return 'Опубликовано';
}

async function cancelPost(env: Env, id: number, admin: number) {
  const r = await env.DB.prepare("UPDATE telegram_posts SET status = 'cancelled' WHERE id = ?1 AND status IN ('draft', 'failed')").bind(id).run();
  await env.DB.prepare("INSERT INTO audit_log (actor, action, data, at) VALUES (?1, 'post_cancel', ?2, ?3)").bind(admin, String(id), Date.now()).run();
  return r.meta.changes ? 'Отменено' : 'Уже обработан';
}
