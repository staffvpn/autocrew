// Каталоги AUTO CREW. Это контент, а не состояние: меняется только релизом.
// Все цены в рублях. Время работ в норма-часах (н/ч), 1 н/ч = NH_SECONDS реальных секунд.
// Значения ступеней и спроса согласованы с моделью tools/balance_sim.py.

export const CONTENT_VERSION = 1;
export const NH_SECONDS = 120;
export const START_CAPITAL = 60_000;
export const TAX_RATE = 0.06;
export const CONSUMABLES_RATE = 0.04; // расходники от стоимости работ
export const OPEN_HOUR = 8, CLOSE_HOUR = 21; // часы приёма клиентов по Москве
export const SLOT_MS = 15 * 60_000;
export const MAX_OFFLINE_DAYS = 60;
export const BANKRUPT_CASH = -15_000;
export const REP_GOOD = 2.5, REP_COMPLAINT = -8, REP_LEFT = -1, REP_SOFT = 60;

export type Platform = 'vaz' | 'kor' | 'eu' | 'jp';
export type Grade = 'eco' | 'orig';
export const GRADES: Record<Grade, { name: string; priceK: number }> = {
  eco: { name: 'Аналог', priceK: 0.65 },
  orig: { name: 'Оригинал', priceK: 1 },
};

// Модели машин клиентов. Названия похожи на настоящие, но не совпадают с ними.
export interface CarModel { id: string; name: string; platform: Platform; years: [number, number]; weight: number }
export const CAR_MODELS: CarModel[] = [
  { id: 'ladya_2107', name: 'Ладья 2107', platform: 'vaz', years: [1995, 2012], weight: 5 },
  { id: 'ladya_privora', name: 'Ладья Привора', platform: 'vaz', years: [2008, 2018], weight: 5 },
  { id: 'ladya_granda', name: 'Ладья Гранда', platform: 'vaz', years: [2012, 2024], weight: 7 },
  { id: 'shevrale_nava', name: 'Шеврале Нава', platform: 'vaz', years: [2003, 2020], weight: 3 },
  { id: 'hyonda_solarus', name: 'Хёнда Соларус', platform: 'kor', years: [2011, 2022], weight: 7 },
  { id: 'kiya_riya', name: 'Кия Рия', platform: 'kor', years: [2011, 2023], weight: 6 },
  { id: 'deu_nexa', name: 'Дэу Нэкса', platform: 'kor', years: [2002, 2016], weight: 3 },
  { id: 'reno_logun', name: 'Рэно Логун', platform: 'eu', years: [2006, 2021], weight: 5 },
  { id: 'folcvagen_pola', name: 'Фольцваген Пола', platform: 'eu', years: [2010, 2020], weight: 5 },
  { id: 'shkado_oktavia', name: 'Шкадо Октавиа', platform: 'eu', years: [2008, 2022], weight: 4 },
  { id: 'fort_fokus', name: 'Форт Фокус', platform: 'eu', years: [2005, 2018], weight: 4 },
  { id: 'taiota_koralla', name: 'Тайота Коралла', platform: 'jp', years: [2006, 2021], weight: 4 },
  { id: 'micubusi_lansor', name: 'Мицубуси Лансор', platform: 'jp', years: [2007, 2016], weight: 2 },
];
export const CAR_COLORS = ['#b8b8b0', '#2b2f36', '#8a1f1f', '#1f3f6e', '#e0ddd2', '#3d5a3a', '#6b5a3e', '#9c7a2c'];

// Запчасти. retail — розничная цена оригинала, клиент платит розницу выбранного качества.
export interface Part { id: string; name: string; platform?: Platform; retail: number; unit: string }
const byPlatform = (base: string, name: string, unit: string, prices: Record<Platform, number>): Part[] =>
  (Object.keys(prices) as Platform[]).map(p => ({ id: `${base}_${p}`, name, platform: p, retail: prices[p], unit }));
export const PLATFORM_NAMES: Record<Platform, string> = { vaz: 'отеч.', kor: 'кор.', eu: 'евр.', jp: 'яп.' };
export const PARTS: Part[] = [
  { id: 'engine_oil', name: 'Моторное масло 4 л', retail: 3600, unit: 'кан.' },
  ...byPlatform('oil_filter', 'Масляный фильтр', 'шт', { vaz: 380, kor: 650, eu: 750, jp: 700 }),
  ...byPlatform('air_filter', 'Воздушный фильтр', 'шт', { vaz: 450, kor: 800, eu: 900, jp: 850 }),
  ...byPlatform('cabin_filter', 'Салонный фильтр', 'шт', { vaz: 400, kor: 700, eu: 850, jp: 800 }),
  ...byPlatform('spark_plug', 'Свеча зажигания', 'шт', { vaz: 250, kor: 550, eu: 650, jp: 600 }),
  { id: 'bulb_h4', name: 'Лампа H4', retail: 450, unit: 'шт' },
  ...byPlatform('brake_pads', 'Колодки передние (к-т)', 'к-т', { vaz: 1600, kor: 2900, eu: 3400, jp: 3200 }),
  ...byPlatform('stab_link', 'Стойка стабилизатора', 'шт', { vaz: 650, kor: 1100, eu: 1400, jp: 1300 }),
  { id: 'battery_60', name: 'Аккумулятор 60 А·ч', retail: 8200, unit: 'шт' },
];
export const PART = Object.fromEntries(PARTS.map(p => [p.id, p])) as Record<string, Part>;
export const partPrice = (partId: string, grade: Grade) => Math.round(PART[partId].retail * GRADES[grade].priceK);

