// Интеграционные тесты API на локальном D1 (тот же движок, что в Cloudflare).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import { readFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleApi, type Env } from '../src/worker/api';
import { signInitData } from '../src/worker/auth';

const BOT_TOKEN = '123456:test-token';
let env: Env, dispose: () => Promise<void>;

beforeAll(async () => {
  mkdirSync('dist', { recursive: true });
  const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: 'wrangler.toml', persist: { path: mkdtempSync(join(tmpdir(), 'autocrew-d1-')) } });
  dispose = proxy.dispose;
  const sql = readFileSync('migrations/0001_init.sql', 'utf8').replace(/--.*$/gm, '');
  for (const stmt of sql.split(';').map(s => s.trim()).filter(Boolean)) await proxy.env.DB.prepare(stmt).run();
  env = { DB: proxy.env.DB, BOT_TOKEN, RATE_LIMIT: '0' };
}, 60_000);
afterAll(async () => { await dispose?.(); });

let opN = 0;
const opId = () => `test-op-${Date.now()}-${++opN}`;
async function call(path: string, user: number | null, body: unknown = {}, initData?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (user !== null) headers.authorization = 'tma ' + (initData ?? await signInitData({ id: user, first_name: 'U' + user }, BOT_TOKEN));
  const res = await handleApi(new Request('https://x' + path, { method: 'POST', headers, body: JSON.stringify(body) }), env, path);
  return { status: res.status, body: await res.json() as any };
}
const cmd = (user: number, type: string, args: unknown = {}, op = opId()) => call('/api/cmd', user, { type, args, op_id: op });
const ledgerSum = async (user: number) => (await env.DB.prepare('SELECT SUM(l.amount) s FROM ledger l JOIN companies c ON c.id = l.company_id WHERE c.owner_tg_id = ?1').bind(user).first<{ s: number }>())!.s;

describe('ограничение частоты', () => {
  it('больше 12 запросов за 2 секунды от одного игрока — 429', async () => {
    const limited = { ...env, RATE_LIMIT: undefined };
    const initData = await signInitData({ id: 77 }, BOT_TOKEN);
    const codes: number[] = [];
    for (let i = 0; i < 14; i++) {
      const res = await handleApi(new Request('https://x/api/state', { method: 'POST', headers: { authorization: 'tma ' + initData }, body: '{}' }), limited, '/api/state');
      codes.push(res.status);
    }
    expect(codes.slice(0, 12).every(c => c === 200)).toBe(true);
    expect(codes.at(-1)).toBe(429);
  });
});

describe('авторизация', () => {
  it('без подписи Telegram — 401', async () => {
    expect((await call('/api/state', null)).status).toBe(401);
  });
  it('поддельная подпись — 401', async () => {
    const good = await signInitData({ id: 5 }, BOT_TOKEN);
    const forged = good.replace(/%22id%22%3A5/, '%22id%22%3A6');
    expect(forged).not.toBe(good);
    expect((await call('/api/state', 5, {}, forged)).status).toBe(401);
  });
  it('подпись другим токеном — 401', async () => {
    const other = await signInitData({ id: 5 }, '999:other');
    expect((await call('/api/state', 5, {}, other)).status).toBe(401);
  });
  it('просроченная подпись — 401', async () => {
    const old = await signInitData({ id: 5 }, BOT_TOKEN, Math.floor(Date.now() / 1000) - 2 * 86400);
    expect((await call('/api/state', 5, {}, old)).status).toBe(401);
  });
});

