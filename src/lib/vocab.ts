/**
 * RDF vocabularies used when writing repository metadata into a Solid pod.
 *
 * `solidgit:` is the project-local namespace for the small set of terms
 * the bridge invents (`Repository`, `Issue`, `Comment`, …). It is not yet
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
} as const;
