import type { ErrorRequestHandler } from "express";
import { plaidError } from "./plaid.js";

/**
 * Last middleware: Express 5 forwards thrown errors and rejected async handlers here. The failure is logged; the
 * JSON answer carries only Plaid's error message or a client error's (e.g. malformed JSON, with its 4xx), never
 * the text of an unexpected exception.
 */
export const jsonErrors: ErrorRequestHandler = (e, _req, res, _next) => {
  const d = plaidError(e);
  console.error(d ?? e);
  if (e?.expose) res.status(e.status).json({ error: e.message });
  else res.status(500).json({ error: d?.error_message ?? "Internal server error" });
};

/** Trim a user-supplied label; blank or non-string means "clear" (null). */
export const cleanLabel = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
