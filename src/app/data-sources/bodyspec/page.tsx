import Link from "next/link";
import { SourceDataBrowser } from "@/components/source-data-browser";
import { Wordmark } from "@/components/wordmark";
import BodySpecUploadClient from "./upload-client";

export const dynamic = "force-dynamic";

export default function BodySpecPage() {
  return (
    <div className="max-w-[820px]">
      <Link href="/data-sources" className="text-[0.8125rem] text-muted hover:text-foreground">
        ← Data Sources
      </Link>
      <h1 className="text-2xl font-semibold mt-3 mb-2">BodySpec DEXA</h1>
      <p className="text-[0.875rem] text-text-secondary mb-8">
        Upload BodySpec DEXA scan PDFs. <Wordmark /> extracts body fat %, lean mass, fat mass, bone mineral
        density, and visceral fat. Review before saving.
      </p>

      <section className="mb-10">
        <h2 className="text-[1rem] font-semibold mb-4">Imported data</h2>
        <SourceDataBrowser source="bodyspec" />
      </section>

      <section className="border-t border-border pt-8">
        <h2 className="text-[1rem] font-semibold mb-4">Upload a new scan</h2>
        <BodySpecUploadClient />
      </section>
    </div>
  );
}
