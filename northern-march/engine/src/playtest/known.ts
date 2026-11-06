// Known issues the laboratory has found and that wait for a decision. A failure matching one is classed "known"
// rather than "new", so it is counted but does not raise a fresh alert. Remove an entry once it is fixed.
export interface KnownIssue { id: string; match: RegExp; title: string; found: string; decision: string }
export const KNOWN: KnownIssue[] = [
  {
    id: "KI-01", match: /ExecutionStarted after OrderReceived/,
    title: "Attack orders skip interpretation and obedience: the captain cannot refuse or adapt an attack (orders.ts startAttack, since 1 Nov)",
    found: "6 Nov, random-valid persona, seed 7, first game", decision: "Marko: route attack orders through interpretation and obedience like every other order?",
  },
];
export const knownOf = (failure: string) => KNOWN.find((k) => k.match.test(failure))?.id ?? null;
