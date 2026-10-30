// Пиксель-арт: вид изнутри гаража. Рисуется в низком разрешении и растягивается без сглаживания.
// Окно и проём ворот показывают время суток и погоду. Интерьер зависит от ступени бизнеса,
// купленного инструмента, машины в работе и клиентов, ждущих у ворот.
import type { Weather } from '../shared/weather';

export const W = 192, H = 108;

export interface SceneData {
  stage: number;
  hour: number;
  minute: number;
  weather: Weather;
  tools: string[];
  working: { color: string; progress: number; lifted: boolean } | null;
  queue: { shirt: string; flag: boolean }[];
}

type Ctx = CanvasRenderingContext2D;
const rect = (c: Ctx, x: number, y: number, w: number, h: number, col: string) => { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), w, h); };
const hash = (i: number) => Math.imul(i + 1, 2654435761) >>> 0;
const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

function shade(c: string, k: number) {
  const n = parseInt(c.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, v * k));
  return hex(f(n >> 16), f((n >> 8) & 255), f(n & 255));
}
function mix(a: string, b: string, k: number) {
  const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
  const m = (s: number) => ((x >> s) & 255) * (1 - k) + ((y >> s) & 255) * k;
  return hex(m(16), m(8), m(0));
}
const isNight = (h: number) => h < 7 || h >= 20;

// Небо плавно по времени суток, в непогоду серее
function skyColors(hour: number, minute: number, wx: Weather): [string, string] {
  const t = hour + minute / 60;
  const keys: [number, string, string][] = [
    [0, '#070b16', '#0f1626'], [5, '#0b1222', '#1a2238'], [7, '#4d5d80', '#d79a6e'], [9, '#6f97c2', '#b4cde2'],
    [17, '#6f97c2', '#b4cde2'], [19, '#3e3c62', '#d07a52'], [21, '#0d1426', '#1d2540'], [24, '#070b16', '#0f1626'],
  ];
  let i = 0; while (keys[i + 1][0] <= t) i++;
  const [t0, a0, b0] = keys[i], [t1, a1, b1] = keys[i + 1];
  const k = (t - t0) / (t1 - t0);
  let top = mix(a0, a1, k), low = mix(b0, b1, k);
  if (wx !== 'clear') {
    const grey = wx === 'snow' ? '#8a909a' : '#5d636c';
    const amount = t > 7 && t < 20 ? 0.6 : 0.25;
    top = mix(top, grey, amount); low = mix(low, grey, amount);
  }
  return [top, low];
}

// Вид наружу: небо, гаражи кооператива напротив, фонарь, осадки.
function outside(c: Ctx, x: number, y: number, w: number, h: number, d: SceneData, t: number, ground: boolean) {
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
  const [top, low] = skyColors(d.hour, d.minute, d.weather);
  for (let i = 0; i < h; i++) rect(c, x, y + i, w, 1, mix(top, low, i / h));
  const night = isNight(d.hour);
  if (night && d.weather === 'clear') for (let i = 0; i < 10; i++) { const hh = hash(i + x); rect(c, x + (hh % w), y + ((hh >>> 10) % Math.max(1, Math.floor(h / 2))), 1, 1, '#c9d3e6'); }
  if (!night && d.weather === 'clear') rect(c, x + w - 10, y + 4, 4, 4, '#fff1b8');
  if (d.weather !== 'clear') {
    const cl = night ? '#2a3040' : d.weather === 'snow' ? '#c4c8ce' : '#8b9099';
    for (let i = 0; i < 3; i++) { const cx = x + ((Math.floor(t / 400) + i * 23) % (w + 20)) - 10; rect(c, cx, y + 3 + i * 3, 14, 3, cl); }
  }
  const roof = night ? '#121722' : '#5b6370', wall = night ? '#1a202c' : '#7a8290';
  const gy = y + Math.round(h * 0.55);
  rect(c, x, gy, w, y + h - gy, wall);
  rect(c, x, gy - 2, w, 2, roof);
  for (let gx = x + 3; gx < x + w - 6; gx += 14) rect(c, gx, gy + 3, 9, y + h - gy - 3, night ? '#10141c' : '#646b78');
  if (d.weather === 'snow') rect(c, x, gy - 3, w, 1, '#eef2f6');
  const lx = x + Math.round(w * 0.7), ly = y + Math.round(h * 0.25);
  rect(c, lx, ly, 1, y + h - ly, night ? '#2a2f3a' : '#3c414c');
  rect(c, lx - 2, ly, 4, 1, '#3c414c');
  if (night) {
    rect(c, lx - 2, ly + 1, 4, 1, '#ffd58a');
    c.fillStyle = 'rgba(255, 210, 130, 0.12)';
    c.beginPath(); c.moveTo(lx, ly + 2); c.lineTo(lx - 8, y + h); c.lineTo(lx + 8, y + h); c.closePath(); c.fill();
  }
  if (ground) rect(c, x, y + h - 3, w, 3, d.weather === 'snow' ? '#dfe5ea' : night ? '#15181e' : '#3e4249');
  if (d.weather === 'rain') {
    c.fillStyle = night ? 'rgba(160, 180, 210, 0.55)' : 'rgba(210, 225, 240, 0.7)';
    for (let i = 0; i < w * h / 40; i++) {
      const hh = hash(i * 7 + x);
      c.fillRect(x + ((hh % w) + Math.floor(t / 30)) % w, y + ((hh >>> 8) % h + Math.floor(t / 12)) % h, 1, 3);
    }
  }
  if (d.weather === 'snow') {
    c.fillStyle = '#f4f7fa';
    for (let i = 0; i < w * h / 50; i++) {
      const hh = hash(i * 13 + x);
      c.fillRect(x + ((hh % w) + Math.round(Math.sin(t / 700 + i) * 2) + w) % w, y + ((hh >>> 8) % h + Math.floor(t / 90)) % h, 1, 1);
    }
  }
  c.restore();
}

