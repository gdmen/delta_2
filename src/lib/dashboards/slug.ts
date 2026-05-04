import { z } from "zod";

/**
 * Dashboard slugs become URL segments at /dashboards/[slug]. They must be
 * URL-safe AND not collide with existing top-level routes (otherwise users
 * could shadow real pages by creating a dashboard slugged "data" etc.).
 *
 * The same regex is enforced in three places:
 *   - src/app/dashboards/[slug]/page.tsx (read path, defensive)
 *   - the create / rename mutation routes (write path, normative)
 *   - src/lib/dashboards/slug.ts (this file, single source of truth)
 */
export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Reserved names: anything matching a sibling top-level route under src/app/.
 * Adding a new top-level route means adding it here. Lower-case, no leading
 * slash. Empty string is rejected by SLUG_PATTERN so we don't need it.
 */
export const RESERVED_SLUGS = new Set([
  "api",
  "_next",
  "dashboards",
  "data",
  "data-sources",
  "goals",
  "input",
  "recovery",
  "body-comp",
  // `sports` was a top-level route; PR4 deleted the per-sport pages but
  // we keep it reserved so future re-introduction (or sport-scoped
  // dashboards) doesn't collide with an existing user-created slug.
  "sports",
  "favicon.ico",
  // /dashboards/new is the create-dashboard page (a static segment that
  // takes precedence over [slug]) — reserve so a user can't shadow it.
  "new",
]);

export const slugSchema = z
  .string()
  .regex(SLUG_PATTERN, "Slug must be lowercase letters, digits, or dashes (1-64 chars).")
  .refine((s) => !RESERVED_SLUGS.has(s), {
    message: "Slug is reserved by another route.",
  });

/**
 * Generate a slug from a free-form name. Lowercases, replaces spaces with
 * dashes, strips characters outside [a-z0-9-], collapses runs of dashes,
 * trims leading/trailing dashes, caps at 64 chars. Returns the generated
 * slug, OR null if the result would be empty or reserved (caller surfaces
 * the error to the user).
 */
export function slugify(name: string): string | null {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  if (!slug) return null;
  if (!SLUG_PATTERN.test(slug)) return null;
  if (RESERVED_SLUGS.has(slug)) return null;
  return slug;
}
