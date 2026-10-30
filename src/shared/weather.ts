// Погода за окном. Одна на всех игроков: детерминирована по 3-часовым блокам московского времени
// и зависит от сезона. Позже будет влиять на спрос (дворники, аккумуляторы зимой, шины).
import { rng } from './rng';
import { MSK_OFFSET } from './time';

export type Weather = 'clear' | 'cloudy' | 'rain' | 'snow';
// Вероятности [дождь, снег, облачно] по месяцам (январь = 0)
const SEASON: [number, number, number][] = [
  [0.02, 0.4, 0.35], [0.02, 0.35, 0.35], [0.1, 0.2, 0.35], [0.25, 0.05, 0.35], [0.25, 0, 0.3], [0.25, 0, 0.25],
  [0.25, 0, 0.25], [0.25, 0, 0.25], [0.3, 0, 0.35], [0.35, 0.05, 0.35], [0.2, 0.25, 0.4], [0.03, 0.4, 0.35],
];

export function weatherAt(ts: number): Weather {
  const block = Math.floor((ts + MSK_OFFSET) / (3 * 3600_000));
  const month = new Date(ts + MSK_OFFSET).getUTCMonth();
  const [rain, snow, cloudy] = SEASON[month];
  const x = rng(`wx:${block}`).next();
  return x < rain ? 'rain' : x < rain + snow ? 'snow' : x < rain + snow + cloudy ? 'cloudy' : 'clear';
}
export const WEATHER_NAMES: Record<Weather, string> = { clear: 'ясно', cloudy: 'пасмурно', rain: 'дождь', snow: 'снег' };
