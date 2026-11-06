# Agent Playtest Lab: operator guide

Authority: `v4/` as amended by `V4_1_AMENDMENTS.md` (DECISIONS D-022). Code: `engine/src/playtest/`. Tests: `engine/test/playtest.test.ts`.

## Commands (in `northern-march/engine`)

| Command | What it runs |
|---|---|
| `npm run playtest:quick` | 10 seeds x 10 personas, 150 days (100 games) |
| `npm run playtest:full` | 100 seeds x 10 personas (1,000 games) |
| `npm run playtest:adversarial` | 250 seeds x random, probe, novice, miscalibrated |
| `npm run playtest:paired -- --patch communities.params.reliefMilli=10000` | baseline vs candidate on the same tuples (validation seeds 5000+) |
| `npm run playtest:dashboard -- <dir>` | rebuild `dashboard.html` |
| `npm run playtest:replay -- <dir> <game>` | replay one game from its record; must match its log hash |
| `npm run playtest:shrink -- <dir> <game>` | minimise a failing game into `test/regression/<id>.json` |
| `npm run playtest:query -- <dir> failures\|new\|persona <p>\|game <i>` | look things up |
| `npm run playtest:investigate -- <dir> <finding>` | write a paired-experiment manifest for review (does not run it) |
| `npm run playtest:outbox -- <dir>` | deliver due reports (fake provider unless `--real-email`) |

Common flags: `--id`, `--first`, `--seeds`, `--days`, `--workers`, `--wall-min`, `--max-mb`, `--out`, `--inline`.

Output: `results/playtest/<id>/` with `manifest.json`, `summaries.jsonl` (every game), `records.jsonl` (every game; not committed for large runs), `retained.jsonl` (failures and one per persona), `analysis.json`, `dashboard.html`, `outbox.jsonl`, `package.json` (hashes; files read-only once complete). A stopped run resumes when started again with the same `--id`.

## Seeds

Dev 1-4999, validation 5000-9999, sealed 200,000+ (clear of every phase-gate block). Paired experiments never use sealed seeds.

## Statuses

PASS, REVIEW, FAIL, INSUFFICIENT EVIDENCE, NOT EVALUATED, per panel. There is no overall score. A failure that matches `src/playtest/known.ts` is "known" (counted, no alert).

## Report email (Prompt 9: one real test, needs Marko)

Nothing is sent until all of this is done, and the address never enters the repository.

1. Gmail: turn on 2-step verification, then create an app password (Google Account, Security, App passwords).
2. GitHub, repository Settings, Secrets and variables, Actions:
   - Secret `PLAYTEST_REPORT_EMAIL_TO`: the address reports go to.
   - Secret `PLAYTEST_SMTP_USER`: the Gmail address that sends.
   - Secret `PLAYTEST_SMTP_PASSWORD`: the app password.
   - Variable `PLAYTEST_REAL_EMAIL_APPROVED` = `1` (this is the approval).
3. Actions, "playtest", Run workflow: mode `quick`, seeds `10`, email ticked. Expected: one final-report email when it ends.
4. Then run `full` with email ticked: an email at the end (and at 10,000 games for long runs, and at once on a new invariant failure). 1,000-game progress stays in the outbox and dashboard unless `PLAYTEST_EMAIL_EVERY_1K=1`.

Locally: set the same three values as environment variables, `PLAYTEST_MAIL_COMMAND="msmtp -t"` (or any command that reads a message on stdin) and `PLAYTEST_REAL_EMAIL_APPROVED=1`, then add `--real-email`.

## Not started

L8 (adversarial search, quality-diversity archives) and L9 (controlled self-improvement): each needs Marko's separate approval.
