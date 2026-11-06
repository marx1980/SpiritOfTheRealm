// Known issues the laboratory has found and that wait for a decision. A failure matching one is classed "known"
// rather than "new", so it is counted but does not raise a fresh alert. Remove an entry once it is fixed (KI-01 fixed 6 Nov;
// its regression case now asserts the fix).
export interface KnownIssue { id: string; match: RegExp; title: string; found: string; decision: string }
export const KNOWN: KnownIssue[] = [
];
export const knownOf = (failure: string) => KNOWN.find((k) => k.match.test(failure))?.id ?? null;
