import { guard } from "@/lib/http";
import { enqueuePoll, getDashboard } from "@/lib/monitor";

export async function POST() {
  const denied = await guard();
  if (denied) return denied;
  await enqueuePoll({ manual: true });
  return Response.json(getDashboard());
}
