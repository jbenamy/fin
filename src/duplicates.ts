export interface DupAccount {
  account_id: string; item_id: string; institution: string; name: string; mask: string | null;
  type: string; subtype: string | null; current_balance: number | null; owner: string;
}
export interface DupMember { item_id: string; account_id: string; name: string; owner: string; balance: number | null }
export interface DupGroup {
  institution: string; type: string; subtype: string | null; mask: string;
  confidence: "high" | "likely"; members: DupMember[];
}
export interface DupConnection { institution: string; item_ids: string[] }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * The same real account showing up through more than one Item, e.g. spouses who each linked the
 * joint accounts. Match = same institution + same type + same last-4 mask, across different Items.
 * "high" when balances also agree to the cent, "likely" otherwise (balances can differ by refresh timing).
 */
export function findDuplicates(accounts: DupAccount[]): { accounts: DupGroup[]; connections: DupConnection[] } {
  const buckets = Map.groupBy(accounts.filter((a) => a.mask), (a) => [norm(a.institution), a.type, a.mask].join("|"));
  const groups: DupGroup[] = [];
  for (const list of buckets.values()) {
    if (new Set(list.map((a) => a.item_id)).size < 2) continue;
    const bal = list.map((a) => a.current_balance);
    const same = bal.every((b) => b != null && Math.abs(b - bal[0]!) < 0.005);
    groups.push({
      institution: list[0].institution, type: list[0].type, subtype: list[0].subtype, mask: list[0].mask!,
      confidence: same ? "high" : "likely",
      members: list.map((a) => ({ item_id: a.item_id, account_id: a.account_id, name: a.name, owner: a.owner, balance: a.current_balance })),
    });
  }
  groups.sort((a, b) => a.institution.localeCompare(b.institution) || a.mask.localeCompare(b.mask));

  // Whole connections that overlap completely: the same bank login linked twice (each Item is billed).
  const logins = [...Map.groupBy(accounts, (a) => a.item_id).values()].filter((l) => l.every((a) => a.mask));
  const sig = (l: DupAccount[]) => norm(l[0].institution) + "|" + l.map((a) => `${a.type}:${a.mask}`).sort().join(",");
  const connections = [...Map.groupBy(logins, sig).values()].filter((same) => same.length > 1)
    .map((same) => ({ institution: same[0][0].institution, item_ids: same.map((l) => l[0].item_id) }));
  return { accounts: groups, connections };
}
