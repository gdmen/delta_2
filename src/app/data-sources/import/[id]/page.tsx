import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { importSources } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { SourceDataBrowser } from "@/components/source-data-browser";
import { SourceSyncBehavior } from "@/components/source-sync-behavior";
import { WipeSourceButton } from "@/components/wipe-source-button";
import { DeleteSourceButton } from "@/components/delete-source-button";
import { ImportClient } from "./import-client";
import { requireUserOrSignin } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";

export const dynamic = "force-dynamic";

export default async function ImportSourcePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUserOrSignin();
  const { id: idStr } = await params;
  const id = parseInt(idStr, 10);
  if (isNaN(id)) notFound();

  const rows = await db
    .select()
    .from(importSources)
    .where(and(userScope(user.id).importSources, eq(importSources.id, id)))
    .limit(1);
  if (rows.length === 0) notFound();
  const src = rows[0];

  // metrics/events `source` is the lowercased, underscore-joined name.
  const sourceTag = src.name.toLowerCase().replace(/\s+/g, "_");

  return (
    <div className="max-w-[820px]">
      <Link href="/data-sources" className="text-[0.8125rem] text-muted hover:text-foreground">
        ← Sources
      </Link>
      <div className="flex items-baseline justify-between mt-3 mb-2">
        <h1 className="text-2xl font-semibold">{src.name}</h1>
        <Link
          href={`/data-sources/import/${src.id}/edit`}
          className="text-[0.8125rem] text-muted hover:text-foreground"
        >
          Edit mapping →
        </Link>
      </div>
      <p className="text-[0.875rem] text-text-secondary mb-8">
        Custom CSV import source. Kind:{" "}
        <code className="font-mono bg-surface px-1 rounded">{src.kind}</code>.
      </p>

      <details className="mb-10 border-b border-border pb-6">
        <summary className="cursor-pointer text-[0.8125rem] font-semibold uppercase tracking-wider text-muted">
          Import a CSV
        </summary>
        <div className="mt-6">
          <ImportClient sourceId={src.id} sourceName={src.name} />
        </div>
      </details>

      <SourceSyncBehavior source={sourceTag} kind="csv" />

      <section>
        <h2 className="text-[1rem] font-semibold mb-4">Imported data</h2>
        <SourceDataBrowser source={sourceTag} />
      </section>

      <WipeSourceButton source={sourceTag} />
      <DeleteSourceButton
        sourceId={src.id}
        sourceName={src.name}
        sourceTag={sourceTag}
      />
    </div>
  );
}
