import { NextResponse } from "next/server";
import { db } from "@/db";
import { sports } from "@/db/schema";
import { requireUserOr401 } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";

export async function GET() {
  const { user, error } = await requireUserOr401();
  if (error) return error;
  const rows = await db.select().from(sports).where(userScope(user.id).sports);
  return NextResponse.json(rows);
}
