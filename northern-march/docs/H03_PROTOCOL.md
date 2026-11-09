# H-03 Battle readability — protocol (Phase 8)

**Bar (plan C2):** testers watch clips of formations in each of the 7 behaviours, with no numbers shown. PASS: at least 80% correct identification of behaviour, and at least 90% correct distinction between observed and reported markers.

**Page:** the "Battle Clips" artifact. Share it with each tester as a **Contributor** (view-only people cannot save answers). Each tester's answers are kept under their own id; only the owner and editors can read them all. Results: open the page with `#results` at the end of the address (owner or editor).

**Clips:** 28 behaviour clips (4 per behaviour, each from a different battle, both sides and several kinds of formation) and 12 marker items (6 seen now, 6 reported), cut from simulated battles by `tools/phase8_clips.ts` (seeds 1-24 at Northwatch, 180/360/520 raiders, with and without the queen, some with a withdrawal order). Each clip loops 6 frames, 30 battle seconds apart. The marked formation has a pointer; neighbours may be doing something else. Order is shuffled per tester (behaviour clips first, then markers).

**Before:** testers are told only the seven behaviour names as they appear on the buttons, and that a formation "seen now" is drawn solid and one "reported" is drawn hollow with a dashed edge. No training clips, no feedback during the test.

**Run:** at least 5 testers, one sitting each, no help. A tester who stops can reopen the page and resume.

**Verdict:** from `#results`: behaviour accuracy ≥ 80% and marker accuracy ≥ 90% → PASS; otherwise report per-behaviour accuracy and the confusions, and change the drawings (not the bar). A gate is not passed on fewer than 5 finished testers.

**Not covered:** audio signatures (BATTLEFIELD §13 asks for visual and audio; this slice has visual only) and live play. Testers may also be shown the `#battle` view of the game page afterwards for comments.
