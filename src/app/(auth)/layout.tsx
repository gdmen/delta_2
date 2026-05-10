/**
 * Auth route group. Renders /signin and /signup WITHOUT the sidebar
 * — the user can't be using the sidebar before they're signed in
 * anyway, and the sidebar's `loadAllDashboards()` would 500 if
 * called from an unauth state.
 *
 * Form-as-hero UI: single 360px card centered on the viewport. No
 * marketing chrome.
 */
export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-[360px]">{children}</div>
    </div>
  );
}
