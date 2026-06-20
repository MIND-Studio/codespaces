import "server-only";
import { Session } from "@inrupt/solid-client-authn-node";

/**
 * Obtain an authenticated `fetch` for a CSS account, using the
 * password-grant → client-credentials flow CSS exposes via its account
 * controls API. The flow is:
 *
 *   1. GET  {css}/.account/                       → discover login URL
 *   2. POST {login} { email, password }           → get account auth token
 *   3. GET  {css}/.account/ + auth                → discover clientCreds URL
 *   4. POST {clientCreds} { name, webId } + auth  → get {id, secret}
 *   5. session.login({ clientId: id, clientSecret: secret, oidcIssuer })
 *
 * The seeded `alice` demo user is the only credential the publisher needs
 * for the MVP; a real product would replace this with a Solid-OIDC
 * delegation flow against the *user*, not a shared account.
 *
 * Adapted from mind-market-v0/scripts/seed-demo.ts:480 (`getAuthedFetch`).
 */
export async function getCssAuthedFetch(input: {
  cssBaseUrl: string;
  email: string;
  password: string;
  webId: string;
}): Promise<{ fetch: typeof fetch; logout: () => Promise<void> }> {
  const { cssBaseUrl, email, password, webId } = input;

  const { controls } = await discoverAccountControls(cssBaseUrl);
  const loginUrl = controls.password?.login;
  if (!loginUrl) {
    throw new Error(`CSS at ${cssBaseUrl} did not advertise a password-login endpoint.`);
  }

  const { authorization } = await loginAccount(loginUrl, email, password);

  const { controls: postLoginControls } = await discoverAccountControls(cssBaseUrl, authorization);
  const credsUrl = postLoginControls.account?.clientCredentials;
  if (!credsUrl) {
    throw new Error(`CSS at ${cssBaseUrl} did not advertise clientCredentials after login.`);
  }

  const credName = `mind-codespaces-publisher-${Date.now()}`;
  const { id, secret } = await createClientCredentials(credsUrl, authorization, credName, webId);

  const session = new Session();
  await session.login({
    clientId: id,
    clientSecret: secret,
    oidcIssuer: cssBaseUrl,
    tokenType: "DPoP",
  });
  if (!session.info.isLoggedIn) {
    throw new Error(`Session login failed for ${webId}`);
  }
  return {
    fetch: session.fetch.bind(session) as typeof fetch,
    logout: () => session.logout(),
  };
}

async function discoverAccountControls(cssBaseUrl: string, authorization?: string) {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (authorization) {
    headers.Authorization = `CSS-Account-Token ${authorization}`;
  }
  const res = await fetch(`${cssBaseUrl}.account/`, { headers });
  if (!res.ok) {
    throw new Error(
      `CSS account API at ${cssBaseUrl}.account/ returned ${res.status}. ` +
        `Is the CSS instance running?`,
    );
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
  if (!res.ok) {
    throw new Error(`Account login failed for ${email}: ${res.status}`);
  }
  return (await res.json()) as { authorization: string };
}

async function createClientCredentials(
  credentialsUrl: string,
  authorization: string,
  name: string,
  webId: string,
) {
  const res = await fetch(credentialsUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `CSS-Account-Token ${authorization}`,
    },
    body: JSON.stringify({ name, webId }),
  });
  if (!res.ok) {
    throw new Error(
      `Could not create client credentials for ${webId}: ${res.status} ${await res.text()}`,
    );
  }
  return (await res.json()) as { id: string; secret: string };
}