describe('мастерская', () => {
  it('новый игрок без мастерской, создание, повтор и занятое название', async () => {
    expect((await call('/api/state', 10)).body.company).toBeNull();
    const op = opId();
    const r = await cmd(10, 'create_company', { name: 'Ржавый болт' }, op);
    expect(r.body.ok).toBe(true);
    expect(r.body.company.cash).toBe(60_000);
    const again = await cmd(10, 'create_company', { name: 'Ржавый болт' }, op);
    expect(again.body.replay).toBe(true);
    expect((await cmd(11, 'create_company', { name: 'ржавый  БОЛТ' })).body.error).toMatch('занято');
    expect((await cmd(10, 'create_company', { name: 'Второй' })).body.error).toMatch('уже открыта');
    expect(await ledgerSum(10)).toBe(60_000);
  });

  it('повтор команды с тем же op_id не списывает деньги дважды', async () => {
    const op = opId();
    const a = await cmd(10, 'buy_tool', { tool_id: 'wrench_set' }, op);
    expect(a.body.ok).toBe(true);
    const b = await cmd(10, 'buy_tool', { tool_id: 'wrench_set' }, op);
    expect(b.body.replay).toBe(true);
    expect(b.body.company.cash).toBe(60_000 - 6500);
    expect(await ledgerSum(10)).toBe(60_000 - 6500);
  });

  it('параллельные одинаковые команды с разными op_id применяются один раз', async () => {
    const rs = await Promise.all([1, 2, 3].map(() => cmd(10, 'buy_tool', { tool_id: 'drain_pan' })));
    expect(rs.filter(r => r.body.ok).length).toBe(1);
    const tools = await env.DB.prepare("SELECT COUNT(*) n FROM tools WHERE tool_id = 'drain_pan'").first<{ n: number }>();
    expect(tools!.n).toBe(1);
    const cash = (await call('/api/state', 10)).body.company.cash;
    expect(cash).toBe(60_000 - 6500 - 1200);
    expect(await ledgerSum(10)).toBe(cash);
  });

  it('устаревшая запись отклоняется защитой версий', async () => {
    const c = await env.DB.prepare('SELECT id, version FROM companies WHERE owner_tg_id = 10').first<{ id: string; version: number }>();
    const stale = env.DB.prepare('INSERT INTO company_versions (company_id, version, ok) VALUES (?1, ?2, (SELECT version FROM companies WHERE id = ?1) = ?3)').bind(c!.id, c!.version + 50, c!.version - 1);
    const write = env.DB.prepare("INSERT INTO ledger (company_id, at, day, amount, category) VALUES (?1, 0, '2026-01-01', 1000000, 'hack')").bind(c!.id);
    await expect(env.DB.batch([stale, write])).rejects.toThrow();
    const hack = await env.DB.prepare("SELECT COUNT(*) n FROM ledger WHERE category = 'hack'").first<{ n: number }>();
    expect(hack!.n).toBe(0);
  });

  it('ошибка правил возвращает понятный текст и не меняет кассу', async () => {
    const before = (await call('/api/state', 10)).body.company.cash;
    const r = await cmd(10, 'buy_tool', { tool_id: 'jack' });
    expect(r.body.ok).toBe(false);
    expect(r.body.error).toMatch('ступень');
    expect(r.body.company.cash).toBe(before);
    expect((await cmd(10, 'nope')).status).toBe(400);
    expect((await call('/api/cmd', 10, { type: 'buy_tool', args: {} })).status).toBe(400);
  });

  it('скрытое не уходит клиенту: работы до осмотра и реальный срок доставки', async () => {
    const r = await cmd(10, 'order_parts', { supplier_id: 'corner', lines: [{ part_id: 'engine_oil', grade: 'orig', qty: 1 }] });
    expect(r.body.ok).toBe(true);
    expect(r.body.deliveries[0].eta).toBeUndefined();
    expect(r.body.deliveries[0].eta_promised).toBeGreaterThan(Date.now());
    const now = Date.now();
    await env.DB.prepare(`INSERT INTO repair_orders (company_id, id, arrived_at, leave_at, customer, sens, car, symptom, job_types, inspected, status)
      SELECT id, 'jtest', ?1, ?2, 'Иван', 1, '{"model":"ladya_granda","year":2015,"mileage":150000,"color":"#fff"}', 'Стучит', '["spark_plugs"]', 0, 'waiting' FROM companies WHERE owner_tg_id = 10`).bind(now, now + 3600_000).run();
    const s = (await call('/api/state', 10)).body;
    const j = s.jobs.find((x: any) => x.id === 'jtest');
    expect(j.job_types).toEqual([]);
    expect(j.quotes).toBeNull();
    const ins = await cmd(10, 'inspect', { job_id: 'jtest' });
    expect(ins.body.jobs.find((x: any) => x.id === 'jtest').job_types).toEqual(['spark_plugs']);
  });
});
