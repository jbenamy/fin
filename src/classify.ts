// Employer-sponsored plans get their own group; IRAs, pensions etc. stay under "Retirement".
const EMPLOYER_PLAN = new Set(["401k", "401a", "403b", "457b", "roth 401k", "thrift savings plan", "profit sharing plan"]);
const RETIREMENT = new Set([
  "ira", "roth", "sep ira", "simple ira", "sarsep", "keogh", "pension", "retirement", "non-custodial wallet",
]);

/** Display group for an account, derived from Plaid's type/subtype. */
export function accountGroup(type: string, subtype: string | null): string {
  const st = (subtype ?? "").toLowerCase();
  switch (type) {
    case "depository":
      if (st === "checking") return "Checking";
      if (st === "hsa") return "HSA";
      return "Savings";
    case "credit": return "Credit Cards";
    case "loan": return "Loans";
    case "investment":
      if (EMPLOYER_PLAN.has(st)) return "401(k)";
      if (RETIREMENT.has(st)) return "Retirement";
      if (st === "529") return "Education";
      return "Brokerage";
    default: return "Other";
  }
}

export const GROUP_ORDER = ["Checking", "Savings", "HSA", "Credit Cards", "Loans", "Brokerage", "401(k)", "Retirement", "Education", "Other"];

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);
const ORG = /\b(llc|inc|corp|trust|ltd|lp|estate|foundation|company|co)\b/i;
const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

/**
 * Normalise an account-holder name so "ALEX Q SMITH" and "Alex Smith" from different
 * institutions map to the same owner: first + last token, title-cased. Organisations keep their full name.
 */
function normalizeName(raw: string): { key: string; display: string } | null {
  const clean = raw.replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  if (ORG.test(clean)) return { key: clean.toLowerCase(), display: titleCase(clean) };
  const tokens = clean.split(" ").filter((t) => !SUFFIXES.has(t.toLowerCase()));
  if (tokens.length === 0) return null;
  const parts = tokens.length > 1 ? [tokens[0], tokens[tokens.length - 1]] : tokens;
  const display = titleCase(parts.join(" "));
  return { key: display.toLowerCase(), display };
}

/**
 * Collapse Plaid's owners (each with a list of name variants) into one label.
 * Joint accounts become "A & B" (sorted, so ordering is stable across institutions).
 */
export function ownerFromNames(owners: { names: string[] }[]): string | null {
  const seen = new Map<string, string>();
  for (const o of owners) {
    const n = o.names?.length ? normalizeName(o.names[0]) : null;
    if (n) seen.set(n.key, n.display);
  }
  if (seen.size === 0) return null;
  return [...seen.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, d]) => d).join(" & ");
}
