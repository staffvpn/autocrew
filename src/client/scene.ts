// Пиксель-арт: гараж изнутри, 384×216. Статичный слой (стены, полки, пол) кэшируется
// и перерисовывается только при смене ступени, инструмента, времени суток или погоды.
// Поверх каждый кадр рисуются окно с погодой, ворота, машина, люди, кот и свет.
import type { Weather } from '../shared/weather';
import type { Body } from '../shared/content';

export const W = 384, H = 216;
const FLOOR = 150;

export type Pose = 'hood' | 'wheel' | 'under';
export interface SceneData {
  stage: number;
  hour: number;
  minute: number;
  weather: Weather;
  tools: string[];
  working: { color: string; progress: number; body: Body; old: boolean; pose: Pose; seed: number } | null;
  queue: { shirt: string; cap: boolean; flag: boolean }[];
}

type Ctx = CanvasRenderingContext2D;
const R = (c: Ctx, x: number, y: number, w: number, h: number, col: string) => { if (w <= 0 || h <= 0) return; c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
const hash = (i: number) => { let h = Math.imul(i ^ 0x9e3779b9, 2654435761); h ^= h >>> 15; h = Math.imul(h, 2246822519); return (h ^ (h >>> 13)) >>> 0; };
const toHex = (r: number, g: number, b: number) => '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const rgb = (c: string) => { const n = parseInt(c.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const shade = (c: string, k: number) => { const [r, g, b] = rgb(c); return toHex(r * k, g * k, b * k); };
const mix = (a: string, b: string, k: number) => { const x = rgb(a), y = rgb(b); return toHex(x[0] + (y[0] - x[0]) * k, x[1] + (y[1] - x[1]) * k, x[2] + (y[2] - x[2]) * k); };
const isNight = (h: number) => h < 7 || h >= 20;

// ---------- Люди: пиксельная фигура на суставах ----------
// Точки задаются относительно ступней (y вверх отрицательный), facing = 1 — смотрит вправо.
type P = [number, number];
export type Act = 'stand' | 'walk' | 'bench' | 'shelf' | 'phone' | 'hood' | 'wheel' | 'under';
interface Look { jacket: string; pants?: string; cap?: string | null; skin?: string; hair?: string; logo?: boolean }
interface Skel { hip: P; neck: P; head: P; kneeL: P; footL: P; kneeR: P; footR: P; elbowL: P; handL: P; elbowR: P; handR: P; back?: boolean; tool?: boolean }

function line(c: Ctx, a: P, b: P, w: number, col: string) {
  c.fillStyle = col;
  const steps = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), 1);
  const o = Math.floor(w / 2);
  for (let i = 0; i <= steps; i++) c.fillRect(Math.round(a[0] + (b[0] - a[0]) * i / steps) - o, Math.round(a[1] + (b[1] - a[1]) * i / steps) - o, w, w);
}

function skeleton(act: Act, t: number, phase: number): Skel {
  const s = Math.sin, ph = t / 1000 + phase;
  switch (act) {
    case 'walk': {
      const k = s(ph * 9), k2 = s(ph * 9 + Math.PI), bob = Math.abs(s(ph * 9)) * 0.8;
      return { hip: [0, -11 - bob], neck: [1, -21 - bob], head: [1.5, -25 - bob], kneeL: [k * 2.5 + 1, -6], footL: [k * 4, 0], kneeR: [k2 * 2.5 + 1, -6], footR: [k2 * 4, 0],
        elbowL: [-k * 2, -16 - bob], handL: [-k * 3.5, -12 - bob], elbowR: [-k2 * 2, -16 - bob], handR: [-k2 * 3.5, -12 - bob] };
    }
    case 'bench': { // спиной к нам, стучит молотком по верстаку
      const hit = Math.max(0, s(ph * 6)) * 4;
      return { back: true, tool: true, hip: [0, -11], neck: [0, -21], head: [0, -25.5], kneeL: [-2, -6], footL: [-2, 0], kneeR: [2, -6], footR: [2, 0],
        elbowL: [-4, -16], handL: [-3, -14], elbowR: [5, -18 - hit * 0.5], handR: [4, -17 - hit] };
    }
    case 'shelf': { // тянется к верхней полке
      const r = s(ph * 3) * 1.5;
      return { hip: [0, -11], neck: [0.5, -21], head: [1, -25.5], kneeL: [-1, -6], footL: [-2, 0], kneeR: [2, -6], footR: [2, 0],
        elbowL: [-3, -16], handL: [-3, -12], elbowR: [3, -26], handR: [4 + r, -31] };
    }
    case 'phone': {
      const shift = s(ph * 0.8) > 0.6 ? 1 : 0;
      return { hip: [shift, -11], neck: [shift, -21], head: [shift + 0.5, -25.5], kneeL: [-1.5, -6], footL: [-2, 0], kneeR: [2.5, -6], footR: [3, 0],
        elbowL: [-3 + shift, -15], handL: [-2 + shift, -12], elbowR: [3 + shift, -15], handR: [2 + shift, -19] };
    }
    case 'hood': { // наклонился в моторный отсек, руки работают
      const a = s(ph * 7) * 1.5, b2 = s(ph * 5 + 1) * 1.5;
      return { hip: [0, -11], neck: [5, -18], head: [7.5, -21], kneeL: [-1, -6], footL: [-2, 0], kneeR: [1.5, -6], footR: [1.5, 0],
        elbowL: [8, -15], handL: [12 + a, -18], elbowR: [9, -14], handR: [13 + b2, -15 + a * 0.5], tool: true };
    }
    case 'wheel': { // на корточках у колеса, крутит ключом
      const turn = s(ph * 8) * 2;
      return { hip: [-1, -6], neck: [3, -14], head: [5, -18], kneeL: [4, -8], footL: [3, 0], kneeR: [2, -7], footR: [-2, 0],
        elbowL: [6, -10], handL: [9, -11 + turn], elbowR: [6, -12], handR: [10, -9 - turn], tool: true };
    }
    case 'under': { // лежит на лежаке под машиной, торчат ноги, одно колено подгибается
      const knee = (Math.sin(ph * 1.3) + 1) / 2 * 5;
      return { hip: [0, -3], neck: [-12, -3], head: [-16, -3], kneeL: [5, -3 - knee], footL: [9 - knee * 0.6, -1], kneeR: [6, -3], footR: [12, -2],
        elbowL: [-8, -6], handL: [-6, -9 + s(ph * 6)], elbowR: [-9, -5], handR: [-7, -8], tool: true };
    }
    default: {
      const br = s(ph * 1.6) * 0.4;
      return { hip: [0, -11], neck: [0, -21 + br], head: [0.5, -25.5 + br], kneeL: [-1.5, -6], footL: [-2, 0], kneeR: [1.5, -6], footR: [2, 0],
        elbowL: [-3.5, -16], handL: [-3, -12], elbowR: [3.5, -16], handR: [3, -12] };
    }
  }
}

