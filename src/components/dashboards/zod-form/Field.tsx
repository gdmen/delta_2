"use client";

import { useFormContext, useController } from "react-hook-form";
import type { FieldMeta } from "@/lib/widgets/types";
import type { FormContext as PickerContext } from "./types";

/**
 * One form field. Looks up `uiMeta[name].component` to pick the right
 * renderer. For unknown components or unspecified meta, falls back to a
 * text input — graceful but flagged in the label.
 *
 * Uses `useController` (not the bare `register` API) so we can render
 * controlled inputs uniformly across pickers (which need value + onChange)
 * and native inputs.
 */
export function Field({
  name,
  meta,
  context,
}: {
  name: string;
  meta: FieldMeta;
  context: PickerContext;
}) {
  const { control } = useFormContext();
  const { field, fieldState } = useController({ name, control });

  const label = meta.label ?? name;
  const help = meta.helpText;
  const component = meta.component ?? "text";

  return (
    <div>
      <label htmlFor={name} className="block text-[0.8125rem] font-medium mb-1">
        {label}
      </label>
      {renderControl(component, name, field, meta, context)}
      {help && <p className="mt-1 text-[0.75rem] text-muted">{help}</p>}
      {fieldState.error && (
        <p className="mt-1 text-[0.75rem] text-accent-red">{fieldState.error.message}</p>
      )}
    </div>
  );
}

/**
 * `field` is RHF's controller API: { value, onChange, onBlur, ref }.
 * Component variants:
 *   text:          plain string input
 *   number:        numeric input, coerces to number on change
 *   select:        <select> with meta.options
 *   metric-picker: dropdown of metric_types by name (value = name string)
 *   sport-picker:  dropdown of sports by name (value = name string), with — None — option
 *   boolean:       checkbox
 */
function renderControl(
  component: NonNullable<FieldMeta["component"]>,
  name: string,
  field: ReturnType<typeof useController>["field"],
  meta: FieldMeta,
  context: PickerContext,
) {
  const baseInputClass =
    "w-full px-3 py-2 border border-border rounded text-[0.875rem] focus:outline-none focus:border-foreground bg-background";

  if (component === "number") {
    return (
      <input
        id={name}
        type="number"
        className={`${baseInputClass} font-mono`}
        value={field.value ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          field.onChange(v === "" ? undefined : Number(v));
        }}
        onBlur={field.onBlur}
        ref={field.ref}
      />
    );
  }

  if (component === "boolean") {
    return (
      <label className="inline-flex items-center gap-2">
        <input
          id={name}
          type="checkbox"
          checked={Boolean(field.value)}
          onChange={(e) => field.onChange(e.target.checked)}
          onBlur={field.onBlur}
          ref={field.ref}
        />
        <span className="text-[0.8125rem] text-muted">{meta.helpText ?? "Enabled"}</span>
      </label>
    );
  }

  if (component === "select") {
    return (
      <select
        id={name}
        className={baseInputClass}
        value={field.value ?? ""}
        onChange={(e) => field.onChange(e.target.value)}
        onBlur={field.onBlur}
        ref={field.ref}
      >
        {meta.options?.map((o) => (
          <option key={String(o.value)} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }

  if (component === "metric-picker") {
    return (
      <select
        id={name}
        className={baseInputClass}
        value={field.value ?? ""}
        onChange={(e) => field.onChange(e.target.value)}
        onBlur={field.onBlur}
        ref={field.ref}
      >
        <option value="">— Select metric —</option>
        {context.metricTypes.map((m) => (
          <option key={m.id} value={m.name}>
            {m.name}
            {m.unit ? ` (${m.unit})` : ""}
          </option>
        ))}
      </select>
    );
  }

  if (component === "sport-picker") {
    return (
      <select
        id={name}
        className={baseInputClass}
        value={field.value ?? ""}
        onChange={(e) => field.onChange(e.target.value === "" ? null : e.target.value)}
        onBlur={field.onBlur}
        ref={field.ref}
      >
        <option value="">— Any —</option>
        {context.sports.map((s) => (
          <option key={s.id} value={s.name}>
            {s.name}
          </option>
        ))}
      </select>
    );
  }

  // Default: text
  return (
    <input
      id={name}
      type="text"
      className={baseInputClass}
      value={field.value ?? ""}
      onChange={(e) => field.onChange(e.target.value)}
      onBlur={field.onBlur}
      ref={field.ref}
    />
  );
}
