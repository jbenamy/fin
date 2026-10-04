import { plaid } from "./plaid.js";

export interface PlaidItemStatus {
  error: string | null; update_type: string | undefined; consent_expiration_time: string | null; consented_products: string[];
  transactions_last_success: string | null; transactions_last_failure: string | null;
  investments_last_success: string | null; investments_last_failure: string | null;
  fetched_at: string;
}
export type PlaidStatusResult = { info: PlaidItemStatus; error: null } | { info: null; error: string };

// /item/get is cheap but the Connections page called it for every connection on every load. Cache successes briefly;
// a sync, unlink or consent change drops the entry, and ?refresh=1 bypasses the cache.
const TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; info: PlaidItemStatus }>();

export function invalidatePlaidStatus(itemId: string) { cache.delete(itemId); }

export async function getPlaidStatus(itemId: string, accessToken: string, force = false): Promise<PlaidStatusResult> {
  const hit = cache.get(itemId);
  if (!force && hit && Date.now() - hit.at < TTL_MS) return { info: hit.info, error: null };
  try {
    const { data } = await plaid.itemGet({ access_token: accessToken });
    const info: PlaidItemStatus = {
      error: data.item.error ? `${data.item.error.error_code}: ${data.item.error.error_message}` : null,
      update_type: data.item.update_type,
      consent_expiration_time: data.item.consent_expiration_time ?? null,
      consented_products: data.item.consented_products ?? [],
      transactions_last_success: data.status?.transactions?.last_successful_update ?? null,
      transactions_last_failure: data.status?.transactions?.last_failed_update ?? null,
      investments_last_success: data.status?.investments?.last_successful_update ?? null,
      investments_last_failure: data.status?.investments?.last_failed_update ?? null,
      fetched_at: new Date().toISOString(),
    };
    cache.set(itemId, { at: Date.now(), info });
    return { info, error: null };
  } catch (e: any) {
    return { info: null, error: e?.response?.data?.error_code ?? String(e) };
  }
}
