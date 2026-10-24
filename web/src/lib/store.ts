/** localStorage that never throws (private windows, blocked storage): reads fall back, writes are dropped. */
export const store = {
  get(key: string, fallback: string | null = null) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } },
  set(key: string, value: string) { try { localStorage.setItem(key, value); } catch {} },
  remove(key: string) { try { localStorage.removeItem(key); } catch {} },
};
