# Risks and challenges

| # | Risk | Early sign | Mitigation | Status (6 Nov) |
|---|---|---|---|---|
| 1 | Too much uncertainty destroys agency | Testers act at random or stop reading letters | H-01 criteria (a)/(b); report age and source on every claim | Open: no testers yet |
| 2 | NPC autonomy looks like broken AI | Legibility scores 0-1 | DecisionTrace with reasons; letters say why | Partly covered (traces, reasons in advice) |
| 3 | Traits create cliff edges | Behaviour flips on small changes | T04 gradient test; knife-edge test (C0.6) | T04 passes; knife-edge at 7A |
| 4 | Event volume creates fake emergence | Many events, shallow chains | ON/OFF attributable rate (G-03/04) | Gated at 7A |
| 5 | Causal chains impossible to understand | Inspector chains too long to read | causedBy on every event; chronicle | Covered for military chains |
| 6 | Population becomes a renamed unrest bar | One number drives everything | D2 hard gates; specific grievances with causes and remedies | Mitigated in 6A (G-13 invariant) |
| 7 | Rebellion becomes automatic | Revolt on high grievance alone | I03; no revolt in 6A | Mitigated |
| 8 | Economy scope expands too early | New resources before the grain loop works | 7A grain only; 7B deferred | Mitigated by plan v4 |
| 9 | NPC cognition becomes expensive | Wall-clock per year rises | Tier budgets (G-14); communities review once a day | Watch: aggressive runs ~4 s per 240 days |
| 10 | LLM becomes authoritative | Language layer changes state | G-16; templated phrasing is the fallback | Mitigated (no LLM in the loop) |
| 11 | Healthy headless metrics mistaken for fun | Gates pass, testers bored | Human playtests at 7A | Open |
| 12 | Synthetic tester shares NPC logic | Follow-adviser policies agree with advisers by construction | G-12 uses advisers' own planner; add a policy with independent heuristics | Live risk |
| 13 | Full rebellion before the social loop is validated | Revolt code before 7A | 6B deferred | Mitigated |
| 14 | Battlefield integrated before isolated testing | Battle code in campaign before H-03 | Phase 8 isolated slice first | Mitigated |

## Key challenge
The Grain Crisis may overfit the architecture to requisition politics. Built in 6A: a second, non-grain grievance (troop misconduct) on the same community architecture; required again at the 7A gate.
