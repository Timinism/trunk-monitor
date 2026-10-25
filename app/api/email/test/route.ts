import { guard, badRequest } from "@/lib/http";
import { sendTestEmail } from "@/lib/monitor";
import { getSettings, mergeSettings } from "@/lib/settings";

export async function POST(request: Request) {
  const denied = await guard();
  if (denied) return denied;
  const body = await request.json().catch(() => null);
  try {
    const settings = mergeSettings(getSettings(), body);
    const result = await sendTestEmail(settings);
    return Response.json(result, { status: result.status === "sent" ? 200 : 422 });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Could not send the test message.");
  }
}