function figure(c: Ctx, x: number, ground: number, act: Act, t: number, look: Look, facing = 1, phase = 0) {
  const k = skeleton(act, t, phase);
  const P = (p: P): P => [x + p[0] * facing, ground + p[1]];
  const pants = look.pants || '#1e2633', skin = look.skin || '#d4a07a', ink = '#08090b';
  const boot = '#2a221c', jacketHi = shade(look.jacket, 1.35), jacketLo = shade(look.jacket, 0.7);
  const limbs = (col: string, outline: boolean) => {
    const o = outline ? 2 : 0;
    line(c, P(k.hip), P(k.kneeL), 3 + o, outline ? ink : shade(pants, 0.85)); line(c, P(k.kneeL), P(k.footL), 3 + o, outline ? ink : shade(pants, 0.85));
    line(c, P(k.hip), P(k.kneeR), 3 + o, outline ? ink : pants); line(c, P(k.kneeR), P(k.footR), 3 + o, outline ? ink : pants);
    line(c, P(k.neck), P(k.hip), 6 + o, outline ? ink : col);
    line(c, P(k.neck), P(k.elbowL), 2 + o, outline ? ink : jacketLo); line(c, P(k.elbowL), P(k.handL), 2 + o, outline ? ink : jacketLo);
  };
  limbs(look.jacket, true);
  limbs(look.jacket, false);
  // Блик и логотип на куртке
  const n = P(k.neck), h = P(k.hip);
  line(c, [n[0] - facing * 2, n[1] + 1], [h[0] - facing * 2, h[1] - 2], 1, jacketHi);
  if (look.logo && !k.back) { c.fillStyle = '#d8d8d8'; c.fillRect(Math.round(n[0] + facing), Math.round(n[1] + 3), 2, 1); }
  // Ремень
  line(c, [h[0] - 2, h[1]], [h[0] + 2, h[1]], 1, '#0e0f12');
  // Ботинки
  for (const f of [P(k.footL), P(k.footR)]) { c.fillStyle = ink; c.fillRect(Math.round(f[0]) - 2, Math.round(f[1]) - 2, 6, 3); c.fillStyle = boot; c.fillRect(Math.round(f[0]) - 1 + (facing > 0 ? 0 : -1), Math.round(f[1]) - 1, 4, 1); }
  // Ближняя рука поверх корпуса
  line(c, P(k.neck), P(k.elbowR), 4, ink); line(c, P(k.elbowR), P(k.handR), 4, ink);
  line(c, P(k.neck), P(k.elbowR), 2, look.jacket); line(c, P(k.elbowR), P(k.handR), 2, look.jacket);
  for (const hd of [P(k.handL), P(k.handR)]) { c.fillStyle = skin; c.fillRect(Math.round(hd[0]) - 1, Math.round(hd[1]) - 1, 2, 2); }
  if (k.tool) { const hd = P(k.handR); c.fillStyle = '#b8bec6'; c.fillRect(Math.round(hd[0]) + (facing > 0 ? 1 : -4), Math.round(hd[1]) - 1, 4, 1); }
  if (act === 'phone') { const hd = P(k.handR); c.fillStyle = '#101216'; c.fillRect(Math.round(hd[0]) - 1, Math.round(hd[1]) - 3, 2, 3); c.fillStyle = '#7ab0e0'; c.fillRect(Math.round(hd[0]) - 1, Math.round(hd[1]) - 2, 1, 1); }
  // Голова
  const hd = P(k.head), hx = Math.round(hd[0]) - 2, hy = Math.round(hd[1]) - 2;
  c.fillStyle = ink; c.fillRect(hx - 1, hy - 1, 7, 7);
  c.fillStyle = k.back ? (look.hair || '#2e2218') : skin; c.fillRect(hx, hy, 5, 5);
  if (!k.back) { c.fillStyle = '#1a120c'; c.fillRect(hx + (facing > 0 ? 3 : 1), hy + 2, 1, 1); c.fillStyle = shade(skin, 0.8); c.fillRect(hx, hy + 4, 5, 1); }
  if (look.cap) { c.fillStyle = ink; c.fillRect(hx - 1, hy - 2, 7, 3); c.fillStyle = look.cap; c.fillRect(hx, hy - 1, 5, 2); if (!k.back) { c.fillStyle = shade(look.cap, 0.7); c.fillRect(hx + (facing > 0 ? 4 : -2), hy + 1, 3, 1); } }
  else { c.fillStyle = look.hair || '#2e2218'; c.fillRect(hx, hy - 1, 5, 2); if (!k.back) c.fillRect(hx + (facing > 0 ? 0 : 4), hy, 1, 2); }
}

// Лежак механика под машиной
function creeper(c: Ctx, x: number, ground: number) {
  R(c, x - 18, ground - 3, 24, 2, '#3a2a1c'); R(c, x - 16, ground - 1, 2, 1, '#111'); R(c, x + 2, ground - 1, 2, 1, '#111');
}

// ---------- Пиксельный шрифт ----------
const F5: Record<string, string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'], U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'], O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'], R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'], W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
};
const F4: Record<string, string[]> = {
  'Е': ['####', '#...', '###.', '#...', '####'], 'З': ['###.', '...#', '.##.', '...#', '###.'], 'Д': ['.##.', '.#.#', '#..#', '####', '#..#'],
  'И': ['#..#', '#..#', '#.##', '##.#', '#..#'], 'Ч': ['#..#', '#..#', '.###', '...#', '...#'], 'Н': ['#..#', '#..#', '####', '#..#', '#..#'],
  'П': ['####', '#..#', '#..#', '#..#', '#..#'], 'О': ['.##.', '#..#', '#..#', '#..#', '.##.'], 'В': ['###.', '#..#', '###.', '#..#', '###.'],
  'Т': ['###.', '.#..', '.#..', '.#..', '.#..'], 'Р': ['###.', '#..#', '###.', '#...', '#...'], 'М': ['#..#', '####', '#..#', '#..#', '#..#'],
  'А': ['.##.', '#..#', '####', '#..#', '#..#'], 'С': ['.###', '#...', '#...', '#...', '.###'], 'Л': ['.###', '.#.#', '.#.#', '.#.#', '#..#'],
  ' ': ['....', '....', '....', '....', '....'],
};
function text(c: Ctx, x: number, y: number, s: string, col: string, font: Record<string, string[]>, scale = 1) {
  let cx = x;
  for (const ch of s) {
    const g = font[ch]; if (!g) { cx += 4 * scale; continue; }
    for (let r = 0; r < g.length; r++) for (let i = 0; i < g[r].length; i++) if (g[r][i] === '#') R(c, cx + i * scale, y + r * scale, scale, scale, col);
    cx += (g[0].length + 1) * scale;
  }
}

