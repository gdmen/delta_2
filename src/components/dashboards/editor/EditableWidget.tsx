"use client";

import { memo, type ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Settings, Trash2 } from "lucide-react";

interface EditableWidgetProps {
  id: number;
  gridW: number;
  gridH: number;
  /**
   * Server-rendered widget content from the renderer. Passed as children
   * (vs. rendering the widget client-side here) so chart widgets keep
   * their RSC + Recharts client-only boundary intact during edit.
   */
  children: ReactNode;
  /**
   * Handlers take the widget id rather than closing over it so the parent
   * can pass stable function references — memoizing here actually
   * prevents 60fps re-renders during drag. Inline closures from the
   * parent would defeat the comparator.
   */
  onSettingsById: (id: number) => void;
  onDeleteById: (id: number) => void;
}

/**
 * One widget cell in edit mode. Hover-revealed handles for drag (top-left),
 * settings (top-right), and delete (top-right next to settings). Hairline
 * outline at rest, foreground outline on hover/focus, dashed during a
 * drop-target hover.
 *
 * Memoized so chart widgets don't re-render at 60fps during drag. The
 * comparator ignores transform/drag-state because dnd-kit applies those
 * via a ref bypass; only widget-identity, size, content, and the parent's
 * stable handlers gate a real re-render.
 */
export const EditableWidget = memo(
  function EditableWidget({
    id,
    gridW,
    gridH,
    children,
    onSettingsById,
    onDeleteById,
  }: EditableWidgetProps) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } =
      useSortable({ id });

    const style = {
      transform: CSS.Translate.toString(transform),
      transition,
      gridColumn: `span ${gridW}`,
      gridRow: `span ${gridH}`,
      containerType: "inline-size",
      opacity: isDragging ? 0.4 : 1,
    } as const;

    const outlineClass = isOver
      ? "outline outline-1 outline-foreground outline-dashed"
      : "outline outline-1 outline-border hover:outline-foreground";

    return (
      <div
        ref={setNodeRef}
        style={style}
        className={`relative group rounded-md ${outlineClass}`}
      >
        {children}
        {/* Drag handle: 4 lines, top-left, hover-revealed. Click + drag,
            or Tab + Space + arrows for keyboard. */}
        <button
          type="button"
          aria-label="Drag widget"
          className="absolute top-1 left-1 w-7 h-7 rounded flex items-center justify-center text-text-tertiary hover:text-foreground hover:bg-surface opacity-0 group-hover:opacity-100 focus-visible:opacity-100 cursor-grab active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical size={16} />
        </button>
        {/* Settings + delete cluster, top-right. */}
        <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            aria-label="Widget settings"
            onClick={() => onSettingsById(id)}
            className="w-7 h-7 rounded flex items-center justify-center text-text-tertiary hover:text-foreground hover:bg-surface"
          >
            <Settings size={14} />
          </button>
          <button
            type="button"
            aria-label="Delete widget"
            onClick={() => onDeleteById(id)}
            className="w-7 h-7 rounded flex items-center justify-center text-text-tertiary hover:text-accent-red hover:bg-surface"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    );
  },
);
