// Пиксель-арт сцена гаража. Рисуется в низком разрешении и растягивается без сглаживания.
// Вид зависит от ступени бизнеса, времени суток, купленного инструмента и машин.
export const W = 192, H = 108;

export interface SceneData {
  stage: number;
  hour: number;
  tools: string[];
  working: { color: string; progress: number; lifted: boolean } | null;
  queue: { color: string; flag: boolean }[];
}

type Ctx = CanvasRenderingContext2D;
const rect = (c: Ctx, x: number, y: number, w: number, h: number, col: string) => { c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), w, h); };

function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

function sky(c: Ctx, hour: number, t: number) {
  const night = hour < 6 || hour >= 21, evening = hour >= 18 && hour < 21, morning = hour >= 6 && hour < 8;
  const top = night ? '#0b1322' : evening ? '#3b3a5c' : morning ? '#5d6f8e' : '#6f97bd';
  const low = night ? '#16233a' : evening ? '#d0805a' : morning ? '#e3a777' : '#a9c6de';
  for (let y = 0; y < 84; y++) {
    const k = y / 84;
    const a = parseInt(top.slice(1), 16), b = parseInt(low.slice(1), 16);
    const mix = (s: number) => Math.round(((a >> s) & 255) * (1 - k) + ((b >> s) & 255) * k);
    rect(c, 0, y, W, 1, `rgb(${mix(16)},${mix(8)},${mix(0)})`);
  }
  if (night) for (let i = 0; i < 26; i++) {
    const h = Math.imul(i + 1, 2654435761) >>> 0;
    const x = h % W, y = (h >>> 12) % 44;
    if ((i + Math.floor(t / 900)) % 9) rect(c, x, y, 1, 1, i % 3 ? '#cfd8e8' : '#8f9bb0');
  }
  // Силуэты гаражного кооператива на заднем плане
  const far = night ? '#101826' : '#4f5d6b';
  for (let x = 0; x < W; x += 24) rect(c, x, 60 + ((x / 24) % 2) * 3, 22, 24, far);
  return night;
}

function car(c: Ctx, x: number, base: number, color: string, len: number, night: boolean, lifted = 0) {
  const b = base - lifted;
  const body = color, dark = shade(color, 0.7), light = shade(color, 1.25);
  rect(c, x + 1, b - 10, len - 2, 6, body);
  rect(c, x, b - 9, len, 4, body);
  rect(c, x + 1, b - 10, len - 2, 1, light);
  rect(c, x + 1, b - 5, len - 2, 1, dark);
  const cx0 = x + Math.round(len * 0.24), cx1 = x + Math.round(len * 0.74);
  for (let r = 0; r < 6; r++) rect(c, cx0 + Math.max(0, 3 - r), b - 16 + r, cx1 - cx0 - Math.max(0, 3 - r) - Math.max(0, 2 - r), 1, body);
  const glass = night ? '#24364a' : '#a7c9dd';
  rect(c, cx0 + 3, b - 15, Math.round((cx1 - cx0) / 2) - 3, 4, glass);
  rect(c, cx0 + Math.round((cx1 - cx0) / 2) + 1, b - 15, Math.round((cx1 - cx0) / 2) - 4, 4, glass);
  rect(c, x + len - 2, b - 9, 2, 2, night ? '#fff3c2' : '#f4e7b0');
  rect(c, x, b - 9, 1, 2, '#c43c2c');
  for (const wx of [x + 6, x + len - 9]) {
    rect(c, wx, b - 5, 5, 5, '#121212');
    rect(c, wx - 1, b - 4, 7, 3, '#121212');
    rect(c, wx + 1, b - 3, 3, 1, '#8a8a8a');
    rect(c, wx + 2, b - 4, 1, 3, '#8a8a8a');
  }
  if (lifted) { rect(c, x + 8, b, 2, lifted, '#c9a227'); rect(c, x + len - 10, b, 2, lifted, '#c9a227'); }
}