// ---------- Улица (окно и ворота) ----------
function skyColors(hour: number, minute: number, wx: Weather): [string, string] {
  const t = hour + minute / 60;
  const keys: [number, string, string][] = [
    [0, '#05080f', '#0c1220'], [5, '#0a1020', '#1a1d35'], [6.5, '#2a2850', '#a8604a'], [8, '#5a7aa8', '#c8a888'], [10, '#6a92c0', '#a8c4dc'],
    [16.5, '#6a92c0', '#a8c4dc'], [18.5, '#3a3266', '#e07a4a'], [20, '#1e1a40', '#7a3a58'], [21.5, '#080c18', '#141a30'], [24, '#05080f', '#0c1220'],
  ];
  let i = 0; while (keys[i + 1][0] <= t) i++;
  const [t0, a0, b0] = keys[i], [t1, a1, b1] = keys[i + 1];
  const k = (t - t0) / (t1 - t0);
  let top = mix(a0, a1, k), low = mix(b0, b1, k);
  if (wx !== 'clear') {
    const grey = wx === 'snow' ? '#8c929c' : '#525862', amount = t > 7 && t < 19.5 ? 0.62 : 0.3;
    top = mix(top, grey, amount); low = mix(low, grey, amount);
  }
  return [top, low];
}

function outside(c: Ctx, x: number, y: number, w: number, h: number, d: SceneData, t: number, street: boolean) {
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
  const [top, low] = skyColors(d.hour, d.minute, d.weather);
  for (let i = 0; i < h; i++) R(c, x, y + i, w, 1, mix(top, low, i / h));
  const night = isNight(d.hour);
  if (d.weather === 'clear') {
    if (night) for (let i = 0; i < 14; i++) { const hh = hash(i * 31 + x); R(c, x + (hh % w), y + ((hh >>> 9) % Math.floor(h * 0.45)), 1, 1, i % 4 ? '#b8c4dc' : '#ffffff'); }
    else R(c, x + w - 16, y + 6, 5, 5, '#fff2c0');
  } else {
    const cl = night ? '#1c2232' : d.weather === 'snow' ? '#b4bac2' : '#7a8088';
    for (let i = 0; i < 4; i++) { const cx = x + ((Math.floor(t / 300) + i * 37) % (w + 30)) - 20; R(c, cx, y + 4 + i * 4, 22, 4, cl); R(c, cx + 5, y + 2 + i * 4, 12, 2, cl); }
  }
  // Город: дальние дома с окнами, ближе — гаражи кооператива
  const far = night ? '#0e1220' : mix(low, '#3a4050', 0.6);
  for (let i = 0; i < 9; i++) {
    const hh = hash(i + 7), bw = 10 + (hh % 10), bh = 14 + ((hh >>> 5) % 22), bx = x + i * (w / 8) - 6;
    R(c, bx, y + h * 0.62 - bh, bw, bh + h, far);
    if (night) for (let wy = 3; wy < bh - 2; wy += 4) for (let wx = 2; wx < bw - 2; wx += 3) if (hash(i * 97 + wy * 13 + wx) % 5 === 0) R(c, bx + wx, y + h * 0.62 - bh + wy, 1, 2, '#e8b860');
  }
  const gy = y + Math.round(h * 0.62);
  R(c, x, gy, w, h, night ? '#14161c' : '#4a4e58');
  for (let gx = x + 2; gx < x + w; gx += 18) { R(c, gx, gy + 3, 14, h, night ? '#0e1014' : '#3a3e46'); R(c, gx, gy + 3, 14, 1, night ? '#1a1d24' : '#565a64'); }
  R(c, x, gy - 1, w, 1, d.weather === 'snow' ? '#e8edf2' : night ? '#20242c' : '#5a5e68');
  // Фонарь
  const lx = x + Math.round(w * 0.72), ly = y + Math.round(h * 0.3);
  R(c, lx, ly, 1, h, '#2a2e36'); R(c, lx - 3, ly, 6, 1, '#2a2e36');
  if (night) {
    R(c, lx - 3, ly + 1, 6, 1, '#ffd890');
    const g = c.createRadialGradient(lx, ly + 2, 0, lx, ly + 2, 22); g.addColorStop(0, 'rgba(255,210,140,.35)'); g.addColorStop(1, 'rgba(255,210,140,0)');
    c.fillStyle = g; c.fillRect(lx - 22, ly - 20, 44, 44);
  }
  if (street) {
    const road = d.weather === 'snow' ? '#c8ced6' : night ? '#121418' : '#34373e';
    R(c, x, y + h - 10, w, 10, road);
    if (d.weather === 'rain') for (let i = 0; i < 5; i++) R(c, x + (hash(i) % w), y + h - 8 + (i % 3) * 2, 6, 1, night ? '#2a3a4a' : '#5a6878');
  }
  if (d.weather === 'rain') {
    c.fillStyle = night ? 'rgba(150,170,200,.5)' : 'rgba(205,220,236,.6)';
    for (let i = 0; i < w * h / 30; i++) { const hh = hash(i * 7 + x); c.fillRect(x + ((hh % w) + Math.floor(t / 40)) % w, y + ((hh >>> 8) % h + Math.floor(t / 9)) % h, 1, 4); }
  }
  if (d.weather === 'snow') {
    c.fillStyle = '#f2f5f8';
    for (let i = 0; i < w * h / 45; i++) { const hh = hash(i * 13 + x); c.fillRect(x + ((hh % w) + Math.round(Math.sin(t / 800 + i) * 3) + w) % w, y + ((hh >>> 8) % h + Math.floor(t / 70)) % h, (hh & 3) ? 1 : 2, (hh & 3) ? 1 : 2); }
  }
  c.restore();
}

