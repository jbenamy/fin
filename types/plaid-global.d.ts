// Plaid's Link script (loaded from cdn.plaid.com on /accounts) defines this global.
declare const Plaid: { create(options: Record<string, unknown>): { open(): void } };
