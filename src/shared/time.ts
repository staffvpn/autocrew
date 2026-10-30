// Игровое время привязано к московскому часовому поясу (UTC+3, без перехода на летнее время).
export const MSK_OFFSET = 3 * 3600_000;
export const DAY_MS = 86_400_000;

export const mskDay = (ts: number) => new Date(ts + MSK_OFFSET).toISOString().slice(0, 10);
export const mskHour = (ts: number) => new Date(ts + MSK_OFFSET).getUTCHours();
// Начало следующих московских суток после ts
export const nextMidnight = (ts: number) => Math.floor((ts + MSK_OFFSET) / DAY_MS) * DAY_MS + DAY_MS - MSK_OFFSET;
