import { Plaid, PlaidClient, PlaidEnvironment, PlaidError } from "plaid";

/** Plaid's error body ({ error_code, error_message, request_id, … }) on a failed API call, if the failure came from Plaid. */
export const plaidError = (e: unknown): Plaid.PlaidError | undefined =>
  e instanceof PlaidError && e.body && typeof e.body === "object" ? (e.body as Plaid.PlaidError) : undefined;

const ENVIRONMENTS: Record<string, PlaidEnvironment> = { production: PlaidEnvironment.Production, sandbox: PlaidEnvironment.Sandbox };
export const plaidEnv = process.env.PLAID_ENV ?? "production";
const environment = ENVIRONMENTS[plaidEnv];
if (!environment) throw new Error(`PLAID_ENV must be "production" or "sandbox", not "${plaidEnv}"`);

/** The Plaid API version every request pins (the Plaid-Version header); the About page shows it. */
export const PLAID_API_VERSION = "2020-09-14";

// The client reads PLAID_CLIENT_ID and PLAID_SECRET from the environment; a missing one fails each request, not startup.
export const plaid = new PlaidClient({ environment, version: PLAID_API_VERSION });
