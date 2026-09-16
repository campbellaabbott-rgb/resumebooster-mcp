---
name: setup
description: Connect the Resume Booster Job Board MCP server with a free key. Use when the person asks to set up, connect, or add a key for resumebooster, or when a keyed tool refuses for want of a key.
---

# Set up the Resume Booster Job Board connection

This plugin's `.mcp.json` registers `resumebooster` at `https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/agent-mcp` with no key. board_stats, search_jobs, search and fetch answer with no key at all, so a fresh connection works on its first call from any host. Everything else needs a free key.

1. Tell the person to open https://resumebooster.work/data-api and mint a key (it starts with `rb_live_`). Do not ask them to paste it into the chat; ask them to put it in their shell environment:

       export RESUMEBOOSTER_KEY=rb_live_...your key...

2. Register a keyed copy of the server for every project (the plugin's keyless one can stay):

       claude mcp add --transport http --scope user resumebooster https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/agent-mcp --header "Authorization: Bearer $RESUMEBOOSTER_KEY"

3. Run `/mcp` and reconnect, then call `key_status` — it answers the tier, the calls left today and whether the paid and apply tools would work, with any blocker named.

Never write the key into `.mcp.json`, a URL, or a file that is committed. If `key_status` says the paid tools are closed, a pass or plan at https://resumebooster.work/agents/pass opens them; name the gate, never a price.
