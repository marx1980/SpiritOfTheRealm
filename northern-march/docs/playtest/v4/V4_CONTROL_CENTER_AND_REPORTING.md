# V4 Control Center and Reporting

## Run modes

- **Quick:** 100–500 tuples for development feedback.
- **Full:** 1,000+ tuples across personas and canonical/regression scenarios.
- **Adversarial:** bounded mutation/search for exploits and cliffs.
- **Paired experiment:** identical tuples for baseline and candidate.

## Dashboard states

Use **PASS**, **REVIEW**, **FAIL**, **INSUFFICIENT EVIDENCE**, and **NOT EVALUATED**. Never reduce the laboratory to one overall score.

Panels cover integrity, NPC cognition, information ecology/G-11, personas/agency, strategic diversity, emergence, performance, candidate comparison, and report-delivery status.

## Causal explorer

For a selected outcome show:

1. objective causal graph;
2. Anna-known timeline;
3. acting-agent belief/decision chain;
4. source/age/reliability annotations;
5. replay command and minimized case.

Objective truth is post-run/debug only.

## Milestone reports

- Every **1,000 successfully completed games:** progress report.
- Every **10,000 games:** deep report, replacing the ordinary 1,000 email at that threshold.
- Hard Severity-1 invariant: immediate alert.
- Completion/interruption/terminal failure: final report.

Workers continue while snapshots and reports are generated. Milestones use durable exactly-once keys, durable outbox, bounded exponential retry and restart-safe delivery state.

## Email

Recipient: the owner's address, set only in `PLAYTEST_REPORT_EMAIL_TO` (redacted from this public copy, see V4_1_AMENDMENTS.md).

No credential may be committed or displayed in logs/artifacts. Use GitHub/environment secrets with a provider-neutral `NotificationAdapter`. Test with a fake provider first; perform one real delivery only after explicit configuration and approval.

Because the repository is public, placing the recipient address in committed configuration makes it public. Prefer setting the actual address as a repository variable/secret and keeping only an example in public files if privacy is desired.

## Report content

The 1,000 report contains identity/hashes, completion, throughput/ETA, hard status, failures/stalls, changes since prior report, new minimal failures, persona summary, G-11 diagnostic, top evidence-linked finding and next threshold.

The 10,000 report adds confidence/effect summaries, gradients, dominance, diversity, information ecology, failure clusters, causal/emergence trends, performance/storage, five key conclusions and proposed investigations.

## Retention

Keep summaries and reports for all run sets. Keep full logs only for failures, minimized cases, novel causal signatures, archive elites and pinned examples. Define configurable retention/size limits; never delete regression cases automatically.

## Analyst and investigations

The Analyst Agent reads aggregates and selected evidence, labels findings by certainty, and links every claim. “Investigate” creates a reviewable paired-experiment manifest; it cannot silently execute unrestricted changes.