// Инструмент. durability — сколько работ до поломки. quality — снижение шанса претензии (в долях).
export interface Tool { id: string; name: string; price: number; durability: number; stage: number; quality?: number; desc: string }
export const TOOLS: Tool[] = [
  { id: 'wrench_set', name: 'Набор ключей и головок', price: 6500, durability: 250, stage: 0, desc: 'Без него не сделать ничего' },
  { id: 'filter_wrench', name: 'Съёмник масляных фильтров', price: 900, durability: 200, stage: 0, desc: 'Нужен для замены масла' },
  { id: 'drain_pan', name: 'Ёмкость для слива масла', price: 1200, durability: 400, stage: 0, desc: 'Нужна для замены масла' },
  { id: 'plug_wrench', name: 'Свечной ключ', price: 750, durability: 200, stage: 0, desc: 'Нужен для замены свечей' },
  { id: 'work_light', name: 'Переносная лампа', price: 1400, durability: 300, stage: 0, quality: 0.01, desc: 'Видно, что делаешь: претензий меньше' },
  { id: 'jack', name: 'Подкатной домкрат 2 т', price: 4800, durability: 300, stage: 1, desc: 'Для тормозов и подвески' },
  { id: 'stands', name: 'Страховочные подставки', price: 2600, durability: 500, stage: 1, desc: 'Без них под машину не лезут' },
  { id: 'battery_tester', name: 'Тестер аккумуляторов', price: 2900, durability: 300, stage: 1, desc: 'Для проверки и замены АКБ' },
  { id: 'torque_wrench', name: 'Динамометрический ключ', price: 5400, durability: 300, stage: 1, quality: 0.02, desc: 'Правильная затяжка: претензий меньше' },
];
export const TOOL = Object.fromEntries(TOOLS.map(t => [t.id, t])) as Record<string, Tool>;
export const TOOL_REPAIR_K = 0.35;

// Виды работ. parts — функция от платформы машины. symptoms — что говорит клиент до осмотра.
export interface JobType { id: string; name: string; nh: number; stage: number; tools: string[]; parts: (p: Platform) => [string, number][]; weight: number; symptom: string }
export const JOBS: JobType[] = [
  { id: 'oil_change', name: 'Замена масла и фильтра', nh: 0.5, stage: 0, tools: ['wrench_set', 'filter_wrench', 'drain_pan'], parts: p => [['engine_oil', 1], [`oil_filter_${p}`, 1]], weight: 10, symptom: 'service' },
  { id: 'air_filter', name: 'Замена воздушного фильтра', nh: 0.2, stage: 0, tools: ['wrench_set'], parts: p => [[`air_filter_${p}`, 1]], weight: 4, symptom: 'sluggish' },
  { id: 'cabin_filter', name: 'Замена салонного фильтра', nh: 0.3, stage: 0, tools: ['wrench_set'], parts: p => [[`cabin_filter_${p}`, 1]], weight: 4, symptom: 'cabin_smell' },
  { id: 'spark_plugs', name: 'Замена свечей зажигания', nh: 0.6, stage: 0, tools: ['wrench_set', 'plug_wrench'], parts: p => [[`spark_plug_${p}`, 4]], weight: 5, symptom: 'misfire' },
  { id: 'bulb', name: 'Замена лампы фары', nh: 0.2, stage: 0, tools: ['wrench_set'], parts: () => [['bulb_h4', 1]], weight: 3, symptom: 'headlight' },
  { id: 'brake_pads', name: 'Замена передних колодок', nh: 1.0, stage: 1, tools: ['wrench_set', 'jack', 'stands'], parts: p => [[`brake_pads_${p}`, 1]], weight: 6, symptom: 'brake_squeal' },
  { id: 'battery', name: 'Замена аккумулятора', nh: 0.3, stage: 1, tools: ['wrench_set', 'battery_tester'], parts: () => [['battery_60', 1]], weight: 4, symptom: 'no_start' },
  { id: 'stab_links', name: 'Замена стоек стабилизатора', nh: 0.8, stage: 1, tools: ['wrench_set', 'jack', 'stands'], parts: p => [[`stab_link_${p}`, 2]], weight: 5, symptom: 'front_knock' },
];
export const JOB = Object.fromEntries(JOBS.map(j => [j.id, j])) as Record<string, JobType>;
// Один симптом может означать разные работы — поэтому нужен осмотр.
export const SYMPTOMS: Record<string, string[]> = {
  service: ['Пора на ТО, масло давно не меняли', 'Приехал поменять масло, пробег подошёл'],
  sluggish: ['Машина стала вялой, расход вырос', 'Плохо тянет в горку'],
  cabin_smell: ['Из печки пахнет сыростью', 'Окна потеют изнутри'],
  misfire: ['Троит, дёргается на холостых', 'Машина стала вялой, расход вырос'],
  headlight: ['Не горит левая фара', 'Не горит фара, ГАИ уже остановило'],
  brake_squeal: ['Скрипит при торможении', 'Тормоза свистят и хуже держат'],
  no_start: ['По утрам плохо заводится', 'Вчера не завелась, прикуривали'],
  front_knock: ['Стучит спереди на кочках', 'Что-то брякает в подвеске'],
};
export const CUSTOMER_NAMES = ['Сергей', 'Андрей', 'Ольга', 'Дмитрий', 'Марина', 'Алексей', 'Игорь', 'Наталья', 'Виктор', 'Елена', 'Павел', 'Ринат', 'Артём', 'Светлана', 'Михаил', 'Тимур', 'Галина Петровна', 'Олег', 'Юлия', 'Николай'];

