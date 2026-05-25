import "server-only";
import {
  getSolidDataset,
  getThing,
  getStringNoLocale,
  getUrl,
  getUrlAll,
  getContainedResourceUrlAll,
} from "@inrupt/solid-client";

const FOAF = "http://xmlns.com/foaf/0.1/";
const SOLID = "http://www.w3.org/ns/solid/terms#";
const VCARD = "http://www.w3.org/2006/vcard/ns#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const PIM = "http://www.w3.org/ns/pim/space#";

export type ProfileSummary = {
  webId: string;
  document: string;
  name: string | null;
  nick: string | null;
  bio: string | null;
  homepage: string | null;
  oidcIssuer: string | null;
  img: string | null;
  knows: string[];
  types: string[];
  rawTurtle: string;
  fetchedAt: number;
};

export async function fetchProfile(webId: string): Promise<ProfileSummary> {
  const document = stripFragment(webId);
  const [dataset, rawTurtle] = await Promise.all([
    getSolidDataset(document),
    fetch(document, { headers: { Accept: "text/turtle" } }).then((r) =>
      r.ok ? r.text() : "",
    ),
  ]);
  const thing = getThing(dataset, webId);
  if (!thing) {
    return {
      webId,
      document,
      name: null,
      nick: null,
      bio: null,
      homepage: null,
      oidcIssuer: null,
      img: null,
      knows: [],
      types: [],
      rawTurtle,
      fetchedAt: Date.now(),
    };
  }
  return {
    webId,
    document,
    name: getStringNoLocale(thing, `${FOAF}name`),
    nick: getStringNoLocale(thing, `${FOAF}nick`),
    bio:
      getStringNoLocale(thing, `${VCARD}note`) ??
      getStringNoLocale(thing, `${RDFS}comment`),
    homepage: getUrl(thing, `${FOAF}homepage`),
    oidcIssuer: getUrl(thing, `${SOLID}oidcIssuer`),
    img: getUrl(thing, `${FOAF}img`),
    knows: getUrlAll(thing, `${FOAF}knows`),
    types: getUrlAll(thing, `${RDF}type`),
    rawTurtle,
    fetchedAt: Date.now(),
  };
}

export async function listContainer(url: string): Promise<string[] | null> {
  try {
    const dataset = await getSolidDataset(url);
    return getContainedResourceUrlAll(dataset);
  } catch {
    return null;
  }
}

function stripFragment(url: string): string {
  const i = url.indexOf("#");
  return i >= 0 ? url.slice(0, i) : url;
}

/**
 * Verify that `candidate` matches one of the `pim:storage` locations
 * advertised by the WebID's profile document. Without this check, the
 * `ownerPodRoot` field at repo creation is attacker-controlled — they
 * can register a pod they control alongside someone else's WebID.
 *
 * Returns `{ ok: false, reason }` when the profile cannot be fetched
 * (offline pods, ACL issues) so the caller can decide whether to fail
 * open in dev or hard-fail in prod. See P0-S5 in the readiness doc.
 */
export async function verifyPodRootForWebId(
  webId: string,
  candidate: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  let dataset;
  try {
    dataset = await getSolidDataset(stripFragment(webId));
  } catch (e) {
    return {
      ok: false,
      reason: `failed to dereference WebID profile: ${(e as Error).message}`,
    };
  }
  const thing = getThing(dataset, webId);
  if (!thing) {
    return { ok: false, reason: "WebID profile contains no thing for the WebID" };
  }
  const storages = getUrlAll(thing, `${PIM}storage`);
  if (storages.length === 0) {
    return {
      ok: false,
      reason: "WebID profile advertises no pim:storage; cannot verify podRoot",
    };
  }
  const norm = (u: string) => (u.endsWith("/") ? u : `${u}/`);
  const candidateN = norm(candidate);
  for (const s of storages) {
    if (norm(s) === candidateN) return { ok: true };
  }
  return {
    ok: false,
    reason: `podRoot not in advertised pim:storage set [${storages.join(", ")}]`,
  };
}