function car(c: Ctx, x: number, base: number, color: string, len: number, dark: boolean, lifted = 0) {
  const b = base - lifted;
  rect(c, x + 1, b - 10, len - 2, 6, color);
  rect(c, x, b - 9, len, 4, color);
  rect(c, x + 1, b - 10, len - 2, 1, shade(color, 1.25));
  rect(c, x + 1, b - 5, len - 2, 1, shade(color, 0.7));
  const cx0 = x + Math.round(len * 0.24), cx1 = x + Math.round(len * 0.74);
  for (let r = 0; r < 6; r++) rect(c, cx0 + Math.max(0, 3 - r), b - 16 + r, cx1 - cx0 - Math.max(0, 3 - r) - Math.max(0, 2 - r), 1, color);
  const glass = dark ? '#24364a' : '#9ec0d4';
  rect(c, cx0 + 3, b - 15, Math.round((cx1 - cx0) / 2) - 3, 4, glass);
  rect(c, cx0 + Math.round((cx1 - cx0) / 2) + 1, b - 15, Math.round((cx1 - cx0) / 2) - 4, 4, glass);
  rect(c, x + len - 2, b - 9, 2, 2, '#f4e7b0');
  rect(c, x, b - 9, 1, 2, '#c43c2c');
  for (const wx of [x + 6, x + len - 9]) {
    rect(c, wx, b - 5, 5, 5, '#121212'); rect(c, wx - 1, b - 4, 7, 3, '#121212');
    rect(c, wx + 1, b - 3, 3, 1, '#8a8a8a'); rect(c, wx + 2, b - 4, 1, 3, '#8a8a8a');
  }
  if (lifted) for (const sx of [x + 7, x + len - 10]) { rect(c, sx, b, 3, lifted, '#d9a400'); rect(c, sx - 1, base - 1, 5, 1, '#d9a400'); }
}

function person(c: Ctx, x: number, base: number, shirt: string, t: number, working: boolean, phase = 0) {
  const bob = working ? Math.floor(t / 250) % 2 : Math.floor((t + phase) / 1600) % 2;
  rect(c, x, base - 4, 2, 4, '#2c3344'); rect(c, x + 3, base - 4, 2, 4, '#2c3344');
  rect(c, x, base - 10 + bob, 5, 6, shirt);
  rect(c, x + 1, base - 13 + bob, 3, 3, '#e0b08a');
  rect(c, x + 1, base - 14 + bob, 3, 1, '#3a2a1c');
  if (working) rect(c, x - 3, base - 9 + bob * 2, 3, 1, '#b8b8b8');
}

const TOOL_ICONS: Record<string, (c: Ctx, x: number, y: number) => void> = {
  wrench_set: (c, x, y) => { rect(c, x, y, 7, 3, '#c43c2c'); rect(c, x + 1, y + 1, 5, 1, '#a0a0a0'); },
  filter_wrench: (c, x, y) => { rect(c, x + 1, y, 3, 3, '#9a9a9a'); rect(c, x + 2, y + 3, 1, 3, '#9a9a9a'); },
  drain_pan: (c, x, y) => { rect(c, x, y + 3, 7, 2, '#2e5d8a'); },
  plug_wrench: (c, x, y) => { rect(c, x + 2, y, 1, 6, '#b5b5b5'); rect(c, x, y, 5, 1, '#b5b5b5'); },
  work_light: (c, x, y) => { rect(c, x + 1, y, 3, 4, '#f2d14b'); rect(c, x + 2, y + 4, 1, 2, '#333'); },
  jack: (c, x, y) => { rect(c, x, y + 4, 7, 2, '#c43c2c'); rect(c, x + 5, y + 1, 1, 3, '#c43c2c'); },
  stands: (c, x, y) => { rect(c, x, y + 1, 1, 5, '#d9a400'); rect(c, x + 3, y + 1, 1, 5, '#d9a400'); },
  battery_tester: (c, x, y) => { rect(c, x, y + 1, 5, 4, '#222'); rect(c, x + 1, y + 2, 3, 1, '#7fbf6a'); },
  torque_wrench: (c, x, y) => { rect(c, x, y + 2, 7, 1, '#b5b5b5'); rect(c, x + 5, y + 1, 2, 3, '#555'); },
};