function mechanic(c: Ctx, x: number, base: number, t: number, working: boolean) {
  const bob = working ? (Math.floor(t / 250) % 2) : 0;
  rect(c, x, base - 4, 2, 4, '#2c3b5a');
  rect(c, x + 3, base - 4, 2, 4, '#2c3b5a');
  rect(c, x, base - 10 + bob, 5, 6, '#355d8c');
  rect(c, x + 1, base - 13 + bob, 3, 3, '#e0b08a');
  rect(c, x + 1, base - 14 + bob, 3, 1, '#3a2a1c');
  if (working) rect(c, x + 5, base - 9 + bob * 2, 3, 1, '#b8b8b8');
}

const TOOL_ICONS: Record<string, (c: Ctx, x: number, y: number) => void> = {
  wrench_set: (c, x, y) => { rect(c, x, y, 7, 3, '#c43c2c'); rect(c, x + 1, y + 1, 5, 1, '#a0a0a0'); },
  filter_wrench: (c, x, y) => { rect(c, x + 1, y, 3, 3, '#9a9a9a'); rect(c, x + 2, y + 3, 1, 3, '#9a9a9a'); },
  drain_pan: (c, x, y) => { rect(c, x, y + 3, 7, 2, '#2e5d8a'); },
  plug_wrench: (c, x, y) => { rect(c, x + 2, y, 1, 6, '#b5b5b5'); rect(c, x, y, 5, 1, '#b5b5b5'); },
  work_light: (c, x, y) => { rect(c, x + 1, y, 3, 4, '#f2d14b'); rect(c, x + 2, y + 4, 1, 2, '#333'); },
  jack: (c, x, y) => { rect(c, x, y + 4, 8, 2, '#c43c2c'); rect(c, x + 5, y + 1, 1, 3, '#c43c2c'); },
  stands: (c, x, y) => { rect(c, x, y + 1, 1, 5, '#d9a400'); rect(c, x + 3, y + 1, 1, 5, '#d9a400'); },
  battery_tester: (c, x, y) => { rect(c, x, y + 1, 5, 4, '#222'); rect(c, x + 1, y + 2, 3, 1, '#7fbf6a'); },
  torque_wrench: (c, x, y) => { rect(c, x, y + 2, 9, 1, '#b5b5b5'); rect(c, x + 7, y + 1, 2, 3, '#555'); },
};

