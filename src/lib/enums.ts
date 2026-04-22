/**
 * Shared string unions that appear in multiple schema columns AND in
 * API validation / type annotations. Declaring them once here keeps
 * the drizzle enum arrays and app-level type guards in sync.
 */

export const STATUSES = ["active", "completed", "abandoned"] as const;
export type Status = typeof STATUSES[number];

export function isStatus(s: string): s is Status {
  return (STATUSES as readonly string[]).includes(s);
}
