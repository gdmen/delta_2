import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type LinkProps = Omit<ComponentProps<typeof Link>, "href">;

/**
 * Renders a next/link when href is set; otherwise renders a <span>
 * with the same className so layout (flex, padding, etc.) is preserved.
 * Used to centralize the share-mode pattern across widgets: callers
 * pass `href={shareMode ? undefined : "/authed/path"}` and this
 * component drops the in-app navigation affordance when the page is
 * being rendered for an unauthenticated share-link viewer.
 *
 * Callers strip hover:* classes themselves when they don't want a
 * non-functional hover affordance — the span fallback otherwise still
 * applies those styles on hover, which looks misleading.
 *
 * For block-level row affordances with their own hover treatments
 * (FocusCard, GoalBar), the leaf component implements the same pattern
 * inline because the styling differs between linked and unlinked
 * states (no hover background on plain rows).
 */
export function MaybeLink({
  href,
  children,
  className,
  ...rest
}: LinkProps & { href: string | undefined; children: ReactNode }) {
  if (href) {
    return (
      <Link href={href} className={className} {...rest}>
        {children}
      </Link>
    );
  }
  return <span className={className}>{children}</span>;
}
