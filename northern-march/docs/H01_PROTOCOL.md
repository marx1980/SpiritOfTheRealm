# H-01 and H-02 session protocol (Phase 5)

Gate text: IMPLEMENTATION_PLAN C4. This file is the practical script for running it.

## Build and open
- `cd engine && npm install && node ui/build.ts` writes `ui/dist/northern-march.html` (one self-contained page; it also runs offline, with fallback fonts).
- The published debug page is the same file: https://claude.ai/artifact/L6oAoVF7F2WHLBpoQ4ud2Z (private until shared from its Share menu).
- Scenario: `ui/h01.json` — seed 51, 90 days, raiders at Blackwood from day 6 (a strong band, 35 days) and again from day 55 (a large host, 30 days). Every tester plays the same seed. Restart gives the same game.
- Observer panel: Shift+O, or open the page with `#observer`. Testers never see it.

## Testers
- 5 testers (minimum 3) who have not seen the design documents.
- Two sessions each of at least 30 minutes (H-02 needs two). Session 1 is H-01.

## Briefing (read aloud, nothing more)
"You are Queen Anna. Keep Northwatch, Greybridge and Eastmarch Keep from falling for 90 days, and stay alive. You only know what reaches you: letters, what your advisers tell you in person, and what you see yourself. Think aloud. Before every decision, say why."

## Delayed consequences built into the scenario
Each tester should meet at least three. The observer marks which ones occurred.

| # | Cause | Consequence and delay |
|---|---|---|
| C1 | Raiders appear at Blackwood on day 6 | Bren's letter reaches Ravenport about 3-5 days later; the Map shows the age and source |
| C2 | Anna orders a repair | The messenger rides, Bren works 5 days, and the completion letter returns about two weeks after the order |
| C3 | Repairs ordered without money | The order is abandoned for lack of funds; Anna learns it only by letter, days later |
| C4 | Anna travels to Northwatch or Greybridge | Letters for her are read to the council at Ravenport, then forwarded; Elara governs as regent and may order repairs within her limits, then writes to Anna |
| C5 | Anna stays in a fort with failing walls when the second wave comes (day 55+) | A danger warning first; if the walls are breached with her inside, she is killed or captured |
| C6 | Following Oren (the steward) | He mostly advises waiting or a levy; the walls keep falling while the treasury looks healthy |

## Observer sheet (one row per decision)

| Day | Pause type | Action(s) | Stated reason (tester's words) | (a) Cites something on screen? Which (letter, its age or source, an adviser) | (c) Uses anything Anna could not know? |
|---|---|---|---|---|---|

## Observer sheet (one row per consequence)

| Day | Consequence (C1-C6 or other) | Asked "why did this happen?" — tester's words | (b) Explained from shown information or the inspector? |
|---|---|---|---|

## Scoring
- Per tester: (a) ≥ 80% of stated reasons cite on-screen information; (b) ≥ 70% of consequences explained; (c) zero uses of information Anna could not have.
- PASS: at least 4 of 5 testers meet a, b and c (all, if only 3 testers).
- FAIL: record the tester's own words for every failure; fix the interface or the information design; re-test with new testers.
- After the session, export the event log (observer panel → Copy log) and keep it with the sheets.

## H-02: trust is learnable (end of session 2)
- Without statistics, each tester ranks Elara, Oren and Selene from most to least reliable, with one sentence each.
- Reference order: objective-success rate of following each adviser alone on TUNE seeds (`engine/results/g12_aliases.json`).
- PASS: mean Spearman rank agreement ≥ 0.5, and no tester ranks the worst adviser first.

## What to record for the next phase
- Moments where a tester said they did not know something they wanted to know.
- Moments where a tester trusted an old letter without noticing its age.
- Any wording testers misread.
