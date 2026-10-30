// Игровые правила AUTO CREW. Работают только на сервере над состоянием одной компании.
// Модуль не знает о базе: он меняет объекты в памяти и помечает изменённые строки,
// а db.ts записывает их одним атомарным пакетом.
import {
  STAGES, JOBS, JOB, PART, TOOL, SUPPLIER, AD, CAR_MODELS, CAR_COLORS, SYMPTOMS, CUSTOMER_NAMES, PRICE_LEVELS,
  NH_SECONDS, START_CAPITAL, TAX_RATE, CONSUMABLES_RATE, OPEN_HOUR, CLOSE_HOUR, SLOT_MS, MAX_OFFLINE_DAYS,
  BANKRUPT_CASH, REP_GOOD, REP_COMPLAINT, REP_LEFT, REP_SOFT, GRADES, partPrice, TOOL_REPAIR_K,
  type Grade, type Platform,
} from '../shared/content';
import { rng } from '../shared/rng';
import { mskDay, mskHour, nextMidnight, DAY_MS } from '../shared/time';

export interface Company {
  id: string; owner_tg_id: number; name: string; stage: number; cash: number; reputation: number;
  orders_done: number; version: number; tick_at: number; created_at: number;
  ad_id: string | null; ad_until: number; status: 'active' | 'bankrupt' | 'closed';
}
export interface ToolRow { tool_id: string; wear: number; broken: number; bought_at: number }
export interface StockRow { part_id: string; grade: Grade; qty: number; avg_cost: number }
export interface Car { model: string; year: number; mileage: number; color: string }
export interface JobRow {
  id: string; arrived_at: number; leave_at: number; customer: string; sens: number; car: Car; symptom: string;
  job_types: string[]; inspected: number;
  status: 'waiting' | 'accepted' | 'in_progress' | 'done' | 'left';
  price_level: string | null; grade: Grade | null; labor: number; parts_price: number; parts_cost: number;
  started_at: number; done_at: number; complaint_at: number; complaint_done: number;
}
export interface PoLine { part_id: string; grade: Grade; qty: number; unit: number }
export interface PoRow { id: string; supplier_id: string; lines: PoLine[]; total: number; fee: number; ordered_at: number; eta_promised: number; eta: number; status: 'pending' | 'delivered' }
export interface LedgerRow { at: number; amount: number; category: string; ref: string | null }
export interface FeedRow { at: number; kind: string; text: string }

export interface World {
  c: Company;
  tools: Map<string, ToolRow>;
  stock: Map<string, StockRow>;
  jobs: Map<string, JobRow>;
  pos: Map<string, PoRow>;
  dirty: { tools: Set<string>; stock: Set<string>; jobs: Set<string>; pos: Set<string> };
  ledger: LedgerRow[];
  feed: FeedRow[];
}

export class GameError extends Error {}
const fail = (msg: string): never => { throw new GameError(msg); };
const stockKey = (part: string, grade: Grade) => `${part}|${grade}`;
const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU').replace(/ |,/g, ' ') + ' ₽';
export const stage = (w: World) => STAGES[w.c.stage];

export function newWorld(c: Company): World {
  return { c, tools: new Map(), stock: new Map(), jobs: new Map(), pos: new Map(),
    dirty: { tools: new Set(), stock: new Set(), jobs: new Set(), pos: new Set() }, ledger: [], feed: [] };
}

// Все деньги проходят только через эту функцию: она меняет кассу и пишет проводку.
function money(w: World, at: number, amount: number, category: string, ref: string | null = null) {
  amount = Math.round(amount);
  if (!amount) return;
  w.c.cash += amount;
  w.ledger.push({ at, amount, category, ref });
}
const feed = (w: World, at: number, kind: string, text: string) => w.feed.push({ at, kind, text });
const touchJob = (w: World, j: JobRow) => { w.jobs.set(j.id, j); w.dirty.jobs.add(j.id); };
const repDelta = (w: World, base: number) => {
  w.c.reputation = Math.max(0, Math.min(1000, w.c.reputation + base * REP_SOFT / (REP_SOFT + w.c.reputation)));
};

