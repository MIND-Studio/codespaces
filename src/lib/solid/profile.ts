import "server-only";
import {
  getContainedResourceUrlAll,
  getSolidDataset,
  getStringNoLocale,
  getThing,
  getUrl,
  getUrlAll,
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
    fetch(document, { headers: { Accept: "text/turtle" } }).then((r) => (r.ok ? r.text() : "")),
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
    bio: getStringNoLocale(thing, `${VCARD}note`) ?? getStringNoLocale(thing, `${RDFS}comment`),
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
 * Verify that `candidate` is genuinely a Solid pod root owned by the
 * holder of `webId`. Without this check the `ownerPodRoot` field at
 * repo creation is attacker-controlled — they can register a pod they
 * control alongside someone else's WebID.
 *
 * Two paths:
 *
 * 1. **Strict (preferred):** the WebID profile document carries a
 *    `pim:storage` triple matching the candidate. Any production pod
 *    onboarded via /connect or a curated profile-writer hits this path.
 *
 * 2. **Spec fallback:** CSS v7 sign-ups produce WebID profiles that
 *    only carry `solid:oidcIssuer` and `a foaf:Person` — no
 *    `pim:storage`. For those we fall back to two Solid-spec checks:
 *      a) the candidate URL advertises itself as `pim:space#Storage`
 *         via an HTTP `Link: rel="type"` header (i.e. it really is a
 *         pod root, not an arbitrary container or webpage); AND
 *      b) the WebID document URL is hosted *inside* the candidate
 *         (same origin, candidate URL is a prefix). This is what
 *         pins the pod to the WebID: only the pod's owner can write
 *         a profile card inside the pod.
 *
 *    Both together close the obvious bypasses: (a) without (b) lets
 *    an attacker claim someone else's pod; (b) without (a) lets them
 *    claim a non-pod container.
 *
 * Returns `{ ok: false, reason }` when neither path succeeds, so the
 * caller can decide whether to fail open in dev or hard-fail in prod.
 * See P0-S5 in the readiness doc.
 */
export async function verifyPodRootForWebId(
  webId: string,
  candidate: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const norm = (u: string) => (u.endsWith("/") ? u : `${u}/`);
  const candidateN = norm(candidate);

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

  // Path 1: pim:storage triple matches.
  const storages = getUrlAll(thing, `${PIM}storage`);
  for (const s of storages) {
    if (norm(s) === candidateN) return { ok: true };
  }

  // Path 2: Solid-spec fallback. The pod root advertises itself via
  // the `pim:space#Storage` Link rel, and the WebID document is hosted
  // inside that pod root. CSS-issued WebIDs always satisfy this even
  // when the profile lacks pim:storage.
  const webIdDoc = stripFragment(webId);
  if (!webIdDoc.startsWith(candidateN)) {
    return {
      ok: false,
      reason:
        storages.length === 0
          ? `WebID profile has no pim:storage and WebID document ${webIdDoc} is not inside candidate ${candidateN}`
          : `podRoot not in advertised pim:storage set [${storages.join(", ")}]`,
    };
  }

  let headResp: Response;
  try {
    headResp = await fetch(candidateN, { method: "HEAD" });
  } catch (e) {
    return {
      ok: false,
      reason: `failed to HEAD candidate pod root: ${(e as Error).message}`,
    };
  }
  if (!headResp.ok) {
    return {
      ok: false,
      reason: `HEAD ${candidateN} returned ${headResp.status}; not a live pod root`,
    };
  }
  // Look for Link: <http://www.w3.org/ns/pim/space#Storage>; rel="type"
  // Multiple Link headers are typically returned; the `link` value on
  // fetch() joins them with `, ` per the Web spec, so parse with a
  // regex that tolerates that.
  const link = headResp.headers.get("link") ?? "";
  const isStorage =
    /<\s*http:\/\/www\.w3\.org\/ns\/pim\/space#Storage\s*>\s*;\s*rel\s*=\s*"?type"?/i.test(link);
  if (!isStorage) {
    return {
      ok: false,
      reason: `candidate ${candidateN} does not advertise pim:space#Storage via Link rel="type"`,
    };
  }
  return { ok: true };
}
