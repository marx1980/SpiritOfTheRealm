# V4 Review Notes — Improvements over v3

V4 improves v3 by:

- consolidating overlapping documents into one authority hierarchy;
- replacing 42 granular AP items with nine auditable lab gates;
- defining explicit migration/archive rules;
- removing vague dependence on prior prompts;
- adding compute, artifact and paid-API budgets;
- clarifying LLM reproducibility limits;
- adding schema-version/migration requirements;
- strengthening email idempotency and privacy guidance;
- defining result retention;
- separating fake email tests from approved real delivery;
- requiring one real acceptance demonstration per gate;
- making separate approvals mandatory for search and recursive optimization;
- clarifying that public inclusion of the recipient email exposes it publicly;
- preserving human H-01/H-02 gates.

Open implementation choices intentionally left to repository inspection:

- exact mail provider;
- exact worker technology;
- static dashboard hosting location;
- JSONL-only versus optional database index;
- exact confidence/effect-size methods for each metric;
- precise compute budgets.

The coding agent must propose these after inspecting the actual project rather than inventing incompatible infrastructure.