// ---------- Машина (вид сбоку, перед справа) ----------
interface BodySpec { L: number; roof: number; belt: number; g0: number; g1: number; ws: number; rs: number; wheel: number; r: number; hoodDrop: number; trunk: number }
const BODIES: Record<Body, BodySpec> = {
  classic: { L: 124, roof: 40, belt: 24, g0: 0.27, g1: 0.72, ws: 9, rs: 7, wheel: 0.2, r: 9, hoodDrop: 1, trunk: 0 },
  sedan: { L: 126, roof: 40, belt: 25, g0: 0.24, g1: 0.70, ws: 16, rs: 13, wheel: 0.19, r: 10, hoodDrop: 3, trunk: 2 },
  hatch: { L: 112, roof: 41, belt: 25, g0: 0.08, g1: 0.66, ws: 15, rs: 7, wheel: 0.17, r: 10, hoodDrop: 3, trunk: 0 },
  suv: { L: 104, roof: 46, belt: 29, g0: 0.08, g1: 0.68, ws: 9, rs: 3, wheel: 0.19, r: 11, hoodDrop: 1, trunk: 0 },
};

function car(c: Ctx, x0: number, ground: number, color: string, body: Body, old: boolean, pose: Pose | null, seed: number, lit: boolean) {
  const b = BODIES[body];
  const lift = pose === 'wheel' ? 7 : 0;
  const base = ground - lift; // нижняя кромка порога
  const sill = base - 6, beltY = base - b.belt, roofY = base - b.roof;
  const gx0 = x0 + Math.round(b.L * b.g0), gx1 = x0 + Math.round(b.L * b.g1);
  const hi = shade(color, 1.28), mid = color, lo = shade(color, 0.72), dk = shade(color, 0.5);
  const glass = lit ? '#2a3a4c' : '#141c26', glassHi = lit ? '#5a7488' : '#26323e';
  // Тень на полу
  c.fillStyle = 'rgba(0,0,0,.45)'; c.beginPath(); c.ellipse(x0 + b.L / 2, ground + 1, b.L / 2 + 6, 4, 0, 0, Math.PI * 2); c.fill();
  // Кузов по столбцам: от порога до линии капота/багажника
  for (let i = 0; i < b.L; i++) {
    const x = x0 + i;
    let top = beltY;
    if (i < 4) top = beltY + (4 - i);                          // скругление сзади
    if (i > b.L - 5) top = beltY + (i - (b.L - 5)) + b.hoodDrop; // скругление спереди
    else if (x > gx1) top = beltY + Math.round(b.hoodDrop * (x - gx1) / (x0 + b.L - gx1));
    if (x < gx0 && b.trunk) top = beltY - Math.round(b.trunk * (1 - (gx0 - x) / (gx0 - x0)));
    const bottom = i < 3 || i > b.L - 4 ? sill : base;
    R(c, x, top, 1, bottom - top, mid);
    R(c, x, top, 1, 1, hi);
    R(c, x, base - 9, 1, 3, lo);
    R(c, x, bottom - 1, 1, 1, dk);
  }
  // Крыша и стёкла
  for (let x = gx0; x <= gx1; x++) {
    const fromRear = x - gx0, toFront = gx1 - x;
    let top = roofY;
    if (fromRear < b.rs) top = roofY + Math.round((b.rs - fromRear) * (b.roof - b.belt) / b.rs);
    if (toFront < b.ws) top = roofY + Math.round((b.ws - toFront) * (b.roof - b.belt) / b.ws);
    if (body !== 'classic' && body !== 'suv') { const mid2 = (gx0 + gx1) / 2, span = (gx1 - gx0) / 2; top += Math.round(Math.pow(Math.abs(x - mid2) / span, 3) * 2); }
    R(c, x, top, 1, beltY - top + 1, mid);
    R(c, x, top, 1, 1, hi);
    // стекло: отступ 2 от крыши и кузова
    if (top + 2 < beltY - 1 && fromRear > 1 && toFront > 1) {
      R(c, x, top + 2, 1, beltY - top - 3, glass);
      if ((x + top) % 9 < 2) R(c, x, top + 3, 1, 3, glassHi);
    }
  }
  // Стойки
  const bp = Math.round((gx0 + gx1) / 2) + (body === 'hatch' ? 6 : 2);
  R(c, bp, roofY + 1, 3, b.roof - b.belt, body === 'classic' ? mid : '#16181c');
  R(c, gx1 - 1, roofY + 1, 1, b.roof - b.belt, lo);
  // Двери, ручки, молдинг
  for (const dx of [Math.round(b.L * 0.36), Math.round(b.L * 0.58)]) R(c, x0 + dx, beltY + 1, 1, base - beltY - 3, dk);
  R(c, x0 + Math.round(b.L * 0.4), beltY + 3, 4, 1, body === 'classic' ? '#c8ccd0' : dk);
  R(c, x0 + Math.round(b.L * 0.62), beltY + 3, 4, 1, body === 'classic' ? '#c8ccd0' : dk);
  if (body === 'classic') R(c, x0 + 3, beltY + 9, b.L - 6, 1, '#b8bcc0');
  // Зеркало
  R(c, gx1 - 3, beltY - 3, 4, 3, dk);
  // Фары, решётка, бамперы
  const fx = x0 + b.L - 2;
  R(c, fx - 1, beltY + 3, 3, 4, lit ? '#f2ecc8' : '#a8a080');
  if (body === 'classic') { R(c, fx - 4, beltY + 3, 3, 4, '#d8d0b0'); R(c, fx - 2, beltY + 8, 3, 3, '#202226'); }
  R(c, x0, beltY + 3, 2, 4, '#b8282a'); R(c, x0, beltY + 7, 2, 2, '#e08a20');
  const bump = body === 'classic' ? '#c8ccd2' : dk;
  R(c, x0 - 2, base - 10, 5, 4, bump); R(c, x0 + b.L - 3, base - 10, 5, 4, bump);
  if (body === 'classic') { R(c, x0 - 2, base - 10, 5, 1, '#eef0f2'); R(c, x0 + b.L - 3, base - 10, 5, 1, '#eef0f2'); }
  // Номер
  R(c, x0 + b.L - 1, base - 15, 2, 5, '#e8e8e0');
  // Ржавчина на старых машинах
  if (old) for (let i = 0; i < 9; i++) {
    const hh = hash(seed * 31 + i), rx = x0 + 6 + (hh % (b.L - 12)), ry = base - 8 - ((hh >>> 8) % 5);
    R(c, rx, ry, 1 + ((hh >>> 4) & 1), 1 + ((hh >>> 6) & 1), (hh & 1) ? '#7a3e1c' : '#5a2c14');
  }
  // Колёса и арки
  const wheels = [x0 + Math.round(b.L * b.wheel), x0 + Math.round(b.L * (1 - b.wheel))];
  wheels.forEach((wx, n) => {
    const cy = ground - b.r - lift;
    for (let dy = -b.r - 2; dy <= 0; dy++) { const half = Math.round(Math.sqrt(Math.max(0, (b.r + 2) ** 2 - dy * dy))); R(c, wx - half, cy + dy, half * 2 + 1, 1, '#0a0b0d'); }
    const front = n === 1;
    if (pose === 'wheel' && front) {
      // Колесо снято: виден тормозной диск и суппорт
      disc(c, wx, cy, b.r - 3, '#7a7e86', '#4a4e56'); R(c, wx + 2, cy - 5, 4, 7, '#b02a24'); R(c, wx + 2, cy - 5, 4, 1, '#d84a3a');
      R(c, wx - 1, cy + 1, 2, ground - cy - 1, '#d0a020'); // подставка
    } else wheel(c, wx, cy, b.r, body === 'classic');
  });
  if (pose === 'wheel') {
    // Подкатной домкрат и снятое колесо на полу
    const jx = wheels[1] - 22;
    R(c, jx, ground - 4, 22, 4, '#b02020'); R(c, jx, ground - 4, 22, 1, '#d84040'); R(c, jx + 18, ground - lift - 2, 4, lift - 2, '#808488');
    R(c, jx - 8, ground - 6, 10, 2, '#202226');
    flatWheel(c, wheels[1] + 18, ground, b.r);
  }
  if (pose === 'hood') {
    // Открытый капот и моторный отсек
    const hx0 = gx1 + 1, hx1 = x0 + b.L - 3;
    R(c, hx0, beltY - 1, hx1 - hx0, 4, '#101114');
    for (let i = 0; i < hx1 - hx0; i += 5) R(c, hx0 + i, beltY - 3 - ((i * 7) % 4), 3, 3, i % 10 ? '#5a5e66' : '#3a3e46');
    for (let i = 0; i <= hx1 - hx0 + 6; i++) { const yy = beltY - 2 - Math.round(i * 0.9); R(c, hx0 - 2 + i, yy - 2, 1, 3, mid); R(c, hx0 - 2 + i, yy - 2, 1, 1, hi); }
    R(c, hx1 - 2, beltY - 2 - Math.round((hx1 - hx0) * 0.9), 1, Math.round((hx1 - hx0) * 0.9), '#9a9ea4'); // упор капота
  }
}
function disc(c: Ctx, cx: number, cy: number, r: number, col: string, inner: string) {
  for (let dy = -r; dy <= r; dy++) { const half = Math.round(Math.sqrt(r * r - dy * dy)); R(c, cx - half, cy + dy, half * 2 + 1, 1, col); }
  R(c, cx - 2, cy - 2, 5, 5, inner);
}
function wheel(c: Ctx, cx: number, cy: number, r: number, chrome: boolean) {
  for (let dy = -r; dy <= r; dy++) { const half = Math.round(Math.sqrt(r * r - dy * dy)); R(c, cx - half, cy + dy, half * 2 + 1, 1, '#16171a'); }
  const rr = r - 3;
  for (let dy = -rr; dy <= rr; dy++) { const half = Math.round(Math.sqrt(rr * rr - dy * dy)); R(c, cx - half, cy + dy, half * 2 + 1, 1, chrome ? '#a8acb2' : '#6a6e76'); }
  R(c, cx - rr + 1, cy - 1, rr * 2 - 1, 1, chrome ? '#d8dce0' : '#8a8e96');
  R(c, cx - 1, cy - 1, 3, 3, '#2a2c30');
}
function flatWheel(c: Ctx, cx: number, ground: number, r: number) {
  R(c, cx - r, ground - 5, r * 2, 5, '#16171a'); R(c, cx - r + 3, ground - 4, r * 2 - 6, 2, '#6a6e76'); R(c, cx - r, ground - 5, r * 2, 1, '#2a2c30');
}

