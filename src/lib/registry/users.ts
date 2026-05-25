import "server-only";
import { getDb } from "@/lib/registry/db";
import { RegistryError, validateName } from "@/lib/registry/repos";

export type User = {
  id: number;
  ownerSlug: string;
  webId: string;
  podRoot: string;
  email: string;
  createdAt: number;
};

function rowToUser(row: Record<string, unknown>): User {
  return {
    id: row.id as number,
    ownerSlug: row.owner_slug as string,
    webId: row.web_id as string,
    podRoot: row.pod_root as string,
    email: row.email as string,
    createdAt: row.created_at as number,
  };
}

export function createUser(input: {
  ownerSlug: string;
  webId: string;
  podRoot: string;
  email: string;
}): User {
  validateName(input.ownerSlug, "owner");
  if (!input.webId.startsWith("http")) {
    throw new RegistryError("webId must be an http(s) URL", "INVALID_INPUT");
  }
  if (!input.podRoot.startsWith("http")) {
    throw new RegistryError("podRoot must be an http(s) URL", "INVALID_INPUT");
  }
  if (!input.email.includes("@")) {
    throw new RegistryError("email must contain '@'", "INVALID_INPUT");
  }

  const now = Date.now();
  try {
    const info = getDb()
      .prepare(
        `INSERT INTO users (owner_slug, web_id, pod_root, email, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(input.ownerSlug, input.webId, input.podRoot, input.email, now);
    return {
      id: info.lastInsertRowid as number,
      ownerSlug: input.ownerSlug,
      webId: input.webId,
      podRoot: input.podRoot,
      email: input.email,
      createdAt: now,
    };
  } catch (e) {
    if (
      e instanceof Error &&
      "code" in e &&
      (e as { code: string }).code === "SQLITE_CONSTRAINT_UNIQUE"
    ) {
      throw new RegistryError(
        `user already exists (slug=${input.ownerSlug} or webId=${input.webId})`,
        "ALREADY_EXISTS",
      );
    }
    throw e;
  }
}

export function getUserByWebId(webId: string): User | null {
  const row = getDb()
    .prepare("SELECT * FROM users WHERE web_id = ?")
    .get(webId) as Record<string, unknown> | undefined;
  return row ? rowToUser(row) : null;
}

export function getUserBySlug(slug: string): User | null {
  const row = getDb()
    .prepare("SELECT * FROM users WHERE owner_slug = ?")
    .get(slug) as Record<string, unknown> | undefined;
  return row ? rowToUser(row) : null;
}
