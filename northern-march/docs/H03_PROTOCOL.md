# H-03 Battle screen playability — protocol (Phase 8, version 2, D-063)

**Question:** does the battle screen work for play? Units carry their state as a word (every state but good order), so the test is no longer whether testers can name a behaviour from its shape. It asks whether a player can find trouble quickly, keep the two sides apart, tell fresh sightings from reports, and whether the screen is too crowded. It also chooses how units seen breaking should stand out.

**Page:** the "Battle Clips" artifact. Share it with each tester as a **Contributor** (view-only people cannot save answers). Each tester's answers are kept under their own id; only the owner and editors can read them all. Results: open the page with `#results` at the end of the address (owner or editor). Answers from version 1 of the page are ignored.

**Clips** (`tools/phase8_clips.ts`, seeds 1-30 at Northwatch, 180/360/520 raiders, the queen at the rear or in the centre, half with attack orders): headquarters' own picture of the battle, framed on the units seen now, with names, state words and report ages, as the game shows it.
- 18 **spot** moments: one or two of our units are seen breaking (retreat or rout). The tester taps the unit of ours in trouble; time to tap is recorded.
- 12 **side** moments: one unit seen breaking, outlined, with no other unit close to it (6 ours, 6 the raiders'). The tester says whose it is.
- 12 **known** pictures: one unit outlined, seen now or a report at least three minutes old (6 each).

**Styles:** each spot and side moment is shown in one of three styles: A no flash, B light pink flash, C pale flash of the unit's own colour (raiders are drawn dark red so pink stays apart from them). The style of each moment rotates between testers, so across testers every moment is seen in every style. Each tester sees the three styles as three parts, in shuffled order, and rates after each part how crowded the screen looked (1 clear to 5 crowded), with a note on anything that overlapped or hid something. Known pictures come last, without flash.

**Before:** a one-screen guide (colours, solid and dashed, the seven state words and their shapes, what to do in each part). No feedback during the test. Pictures change every 2 seconds (six pictures, 30 battle seconds apart), so each picture shows two flashes.

**Run:** at least 5 testers, one sitting each, no help, at least two of them on a phone. A tester who stops can reopen the page and resume.

**Reading the results** (per style, from `#results`):
- found trouble: share of spot moments where the tapped unit was one of ours in trouble, and the median time to tap;
- taps on raider units (a flash that draws the eye to the wrong side);
- side told correctly (a flash that hides whose unit it is);
- crowding rating and the notes;
- seen now or report, across all known pictures.

**Bars:** found trouble at least 90% and side told correctly at least 95% in the chosen style; seen now or report at least 90%; mean crowding no worse than 3. The style chosen is the one with the most trouble found and the shortest median time among those that meet the side bar; ties go to no flash. Below a bar: report the numbers and the notes, change the drawing (not the bar), and run again on new testers. Not passed on fewer than 5 finished testers.

**Not covered:** audio signatures (BATTLEFIELD §13 asks for visual and audio; this slice has visual only), live play, and orders.

**Version 1** (7 behaviour clips, a pointer, no state words) was replaced before any tester finished it (D-063).
