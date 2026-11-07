---
name: find-jobs
description: Search the live Resume Booster Job Board for a person, verify the shortlist is still open, and only then discuss applying. Use for any job search, "is this posting still open", employer hiring record, or apply request.
---

# Find jobs on the board

Order of calls, and why:

1. `key_status` first when a keyed tool is about to be called — it names the tier and any blocker, so nothing is discovered by refusal.
2. `search_jobs` with the role read from the person's CV or words (never invented) and their location; read its disclosures (`ignoredFilters`, `countUnavailable`) back to them. Unkeyed, a search is one page of 10 rows.
3. `check_jobs_open` on the shortlist before `get_jobs` — it re-verifies from the board's index, up to many ids per call, and names that basis.
4. `get_job` or `get_jobs` for the full text of the ones that survived (`fetch` reads one posting with no key). A `https://resumebooster.work/jobs?job=<id>` link's `id` is the argument `get_job`, `fetch` and `apply_myself` take.
5. `employer_hiring_record` for an employer's own record — per board, never summed, never a ranking; a takedown is a takedown, never a hire.
6. `apply_myself` when the person wants to apply to one: it returns the employer's real application form where its hiring system publishes one (otherwise the posting's apply link), with who should answer each question. Ask the person the factual questions, draft only what it marks `draft_from_your_cv`, and stop before Submit — the person reads every answer and submits on the employer's own site. Nothing is ever submitted for them.

Rules: never invent a posting, salary or employer fact the tools did not return; show pay only when the card states it; say "unknown" when the tool does. Tools that need a key: name the gate (https://resumebooster.work/data-api for a free key), never a price. A tool that answers "Sign-in through this server is not switched on yet" needs a key this connection does not hold: say so, name the unkeyed tools, and stop.
