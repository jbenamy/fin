import type { RequestHandler } from "express";

/** Async route wrapper: log the failure and answer with Plaid's error message (or the exception text) as JSON. */
export const wrap = (fn: RequestHandler): RequestHandler => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch((e) => {
    const d = e?.response?.data;
    console.error(d ?? e);
    res.status(500).json({ error: d?.error_message ?? String(e) });
  });

/** Trim a user-supplied label; blank or non-string means "clear" (null). */
export const cleanLabel = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
