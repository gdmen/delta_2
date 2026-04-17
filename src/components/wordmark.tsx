/**
 * Renders "Delta" (or any child text) in the site's wordmark font.
 * Use inline inside copy whenever referring to the product by name, e.g.
 * "<Wordmark>Delta</Wordmark> extracts the values..."
 */
export function Wordmark({ children = "Delta" }: { children?: React.ReactNode }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-wordmark)",
        fontWeight: 700,
        letterSpacing: "-0.04em",
      }}
    >
      {children}
    </span>
  );
}