// ---------- Статичный слой: стены, полки, пол ----------
function background(c: Ctx, d: SceneData) {
  const pro = d.stage >= 1;
  // Потолок, трубы
  R(c, 0, 0, W, 16, '#0e0f13');
  R(c, 0, 9, W, 3, '#24272e'); R(c, 0, 9, W, 1, '#353943');
  R(c, 228, 0, 3, 40, '#24272e');
  // Кирпичная стена
  const brickA = pro ? '#2b2c33' : '#2e2724', brickB = pro ? '#26272d' : '#29221f', mortar = pro ? '#1c1d22' : '#1d1815';
  R(c, 0, 16, W, FLOOR - 16, mortar);
  for (let y = 16, row = 0; y < FLOOR; y += 6, row++) {
    for (let x = row % 2 ? -8 : 0; x < W; x += 16) {
      const hh = hash(x * 7 + y * 131);
      R(c, x + 1, y + 1, 14, 5, hh % 3 ? brickA : brickB);
      if (hh % 7 === 0) R(c, x + 2, y + 1, 12, 1, shade(brickA, 1.15));
    }
  }
  if (!pro) { // сырость и подтёки
    for (let i = 0; i < 6; i++) { const hh = hash(i + 50), sx = 120 + (hh % 230); c.fillStyle = 'rgba(10,8,6,.35)'; c.fillRect(sx, 16, 6 + (hh % 10), 30 + ((hh >>> 4) % 60)); }
  }
  // Плинтус и разметка
  if (pro) { R(c, 0, FLOOR - 12, W, 4, '#c8a020'); for (let x = 0; x < W; x += 8) R(c, x, FLOOR - 12, 4, 4, '#18191c'); }
  R(c, 0, FLOOR - 2, W, 2, '#141518');

  // Перфощит с инструментом
  const px = 100, py = 46, pw = 104, ph = 46;
  R(c, px - 2, py - 2, pw + 4, ph + 4, '#1a1410');
  R(c, px, py, pw, ph, pro ? '#7a5a34' : '#5a4630');
  for (let y = py + 3; y < py + ph; y += 4) for (let x = px + 3; x < px + pw; x += 4) R(c, x, y, 1, 1, pro ? '#4e3820' : '#3e3020');
  // Ключи: в старом гараже немного, в оборудованном — полный щит
  const nKeys = pro ? 18 : 5;
  for (let i = 0; i < nKeys; i++) {
    const kx = px + 6 + i * 5, len = 14 + (i % 4) * 3;
    R(c, kx, py + 5, 2, len, '#9aa0a8'); R(c, kx - 1, py + 4, 4, 3, '#b8bec6'); R(c, kx - 1, py + 4 + len, 4, 2, '#b8bec6');
  }
  const tools = new Set(d.tools);
  const tx = px + 8, ty = py + 30;
  if (tools.has('wrench_set')) { R(c, tx, ty, 14, 7, '#a82828'); R(c, tx + 1, ty + 1, 12, 1, '#d04040'); R(c, tx + 2, ty + 3, 10, 2, '#888c92'); }
  if (tools.has('filter_wrench')) { R(c, tx + 18, ty, 6, 6, '#8a8e94'); R(c, tx + 20, ty + 6, 2, 6, '#6a6e74'); }
  if (tools.has('plug_wrench')) { R(c, tx + 28, ty - 2, 2, 12, '#b0b4ba'); R(c, tx + 25, ty - 2, 8, 2, '#b0b4ba'); }
  if (tools.has('work_light')) { R(c, tx + 37, ty - 1, 5, 7, '#e8c838'); R(c, tx + 38, ty + 6, 3, 6, '#2a2a2a'); }
  if (tools.has('torque_wrench')) { R(c, tx + 46, ty + 3, 24, 2, '#b0b4ba'); R(c, tx + 64, ty + 1, 6, 6, '#4a4e54'); }
  if (tools.has('battery_tester')) { R(c, tx + 74, ty, 9, 8, '#1e2024'); R(c, tx + 75, ty + 1, 7, 3, '#7ac860'); }
  // Верстак
  const bx = 94, by = 104;
  R(c, bx, by, 116, 5, pro ? '#5a6068' : '#5a4028'); R(c, bx, by, 116, 1, pro ? '#7a8088' : '#7a5838');
  R(c, bx + 2, by + 5, 3, FLOOR - by - 5, '#1a1c20'); R(c, bx + 111, by + 5, 3, FLOOR - by - 5, '#1a1c20');
  R(c, bx + 92, by - 6, 10, 6, '#4a4e56'); R(c, bx + 94, by - 8, 6, 2, '#6a6e76'); // тиски
  if (tools.has('drain_pan')) { R(c, bx + 60, FLOOR - 5, 18, 5, '#1e4a7a'); R(c, bx + 60, FLOOR - 5, 18, 1, '#3a6aa0'); }
  if (pro) {
    // Красные ящики
    for (const [cx, cw, ch] of [[bx + 6, 26, 40], [bx + 34, 22, 30]] as const) {
      R(c, cx, FLOOR - ch, cw, ch, '#a02426'); R(c, cx, FLOOR - ch, cw, 2, '#c83a38');
      for (let yy = FLOOR - ch + 5; yy < FLOOR - 4; yy += 6) { R(c, cx + 1, yy, cw - 2, 1, '#6a1416'); R(c, cx + cw / 2 - 3, yy + 2, 6, 1, '#c8ccd0'); }
      R(c, cx + 1, FLOOR - 3, 3, 3, '#18191c'); R(c, cx + cw - 4, FLOOR - 3, 3, 3, '#18191c');
    }
    R(c, bx + 8, by - 9, 14, 9, '#2a5a8a'); R(c, bx + 8, by - 9, 14, 2, '#3a7ab0'); // кейс на верстаке
  } else {
    R(c, bx + 10, by - 7, 6, 7, '#2a4a2a'); R(c, bx + 20, by - 4, 9, 4, '#8a7a5a'); // банка и тряпка
    R(c, bx + 40, FLOOR - 16, 14, 16, '#3a3028'); R(c, bx + 40, FLOOR - 16, 14, 2, '#4a4038'); // старый ящик
  }

  // Плакат
  R(c, 212, 46, 48, 34, '#121318'); R(c, 213, 47, 46, 32, '#1c1e24');
  text(c, 217, 51, 'ЕЗДИ', '#c8ccd2', F4); text(c, 217, 59, 'ЧИНИ', '#c8ccd2', F4); text(c, 217, 67, 'ПОВТОРИ', '#e0a030', F4);

  // Стеллаж с канистрами
  const sx = 262, sw = 44;
  const shelves = pro ? [40, 66, 92, 118] : [80, 112];
  R(c, sx, shelves[0] - 2, 2, FLOOR - shelves[0] + 2, '#3a3e46'); R(c, sx + sw - 2, shelves[0] - 2, 2, FLOOR - shelves[0] + 2, '#3a3e46');
  shelves.forEach((sy, n) => {
    R(c, sx, sy, sw, 2, '#4a4e58');
    for (let i = 0; i < 6; i++) {
      const hh = hash(n * 17 + i), cw = 5 + (hh % 3), ch = 7 + ((hh >>> 3) % 6);
      if (!pro && hh % 3 === 0) continue;
      const col = ['#a82a2a', '#2a5a9a', '#c8a02a', '#3a7a3a', '#8a8e96', '#6a4a2a'][(hh >>> 6) % 6];
      R(c, sx + 3 + i * 7, sy - ch, cw, ch, col); R(c, sx + 3 + i * 7, sy - ch, cw, 1, shade(col, 1.3));
      if (ch > 9) R(c, sx + 4 + i * 7, sy - ch + 3, cw - 2, 2, '#e8e0c8');
    }
  });
  if (pro) { // бочка с маслом
    R(c, 240, FLOOR - 24, 18, 24, '#9a2222'); R(c, 240, FLOOR - 24, 18, 2, '#c03a34');
    for (const yy of [FLOOR - 17, FLOOR - 8]) R(c, 240, yy, 18, 1, '#6a1414');
    text(c, 241, FLOOR - 15, 'МАСЛО', '#e8d8c0', { 'М': ['#.#', '###', '#.#'], 'А': ['.#.', '###', '#.#'], 'С': ['.##', '#..', '.##'], 'Л': ['.##', '#.#', '#.#'], 'О': ['###', '#.#', '###'] });
  }

  // Окно
  const wx = 316, wy = 28, ww = 60, wh = 46;
  R(c, wx - 4, wy - 4, ww + 8, wh + 8, pro ? '#121316' : '#3a2c1e');
  // Подоконник и стойка покрышек / куча покрышек
  R(c, wx - 6, wy + wh + 4, ww + 12, 3, pro ? '#3a3e46' : '#4a3828');
  if (pro) {
    R(c, 314, 96, 64, 2, '#3a3e46'); R(c, 314, 124, 64, 2, '#3a3e46'); R(c, 314, 96, 2, FLOOR - 96, '#3a3e46'); R(c, 376, 96, 2, FLOOR - 96, '#3a3e46');
    for (const ry of [96, 124]) for (let i = 0; i < 5; i++) tire(c, 318 + i * 12, ry, 11, 22);
    for (let i = 0; i < 5; i++) tire(c, 318 + i * 12, FLOOR, 11, 22);
  } else {
    for (let i = 0; i < 4; i++) { R(c, 340, FLOOR - 7 * (i + 1), 30, 7, '#141518'); R(c, 344, FLOOR - 7 * (i + 1) + 2, 22, 3, '#22242a'); R(c, 340, FLOOR - 7 * (i + 1), 30, 1, '#2a2c32'); }
  }
  // Пол
  R(c, 0, FLOOR, W, H - FLOOR, pro ? '#1e2026' : '#1f1c1a');
  for (let i = 0; i < 6; i++) { const y = FLOOR + Math.round(Math.pow(i / 6, 1.6) * (H - FLOOR)); R(c, 0, y, W, 1, pro ? '#18191e' : '#191614'); }
  for (let x = -200; x < W + 200; x += 32) { // швы плит в перспективе
    for (let y = FLOOR; y < H; y += 2) { const xx = x + (x - W / 2) * (y - FLOOR) / (H - FLOOR) * 0.6; R(c, xx, y, 1, 2, pro ? '#18191e' : '#191614'); }
  }
  for (let i = 0; i < 7; i++) { const hh = hash(i + 300); c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.ellipse(20 + (hh % 340), FLOOR + 10 + ((hh >>> 8) % 50), 4 + (hh % 9), 1.5 + ((hh >>> 3) % 2), 0, 0, Math.PI * 2); c.fill(); }
  if (pro) { // разметка поста и решётка слива
    c.fillStyle = '#b8901c';
    for (const [x1, x2] of [[118, 92], [302, 330]]) for (let y = FLOOR + 4; y < H; y += 2) c.fillRect(Math.round(x1 + (x2 - x1) * (y - FLOOR) / (H - FLOOR)), y, 2, 1);
    R(c, 196, 204, 28, 4, '#121316'); for (let i = 0; i < 7; i++) R(c, 197 + i * 4, 205, 2, 2, '#2a2c32');
  }
}
function tire(c: Ctx, x: number, bottom: number, w: number, h: number) {
  R(c, x, bottom - h, w, h, '#121316'); R(c, x + 1, bottom - h + 1, w - 2, 1, '#2a2c32');
  R(c, x + 3, bottom - h / 2 - 3, w - 6, 6, '#1c1e22'); R(c, x + 4, bottom - h / 2 - 1, w - 8, 2, '#3a3e46');
}

