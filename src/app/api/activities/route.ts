import { NextResponse } from "next/server";
import { db } from "@/db";
import { activities } from "@/db/schema";
import { requireUserOr401 } from "@/lib/auth/require";
import { userScope } from "@/lib/auth/scope";

export async function GET() {
  const { user, error } = await requireUserOr401();
  if (error) return error;
  const rows = await db.select().from(activities).where(userScope(user.id).activities);
  return NextResponse.json(rows);
}
