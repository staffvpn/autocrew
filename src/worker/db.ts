// Загрузка и запись состояния компании. Вся запись идёт одним DB.batch (транзакция D1):
// либо применяется всё, либо ничего.
import { mskDay } from '../shared/time';
import { newWorld, type World, type Company, type JobRow, type PoRow } from './game';

export class ConflictError extends Error {}

const json = (v: unknown) => JSON.stringify(v);

export async function loadWorld(db: D1Database, tgId: number): Promise<World | null> {
  const c = await db.prepare("SELECT * FROM companies WHERE owner_tg_id = ?1 AND status != 'closed'").bind(tgId).first<Company & { name_norm: string }>();
  if (!c) return null;
  const [tools, stock, jobs, pos] = await db.batch([
    db.prepare('SELECT tool_id, wear, broken, bought_at FROM tools WHERE company_id = ?1').bind(c.id),
    db.prepare('SELECT part_id, grade, qty, avg_cost FROM inventory WHERE company_id = ?1').bind(c.id),
    // Нужны только живые заказы и те, по которым ещё может прийти претензия
    db.prepare(`SELECT * FROM repair_orders WHERE company_id = ?1
      AND (status IN ('waiting', 'accepted', 'in_progress') OR (complaint_at > 0 AND complaint_done = 0))`).bind(c.id),
    db.prepare("SELECT * FROM purchase_orders WHERE company_id = ?1 AND status = 'pending'").bind(c.id),
  ]);
  const { name_norm: _, ...company } = c;
  const w = newWorld(company);
  for (const t of tools.results as any[]) w.tools.set(t.tool_id, t);
  for (const s of stock.results as any[]) w.stock.set(`${s.part_id}|${s.grade}`, s);
  for (const j of jobs.results as any[]) {
    const { company_id: _c, ...row } = j;
    w.jobs.set(j.id, { ...row, car: JSON.parse(j.car), job_types: JSON.parse(j.job_types) } as JobRow);
  }
  for (const p of pos.results as any[]) {
    const { company_id: _c, ...row } = p;
    w.pos.set(p.id, { ...row, lines: JSON.parse(p.lines) } as PoRow);
  }
  return w;
}

export const normName = (name: string) => name.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]/gu, '');

// Строит пакет записи. isNew — компания только что создана (INSERT вместо UPDATE).
export function saveStatements(db: D1Database, w: World, opts: { isNew?: boolean; op?: { tgId: number; opId: string; type: string; result: unknown; at: number } } = {}) {
  const c = w.c, id = c.id;
  const prev = c.version;
  c.version = prev + 1;
  const st: D1PreparedStatement[] = [];
  // Первым идёт защита от гонок: если версия в базе уже не та, с которой мы начинали,
  // CHECK в company_versions падает и весь пакет откатывается (см. миграцию 0001).
  st.push(db.prepare('INSERT INTO company_versions (company_id, version, ok) VALUES (?1, ?2, (SELECT version FROM companies WHERE id = ?1) = ?3)').bind(id, c.version, prev));
  if (opts.op) st.push(db.prepare('INSERT INTO ops (tg_id, op_id, type, result, at) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(opts.op.tgId, opts.op.opId, opts.op.type, json(opts.op.result), opts.op.at));
  if (opts.isNew) {
    st.push(db.prepare(`INSERT INTO companies (id, owner_tg_id, name, name_norm, stage, cash, reputation, orders_done, version, tick_at, created_at, ad_id, ad_until, status)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`)
      .bind(id, c.owner_tg_id, c.name, normName(c.name), c.stage, c.cash, c.reputation, c.orders_done, c.version, c.tick_at, c.created_at, c.ad_id, c.ad_until, c.status));
  } else {
    st.push(db.prepare(`UPDATE companies SET stage = ?2, cash = ?3, reputation = ?4, orders_done = ?5, version = ?6, tick_at = ?7, ad_id = ?8, ad_until = ?9, status = ?10
      WHERE id = ?1 AND version = ?11`)
      .bind(id, c.stage, c.cash, c.reputation, c.orders_done, c.version, c.tick_at, c.ad_id, c.ad_until, c.status, prev));
  }
  st.push(db.prepare('DELETE FROM company_versions WHERE company_id = ?1 AND version < ?2').bind(id, c.version - 3));
  for (const k of w.dirty.tools) {
    const t = w.tools.get(k)!;
    st.push(db.prepare('INSERT OR REPLACE INTO tools (company_id, tool_id, wear, broken, bought_at) VALUES (?1, ?2, ?3, ?4, ?5)').bind(id, t.tool_id, t.wear, t.broken, t.bought_at));
  }
  for (const k of w.dirty.stock) {
    const s = w.stock.get(k)!;
    st.push(db.prepare('INSERT OR REPLACE INTO inventory (company_id, part_id, grade, qty, avg_cost) VALUES (?1, ?2, ?3, ?4, ?5)').bind(id, s.part_id, s.grade, s.qty, s.avg_cost));
  }
  for (const k of w.dirty.jobs) {
    const j = w.jobs.get(k)!;
    st.push(db.prepare(`INSERT OR REPLACE INTO repair_orders (company_id, id, arrived_at, leave_at, customer, sens, car, symptom, job_types, inspected, status,
      price_level, grade, labor, parts_price, parts_cost, started_at, done_at, complaint_at, complaint_done)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)`)
      .bind(id, j.id, j.arrived_at, j.leave_at, j.customer, j.sens, json(j.car), j.symptom, json(j.job_types), j.inspected, j.status,
        j.price_level, j.grade, j.labor, j.parts_price, j.parts_cost, j.started_at, j.done_at, j.complaint_at, j.complaint_done));
  }
  for (const k of w.dirty.pos) {
    const p = w.pos.get(k)!;
    st.push(db.prepare(`INSERT OR REPLACE INTO purchase_orders (company_id, id, supplier_id, lines, total, fee, ordered_at, eta_promised, eta, status)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`)
      .bind(id, p.id, p.supplier_id, json(p.lines), p.total, p.fee, p.ordered_at, p.eta_promised, p.eta, p.status));
  }
  for (const l of w.ledger) st.push(db.prepare('INSERT INTO ledger (company_id, at, day, amount, category, ref) VALUES (?1, ?2, ?3, ?4, ?5, ?6)').bind(id, l.at, mskDay(l.at), l.amount, l.category, l.ref));
  for (const f of w.feed.slice(-40)) st.push(db.prepare('INSERT INTO feed (company_id, at, kind, text) VALUES (?1, ?2, ?3, ?4)').bind(id, f.at, f.kind, f.text));
  if (w.feed.length) st.push(db.prepare('DELETE FROM feed WHERE company_id = ?1 AND id <= (SELECT id FROM feed WHERE company_id = ?1 ORDER BY id DESC LIMIT 1 OFFSET 100)').bind(id));
  return st;
}

export async function saveWorld(db: D1Database, w: World, opts: Parameters<typeof saveStatements>[2] = {}) {
  const st = saveStatements(db, w, opts);
  try {
    await db.batch(st);
  } catch (e) {
    const msg = String((e as Error).message || e);
    if (/UNIQUE|CHECK|constraint/i.test(msg)) throw new ConflictError(msg);
    throw e;
  }
}

export const hasChanges = (w: World) => w.ledger.length > 0 || w.feed.length > 0 || w.dirty.tools.size > 0 || w.dirty.stock.size > 0 || w.dirty.jobs.size > 0 || w.dirty.pos.size > 0;
