import { connection } from "next/server";
import { assertAuthorized } from "@/lib/auth";

export async function guard(): Promise<Response | null> {
  await connection();
  return assertAuthorized();
}

export function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}
