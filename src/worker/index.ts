// Точка входа Cloudflare Worker: API игры, бот и статические файлы клиента.
import { handleApi, json, type Env } from './api';
import { handleTelegram } from './telegram';

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const path = new URL(req.url).pathname;
    try {
      if (path.startsWith('/api/')) return await handleApi(req, env, path);
      if (path.startsWith('/tg/')) return await handleTelegram(req, env, path);
    } catch (e) {
      console.error(JSON.stringify({ path, error: String((e as Error)?.stack || e) }));
      return json({ ok: false, error: 'Ошибка сервера, попробуй ещё раз' }, 500);
    }
    return env.ASSETS ? env.ASSETS.fetch(req) : new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
