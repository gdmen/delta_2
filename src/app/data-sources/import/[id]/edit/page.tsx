import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { importSources } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { ImportMapping } from "@/lib/import-mapping";
import { EditClient } from "./edit-client";

export const dynamic = "force-dynamic";

export default async function EditImportSourcePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) notFound();

  const rows = await db.select().from(importSources).where(eq(importSources.id, id)).limit(1);
  if (rows.length === 0) notFound();
  const src = rows[0];

  return (
    <div className="max-w-[940px]">
      <Link
        href={`/data-sources/import/${src.id}`}
        className="text-[0.8125rem] text-muted hover:text-foreground"
      >
        ← {src.name}
      </Link>
      <h1 className="text-2xl font-semibold mt-3 mb-2">Edit mapping</h1>
      <p className="text-[0.875rem] text-text-secondary mb-8">
        Adjust how <span className="font-semibold">{src.name}</span> CSV columns map onto{" "}
        Delta&apos;s fields. Renaming a metric (e.g. <code className="font-mono">body_weight</code>{" "}→{" "}
        <code className="font-mono">bodyweight</code>) offers to migrate existing rows to the new type.
      </p>

      <EditClient
        id={src.id}
        name={src.name}
        kind={src.kind as "metrics" | "events" | "workout_sets"}
        initialMapping={JSON.parse(src.mapping) as ImportMapping}
      />
    </div>
  );
}
