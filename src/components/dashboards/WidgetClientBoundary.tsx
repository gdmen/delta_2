"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { WidgetErrorFallback } from "./WidgetErrorFallback";
import type { WidgetErrorInfo } from "@/lib/widgets/types";

interface Props {
  children: ReactNode;
  info: Omit<WidgetErrorInfo, "reason" | "canEdit" | "debugInfo">;
  debug: boolean;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-time throws from a widget Component and renders the typed
 * fallback in its place. Server-side try/catch in WidgetSlot covers schema
 * parse + validate hook errors (errors thrown synchronously before React
 * traversal); this Client boundary catches everything else (Component body
 * throws during render, hydration mismatches, descendant lifecycle errors).
 *
 * Plain class component because React 19 has no functional error boundary
 * primitive yet.
 */
export class WidgetClientBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      `[widget #${this.props.info.widgetId} ${this.props.info.widgetType}] render error`,
      error,
      info,
    );
  }

  render() {
    if (this.state.error) {
      return (
        <WidgetErrorFallback
          info={{
            ...this.props.info,
            reason: "Widget failed to render.",
            canEdit: true,
            debugInfo: {
              error: this.state.error.message,
              stack: this.state.error.stack,
            },
          }}
          debug={this.props.debug}
        />
      );
    }
    return this.props.children;
  }
}
