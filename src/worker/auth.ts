// Проверка подписи Telegram Mini App initData (HMAC-SHA256 по документации Telegram).
export interface TgUser { id: number; first_name?: string; username?: string; language_code?: string }

async function hmac(key: string | Uint8Array<ArrayBuffer>, data: string) {
  const raw = typeof key === 'string' ? new TextEncoder().encode(key) : key;
  const k = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data)));
}
const hex = (b: Uint8Array) => [...b].map(x => x.toString(16).padStart(2, '0')).join('');

export async function verifyInitData(initData: string, botToken: string, now = Date.now(), maxAgeSec = 86400): Promise<TgUser | null> {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const check = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = await hmac('WebAppData', botToken);
  if (hex(await hmac(secret, check)) !== hash) return null;
  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || now / 1000 - authDate > maxAgeSec) return null;
  try {
    const user = JSON.parse(params.get('user') || 'null');
    return user && Number.isInteger(user.id) ? user : null;
  } catch { return null; }
}

// Подписывает initData так же, как Telegram. Нужна для тестов и локальной разработки.
export async function signInitData(user: TgUser, botToken: string, authDate = Math.floor(Date.now() / 1000)) {
  const params = new URLSearchParams({ auth_date: String(authDate), user: JSON.stringify(user) });
  const check = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  params.set('hash', hex(await hmac(await hmac('WebAppData', botToken), check)));
  return params.toString();
}

// Админы: секрет ADMIN_IDS плюс открытый список ADMINS из wrangler.toml (Telegram ID не секрет).
export const adminIds = (env: { ADMIN_IDS?: string; ADMINS?: string }) =>
  `${env.ADMIN_IDS || ''},${env.ADMINS || ''}`.split(/[,\s]+/).map(Number).filter(n => Number.isInteger(n) && n > 0);
