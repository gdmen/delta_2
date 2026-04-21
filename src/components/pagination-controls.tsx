import Link from "next/link";

interface Props {
  currentPage: number;
  pageCount: number;
  linkWithPage: (page: number) => string;
  className?: string;
}

/**
 * Shared Prev/Next pagination controls. Rendered above AND below long
 * tables so users don't have to scroll to paginate. Returns null when
 * there's only one page.
 */
export function PaginationControls({
  currentPage,
  pageCount,
  linkWithPage,
  className = "",
}: Props) {
  if (pageCount <= 1) return null;

  return (
    <div
      className={`flex items-center justify-between text-[0.8125rem] ${className}`}
    >
      <div className="flex gap-2">
        {currentPage > 1 ? (
          <Link
            href={linkWithPage(currentPage - 1)}
            className="px-3 py-1.5 border border-border rounded hover:bg-surface"
          >
            ← Prev
          </Link>
        ) : (
          <span className="px-3 py-1.5 border border-border rounded text-muted opacity-50">
            ← Prev
          </span>
        )}
        {currentPage < pageCount ? (
          <Link
            href={linkWithPage(currentPage + 1)}
            className="px-3 py-1.5 border border-border rounded hover:bg-surface"
          >
            Next →
          </Link>
        ) : (
          <span className="px-3 py-1.5 border border-border rounded text-muted opacity-50">
            Next →
          </span>
        )}
      </div>
      <span className="font-mono text-[0.6875rem] text-muted">
        Page {currentPage} / {pageCount}
      </span>
    </div>
  );
}
