import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import type { TextCardConfig } from "./schema";

/**
 * Long-form notes the user writes themselves. Rendered through
 * react-markdown + rehype-sanitize so any HTML in the body is stripped
 * at render time (config in DB is unconstrained, but rendered output
 * never includes raw <script> / event handlers).
 */
export function TextCardComponent({ config }: { config: TextCardConfig }) {
  if (!config.body.trim()) {
    return (
      <div className="border border-border border-dashed rounded p-4 h-full flex items-center justify-center text-center text-[0.875rem] text-muted">
        Empty note. Open the gear to write something.
      </div>
    );
  }
  return (
    <div className="prose prose-sm max-w-none p-3 text-[0.875rem] leading-relaxed">
      <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{config.body}</ReactMarkdown>
    </div>
  );
}
