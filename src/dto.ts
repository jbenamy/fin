import { accountGroup, accountKind, groupRank, signedBalance } from "./classify.js";
import type { AccountViewRow } from "./types.js";

/**
 * The account shape the pages consume. The server owns the display rules (effective group, group order,
 * credit/loan sign, cash/investment/debt bucket) so the three pages don't each re-implement them.
 */
export function accountDto(a: AccountViewRow) {
  const group = a.group_override || accountGroup(a.type, a.subtype);
  return {
    account_id: a.account_id, item_id: a.item_id, name: a.name, mask: a.mask, type: a.type, subtype: a.subtype,
    group, group_rank: groupRank(group), kind: accountKind(a.type), hidden: !!a.hidden,
    owner: a.owner, owner_detected: a.owner_detected, owner_override: a.owner_override, group_override: a.group_override,
    balance: signedBalance(a.type, a.current_balance), available: a.available_balance,
    currency: a.currency ?? "USD", updated_at: a.updated_at,
  };
}
