/**
 * Minimal ambient typings for `n3` — the package ships no `.d.ts` and there is
 * no `@types/n3`. We only use the synchronous `Parser.parse(string): Quad[]`
 * surface (with a `baseIRI` so relative IRIs in the `.mind/build` trio resolve).
 * If we ever need more of n3's API, widen this shim rather than reaching for a
 * heavyweight type dependency.
 */
declare module "n3" {
  export interface Term {
    termType: "NamedNode" | "BlankNode" | "Literal" | "Variable" | "DefaultGraph" | string;
    value: string;
  }
  export interface Quad {
    subject: Term;
    predicate: Term;
    object: Term;
    graph: Term;
  }
  export class Parser {
    constructor(opts?: { baseIRI?: string; format?: string });
    /** Parses the whole input synchronously when called without a callback. */
    parse(input: string): Quad[];
  }
}
