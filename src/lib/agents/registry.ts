import "server-only";
import type { AgentEvent, Driver, Role, Trigger } from "@/lib/agents/types";

/**
 * In-memory registry. Process-local on purpose — the agents config is
 * declarative TS, registered at module load. Persistence (e.g. enabling
 * a role per-repo from the dashboard) is a later concern.
 *
 * Hot-reload safety: we stash the maps on `globalThis` so dev-time
 * module reloads don't drop registrations and double-register on retry.
 */

type Registry = {
  roles: Map<string, Role>;
  drivers: Map<string, Driver>;
  defaultDriver: string | null;
};

const KEY = "__mc_agents_registry__";

declare global {
  // eslint-disable-next-line no-var
  var __mc_agents_registry__: Registry | undefined;
}

function reg(): Registry {
  if (!globalThis[KEY]) {
    globalThis[KEY] = {
      roles: new Map(),
      drivers: new Map(),
      defaultDriver: null,
    };
  }
  return globalThis[KEY]!;
}

export function registerRole(role: Role): void {
  reg().roles.set(role.name, role);
}

export function registerDriver(driver: Driver): void {
  reg().drivers.set(driver.name, driver);
  if (reg().defaultDriver === null) reg().defaultDriver = driver.name;
}

export function setDefaultDriver(name: string): void {
  if (!reg().drivers.has(name)) {
    throw new Error(`agents: driver ${JSON.stringify(name)} not registered`);
  }
  reg().defaultDriver = name;
}

export function getDefaultDriverName(): string | null {
  return reg().defaultDriver;
}

export function listRoles(): Role[] {
  return Array.from(reg().roles.values());
}

export function listDrivers(): Driver[] {
  return Array.from(reg().drivers.values());
}

export function getRole(name: string): Role | undefined {
  return reg().roles.get(name);
}

export function getDriver(name: string): Driver | undefined {
  return reg().drivers.get(name);
}

/**
 * Resolve which roles are interested in a given event. A role matches
 * if any of its triggers matches the event type (and label, for the
 * `issue.labeled` trigger).
 */
export function rolesForEvent(event: AgentEvent): Role[] {
  return listRoles().filter((role) => role.triggers.some((t) => triggerMatches(t, event)));
}

function triggerMatches(trigger: Trigger, event: AgentEvent): boolean {
  if (trigger.on !== event.type) return false;
  if (
    trigger.on === "issue.labeled" &&
    event.type === "issue.labeled" &&
    trigger.label !== event.label
  ) {
    return false;
  }
  return true;
}