// Поставщики. priceK — закупочная цена от розницы, defect — доля брака по качеству.
export interface Supplier { id: string; name: string; stage: number; priceK: number; deliveryMin: number; fee: number; minOrder: number; reliability: number; delayMin: [number, number]; defect: Record<Grade, number>; desc: string }
export const SUPPLIERS: Supplier[] = [
  { id: 'corner', name: 'Автомагазин «У дома»', stage: 0, priceK: 0.95, deliveryMin: 4, fee: 0, minOrder: 0, reliability: 1, delayMin: [0, 0], defect: { eco: 0.05, orig: 0.01 }, desc: 'Самовывоз за углом. Дорого, зато сразу и без минимальной суммы.' },
  { id: 'opt', name: 'Автодеталь-Опт', stage: 1, priceK: 0.8, deliveryMin: 45, fee: 350, minOrder: 4000, reliability: 0.88, delayMin: [30, 120], defect: { eco: 0.06, orig: 0.01 }, desc: 'Оптовый склад с доставкой. Дешевле на 15%, но заказ от 4 000 ₽ и курьер иногда опаздывает.' },
];
export const SUPPLIER = Object.fromEntries(SUPPLIERS.map(s => [s.id, s])) as Record<string, Supplier>;

// Реклама: увеличивает поток клиентов на время. Одновременно действует одна.
export interface Ad { id: string; name: string; price: number; mult: number; hours: number; stage: number }
export const ADS: Ad[] = [
  { id: 'board', name: 'Объявление на доске у гаражей', price: 300, mult: 1.25, hours: 24, stage: 0 },
  { id: 'forum', name: 'Пост на районном форуме', price: 1500, mult: 1.6, hours: 48, stage: 0 },
  { id: 'flyers', name: 'Листовки на парковке ТЦ', price: 3000, mult: 1.9, hours: 72, stage: 1 },
];
export const AD = Object.fromEntries(ADS.map(a => [a.id, a])) as Record<string, Ad>;

// Цена работы относительно рыночной ставки. Чем дороже, тем чаще клиент отказывается.
export const PRICE_LEVELS: Record<string, { name: string; k: number }> = {
  low: { name: 'Дешевле рынка', k: 0.85 },
  market: { name: 'По рынку', k: 1 },
  high: { name: 'Дороже рынка', k: 1.2 },
};

// Ступени бизнеса. Стоимость и пороги — из tools/balance_sim.py.
export interface Stage { id: number; name: string; desc: string; cost: number; needRep: number; needOrders: number; rent: number; utilities: number; laborRate: number; demandBase: number; demandK: number; demandCap: number; queueCap: number; bays: number; available: boolean; unlocks: string[] }
export const STAGES: Stage[] = [
  { id: 0, name: 'Пустой гараж', desc: 'Старый гараж в кооперативе на окраине. Голые стены, верстак и лампочка.', cost: 0, needRep: 0, needOrders: 0, rent: 700, utilities: 150, laborRate: 1200, demandBase: 3, demandK: 0.05, demandCap: 9, queueCap: 3, bays: 1, available: true, unlocks: [] },
  { id: 1, name: 'Оборудованный гараж', desc: 'Ремонт, свет, нормальный верстак и проводка под инструмент.', cost: 30_000, needRep: 15, needOrders: 8, rent: 700, utilities: 300, laborRate: 1500, demandBase: 4, demandK: 0.05, demandCap: 10, queueCap: 4, bays: 1, available: true, unlocks: ['Тормоза, подвеска и аккумуляторы', 'Поставщик «Автодеталь-Опт»', 'Листовки', 'Ставка 1 500 ₽/н·ч'] },
  { id: 2, name: 'Первый механик', desc: 'Второе место в гараже и наёмный механик.', cost: 15_000, needRep: 45, needOrders: 30, rent: 1000, utilities: 300, laborRate: 1500, demandBase: 5, demandK: 0.05, demandCap: 14, queueCap: 5, bays: 2, available: false, unlocks: ['Найм механика', 'Второе место', 'Работа без тебя до 8 часов'] },
];
