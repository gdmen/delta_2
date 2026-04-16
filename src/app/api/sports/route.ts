import { NextResponse } from "next/server";
import { db } from "@/db";
import { sports } from "@/db/schema";

export async function GET() {
  const rows = await db.select().from(sports);
  return NextResponse.json(rows);
}
