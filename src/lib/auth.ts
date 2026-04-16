import { NextRequest, NextResponse } from "next/server";

export function validateApiKey(request: NextRequest): NextResponse | null {
  const apiKey = process.env.INGEST_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Server misconfigured: no INGEST_API_KEY" }, { status: 500 });
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing Authorization header. Use: Bearer <api-key>" }, { status: 401 });
  }

  const token = authHeader.slice(7);
  if (token !== apiKey) {
    return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
  }

  return null;
}
