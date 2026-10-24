// Icons for account groups and kinds (Lucide). Pages pick by the server's `group` / `kind`, never by type/subtype.
import {
  Briefcase, CircleDollarSign, CreditCard, GraduationCap, HandCoins, HeartPulse, Landmark, PiggyBank, Sunset, TrendingUp,
} from "@lucide/svelte";
import type { Kind } from "./types";

const GROUP_ICONS: Record<string, typeof Landmark> = {
  Checking: Landmark, Savings: PiggyBank, HSA: HeartPulse, "Credit Cards": CreditCard, Loans: HandCoins,
  Brokerage: TrendingUp, "401(k)": Briefcase, Retirement: Sunset, Education: GraduationCap,
};
export const groupIcon = (group: string) => GROUP_ICONS[group] ?? CircleDollarSign;

/** IconChip tone per account kind: cash green, investments accent, debt red. */
export const KIND_TONE = { cash: "ok", investment: "accent", debt: "bad", other: "neutral" } as const satisfies Record<Kind, string>;
