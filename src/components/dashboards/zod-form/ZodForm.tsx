"use client";

import { useEffect, useRef } from "react";
import {
  useForm,
  FormProvider,
  useWatch,
  type FieldValues,
  type DefaultValues,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ZodObject } from "zod";
import type { UIMeta } from "@/lib/widgets/types";
import type { FormContext as PickerContext } from "./types";
import { Field } from "./Field";

/**
 * Auto-generated form for a widget's flat-object Zod schema. Iterates the
 * schema's `.shape` to render one Field per property, using the matching
 * uiMeta entry to pick the input component.
 *
 * For non-object schemas (e.g. metric_strip's `{ metrics: array(...) }`),
 * the caller supplies a custom settings component instead — ZodForm only
 * handles flat objects in PR3. The "edit JSON directly" fallback for
 * complex schemas is handled at the SettingsDrawer level.
 *
 * Generic boundary handling: RHF expects a concrete FieldValues type; we
 * accept any P at the boundary and cast to FieldValues internally. The
 * uiMeta + schema lock the shape down, so the cast is safe in practice.
 */
export function ZodForm<P>({
  schema,
  uiMeta,
  defaultValues,
  context,
  onSubmit,
  onWatch,
}: {
  schema: ZodObject;
  uiMeta: UIMeta<P>;
  defaultValues: P;
  context: PickerContext;
  onSubmit?: (values: P) => void;
  onWatch?: (values: P) => void;
}) {
  const methods = useForm<FieldValues>({
    resolver: zodResolver(schema),
    defaultValues: defaultValues as DefaultValues<FieldValues>,
    mode: "onChange",
  });

  return (
    <FormProvider {...methods}>
      <form
        onSubmit={
          onSubmit
            ? methods.handleSubmit((values) => onSubmit(values as P))
            : undefined
        }
        className="flex flex-col gap-4"
      >
        {Object.keys(schema.shape).map((name) => (
          <Field
            key={name}
            name={name}
            meta={uiMeta[name as keyof P & string] ?? {}}
            context={context}
          />
        ))}
        <Watcher onWatch={onWatch ? (v) => onWatch(v as P) : undefined} />
      </form>
    </FormProvider>
  );
}

/**
 * Subscribes to all form values via useWatch and notifies the parent.
 * useWatch with no `name` argument re-renders this component on every
 * keystroke in any field — that's by design, so the parent's preview can
 * see the latest draft. Putting the subscription in a leaf component
 * means the form's other children don't re-render in lockstep.
 *
 * Debouncing is the caller's job: SettingsDrawer wraps `onWatch` with a
 * 200ms debounce so chart re-renders don't fire on every keystroke. The
 * JSON-equality short-circuit below suppresses redundant emits (e.g. when
 * RHF re-emits on focus movement without actual value change), but isn't
 * a substitute for the debounce.
 */
function Watcher({ onWatch }: { onWatch?: (values: unknown) => void }) {
  const values = useWatch();
  const lastSentRef = useRef<string>("");
  useEffect(() => {
    if (!onWatch) return;
    const serialized = JSON.stringify(values);
    if (serialized === lastSentRef.current) return;
    lastSentRef.current = serialized;
    onWatch(values);
  }, [values, onWatch]);
  return null;
}
