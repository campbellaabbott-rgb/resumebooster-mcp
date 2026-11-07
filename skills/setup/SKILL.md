---
name: setup
description: Connect the Resume Booster Job Board MCP server with a free key. Use when the person asks to set up, connect, or add a key for resumebooster, or when a keyed tool refuses for want of a key.
---

# Set up the Resume Booster Job Board connection

This plugin's `.mcp.json` registers `resumebooster` at `https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/agent-mcp` and reads the key from `RESUMEBOOSTER_KEY` — unset, it sends no key. board_stats, search_jobs, search, fetch, get_job, get_jobs, check_jobs_open, employer_hiring_record, employer_growth and apply_myself answer with no key at all, so a fresh connection works on its first call from any host. Everything else needs a free key.

1. Tell the person to open https://resumebooster.work/data-api and get a key (it starts with `rb_live_`) — the page emails them a single-use link, and the page that link opens shows the key once. Do not ask them to paste it into the chat; ask them to put it in their shell environment:

       export RESUMEBOOSTER_KEY=<paste your key here>

2. Reconnect: the plugin's server reads `RESUMEBOOSTER_KEY` on its next start. If the server was added by hand without the header, register a keyed copy instead:

       claude mcp add --transport http --scope user resumebooster https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/agent-mcp --header "Authorization: Bearer $RESUMEBOOSTER_KEY"

3. Run `/mcp` and reconnect, then call `key_status` — it answers the tier, the requests left this minute, the calls left today and the fit scorings left today, with any blocker named.

Never write the key into `.mcp.json`, a URL, or a file that is committed. If a keyed tool answers that sign-in through the server is not switched on, this connection holds no key and no sign-in: say that `board_stats`, `search_jobs`, `search`, `fetch`, `get_job`, `get_jobs`, `check_jobs_open`, `employer_hiring_record`, `employer_growth` and `apply_myself` still answer, point at https://resumebooster.work/data-api, and stop. If `fit_resume` is refused, name the gate: a key whose email address was confirmed (the free key the emailed link issues) scores 25 times a day, and an account with a paid plan 1000 — never a price.
