# Human testing, Phase 5 (H-01 and H-02)

Full script: `H01_PROTOCOL.md`. This is the short version for testers and the person running the session.

## What the test is for
Whether a player can explain every decision from what the screen shows. It is not a test of whether the player wins.

## Setup
- Open the debug page (private until shared from its Share menu), or build it: `cd engine && npm install && node ui/build.ts`.
- Scenario: seed 51, 150 days. Play starts on Day 1 with the first letters. Raiders at Blackwood from day 6 and again from day 55. Every tester plays the same game; Restart gives the same game.
- Observer panel: Shift+O, or open the page with `#observer`. Testers never see it.

## Testers
- 5 testers (minimum 3) who have not seen the design documents.
- Two sessions each, at least 30 minutes. Session 1 is H-01. Session 2 adds H-02.

## Briefing (read aloud, nothing more)
"You are Queen Anna. Keep Northwatch, Greybridge and Eastmarch Keep from falling for 150 days, and stay alive. You only know what reaches you: letters, what your advisers tell you in person, and what you see yourself. Think aloud. Before every decision, say why."

## What to watch for (consequences, mark each that occurs)
| # | What happens | What it shows |
|---|---|---|
| C1 | Raiders appear (day 6) | The letter arrives days later; the map shows its age and source |
| C2 | A repair is ordered | About two weeks pass before the completion letter |
| C3 | Repairs ordered without enough coins | The order is abandoned; Anna learns it only by letter |
| C4 | Anna travels to a fort | Letters go to the council first; the regent may act |
| C5 | Anna stays in a failing fort when the second wave comes (day 55+) | A danger warning, then possible death or capture |
| C6 | Following Oren | He mostly says wait or levy; walls keep falling while the treasury looks healthy |

Each tester should meet at least three.

## Record, per decision
Day, pause type, action, the tester's stated reason (their words), whether the reason cites something on screen (letter, its age or source, an adviser), and whether it uses anything Anna could not know.

## Record, per consequence
Day, which consequence, the tester's own explanation of why it happened, and whether that explanation comes from shown information.

## Also note
- Moments the tester wanted to know something and could not find it.
- Moments the tester trusted an old letter without noticing its age.
- Wording the tester misread.
- Anything the tester could not do that they expected to (for example, ordering someone).

## Pass rules
Per tester:
- (a) at least 80% of stated reasons cite something on screen;
- (b) at least 70% of consequences are explained from shown information;
- (c) zero uses of information Anna could not have.

H-01 passes when at least 4 of 5 testers meet a, b and c (all of them, if only 3 testers).

## H-02, end of session 2
Without statistics, each tester ranks Elara, Oren and Selene from most to least reliable, one sentence each. It passes when the average rank agreement with the measured order is at least 0.5, and no tester ranks the worst adviser first.

## If it fails
Record the tester's own words for every failure, fix the interface or the information design, and re-test with new testers. Phase 6 stays blocked until H-01 passes.

## After each session
Export the event log (observer panel, Copy log) and keep it with the sheets.
