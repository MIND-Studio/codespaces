import { NextResponse } from "next/server";
import { ensureAgentsBootstrap } from "@/lib/agents/bootstrap";
import {
  getDefaultDriverName,
  listDrivers,
  listRoles,
} from "@/lib/agents/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  ensureAgentsBootstrap();
  return NextResponse.json({
    defaultDriver: getDefaultDriverName(),
    drivers: listDrivers().map((d) => ({ name: d.name, describe: d.describe() })),
    roles: listRoles(),
  });
}
