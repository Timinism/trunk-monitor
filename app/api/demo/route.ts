import { guard, badRequest } from "@/lib/http";
import { ConfigError } from "@/lib/errors";
import { enqueuePoll, getDashboard, simulateDemo } from "@/lib/monitor";

export async function POST(request: Request) {
  const denied = await guard();
  if (denied) return denied;
  const body = (await request.json().catch(() => null)) as { action?: string; trunkId?: string } | null;
  const action = body?.action;
  if (action !== "down" && action !== "restore") {
    return badRequest("Action must be down or restore.");
  }
  try {
    simulateDemo(action, body?.trunkId);
    await enqueuePoll({ manual: true });
    return Response.json(getDashboard());
  } catch (error) {
    const status = error instanceof ConfigError ? 400 : 500;
    const message = error instanceof Error ? error.message : "Simulation failed.";
    return Response.json({ error: message }, { status });
  }
}
