import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

/** Plaid's error body ({ error_code, error_message }) on a failed API call, if the failure came from Plaid. */
export const plaidError = (e: any): { error_code?: string; error_message?: string } | undefined => e?.response?.data;

const env = process.env.PLAID_ENV ?? "production";
export const plaid = new PlaidApi(
  new Configuration({
    basePath: PlaidEnvironments[env],
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID ?? "",
        "PLAID-SECRET": process.env.PLAID_SECRET ?? "",
      },
    },
  }),
);
