// Calendar dates as stored everywhere in the database: YYYY-MM-DD, UTC.

export const DAY_MS = 86_400_000;

/** YYYY-MM-DD (UTC) of a time in ms or a Date; now by default. */
export const isoDate = (t: number | Date = Date.now()) => new Date(t).toISOString().slice(0, 10);

/** Days from date `a` to date `b` (YYYY-MM-DD), possibly fractional or negative. */
export const daysBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / DAY_MS;
