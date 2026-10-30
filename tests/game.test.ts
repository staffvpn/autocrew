import { describe, it, expect } from 'vitest';
import * as G from '../src/worker/game';
import { STAGES, START_CAPITAL, JOB } from '../src/shared/content';
import { nextMidnight } from '../src/shared/time';

const T0 = Date.UTC(2026, 9, 30, 6, 0, 0); // 09:00 по Москве
const H = 3600_000;

// Копия состояния после записи: как будто мир заново загрузили из базы.
function reload(w: G.World): G.World {
  const x = G.newWorld(structuredClone(w.c));
  for (const [k, v] of w.tools) x.tools.set(k, structuredClone(v));
  for (const [k, v] of w.stock) x.stock.set(k, structuredClone(v));
  for (const [k, v] of w.jobs) if (['waiting', 'accepted', 'in_progress'].includes(v.status) || (v.complaint_at && !v.complaint_done)) x.jobs.set(k, structuredClone(v));
  for (const [k, v] of w.pos) if (v.status === 'pending') x.pos.set(k, structuredClone(v));
  return x;
}
const ledgerSum = (ws: G.World[]) => ws.reduce((s, w) => s + w.ledger.reduce((a, l) => a + l.amount, 0), 0);
function starter(id = 'c1') {
  const w = G.createCompany(id, 1, 'Тест', T0);
  for (const t of ['wrench_set', 'filter_wrench', 'drain_pan', 'plug_wrench']) G.cmdBuyTool(w, T0, t);
  return w;
}

describe('создание компании', () => {
  it('стартовый капитал проходит через журнал', () => {
    const w = G.createCompany('c1', 1, 'Гараж', T0);
    expect(w.c.cash).toBe(START_CAPITAL);
    expect(ledgerSum([w])).toBe(START_CAPITAL);
  });
  it('проверяет название', () => {
    expect(() => G.validateName('a')).toThrow(G.GameError);
    expect(() => G.validateName('<script>')).toThrow(G.GameError);
    expect(G.validateName('  Гараж   №7 ')).toBe('Гараж №7');
  });
});

describe('ход времени', () => {
  it('результат не зависит от того, как часто игрок заходит', () => {
    const a = starter(), b = starter();
    G.advance(a, T0 + 30 * H);
    let wb = b;
    for (let t = T0; t <= T0 + 30 * H; t += 7 * 60_000 + 13) { G.advance(wb, t); wb = Object.assign(reload(wb), { ledger: wb.ledger, feed: wb.feed }); }
    G.advance(wb, T0 + 30 * H);
    expect(wb.c.cash).toBe(a.c.cash);
    expect([...wb.jobs.keys()].sort()).toEqual([...a.jobs.keys()].filter(k => ['waiting', 'accepted', 'in_progress'].includes(a.jobs.get(k)!.status) || (a.jobs.get(k)!.complaint_at && !a.jobs.get(k)!.complaint_done)).sort());
  });

  it('клиенты приезжают только в рабочие часы', () => {
    const w = starter();
    G.advance(w, T0 + 3 * 24 * H);
    for (const j of w.jobs.values()) {
      const h = new Date(j.arrived_at + 3 * H).getUTCHours();
      expect(h).toBeGreaterThanOrEqual(8); expect(h).toBeLessThan(21);
    }
    expect(w.jobs.size).toBeGreaterThan(2);
  });

  it('в полночь списывается аренда, касса сходится с журналом', () => {
    const w = starter();
    const before = w.c.cash;
    G.advance(w, nextMidnight(T0) + 1);
    const rent = w.ledger.filter(l => l.category === 'rent' || l.category === 'utilities').reduce((s, l) => s + l.amount, 0);
    expect(rent).toBe(-(STAGES[0].rent + STAGES[0].utilities));
    expect(w.c.cash).toBe(START_CAPITAL + w.ledger.slice(1).reduce((s, l) => s + l.amount, 0));
    expect(before).toBeGreaterThan(w.c.cash - 1);
  });

  it('без работы долг растёт до банкротства, после этого расходы не списываются', () => {
    const w = G.createCompany('c2', 1, 'Банкрот', T0);
    G.advance(w, T0 + 120 * 24 * H); // дольше лимита офлайна: аренда всё равно списывается
    expect(w.c.status).toBe('bankrupt');
    expect(w.c.cash).toBeLessThan(-15_000);
    expect(w.c.cash).toBe(w.ledger.reduce((s, l) => s + l.amount, 0));
    const cash = w.c.cash;
    G.advance(w, T0 + 130 * 24 * H);
    expect(w.c.cash).toBe(cash);
  });
});

