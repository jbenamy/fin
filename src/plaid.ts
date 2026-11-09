import { Plaid, PlaidClient, PlaidEnvironment, PlaidError } from "plaid";

/** Plaid's error body ({ error_code, error_message, request_id, … }) on a failed API call, if the failure came from Plaid. */
export const plaidError = (e: unknown): Plaid.PlaidError | undefined =>
  e instanceof PlaidError && e.body && typeof e.body === "object" ? (e.body as Plaid.PlaidError) : undefined;

const ENVIRONMENTS: Record<string, PlaidEnvironment> = { production: PlaidEnvironment.Production, sandbox: PlaidEnvironment.Sandbox };
const env = process.env.PLAID_ENV ?? "production";
const environment = ENVIRONMENTS[env];
if (!environment) throw new Error(`PLAID_ENV must be "production" or "sandbox", not "${env}"`);

// The client reads PLAID_CLIENT_ID and PLAID_SECRET from the environment; a missing one fails each request, not startup.
export const plaid = new PlaidClient({ environment });
