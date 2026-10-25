import { guard } from "@/lib/http";
import { listEvents } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const denied = await guard();
  if (denied) return denied;
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? "200");
  const safeLimit = Number.isFinite(limit) ? Math.min(500, Math.max(1, Math.round(limit))) : 200;
  return Response.json({ events: listEvents(safeLimit) });
}