export function draw(c: Ctx, d: SceneData, t: number) {
  c.imageSmoothingEnabled = false;
  const night = sky(c, d.hour, t);
  const open = d.hour >= 8 && d.hour < 21;
  // Земля
  rect(c, 0, 84, W, 24, night ? '#1c1d20' : '#3b3c3f');
  for (let x = 0; x < W; x += 16) rect(c, x + 4, 96, 8, 1, night ? '#2a2b2e' : '#55565a');
  // Здание
  const pro = d.stage >= 1;
  rect(c, 40, 18, 112, 66, pro ? '#7d7f84' : '#6a6560');
  for (let y = 22; y < 84; y += 6) for (let x = 40 + ((y / 6) % 2) * 6; x < 152; x += 12) rect(c, x, y, 1, 1, pro ? '#6f7176' : '#5a5550');
  rect(c, 36, 14, 120, 5, pro ? '#3c3f44' : '#3a3633');
  if (!pro) { rect(c, 44, 30, 1, 9, '#4d4844'); rect(c, 45, 38, 1, 6, '#4d4844'); rect(c, 140, 24, 6, 3, '#7a5a3a'); }
  // Табличка с названием (текст поверх в HTML)
  rect(c, 52, 3, 88, 9, '#1a1714');
  rect(c, 53, 4, 86, 7, pro ? '#26221c' : '#211d18');
  rect(c, 60, 12, 1, 2, '#333'); rect(c, 131, 12, 1, 2, '#333');
  // Внутри
  const gx = 50, gy = 26, gw = 92, gh = 58;
  const light = open || d.working;
  rect(c, gx, gy, gw, gh, light ? (pro ? '#5e6368' : '#3b3a39') : '#16171a');
  if (light) {
    if (pro) { rect(c, gx, gy + 40, gw, 2, '#d9a400'); for (let x = gx; x < gx + gw; x += 6) rect(c, x, gy + 40, 3, 2, '#222'); }
    else { rect(c, gx + 10, gy + 6, 14, 9, '#34312f'); rect(c, gx + 60, gy + 12, 1, 12, '#2e2c2a'); rect(c, gx + 61, gy + 22, 1, 5, '#2e2c2a'); }
    // Свет
    if (pro) { rect(c, gx + 18, gy + 1, 20, 2, '#f2f6f8'); rect(c, gx + 54, gy + 1, 20, 2, '#f2f6f8'); }
    else {
      rect(c, gx + 46, gy, 1, 6, '#222');
      const flick = Math.floor(t / 120) % 37 === 0;
      rect(c, gx + 45, gy + 6, 3, 3, flick ? '#806a30' : '#ffe08a');
      c.fillStyle = 'rgba(255, 220, 130, 0.07)';
      c.beginPath(); c.moveTo(gx + 46, gy + 8); c.lineTo(gx + 20, gy + gh); c.lineTo(gx + 72, gy + gh); c.closePath(); c.fill();
    }
    // Пол
    rect(c, gx, gy + 48, gw, 10, pro ? '#55585b' : '#4a4743');
    rect(c, gx + 30, gy + 53, 9, 2, '#2f2d2b'); rect(c, gx + 62, gy + 51, 5, 1, '#2f2d2b');
    // Верстак и щит с инструментом
    rect(c, gx + 4, gy + 36, 22, 3, pro ? '#596169' : '#5b4128');
    rect(c, gx + 5, gy + 39, 2, 9, pro ? '#3c4248' : '#3f2d1c'); rect(c, gx + 23, gy + 39, 2, 9, pro ? '#3c4248' : '#3f2d1c');
    if (pro) { rect(c, gx + 8, gy + 31, 8, 5, '#b8312a'); rect(c, gx + 8, gy + 33, 8, 1, '#7d1f1a'); }
    rect(c, gx + 3, gy + 12, 26, 18, pro ? '#3d4d5c' : '#6e5a3e');
    for (let y = gy + 14; y < gy + 30; y += 3) for (let x = gx + 5; x < gx + 29; x += 3) rect(c, x, y, 1, 1, pro ? '#2e3b47' : '#55452f');
    d.tools.slice(0, 9).forEach((id, i) => TOOL_ICONS[id]?.(c, gx + 4 + (i % 3) * 8, gy + 13 + Math.floor(i / 3) * 6));
    // Хлам старого гаража: покрышки в углу
    if (!pro) { for (let i = 0; i < 3; i++) { rect(c, gx + 80, gy + 38 + i * 4, 9, 4, '#1c1c1c'); rect(c, gx + 82, gy + 39 + i * 4, 5, 2, '#2d2d2d'); } }
    else { rect(c, gx + 82, gy + 30, 8, 18, '#3e4a56'); rect(c, gx + 83, gy + 32, 6, 1, '#7d8a96'); rect(c, gx + 83, gy + 36, 6, 1, '#7d8a96'); }
  }
  // Машина в работе и владелец
  if (d.working) {
    car(c, gx + 34, gy + 56, d.working.color, 38, !light, d.working.lifted ? 4 : 0);
    mechanic(c, gx + 74, gy + 56, t, true);
    rect(c, gx + 30, gy + 4, 32, 3, '#000');
    rect(c, gx + 31, gy + 5, Math.round(30 * d.working.progress), 1, '#f2a83b');
  } else if (light) mechanic(c, gx + 16, gy + 56, t, false);
  // Рольставня: поднята днём, опущена ночью
  const shutter = light ? 4 : gh;
  rect(c, gx - 2, gy - 2, gw + 4, 3, '#2c2c2e');
  for (let y = 0; y < shutter; y += 2) rect(c, gx, gy + y, gw, 1, light ? '#8e9094' : (y % 4 ? '#5e6064' : '#6c6e72'));
  // Очередь у ворот
  const spots: [number, number][] = [[4, 100], [158, 100], [36, 107], [124, 107]];
  d.queue.slice(0, 4).forEach((q, i) => {
    const [x, base] = spots[i];
    car(c, x, base, q.color, 30, night);
    if (q.flag && Math.floor(t / 500) % 2) { rect(c, x + 14, base - 24, 2, 5, '#f2a83b'); rect(c, x + 14, base - 18, 2, 2, '#f2a83b'); }
  });
}
