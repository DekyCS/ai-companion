// Game time is a whole number of minutes since midnight at the start of day 1 (a Monday).

export const DAY = 1440;
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

const pad = (n: number) => String(n).padStart(2, '0');

export function dayOf(t: number): number {
  return Math.floor(t / DAY) + 1;
}

export function minuteOfDay(t: number): number {
  return ((t % DAY) + DAY) % DAY;
}

export function hourOf(t: number): number {
  return Math.floor(minuteOfDay(t) / 60);
}

export function clock(t: number): string {
  const m = minuteOfDay(t);
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export function weekday(t: number): string {
  return WEEKDAYS[(dayOf(t) - 1) % 7] as string;
}

export function isSunday(t: number): boolean {
  return (dayOf(t) - 1) % 7 === 6;
}

export function isWeekend(t: number): boolean {
  return (dayOf(t) - 1) % 7 >= 5;
}

/** Bedtime hours: Khina tires faster and bed scores higher. */
export function isNight(t: number): boolean {
  const h = hourOf(t);
  return h >= 21 || h < 6;
}

export function isDark(t: number): boolean {
  const h = hourOf(t);
  return h >= 20 || h < 6;
}

export function partOfDay(t: number): string {
  const h = hourOf(t);
  if (h < 5) return 'night';
  if (h < 8) return 'early morning';
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  if (h < 21) return 'evening';
  return 'night';
}

/** The game time of the next 06:00 after t. */
export function nextMorning(t: number): number {
  const sixToday = (dayOf(t) - 1) * DAY + 360;
  return t < sixToday ? sixToday : sixToday + DAY;
}

/** How long ago something happened, in words. */
export function ago(now: number, then: number): string {
  const d = now - then;
  if (d < 30) return 'just now';
  if (d < 120) return 'a little while ago';
  if (dayOf(now) === dayOf(then)) return `this ${partOfDay(then)}`;
  if (dayOf(now) - dayOf(then) === 1) return 'yesterday';
  return 'a few days ago';
}

export function stamp(t: number): string {
  return `${weekday(t).slice(0, 3)} ${clock(t)}`;
}
