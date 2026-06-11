/**
 * Enrich the seeded WebID profile documents for alice and mind with
 * human-readable FOAF/vCard fields. Idempotent: re-running replaces.
 *
 * Usage:
 *   docker compose up -d
 *   npm run seed:profiles
 */
import { Session } from "@inrupt/solid-client-authn-node";

const POD_BASE = process.env.POD_BASE_URL ?? "http://localhost:3011/";

type Profile = {
  owner: string;
  email: string;
  password: string;
  name: string;
  bio: string;
  homepage?: string;
  knows: string[];
};

const PROFILES: Profile[] = [
  {
    owner: "alice",
    email: "alice@mind.local",
    password: "dev-only-do-not-use-in-prod",
    name: "Alice Liddell",
    bio: "Hobby gardener and pod-fluent web tinkerer. Hosts a handful of static sites from her own pod — notes, a bakery menu, the explainer you're reading.",
    homepage: `${POD_BASE}alice/public/sites/about/index.html`,
    knows: [`${POD_BASE}mind/profile/card#me`],
  },
  {
    owner: "mind",
    email: "mind@mind.local",
    password: "dev-only-do-not-use-in-prod",
    name: "Mind Project",
    bio: "Reference identity for the Mind prototypes. Owns the compass demo repo and serves as the second WebID in seeded foaf:knows links.",
    knows: [`${POD_BASE}alice/profile/card#me`],
  },
];

function escapeLiteral(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildTurtle(p: Profile): string {
  const webId = `${POD_BASE}${p.owner}/profile/card#me`;
  const knows = p.knows.map((w) => `    foaf:knows <${w}>;`).join("\n");
  const homepage = p.homepage ? `    foaf:homepage <${p.homepage}>;\n` : "";
  return `@prefix foaf: <http://xmlns.com/foaf/0.1/>.
@prefix solid: <http://www.w3.org/ns/solid/terms#>.
@prefix vcard: <http://www.w3.org/2006/vcard/ns#>.

<>
    a foaf:PersonalProfileDocument;
    foaf:maker <${webId}>;
    foaf:primaryTopic <${webId}>.

<${webId}>
    a foaf:Person;
    solid:oidcIssuer <${POD_BASE}>;
    foaf:name "${escapeLiteral(p.name)}";
    foaf:nick "${p.owner}";
    vcard:note "${escapeLiteral(p.bio)}";
${homepage}${knows}
    .
`;
}

async function discoverAccountControls(cssBaseUrl: string, auth?: string) {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (auth) headers.Authorization = `CSS-Account-Token ${auth}`;
  const res = await fetch(`${cssBaseUrl}.account/`, { headers });
  if (!res.ok) {
    throw new Error(`CSS account API returned ${res.status}`);
  }
  return (await res.json()) as {
    controls: {
      password?: { login?: string };
      account?: { clientCredentials?: string };
    };
  };
}

async function loginAccount(loginUrl: string, email: string, password: string) {
  const res = await fetch(loginUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login ${email}: ${res.status}`);
  return (await res.json()) as { authorization: string };
}

async function createClientCredentials(
  url: string,
  auth: string,
  name: string,
  webId: string,
) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `CSS-Account-Token ${auth}`,
    },
    body: JSON.stringify({ name, webId }),
  });
  if (!res.ok) throw new Error(`clientCredentials: ${res.status} ${await res.text()}`);
  return (await res.json()) as { id: string; secret: string };
}

async function getAuthedFetch(p: Profile) {
  const webId = `${POD_BASE}${p.owner}/profile/card#me`;
  const { controls } = await discoverAccountControls(POD_BASE);
  const loginUrl = controls.password?.login;
  if (!loginUrl) throw new Error("no password login endpoint");
  const { authorization } = await loginAccount(loginUrl, p.email, p.password);
  const { controls: postLogin } = await discoverAccountControls(POD_BASE, authorization);
  const credsUrl = postLogin.account?.clientCredentials;
  if (!credsUrl) throw new Error("no clientCredentials endpoint");
  const { id, secret } = await createClientCredentials(
    credsUrl,
    authorization,
    `seed-profiles-${Date.now()}`,
    webId,
  );
  const session = new Session();
  await session.login({
    clientId: id,
    clientSecret: secret,
    oidcIssuer: POD_BASE,
    tokenType: "DPoP",
  });
  if (!session.info.isLoggedIn) throw new Error(`session login failed (${webId})`);
  return {
    fetch: session.fetch.bind(session) as typeof fetch,
    logout: () => session.logout(),
  };
}

async function enrich(p: Profile) {
  const profileUrl = `${POD_BASE}${p.owner}/profile/card`;
  console.log(`[${p.owner}] authenticating as ${p.email}…`);
  const { fetch: authedFetch, logout } = await getAuthedFetch(p);
  try {
    const res = await authedFetch(profileUrl, {
      method: "PUT",
      headers: { "Content-Type": "text/turtle" },
      body: buildTurtle(p),
    });
    if (!res.ok && res.status !== 205) {
      throw new Error(`PUT ${profileUrl} → ${res.status} ${await res.text()}`);
    }
    console.log(`[${p.owner}] profile enriched (${res.status}).`);
  } finally {
    await logout();
  }
}

async function main() {
  for (const p of PROFILES) {
    await enrich(p);
  }
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
