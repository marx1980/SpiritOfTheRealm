# Review of the handover package (6 Nov 2026)

17 files, about 18 KB, stored as received in this folder. The repo documents (`docs/IMPLEMENTATION_PLAN.md` v3, `STATE.md`, `DECISIONS.md`, `BACKLOG.md`) remain the source of truth until Marko accepts the changes below.

## What the package gets right
- Narrowing Phases 6 and 7 to one closed loop (4 communities, grain only, no armed revolt) is a better next step than plan v3's 8-12 communities, full rebellion and 5 resources.
- The genericity check (a second, non-grain grievance) guards against building a requisition-only system.
- The definition of done (one grain decision traced from order to delayed report) is concrete.
- The human-test rule (do not explain the philosophy; see if players learn that the map shows beliefs) matches H-01.

## Problems

### 1. It conflicts with the plan in force
- **Phase numbers.** ROADMAP numbers 0-15 differ from plan v3 (roadmap 3 = Court/Map gate, plan 3 = agents; roadmap 13 = battlefield, plan 8 = battle slice).
- **H-01 is GO/NO-GO before Phase 6** in plan v3. The package goes to 6A with no testers and moves "first serious human playtests" to after 7A. That needs an explicit override decision (like D-016), not a silent change.
- **Gates.** The package's foundation and integrated gates are qualitative. The plan's statistical gates (G-03/G-04/G-05 attributable rate, lift, link necessity on sealed blocks; G-13) are not mentioned. G-03's end state ("Varos acts on Greyfen's grievance") is exactly the Grain Crisis and should be its gate.

### 2. Names that are not in the game
- **Eastmere** does not exist (content has Eastmarch, Varos's seat, plus Coldmere and Saltmere).
- **Lord Greyfen** is not a character; Greyfen's voice is Mara (spokeswoman).
- **Blackwood Settlements:** Blackwood is the raider site, not a settlement.
- (Correction, 6 Nov: Grey Hill does exist, as `grey_hill`; the first version of this review said it did not.)

### 3. Stale or missing state
- Says only "Phases 0-5 reported built". Missing: G-11 open under D-016, G-12 history, the published debug page, and everything added 1-2 Nov (forts fall and are retaken, captains, repair modes, coin economy and levy, adviser roles).
- Coins and the levy already exist. Grain must fit with them (buying grain with coin; who pays for convoys).

### 4. The T-scenarios are mostly built already
| ID | Existing coverage | Gap |
|---|---|---|
| T01 stale report | lazy staleness; player belief differs from truth | that stale beliefs *matter* (= G-11, still open) |
| T02 contradictions | contradictions kept; resolution rules | trust and competence shaping what is done about them |
| T03 bad royal order | obey/adapt/refuse by margins | an adviser challenging a draft order before it is sent |
| T04 opportunity vs order | margins, never a roll | sweep showing smooth gradients |
| T05 missing messenger | new order supersedes only on receipt | none |
| T06 resource shock | none | needs grain |
| T08 Stefan | Phase 4 promotion tests | none |
| T10 same reality, different beliefs | Elara and Caron advise differently | none |

### 5. Grain Crisis design holes
- **Cause.** For G-03/G-04 the crisis must be driven by the Blackwood threat (raids burn fields or block roads); otherwise the OFF arm shows the same rate and the attributable rate is zero.
- **Outcomes.** "Four outcomes must emerge" needs a log classifier and a share target (for example each at least 5% over 1,000 seeds, like G-08).
- **Second grievance.** Troop misconduct fits best: Caron's company already stays at forts away from home ("stay" answer), so billeting at Northwatch is grounded in what exists.

### 6. Package hygiene
- README and INDEX give different reading orders; IMPLEMENTATION_PLAN repeats NEXT_ACTIONS.
- Risks have no mitigation, early sign or owner. Several are already mitigated (LLM boundary by G-16; threshold revolts by D2 hard gates; WorldState access by static checks). One is live: G-12's "follow the adviser" policies use the same planner as the NPCs (risk 12).
- METRICS_DASHBOARD mixes computed metrics with human ones without saying which is which or how each is measured.
- PLAYTEST_WORKSHEET overlaps `H01_PROTOCOL.md` and lacks the H-01/H-02 pass rules (80%/70%, Spearman 0.5); "input method" and "where is Varos" do not fit the current H-01 scenario.

## Proposed changes
1. **Plan v4:** Phase 6 = 6A (4 communities, behaviour ladder, no revolt), Phase 7 = 7A (grain only); 8-12 communities, rebellion and other resources become 6B/7B. One phase numbering, the plan's.
2. **Gates for 6A-7A:** G-03, G-04, G-05 on a sealed block with the Grain Crisis end state; I03 replaces G-13 until revolt exists; outcome-share target for the four outcomes; second-grievance test required.
3. **Communities:** Northwatch, Greyfen (Mara), Eastmarch (Varos), and a fourth from content. Built (6 Nov): Coldmere (Wenna), the village north of Blackwood, as the "Blackwood settlement".
4. **Crisis cause:** raids at Blackwood/Stonewood damage Northwatch's harvest or roads.
5. **H-01 decision for Marko:** either run H-01 now with 3 testers (the page exists) or record an override with conditions.
6. **`test/canonical.test.ts`:** names T01-T10 over existing tests; adds T02, T03, T04 and T06.
7. **Package upkeep:** one index; CURRENT_STATE generated from `STATE.md`; risks as a table (sign, mitigation, status); dashboard split into computed and human; worksheet merged into `H01_PROTOCOL.md`.

## Status (6 Nov)
Marko accepted the override and every proposal. Plan v4 is in `docs/IMPLEMENTATION_PLAN.md`, the override in `DECISIONS.md` D-020.
