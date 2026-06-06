/**
 * RDF vocabularies used when writing repository metadata into a Solid pod.
 *
 * `solidgit:` is the project-local namespace for the small set of terms
 * the bridge invents (`Repository`, `Issue`, `Comment`, `PullRequest`, the
 * `closesIssue` predicate, the membership terms `Membership` / `Member` /
 * `agent` / `role` / `members`, …). It is not yet
 * a published spec; the URI is intentionally a `.local` placeholder so it
 * doesn't pretend to be globally resolvable.
 *
 * Issues reuse `sioc:` (SIOC's `sioc:Item` / `sioc:Container` / `sioc:has_creator`)
 * where the meaning lines up, and `foaf:` for agent identity, so other
 * Solid-aware tools can read issue threads without learning our vocab.
 */
export const NS = {
  solidgit: "https://mind-codespaces.local/vocab#",
  dcterms: "http://purl.org/dc/terms/",
  xsd: "http://www.w3.org/2001/XMLSchema#",
  sioc: "http://rdfs.org/sioc/ns#",
  foaf: "http://xmlns.com/foaf/0.1/",
  rdfs: "http://www.w3.org/2000/01/rdf-schema#",
  // `ldp:` advertises the repo's `ldp:inbox` (Linked Data Notifications);
  // `as:` (ActivityStreams) types each proposal notification as an
  // `as:Announce` carrying an `as:actor` so any LDN-aware tool can read it.
  ldp: "http://www.w3.org/ns/ldp#",
  as: "https://www.w3.org/ns/activitystreams#",
} as const;