export function draw(c: Ctx, d: SceneData, t: number) {
  c.imageSmoothingEnabled = false;
  const pro = d.stage >= 1;
  const open = d.hour >= 8 && d.hour < 21;
  const lightsOn = open || !!d.working;
  const night = isNight(d.hour);
  const FLOOR = 80;
  const frame = pro ? '#3a3e44' : '#2c2927';

  // Стены: шлакоблок в старом гараже, крашеные панели в оборудованном
  const wallA = pro ? '#6c7177' : '#4a4643', wallB = pro ? '#62676d' : '#3f3b38';
  rect(c, 0, 0, W, FLOOR, wallA);
  if (pro) for (let y = 6; y < FLOOR; y += 8) rect(c, 0, y, W, 1, wallB);
  else for (let y = 4; y < FLOOR; y += 5) for (let x = (y / 5) % 2 ? 0 : 6; x < W; x += 12) rect(c, x, y, 11, 1, wallB);
  rect(c, 0, 0, W, 4, frame);
  if (!pro) { rect(c, 92, 14, 1, 9, '#2e2b29'); rect(c, 93, 22, 1, 6, '#2e2b29'); rect(c, 118, 54, 14, 8, '#3a3531'); }
  else { rect(c, 0, 66, W, 3, '#d9a400'); for (let x = 0; x < W; x += 6) rect(c, x, 66, 3, 3, '#222'); }

  // Ворота слева: днём подняты, видно улицу и ждущих клиентов
  const gx = 4, gy = 18, gw = 30, gh = FLOOR - gy;
  rect(c, gx - 3, gy - 3, gw + 6, gh + 3, frame);
  if (open) {
    outside(c, gx, gy, gw, gh, d, t, true);
    for (let y = 0; y < 5; y += 2) rect(c, gx, gy + y, gw, 1, '#8e9094');
    d.queue.slice(0, 3).forEach((q, i) => {
      const px = gx + 4 + i * 9;
      person(c, px, FLOOR - 1, q.shirt, t, false, i * 500);
      if (q.flag && Math.floor(t / 500) % 2) { rect(c, px + 2, FLOOR - 21, 1, 3, '#f2a83b'); rect(c, px + 2, FLOOR - 17, 1, 1, '#f2a83b'); }
    });
  } else for (let y = 0; y < gh; y += 2) rect(c, gx, gy + y, gw, 1, y % 4 ? '#55585c' : '#64676b');

  // Окно справа
  const wx = 140, wy = 12, ww = 44, wh = 30;
  const wf = pro ? '#e3e6e8' : '#5c4a36';
  rect(c, wx - 3, wy - 3, ww + 6, wh + 6, wf);
  const drawWindow = () => {
    outside(c, wx, wy, ww, wh, d, t, false);
    rect(c, wx + ww / 2 - 1, wy, 2, wh, wf);
    rect(c, wx, wy + wh / 2 - 1, ww, 2, wf);
    if (!pro) { c.fillStyle = 'rgba(120, 110, 80, 0.18)'; c.fillRect(wx, wy, ww, wh); for (let i = 0; i < 7; i++) rect(c, wx + 4 + i * 2, wy + 3 + i, 1, 1, 'rgba(230,230,230,0.6)'); }
  };
  drawWindow();
  rect(c, wx - 4, wy + wh + 3, ww + 8, 2, pro ? '#d0d4d8' : '#4a3a2a');
  if (d.weather === 'snow') rect(c, wx - 3, wy + wh + 2, ww + 6, 1, '#eef2f6');
  if (d.weather === 'rain' && !pro) { rect(c, wx + 6, wy + wh + 5, 1, 2 + (Math.floor(t / 300) % 3), '#7d93a8'); rect(c, wx + 4, FLOOR + 6, 8, 1, '#5b6a7a'); }

  // Щит с инструментом и верстак
  rect(c, 42, 20, 34, 24, pro ? '#3d4d5c' : '#6e5a3e');
  for (let y = 22; y < 44; y += 3) for (let x = 44; x < 76; x += 3) rect(c, x, y, 1, 1, pro ? '#2e3b47' : '#55452f');
  d.tools.slice(0, 9).forEach((id, i) => TOOL_ICONS[id]?.(c, 44 + (i % 3) * 10, 23 + Math.floor(i / 3) * 7));
  rect(c, 40, 52, 38, 3, pro ? '#596169' : '#5b4128');
  rect(c, 42, 55, 2, FLOOR - 55, pro ? '#3c4248' : '#3f2d1c'); rect(c, 74, 55, 2, FLOOR - 55, pro ? '#3c4248' : '#3f2d1c');
  rect(c, 66, 48, 6, 4, '#5a5f66');
  if (pro) { rect(c, 46, 62, 14, 12, '#b8312a'); rect(c, 46, 66, 14, 1, '#7d1f1a'); rect(c, 46, 70, 14, 1, '#7d1f1a'); }
  else { rect(c, 48, 47, 5, 5, '#2f4f2f'); rect(c, 56, 49, 6, 3, '#8a7a5a'); }

  // Пол
  rect(c, 0, FLOOR, W, H - FLOOR, pro ? '#56595c' : '#4b4844');
  for (let x = 0; x < W; x += 24) rect(c, x, FLOOR, 1, H - FLOOR, pro ? '#4d5053' : '#43403c');
  rect(c, 0, FLOOR, W, 1, pro ? '#3f4245' : '#34312e');
  if (pro) { rect(c, 82, 86, 54, 1, '#d9a400'); rect(c, 82, 104, 54, 1, '#d9a400'); rect(c, 82, 86, 1, 19, '#d9a400'); rect(c, 135, 86, 1, 19, '#d9a400'); }
  else { rect(c, 96, 96, 12, 3, '#2f2d2b'); rect(c, 150, 92, 7, 2, '#2f2d2b'); rect(c, 30, 100, 6, 2, '#33302d'); }

  // Покрышки в старом гараже, шкаф в оборудованном
  if (!pro) for (let i = 0; i < 3; i++) { rect(c, 172, FLOOR + 2 - 5 * (i + 1), 14, 5, '#1c1c1c'); rect(c, 175, FLOOR + 3 - 5 * (i + 1), 8, 3, '#2d2d2d'); }
  else { rect(c, 170, 48, 16, FLOOR - 48, '#3e4a56'); rect(c, 172, 52, 12, 1, '#7d8a96'); rect(c, 172, 60, 12, 1, '#7d8a96'); rect(c, 172, 68, 12, 1, '#7d8a96'); }

  // Машина и владелец
  if (d.working) {
    car(c, 88, 100, d.working.color, 42, !lightsOn, d.working.lifted ? 5 : 0);
    person(c, 136, 100, '#355d8c', t, true);
  } else if (lightsOn) person(c, 60, FLOOR + 6, '#355d8c', t, false);

  // Освещение
  if (lightsOn) {
    if (pro) {
      rect(c, 70, 4, 28, 2, '#f2f6f8'); rect(c, 112, 4, 28, 2, '#f2f6f8');
    } else {
      rect(c, 104, 4, 1, 8, '#222');
      const flick = Math.floor(t / 120) % 41 === 0;
      rect(c, 103, 12, 3, 3, flick ? '#806a30' : '#ffe08a');
      if (!flick) { c.fillStyle = 'rgba(255, 215, 130, 0.08)'; c.beginPath(); c.moveTo(104, 14); c.lineTo(66, H); c.lineTo(146, H); c.closePath(); c.fill(); }
    }
    if (!night && d.weather !== 'rain') {
      c.fillStyle = 'rgba(255, 245, 210, 0.06)';
      c.beginPath(); c.moveTo(wx, wy + wh); c.lineTo(wx + ww, wy + wh); c.lineTo(wx + 14, H); c.lineTo(wx - 46, H); c.closePath(); c.fill();
    }
  } else {
    // Свет выключен: темно, светится только окно
    c.fillStyle = 'rgba(2, 4, 12, 0.72)'; c.fillRect(0, 0, W, H);
    drawWindow();
    c.fillStyle = 'rgba(140, 160, 200, 0.07)';
    c.beginPath(); c.moveTo(wx, wy + wh); c.lineTo(wx + ww, wy + wh); c.lineTo(wx + 10, H); c.lineTo(wx - 40, H); c.closePath(); c.fill();
  }
  if (d.working) { rect(c, 88, 6, 42, 3, '#000'); rect(c, 89, 7, Math.round(40 * d.working.progress), 1, '#f2a83b'); }
}
