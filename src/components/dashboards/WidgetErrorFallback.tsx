import type { WidgetErrorInfo } from "@/lib/widgets/types";

/**
 * Server-rendered error state for a widget that failed to render. Edit/Delete
 * buttons are inert here; PR3's editor wraps widgets in a Client component
 * that hooks them up to the mutation API.
 *
 * In dev or when ?debug=1 is present, the Debug info <details> is rendered.
 * `debug` is decided by the caller (the WidgetSlot reads searchParams + env).
 */
export function WidgetErrorFallback({
  info,
  debug,
}: {
  info: WidgetErrorInfo;
  debug: boolean;
}) {
  return (
    <div
      role="alert"
      className="border border-border rounded-md bg-surface p-4 flex flex-col gap-2 h-full"
    >
      <div className="text-[0.75rem] uppercase tracking-wider text-accent-orange">
        Widget unavailable
      </div>
      <p className="text-[0.875rem] text-foreground">{info.reason}</p>
      <div className="mt-auto flex gap-2 text-[0.75rem] text-muted">
        <span>widget #{info.widgetId}</span>
        <span>·</span>
        <span className="font-mono">{info.widgetType}</span>
      </div>
      {debug && info.debugInfo && (
        <details className="mt-2 text-[0.75rem] text-text-tertiary">
          <summary className="cursor-pointer">Debug info</summary>
          <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-[0.6875rem]">
            {info.debugInfo.error}
            {info.debugInfo.stack && `\n\n${info.debugInfo.stack}`}
            {`\n\nconfig: ${JSON.stringify(info.config, null, 2)}`}
          </pre>
        </details>
      )}
    </div>
  );
}
