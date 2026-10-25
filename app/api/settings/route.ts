import { guard, badRequest } from "@/lib/http";
import { enqueuePoll, getDashboard, updateSettings } from "@/lib/monitor";
import { getSettings, toPublicSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await guard();
  if (denied) return denied;
  return Response.json(toPublicSettings(getSettings()));
}

export async function PUT(request: Request) {
  const denied = await guard();
  if (denied) return denied;
  const body = await request.json().catch(() => null);
  try {
    const settings = updateSettings(body);
    await enqueuePoll({ manual: true });
    return Response.json({ settings: toPublicSettings(settings), dashboard: getDashboard() });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Could not save settings.");
  }
}
