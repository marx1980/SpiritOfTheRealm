# BACKLOG

Things agreed but not built, with the decision that set them. Newest first.

## From the playtest lab (6 Nov 2026, D-022)
- **KI-01 fixed (6 Nov, approved by Marko):** attack orders now go through interpretation, obedience and the local plan like other orders. Regression case `engine/test/regression/KI-01-attack-obeys-after-interpretation.json` asserts the fix. The fix changes what the aggressive persona does, so G-12 and G-13 must be re-run on the new engine (a fresh sealed block is needed).
- **L9 proposal (D-023, not applied):** lower `scenario.economy.dailyUpkeepMilli` from 25,000 to 22,500. Needs Marko's review, then a re-run of the gates on a fresh sealed block before any change.
- **Real report email (Prompt 9/10):** needs Marko to set the GitHub secrets and approval variable (`docs/playtest/README.md`), then one approved test.
- **L8 search:** not started; needs a separate approval.
- **Gate regression coverage:** the regression batches use scripted policies that never order an attack, which is why KI-01 went unnoticed; add a lab persona run to the regression set.

## From Phase 6 (6 Nov 2026)
- **Advisers on communities:** no adviser yet recommends relief or warns before a levy that Greyfen was promised consultation. Add with care: it changes G-12.
- **Consultation:** the crown cannot yet keep its promise to Greyfen (consult before a levy); only relief eases the broken promise. Natural home: 7A (requisition with consultation).
- **Petition repetition:** a standing grievance is petitioned again every 30 days even if unchanged; consider "only when it grew".
- **Community memory of good deeds** decays only by eviction; trust in the crown moves but has no slow return to its base.
- **Wider population (6B):** 8-12 communities, migration, sabotage, open revolt, leaders co-opted or imprisoned.

## From the Phase 5 playtest rounds (Nov 2026)
- **Troop levy and levy advice** (Marko, 2 Nov): advisers never suggest levying men or taxes beyond the coin levy when money is short. A real troop levy (cost 1.5 times a garrison man) is not built; advisers suggest the coin levy only when the treasury is low or a fort has fallen.
- **More incidents:** magic and other rarer disasters (fires and earthquakes exist since 2 Nov).
- **Sealed block 91000** was run on a superseded engine and its result discarded; do not reuse it for a gate.
- **Wall expansions** (Marko, 1 Nov): extra works beyond keeping walls sound. Not designed.
- **Levied troops cost** (Marko, 2 Nov): a levied man costs 1.5 times a garrison man (garrison 100 means levy 150), recurring. No troop levy exists yet; the "levy" now raises coins only. Build when the troop levy arrives.
- **Adviser differences** (D-015, option 3): narrow and biased advisers by design. Recommended after H-01, so that H-02 first measures how well the present differences can be learned.
- **Castellan auto-repair:** decided none. Castellans only ask; Anna approves.
- **G-11** (D-013) stays open: information does not yet matter enough under passive or delegating rulers.
- **Advisers after a second raid** sometimes advise only repair or wait, so no attack advice appears. Decided 2 Nov: do not change the logic.
