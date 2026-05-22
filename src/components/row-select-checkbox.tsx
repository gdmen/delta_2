"use client";

/**
 * A selectable row's checkbox, shared by every checkbox table. Encapsulates
 * the shift-click capture that's easy to get wrong and was a real bug:
 * `shiftKey` must be read from the click MouseEvent, because a checkbox's
 * `onChange` nativeEvent is a `change` event with no `shiftKey`. The no-op
 * `onChange` keeps the input controlled. Doing this in one place means the
 * shiftKey bug cannot be reintroduced by the next table someone adds.
 *
 * `onToggle` receives whether shift was held; the caller decides what a
 * shift-range means (it calls the selection hook's `toggleRange`). See #37.
 */
export function RowSelectCheckbox({
  checked,
  onToggle,
  disabled,
  ariaLabel,
  title,
  className,
}: {
  checked: boolean;
  onToggle: (shiftKey: boolean) => void;
  disabled?: boolean;
  ariaLabel: string;
  title?: string;
  className?: string;
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onClick={(e) => onToggle(e.shiftKey)}
      onChange={() => {}}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      className={className}
    />
  );
}
