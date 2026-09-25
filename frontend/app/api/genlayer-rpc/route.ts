import { NextRequest, NextResponse } from "next/server";

const RPC_URL = process.env.GENLAYER_RPC_URL ?? "https://studio.genlayer.com/api";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const upstream = await fetch(RPC_URL, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body,
      cache: "no-store",
    });
    const responseBody = await upstream.text();
    return new NextResponse(responseBody, {
      status: upstream.status,
      headers: {
        "cache-control": "no-store",
        "content-type": upstream.headers.get("content-type") ?? "application/json",
      },
    });
  } catch {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "GenLayer RPC proxy unavailable",
        },
        id: null,
      },
      { status: 502 },
    );
  }
}

export async function GET() {
  return NextResponse.json({ error: "POST required" }, { status: 405 });
}