// ---------- Создание компании ----------
export function createCompany(id: string, tgId: number, name: string, now: number): World {
  const w = newWorld({ id, owner_tg_id: tgId, name, stage: 0, cash: 0, reputation: 0, orders_done: 0, version: 0,
    tick_at: now, created_at: now, ad_id: null, ad_until: 0, status: 'active' });
  money(w, now, START_CAPITAL, 'start_capital');
  feed(w, now, 'info', `Ты снял старый гараж и назвал мастерскую «${name}». В кармане ${fmt(START_CAPITAL)}. Для начала купи инструмент: без ключей не сделать даже замену масла.`);
  return w;
}

export function validateName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  if (name.length < 2 || name.length > 32) fail('Название должно быть от 2 до 32 символов');
  if (!/^[\p{L}\p{N} «»"'.,&+\-№]+$/u.test(name)) fail('В названии можно использовать буквы, цифры, пробелы и простые знаки');
  return name;
}

// ---------- Ход времени ----------
// Догоняет мир от c.tick_at до now. События обрабатываются строго по порядку во времени,
// случайность берётся из ключей, привязанных ко времени, поэтому результат не зависит
// от того, как часто игрок заходит.
export function advance(w: World, now: number) {
  const c = w.c;
  if (c.status === 'closed' || now <= c.tick_at) return;
  // Долгое отсутствие: клиентов за давние дни не моделируем (к гаражу никто не подходил),
  // но аренду за каждые сутки списываем, чтобы отсутствие не было бесплатным.
  const skipTo = now - MAX_OFFLINE_DAYS * DAY_MS;
  if (c.tick_at < skipTo) {
    for (let m = nextMidnight(c.tick_at); m <= skipTo; m += DAY_MS) closeDay(w, m);
    for (const j of w.jobs.values()) if (j.status === 'waiting' || j.status === 'accepted') { j.status = 'left'; touchJob(w, j); }
    c.tick_at = skipTo;
  }
  let t = c.tick_at;
  for (let guard = 0; guard < 100_000; guard++) {
    const candidates = [Math.floor(t / SLOT_MS) * SLOT_MS + SLOT_MS, nextMidnight(t)];
    for (const j of w.jobs.values()) {
      if (j.status === 'in_progress') candidates.push(j.done_at);
      if ((j.status === 'waiting' || j.status === 'accepted')) candidates.push(j.leave_at);
      if (j.complaint_at && !j.complaint_done) candidates.push(j.complaint_at);
    }
    for (const p of w.pos.values()) if (p.status === 'pending') candidates.push(p.eta);
    const next = Math.max(t + 1, Math.min(...candidates.filter(x => x > t)));
    if (next > now) break;
    t = next;
    for (const j of [...w.jobs.values()]) {
      if (j.status === 'in_progress' && j.done_at === t) completeJob(w, j);
      if ((j.status === 'waiting' || j.status === 'accepted') && j.leave_at === t) customerLeaves(w, j);
      if (j.complaint_at === t && !j.complaint_done) complaint(w, j);
    }
    for (const p of [...w.pos.values()]) if (p.status === 'pending' && p.eta === t) deliver(w, p);
    if (t === nextMidnight(t - 1)) closeDay(w, t);
    if (t % SLOT_MS === 0) arrival(w, t);
  }
  c.tick_at = now;
}

export function demandPerDay(w: World, at: number) {
  const s = stage(w);
  const base = Math.min(s.demandCap, s.demandBase + w.c.reputation * s.demandK);
  const ad = w.c.ad_id && w.c.ad_until > at ? AD[w.c.ad_id].mult : 1;
  return base * ad;
}

function arrival(w: World, at: number) {
  if (w.c.status !== 'active') return;
  const h = mskHour(at);
  if (h < OPEN_HOUR || h >= CLOSE_HOUR) return;
  const slot = at / SLOT_MS;
  const r = rng(`arr:${w.c.id}:${slot}`);
  const slotsPerDay = (CLOSE_HOUR - OPEN_HOUR) * 3600_000 / SLOT_MS;
  if (!r.chance(demandPerDay(w, at) / slotsPerDay)) return;
  const queue = [...w.jobs.values()].filter(j => j.status === 'waiting' || j.status === 'accepted').length;
  if (queue >= stage(w).queueCap) return; // двор забит, клиент проехал мимо
  const available = JOBS.filter(j => j.stage <= w.c.stage);
  const main = r.weighted(available);
  const types = [main.id];
  const others = available.filter(j => j.id !== main.id);
  if (others.length && r.chance(0.25)) types.push(r.weighted(others).id);
  const model = r.weighted(CAR_MODELS);
  const year = r.int(model.years[0], model.years[1]);
  const age = Math.max(1, 2026 - year);
  const job: JobRow = {
    id: `j${slot}`, arrived_at: at, leave_at: at + r.int(150, 330) * 60_000,
    customer: r.pick(CUSTOMER_NAMES), sens: Math.round((0.6 + r.next() * 0.8) * 100) / 100,
    car: { model: model.id, year, mileage: Math.round(age * r.int(11, 24)) * 1000, color: r.pick(CAR_COLORS) },
    symptom: r.pick(SYMPTOMS[main.symptom]), job_types: types, inspected: 0, status: 'waiting',
    price_level: null, grade: null, labor: 0, parts_price: 0, parts_cost: 0, started_at: 0, done_at: 0, complaint_at: 0, complaint_done: 0,
  };
  touchJob(w, job);
  feed(w, at, 'customer', `Приехал ${job.customer} на ${modelName(job.car.model)}: «${job.symptom}»`);
}

export const modelName = (id: string) => CAR_MODELS.find(m => m.id === id)?.name ?? id;
export const platformOf = (car: Car) => CAR_MODELS.find(m => m.id === car.model)!.platform as Platform;

export function jobParts(j: JobRow, types = j.job_types): [string, number][] {
  const p = platformOf(j.car);
  const sum = new Map<string, number>();
  for (const t of types) for (const [part, qty] of JOB[t].parts(p)) sum.set(part, (sum.get(part) || 0) + qty);
  return [...sum];
}
export const jobNh = (types: string[]) => Math.round(types.reduce((s, t) => s + JOB[t].nh, 0) * 10) / 10;
export const jobTools = (types: string[]) => [...new Set(types.flatMap(t => JOB[t].tools))];

function customerLeaves(w: World, j: JobRow) {
  const angry = j.status === 'accepted';
  j.status = 'left'; touchJob(w, j);
  repDelta(w, angry ? REP_LEFT * 3 : REP_LEFT);
  feed(w, j.leave_at, 'bad', angry
    ? `${j.customer} не дождался ремонта и уехал. Обещал рассказать знакомым.`
    : `${j.customer} устал ждать и уехал в другой сервис.`);
}

function completeJob(w: World, j: JobRow) {
  const at = j.done_at;
  j.status = 'done'; touchJob(w, j);
  money(w, at, j.labor, 'labor', j.id);
  money(w, at, j.parts_price, 'parts_sale', j.id);
  money(w, at, -(j.labor + j.parts_price) * TAX_RATE, 'tax', j.id);
  money(w, at, -j.labor * CONSUMABLES_RATE, 'consumables', j.id);
  w.c.orders_done += 1;
  // Качество: аналоги и изношенный инструмент чаще приводят к претензии, хороший инструмент — реже.
  const used = jobTools(j.job_types).map(id => w.tools.get(id)).filter(Boolean) as ToolRow[];
  const wear = used.reduce((s, t) => s + t.wear, 0) / Math.max(1, used.length);
  const bonus = [...w.tools.values()].filter(t => !t.broken).reduce((s, t) => s + (TOOL[t.tool_id].quality || 0), 0);
  const pFail = Math.max(0.01, (j.grade === 'eco' ? 0.09 : 0.03) + wear * 0.04 - bonus);
  const r = rng(`quality:${w.c.id}:${j.id}`);
  if (r.chance(pFail)) j.complaint_at = at + r.int(2, 10) * 3600_000;
  else repDelta(w, REP_GOOD);
  feed(w, at, 'money', `${modelName(j.car.model)} готова. ${j.customer} заплатил ${fmt(j.labor + j.parts_price)}.`);
}

function complaint(w: World, j: JobRow) {
  j.complaint_done = 1; touchJob(w, j);
  // Гарантия: покупаем оригинальные детали в ближайшем магазине и переделываем бесплатно.
  const cost = jobParts(j).reduce((s, [part, qty]) => s + partPrice(part, 'orig') * SUPPLIER.corner.priceK * qty, 0);
  money(w, j.complaint_at, -cost, 'warranty', j.id);
  repDelta(w, REP_COMPLAINT);
  feed(w, j.complaint_at, 'bad', `${j.customer} вернулся с претензией по ${modelName(j.car.model)}. Переделали по гарантии за ${fmt(cost)}.`);
}

function deliver(w: World, p: PoRow) {
  p.status = 'delivered'; w.dirty.pos.add(p.id);
  const s = SUPPLIER[p.supplier_id];
  const r = rng(`po:${w.c.id}:${p.id}`);
  let refund = 0, defects = 0;
  for (const l of p.lines) {
    let bad = 0;
    for (let i = 0; i < l.qty; i++) if (r.chance(s.defect[l.grade])) bad++;
    const good = l.qty - bad;
    if (good) addStock(w, l.part_id, l.grade, good, l.unit);
    refund += bad * l.unit; defects += bad;
  }
  if (refund) money(w, p.eta, refund, 'supplier_refund', p.id);
  const late = p.eta > p.eta_promised ? `, опоздание ${Math.round((p.eta - p.eta_promised) / 60_000)} мин` : '';
  feed(w, p.eta, defects ? 'bad' : 'info', `Поставка от «${s.name}» на месте${late}.` + (defects ? ` Брак: ${defects} шт., вернули ${fmt(refund)}.` : ''));
}

function addStock(w: World, part: string, grade: Grade, qty: number, unit: number) {
  const k = stockKey(part, grade);
  const row = w.stock.get(k) || { part_id: part, grade, qty: 0, avg_cost: 0 };
  row.avg_cost = Math.round((row.avg_cost * row.qty + unit * qty) / (row.qty + qty));
  row.qty += qty;
  w.stock.set(k, row); w.dirty.stock.add(k);
}

function closeDay(w: World, at: number) {
  if (w.c.status !== 'active') return;
  const s = stage(w);
  money(w, at, -s.rent, 'rent');
  money(w, at, -s.utilities, 'utilities');
  feed(w, at, 'info', `Новый день. Списана аренда ${fmt(s.rent)} и коммунальные ${fmt(s.utilities)}.`);
  if (w.c.cash < BANKRUPT_CASH) {
    w.c.status = 'bankrupt';
    feed(w, at, 'bad', `Долг по аренде достиг ${fmt(-w.c.cash)}. Хозяин гаража сменил замок. Мастерская закрыта.`);
  }
}

// ---------- Команды игрока ----------
const job = (w: World, id: unknown) => w.jobs.get(String(id)) ?? fail('Заказ не найден');
const spend = (w: World, at: number, amount: number, category: string, ref: string | null = null) => {
  if (w.c.cash < amount) fail(`Не хватает денег: нужно ${fmt(amount)}`);
  money(w, at, -amount, category, ref);
};
const active = (w: World) => { if (w.c.status !== 'active') fail('Мастерская закрыта'); };

export function cmdBuyTool(w: World, now: number, toolId: unknown) {
  active(w);
  const t = TOOL[String(toolId)] ?? fail('Нет такого инструмента');
  if (t.stage > w.c.stage) fail('Пока негде применить: нужна следующая ступень');
  if (w.tools.has(t.id)) fail('Уже есть');
  spend(w, now, t.price, 'tools', t.id);
  w.tools.set(t.id, { tool_id: t.id, wear: 0, broken: 0, bought_at: now }); w.dirty.tools.add(t.id);
  feed(w, now, 'info', `Куплено: ${t.name}.`);
}

export function cmdRepairTool(w: World, now: number, toolId: unknown) {
  active(w);
  const row = w.tools.get(String(toolId)) ?? fail('Инструмента нет');
  if (row.wear < 0.5 && !row.broken) fail('Ремонт пока не нужен');
  const t = TOOL[row.tool_id];
  spend(w, now, Math.round(t.price * TOOL_REPAIR_K), 'tool_repair', t.id);
  row.wear = 0; row.broken = 0; w.dirty.tools.add(t.id);
  feed(w, now, 'info', `${t.name}: снова как новый.`);
}

export function cmdInspect(w: World, now: number, jobId: unknown) {
  active(w);
  const j = job(w, jobId);
  if (j.status !== 'waiting' || j.inspected) fail('Машину уже осмотрели');
  j.inspected = 1; touchJob(w, j);
}

export function quoteFor(w: World, j: JobRow, types: string[], level: string, grade: Grade) {
  const labor = Math.round(jobNh(types) * stage(w).laborRate * PRICE_LEVELS[level].k / 10) * 10;
  const parts = jobParts(j, types).reduce((s, [p, q]) => s + partPrice(p, grade) * q, 0);
  return { labor, parts };
}

// Решение клиента детерминировано: один бросок на заказ, переспросить нельзя.
export function acceptChance(w: World, j: JobRow, types: string[], level: string, grade: Grade) {
  const k = PRICE_LEVELS[level].k;
  const p = 0.97 - j.sens * (k - 0.85) * 1.5 - (types.length - 1) * 0.08 + (grade === 'eco' ? 0.04 : 0) + Math.min(0.06, w.c.reputation / 2000);
  return Math.max(0.05, Math.min(0.98, p));
}

export function cmdQuote(w: World, now: number, jobId: unknown, typesRaw: unknown, levelRaw: unknown, gradeRaw: unknown) {
  active(w);
  const j = job(w, jobId);
  if (j.status !== 'waiting') fail('Смету уже составили');
  if (!j.inspected) fail('Сначала осмотри машину');
  const level = String(levelRaw), grade = String(gradeRaw) as Grade;
  if (!PRICE_LEVELS[level]) fail('Неверная цена');
  if (!GRADES[grade]) fail('Неверное качество деталей');
  const types = Array.isArray(typesRaw) ? [...new Set(typesRaw.map(String))] : [];
  if (!types.includes(j.job_types[0])) fail('Основную работу нужно включить');
  if (types.some(t => !j.job_types.includes(t))) fail('Этой работы машине не нужно');
  const q = quoteFor(w, j, types, level, grade);
  const ok = rng(`quote:${w.c.id}:${j.id}`).chance(acceptChance(w, j, types, level, grade));
  j.price_level = level; j.grade = grade; j.labor = q.labor; j.parts_price = q.parts;
  if (ok) {
    j.job_types = types; j.status = 'accepted'; j.leave_at = Math.max(j.leave_at, now + 3 * 3600_000);
    feed(w, now, 'info', `${j.customer} согласен на ${fmt(q.labor + q.parts)} и готов подождать до 3 часов.`);
  } else {
    j.status = 'left'; j.leave_at = now;
    feed(w, now, 'bad', `${j.customer}: «${fmt(q.labor + q.parts)}? Нет, спасибо». Уехал.`);
  }
  touchJob(w, j);
  return { accepted: ok };
}

export function cmdSendAway(w: World, now: number, jobId: unknown) {
  active(w);
  const j = job(w, jobId);
  if (j.status !== 'waiting' && j.status !== 'accepted') fail('Клиент уже не ждёт');
  if (j.status === 'accepted') repDelta(w, REP_LEFT * 2);
  j.status = 'left'; j.leave_at = now; touchJob(w, j);
  feed(w, now, 'info', `Ты отказал клиенту ${j.customer}.`);
}

export function cmdStart(w: World, now: number, jobId: unknown) {
  active(w);
  const j = job(w, jobId);
  if (j.status !== 'accepted') fail('Сначала договорись с клиентом');
  const busy = [...w.jobs.values()].filter(x => x.status === 'in_progress').length;
  if (busy >= stage(w).bays) fail('Пост занят: ты работаешь над другой машиной');
  for (const id of jobTools(j.job_types)) {
    const t = w.tools.get(id);
    if (!t) fail(`Нужен инструмент: ${TOOL[id].name}`);
    if (t!.broken) fail(`Сломан инструмент: ${TOOL[id].name}`);
  }
  const grade = j.grade!;
  const need = jobParts(j);
  for (const [part, qty] of need) {
    const have = w.stock.get(stockKey(part, grade))?.qty || 0;
    if (have < qty) fail(`Не хватает: ${PART[part].name} (${GRADES[grade].name.toLowerCase()}), нужно ${qty}, есть ${have}`);
  }
  let cost = 0;
  for (const [part, qty] of need) {
    const row = w.stock.get(stockKey(part, grade))!;
    row.qty -= qty; cost += row.avg_cost * qty; w.dirty.stock.add(stockKey(part, grade));
  }
  for (const id of jobTools(j.job_types)) {
    const t = w.tools.get(id)!;
    t.wear = Math.min(1, Math.round((t.wear + 1 / TOOL[id].durability) * 10000) / 10000);
    if (t.wear >= 1) { t.broken = 1; feed(w, now, 'bad', `${TOOL[id].name} не выдержал. Нужен ремонт.`); }
    w.dirty.tools.add(id);
  }
  j.parts_cost = cost; j.status = 'in_progress'; j.started_at = now;
  j.done_at = now + Math.round(jobNh(j.job_types) * NH_SECONDS * 1000);
  touchJob(w, j);
}

export function poPrice(supplierId: string, part: string, grade: Grade) {
  return Math.round(partPrice(part, grade) * SUPPLIER[supplierId].priceK);
}

export function cmdOrderParts(w: World, now: number, supplierRaw: unknown, linesRaw: unknown, poId: string) {
  active(w);
  const s = SUPPLIER[String(supplierRaw)] ?? fail('Нет такого поставщика');
  if (s.stage > w.c.stage) fail('Этот поставщик пока с тобой не работает');
  if (!Array.isArray(linesRaw) || !linesRaw.length || linesRaw.length > 30) fail('Корзина пуста');
  const lines: PoLine[] = [];
  for (const l of linesRaw as Record<string, unknown>[]) {
    const part = String(l.part_id), grade = String(l.grade) as Grade, qty = Number(l.qty);
    if (!PART[part] || !GRADES[grade]) fail('Неизвестная деталь');
    if (!Number.isInteger(qty) || qty < 1 || qty > 50) fail('Количество от 1 до 50');
    lines.push({ part_id: part, grade, qty, unit: poPrice(s.id, part, grade) });
  }
  if ([...w.pos.values()].filter(p => p.status === 'pending').length >= 5) fail('Слишком много заказов в пути');
  const total = lines.reduce((sum, l) => sum + l.unit * l.qty, 0);
  if (total < s.minOrder) fail(`Минимальный заказ ${fmt(s.minOrder)}`);
  if (w.c.cash < total + s.fee) fail(`Не хватает денег: нужно ${fmt(total + s.fee)}`);
  money(w, now, -total, 'parts_purchase', poId);
  money(w, now, -s.fee, 'delivery', poId);
  const r = rng(`eta:${w.c.id}:${poId}`);
  const promised = now + s.deliveryMin * 60_000;
  const eta = r.chance(1 - s.reliability) ? promised + r.int(s.delayMin[0], s.delayMin[1]) * 60_000 : promised;
  const po: PoRow = { id: poId, supplier_id: s.id, lines, total, fee: s.fee, ordered_at: now, eta_promised: promised, eta, status: 'pending' };
  w.pos.set(po.id, po); w.dirty.pos.add(po.id);
  feed(w, now, 'info', `Заказ у «${s.name}» на ${fmt(total + s.fee)}. Ожидается через ${s.deliveryMin} мин.`);
}

export function cmdBuyAd(w: World, now: number, adRaw: unknown) {
  active(w);
  const ad = AD[String(adRaw)] ?? fail('Нет такой рекламы');
  if (ad.stage > w.c.stage) fail('Пока недоступно');
  if (w.c.ad_id && w.c.ad_until > now) fail('Реклама уже работает');
  spend(w, now, ad.price, 'ads', ad.id);
  w.c.ad_id = ad.id; w.c.ad_until = now + ad.hours * 3600_000;
  feed(w, now, 'info', `${ad.name}: клиентов будет больше ближайшие ${ad.hours} ч.`);
}

export function upgradeBlockers(w: World): string[] {
  const next = STAGES[w.c.stage + 1];
  if (!next) return ['Это последняя ступень'];
  const out: string[] = [];
  if (!next.available) out.push('Ступень ещё в разработке и откроется в следующем обновлении');
  if (w.c.reputation < next.needRep) out.push(`Репутация ${Math.floor(w.c.reputation)} из ${next.needRep}`);
  if (w.c.orders_done < next.needOrders) out.push(`Выполнено заказов ${w.c.orders_done} из ${next.needOrders}`);
  if (w.c.cash < next.cost) out.push(`Нужно ${fmt(next.cost)}`);
  return out;
}

export function cmdUpgrade(w: World, now: number) {
  active(w);
  const b = upgradeBlockers(w);
  if (b.length) fail(b.join('. '));
  const next = STAGES[w.c.stage + 1];
  spend(w, now, next.cost, 'upgrade', String(next.id));
  w.c.stage = next.id;
  feed(w, now, 'good', `Новая ступень: «${next.name}». ${next.desc}`);
}
