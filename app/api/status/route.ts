import { guard } from "@/lib/http";
import { getDashboard } from "@/lib/monitor";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await guard();
  if (denied) return denied;
  return Response.json(getDashboard());
}