// ---------- Кадр ----------
let bgCanvas: HTMLCanvasElement | null = null, bgKey = '';

export function draw(c: Ctx, d: SceneData, t: number) {
  c.imageSmoothingEnabled = false;
  const pro = d.stage >= 1;
  const open = d.hour >= 8 && d.hour < 21;
  const lightsOn = open || !!d.working;
  const night = isNight(d.hour);
  const key = `${d.stage}|${d.tools.join(',')}`;
  if (!bgCanvas || key !== bgKey) {
    bgCanvas = bgCanvas || document.createElement('canvas');
    bgCanvas.width = W; bgCanvas.height = H;
    const bc = bgCanvas.getContext('2d')!; bc.imageSmoothingEnabled = false;
    background(bc, d); bgKey = key;
  }
  c.drawImage(bgCanvas, 0, 0);

  // Окно с улицей
  const wx = 316, wy = 28, ww = 60, wh = 46;
  outside(c, wx, wy, ww, wh, d, t, false);
  const frame = pro ? '#121316' : '#3a2c1e';
  if (pro) { for (const fx of [wx + 19, wx + 39]) R(c, fx, wy, 2, wh, frame); R(c, wx, wy + 22, ww, 2, frame); }
  else { R(c, wx + 29, wy, 2, wh, frame); R(c, wx, wy + 22, ww, 2, frame); c.fillStyle = 'rgba(90,80,50,.22)'; c.fillRect(wx, wy, ww, wh); for (let i = 0; i < 10; i++) R(c, wx + 6 + i * 2, wy + 4 + i, 1, 1, 'rgba(230,230,230,.5)'); }
  if (pro && lightsOn) { R(c, wx + 2, wy + wh - 8, 8, 8, '#5a3a24'); R(c, wx + 1, wy + wh - 16, 10, 8, '#2e6a2e'); R(c, wx + 3, wy + wh - 19, 6, 4, '#3a8a3a'); } // цветок
  if (d.weather === 'snow') R(c, wx - 5, wy + wh + 3, ww + 10, 1, '#e8edf2');
  if (d.weather === 'rain' && !pro) { const drip = Math.floor(t / 250) % 6; R(c, wx + 10, wy + wh + 7 + drip * 3, 1, 2, '#6a8098'); R(c, wx + 4, FLOOR + 8, 14, 2, '#2a3440'); }

  // Ворота слева
  const gx = 8, gy = 26, gw = 82, gh = FLOOR - gy;
  R(c, gx - 4, gy - 6, gw + 8, gh + 6, '#141518'); R(c, gx - 4, gy - 6, gw + 8, 4, '#24262c');
  if (open) {
    outside(c, gx, gy, gw, gh, d, t, true);
    for (let y = 0; y < 8; y += 2) R(c, gx, gy + y, gw, 1, y % 4 ? '#3a3c42' : '#4a4c52'); // поднятая ставня
    d.queue.slice(0, 4).forEach((q, i) => {
      const qx = gx + 10 + i * 18;
      figure(c, qx, FLOOR - 1, i % 3 === 1 ? 'phone' : 'stand', t, { jacket: q.shirt, cap: q.cap ? shade(q.shirt, 0.55) : null, hair: ['#2e2218', '#6a4a2a', '#1a1a1a', '#8a8a8a'][i % 4] }, i % 2 ? -1 : 1, i * 1.7);
      if (q.flag && Math.floor(t / 500) % 2) { R(c, qx - 1, FLOOR - 38, 2, 5, '#f2a83b'); R(c, qx - 1, FLOOR - 32, 2, 2, '#f2a83b'); }
    });
  } else {
    for (let y = 0; y < gh; y += 3) { R(c, gx, gy + y, gw, 2, '#2c2e34'); R(c, gx, gy + y + 2, gw, 1, '#1c1d22'); }
    // Граффити
    const crown = [[0, 4], [2, 0], [4, 3], [6, 0], [8, 3], [10, 0], [12, 4]];
    for (const [cx, cy] of crown) R(c, gx + 34 + cx, gy + 22 + cy, 2, 5 - cy, '#8a6aa8');
    R(c, gx + 34, gy + 27, 14, 2, '#8a6aa8');
    text(c, gx + 17, gy + 34, 'AUTO', '#7a5c98', F5, 2); text(c, gx + 17, gy + 52, 'CREW', '#7a5c98', F5, 2);
    text(c, gx + 16, gy + 33, 'AUTO', '#a888c8', F5, 2); text(c, gx + 16, gy + 51, 'CREW', '#a888c8', F5, 2);
  }

  // Машина и механик
  const crew: Look = { jacket: '#1a2030', pants: '#141a24', cap: '#121418', logo: true };
  if (d.working) {
    const w = d.working, b = BODIES[w.body];
    const cx = 166 + Math.round((128 - b.L) / 2);
    if (w.pose === 'under') { creeper(c, cx + b.L / 2 + 4, 196); figure(c, cx + b.L / 2 + 6, 196, 'under', t, crew, 1); }
    car(c, cx, 196, w.color, w.body, w.old, w.pose === 'under' ? null : w.pose, w.seed, lightsOn);
    if (w.pose === 'wheel') figure(c, cx + Math.round(b.L * (1 - b.wheel)) + 16, 196, 'wheel', t, crew, -1);
    if (w.pose === 'hood') figure(c, cx + b.L + 8, 196, 'hood', t, crew, -1);
    R(c, cx + b.L / 2 - 30, 124, 60, 5, '#0a0b0d'); R(c, cx + b.L / 2 - 29, 125, Math.round(58 * w.progress), 3, '#f2a83b');
  } else if (lightsOn) {
    // Без заказа хозяин ходит между верстаком и стеллажом: 16-секундный цикл
    const cyc = (t / 1000) % 16;
    if (cyc < 8) figure(c, 152, 148, 'bench', t, crew, 1);
    else if (cyc < 10.5) figure(c, 152 + (cyc - 8) / 2.5 * 120, 148, 'walk', t, crew, 1);
    else if (cyc < 13) figure(c, 272, 148, 'shelf', t, crew, 1);
    else figure(c, 272 - (cyc - 13) / 3 * 120, 148, 'walk', t, crew, -1);
  }

  // Свет
  const lamps = pro ? [[96, 22], [176, 22], [272, 22]] : [[186, 30]];
  if (lightsOn) {
    c.save(); c.globalCompositeOperation = 'lighter';
    for (const [lx, ly] of lamps) {
      const g = c.createRadialGradient(lx + (pro ? 16 : 0), ly, 0, lx + (pro ? 16 : 0), ly + 40, 120);
      g.addColorStop(0, pro ? 'rgba(170,190,220,.22)' : 'rgba(255,190,110,.24)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      // Блики на мокром полу
      c.fillStyle = pro ? 'rgba(170,190,220,.07)' : 'rgba(255,190,110,.07)';
      for (let y = FLOOR + 4; y < H; y += 3) c.fillRect(lx + (pro ? 6 : -3) + Math.sin(y + t / 900) * 1.5, y, pro ? 20 : 6, 1);
    }
    c.restore();
    for (const [lx, ly] of lamps) {
      if (pro) { R(c, lx, ly - 8, 1, 8, '#2a2c32'); R(c, lx + 31, ly - 8, 1, 8, '#2a2c32'); R(c, lx - 1, ly, 34, 3, '#2a2c32'); R(c, lx, ly + 2, 32, 2, '#eef4ff'); }
      else {
        R(c, lx, 12, 1, ly - 12, '#202226');
        const flick = Math.floor(t / 110) % 47 === 0;
        R(c, lx - 2, ly, 5, 5, flick ? '#6a5a30' : '#ffe8a8'); R(c, lx - 1, ly - 1, 3, 1, '#3a3a3a');
      }
    }
    // Пылинки в свете
    c.fillStyle = 'rgba(255,240,210,.35)';
    for (let i = 0; i < 14; i++) { const hh = hash(i + 900); c.fillRect((hh % W + t / (40 + (hh % 30))) % W, 30 + ((hh >>> 8) % 100) + Math.sin(t / 1500 + i) * 4, 1, 1); }
    if (!night) {
      c.fillStyle = 'rgba(255,240,200,.05)';
      c.beginPath(); c.moveTo(wx, wy + wh); c.lineTo(wx + ww, wy + wh); c.lineTo(wx + 20, H); c.lineTo(wx - 70, H); c.closePath(); c.fill();
    }
  } else {
    c.fillStyle = 'rgba(2,3,8,.74)'; c.fillRect(0, 0, W, H);
    outside(c, wx, wy, ww, wh, d, t, false);
    if (pro) { for (const fx of [wx + 19, wx + 39]) R(c, fx, wy, 2, wh, '#050608'); R(c, wx, wy + 22, ww, 2, '#050608'); } else { R(c, wx + 29, wy, 2, wh, '#0a0806'); R(c, wx, wy + 22, ww, 2, '#0a0806'); }
    c.fillStyle = 'rgba(120,140,190,.06)';
    c.beginPath(); c.moveTo(wx, wy + wh); c.lineTo(wx + ww, wy + wh); c.lineTo(wx + 20, H); c.lineTo(wx - 60, H); c.closePath(); c.fill();
  }
  // Виньетка
  const v = c.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, W * 0.62);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.45)');
  c.fillStyle = v; c.fillRect(0, 0, W, H);
}
