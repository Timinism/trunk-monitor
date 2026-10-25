import { guard, badRequest } from "@/lib/http";
import { testOneSbc, testSbcConnection } from "@/lib/monitor";
import { getSettings, mergeSettings, resolveSbcDraft } from "@/lib/settings";

export async function POST(request: Request) {
  const denied = await guard();
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as { sbc?: unknown } | null;
  try {
    if (body && typeof body === "object" && body.sbc && typeof body.sbc === "object") {
      const draft = resolveSbcDraft(getSettings(), body.sbc);
      const result = await testOneSbc(draft);
      return Response.json(result, { status: result.ok ? 200 : 422 });
    }
    const settings = mergeSettings(getSettings(), body);
    const result = await testSbcConnection(settings);
    return Response.json(result, { status: result.ok ? 200 : 422 });
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Could not test the SBC.");
  }
}