describe('заказ от приезда до оплаты', () => {
  it('осмотр, смета, запчасти, ремонт, оплата и налог', () => {
    let completed = 0;
    for (let n = 0; n < 40 && completed < 3; n++) {
      const w = starter('cyc' + n);
      let t = T0, job: G.JobRow | undefined;
      while (!job) { t += 15 * 60_000; G.advance(w, t); job = [...w.jobs.values()].find(j => j.status === 'waiting'); }
      expect(() => G.cmdQuote(w, t, job!.id, job!.job_types, 'low', 'orig')).toThrow('осмотри');
      G.cmdInspect(w, t, job.id);
      const types = [job.job_types[0]];
      if (JOB[types[0]].tools.some(id => !w.tools.has(id))) continue;
      const cashBefore = w.c.cash;
      if (!(G.cmdQuote(w, t, job.id, types, 'low', 'orig') as { accepted: boolean }).accepted) continue;
      expect(() => G.cmdStart(w, t, job!.id)).toThrow('Не хватает');
      const lines = G.jobParts(job).map(([part_id, qty]) => ({ part_id, grade: 'orig', qty }));
      G.cmdOrderParts(w, t, 'corner', lines, 'po_test');
      t += 5 * 60_000; G.advance(w, t);
      if (w.ledger.some(l => l.category === 'supplier_refund')) continue; // брак: деталей не хватит
      G.cmdStart(w, t, job.id);
      expect(() => G.cmdStart(w, t, job!.id)).toThrow();
      G.advance(w, job.done_at);
      expect(w.jobs.get(job.id)!.status).toBe('done');
      expect(w.c.orders_done).toBe(1);
      const paid = job.labor + job.parts_price;
      const purchase = lines.reduce((s, l) => s + G.poPrice('corner', l.part_id, 'orig') * l.qty, 0);
      const rent = w.ledger.filter(l => l.category === 'rent' || l.category === 'utilities').reduce((s, l) => s + l.amount, 0);
      expect(w.c.cash).toBe(cashBefore - purchase + paid - Math.round(paid * 0.06) - Math.round(job.labor * 0.04) + rent);
      expect(w.c.cash).toBe(w.ledger.reduce((s, l) => s + l.amount, 0));
      completed++;
    }
    expect(completed).toBe(3);
  });

  it('решение клиента по смете одно и то же при повторе', () => {
    const results = new Set<boolean>();
    for (let i = 0; i < 3; i++) {
      const w = starter();
      let t = T0, job: G.JobRow | undefined;
      while (!job) { t += 15 * 60_000; G.advance(w, t); job = [...w.jobs.values()].find(j => j.status === 'waiting'); }
      G.cmdInspect(w, t, job.id);
      results.add((G.cmdQuote(w, t, job.id, [job.job_types[0]], 'high', 'orig') as { accepted: boolean }).accepted);
    }
    expect(results.size).toBe(1);
  });
});

describe('ограничения', () => {
  it('нельзя тратить больше, чем есть', () => {
    const w = G.createCompany('c3', 1, 'Тест', T0);
    w.c.cash = 100;
    expect(() => G.cmdBuyTool(w, T0, 'wrench_set')).toThrow('Не хватает денег');
    expect(w.c.cash).toBe(100);
  });
  it('оптовый поставщик и инструмент второй ступени закрыты на старте', () => {
    const w = starter();
    expect(() => G.cmdOrderParts(w, T0, 'opt', [{ part_id: 'engine_oil', grade: 'orig', qty: 2 }], 'po1')).toThrow('не работает');
    expect(() => G.cmdBuyTool(w, T0, 'jack')).toThrow('ступень');
  });
  it('переход на ступень требует репутацию и заказы, а не только деньги', () => {
    const w = starter();
    w.c.cash = 10_000_000;
    expect(() => G.cmdUpgrade(w, T0)).toThrow('Репутация');
    w.c.reputation = 20; w.c.orders_done = 10;
    G.cmdUpgrade(w, T0);
    expect(w.c.stage).toBe(1);
    w.c.reputation = 999; w.c.orders_done = 999;
    expect(() => G.cmdUpgrade(w, T0)).toThrow('в разработке');
  });
  it('минимальный заказ у оптовика', () => {
    const w = starter();
    w.c.stage = 1;
    expect(() => G.cmdOrderParts(w, T0, 'opt', [{ part_id: 'bulb_h4', grade: 'eco', qty: 1 }], 'po1')).toThrow('Минимальный');
  });
  it('количество в заказе проверяется', () => {
    const w = starter();
    expect(() => G.cmdOrderParts(w, T0, 'corner', [{ part_id: 'engine_oil', grade: 'orig', qty: -5 }], 'po1')).toThrow();
    expect(() => G.cmdOrderParts(w, T0, 'corner', [{ part_id: 'engine_oil', grade: 'orig', qty: 1.5 }], 'po1')).toThrow();
    expect(() => G.cmdOrderParts(w, T0, 'corner', [{ part_id: 'gold', grade: 'orig', qty: 1 }], 'po1')).toThrow();
  });
});

describe('админы', async () => {
  const { adminIds } = await import('../src/worker/auth');
  it('объединяет секрет и открытый список', () => {
    expect(adminIds({ ADMIN_IDS: '111, 222', ADMINS: '432943377' })).toEqual([111, 222, 432943377]);
    expect(adminIds({ ADMINS: '432943377' })).toEqual([432943377]);
    expect(adminIds({})).toEqual([]);
  });
});

describe('реплики', async () => {
  const { LINES, voice, line } = await import('../src/shared/lines');
  const { rng } = await import('../src/shared/rng');
  const all = Object.values(LINES).flat();
  it('у каждой вставки есть жёсткий и мягкий вариант', () => {
    for (const s of all) for (const m of s.matchAll(/\{([^{}]*)\}/g)) if (/[а-яё]/i.test(m[1])) expect(m[1].split('|').length, s).toBe(2);
  });
  it('в мягком режиме не остаётся мата', () => {
    const bad = /(бля|ёб|еб[аы]|хрен|хер|сук[аи]|пизд|нахрен|охрен)/i;
    for (const s of all) expect(voice(s, false), s).not.toMatch(bad);
  });
  it('все подстановки заполняются', () => {
    const vars = { name: 'Иван', car: 'Ладья', symptom: 'Стучит', sum: '1 ₽', tool: 'Ключ', supplier: 'Опт', mins: 5, n: 1 };
    for (const key of Object.keys(LINES)) for (let i = 0; i < 20; i++) {
      const text = voice(line(key, rng(key + i), vars), true);
      expect(text, text).not.toMatch(/[{}|]/);
    }
  });
});
