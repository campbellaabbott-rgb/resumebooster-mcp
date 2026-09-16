#!/usr/bin/env node
// Generates every manifest and document in this repo from mcp.config.json.
//
//   node scripts/build.mjs          write the files
//   node scripts/build.mjs --check  exit 1 if any file on disk differs from
//                                   what this script would write (the test
//                                   runs this, so a hand edit to a generated
//                                   file, or a constant changed without a
//                                   rebuild, fails CI instead of drifting)
//
// Nothing here is typed twice: a URL, a tool name, a cap or a quota appears
// in exactly one place (mcp.config.json) and every host block, badge, link
// and sentence below reads it from there.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// BUILD_ROOT lets the test run --check against a mutated copy to prove it bites.
const ROOT = process.env.BUILD_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), "..");
const C = JSON.parse(readFileSync(join(ROOT, "mcp.config.json"), "utf8"));

const toolsOf = (tier) => C.tools.filter((t) => t.tier === tier).map((t) => t.name);
const READ = toolsOf("read");
const PAID = toolsOf("paid");
const APPLY = toolsOf("apply");
const ANON = C.anonTools;
const KEYED_READ = READ.filter((n) => !ANON.includes(n));
const list = (names) => names.map((n) => `\`${n}\``).join(", ");
const prose = (names) =>
  names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

const KEY_PLACEHOLDER = `${C.keyPrefix}...your key...`;
const ENV = C.keyEnvVar;
const NAME = C.serverName;
const URL = C.mcpUrl;

// ---------------------------------------------------------------- links
// Cursor: "cursor://anysphere.cursor-deeplink/mcp/install?name=$NAME&config=$BASE64_ENCODED_CONFIG"
// where config is "JSON.stringify the configuration then base64 encode it"
// (cursor.com/docs/mcp/install-links, fetched 2026-09-16). The config holds
// ONLY the url — a key never travels in a link.
const cursorConfigB64 = Buffer.from(JSON.stringify({ url: URL })).toString("base64");
const cursorDeepLink = `cursor://anysphere.cursor-deeplink/mcp/install?name=${NAME}&config=${cursorConfigB64}`;
const cursorWebLink = `https://cursor.com/install-mcp?name=${NAME}&config=${encodeURIComponent(cursorConfigB64)}`;
const cursorBadgeDark = "https://cursor.com/deeplink/mcp-install-dark.svg";

// VS Code: `vscode:mcp/install?${encodeURIComponent(JSON.stringify(obj))}`
// (code.visualstudio.com/api/extension-guides/ai/mcp, fetched 2026-09-16).
const vscodeObj = { name: NAME, type: "http", url: URL };
const vscodeLink = `vscode:mcp/install?${encodeURIComponent(JSON.stringify(vscodeObj))}`;
const vscodeInsidersLink = `vscode-insiders:mcp/install?${encodeURIComponent(JSON.stringify(vscodeObj))}`;
// GitHub's markdown sanitiser drops non-http link schemes, so the README badge
// goes through vscode.dev's redirect (the pattern github/github-mcp-server uses).
const vscodeBadgeLink = `https://insiders.vscode.dev/redirect?url=${encodeURIComponent(vscodeLink)}`;
const vscodeBadgeImg = "https://img.shields.io/badge/VS_Code-Install_Server-0098FF?logo=visualstudiocode&logoColor=white";
const registryBadgeImg = `https://img.shields.io/badge/MCP_Registry-${encodeURIComponent(C.registryName).replace(/-/g, "--")}-blue`;

// --------------------------------------------------------------- manifests
// PLAN §6(a) / §5.2: the header reads the key from the environment and
// expands to nothing when it is unset, which the server answers as the
// unkeyed tier (an empty bearer is trimmed to no bearer) — so one file
// serves a cloner with a key and a cloner without one. The env var's name
// is not credential-shaped (Claude Code blanks those in remote headers).
const mcpJson = {
  mcpServers: {
    [NAME]: { type: "http", url: URL, headers: { Authorization: `Bearer \${${ENV}:-}` } },
  },
};

const pluginJson = {
  $schema: "https://json.schemastore.org/claude-code-plugin-manifest.json",
  // displayName is documented in the current plugins-reference but the CLI
  // that validated this repo (2.1.128) rejects it as unrecognized, so it stays out.
  name: NAME,
  version: C.version,
  description: C.description,
  author: { name: C.authorName, url: C.site },
  homepage: C.agentsPage,
  repository: C.repoUrl,
  license: "MIT",
  keywords: ["jobs", "job-search", "job-board", "mcp", "hiring", "careers"],
};

const marketplaceJson = {
  $schema: "https://json.schemastore.org/claude-code-marketplace.json",
  name: NAME,
  owner: { name: C.authorName, url: C.site },
  description: `${C.displayName} for Claude Code`,
  version: C.version,
  plugins: [
    {
      name: NAME,
      source: "./",
      description: C.description,
      version: C.version,
      author: { name: C.authorName },
      homepage: C.agentsPage,
      repository: C.repoUrl,
      license: "MIT",
      keywords: pluginJson.keywords,
      category: "productivity",
    },
  ],
};

const geminiExtension = {
  name: NAME,
  version: C.version,
  description: C.description,
  mcpServers: {
    [NAME]: {
      httpUrl: URL,
      headers: { Authorization: `Bearer $${ENV}` },
    },
  },
  settings: [
    {
      name: "API key",
      description: `Optional. A free ${C.keyPrefix} key from ${C.keyPage} opens every read tool; leave it empty and ${prose(ANON)} still answer.`,
      envVar: ENV,
      sensitive: true,
    },
  ],
};

const serverJson = {
  $schema: C.registrySchema,
  name: C.registryName,
  title: C.displayName,
  description: C.description,
  version: C.version,
  websiteUrl: C.agentsPage,
  repository: { url: C.repoUrl, source: "github" },
  icons: [{ src: C.iconUrl, mimeType: "image/png", sizes: ["512x512"] }],
  remotes: [
    {
      type: "streamable-http",
      url: URL,
      headers: [
        {
          name: "Authorization",
          description: `Optional. Bearer ${C.keyPrefix}... from ${C.keyPage} (free). Without it ${prose(ANON)} still answer.`,
          isRequired: false,
          isSecret: true,
        },
      ],
    },
  ],
};

// ------------------------------------------------------------ host blocks
const claudeCodeKeyless = `claude mcp add --transport http ${NAME} ${URL}`;
const claudeCodeKeyed = `claude mcp add --transport http --scope user ${NAME} ${URL} --header "Authorization: Bearer $${ENV}"`;
const mcpJsonKeyless = JSON.stringify({ mcpServers: { [NAME]: { type: "http", url: URL } } }, null, 2);
const cursorJsonKeyed = JSON.stringify(
  { mcpServers: { [NAME]: { url: URL, headers: { Authorization: `Bearer ${KEY_PLACEHOLDER}` } } } },
  null,
  2,
);
const vscodeMcpJson = JSON.stringify(
  {
    inputs: [
      { id: `${NAME}-key`, type: "promptString", description: `${C.displayName} API key (free at ${C.keyPage}); leave empty for the unkeyed tools`, password: true },
    ],
    servers: { [NAME]: { type: "http", url: URL, headers: { Authorization: `Bearer \${input:${NAME}-key}` } } },
  },
  null,
  2,
);
const geminiAdd = `gemini mcp add --transport http --scope user ${NAME} ${URL}`;
const geminiAddKeyed = `gemini mcp add --transport http --scope user --header "Authorization: Bearer $${ENV}" ${NAME} ${URL}`;
const geminiExtInstall = `gemini extensions install ${C.repoUrl}`;
const codexToml = `[mcp_servers.${NAME}]\nurl = "${URL}"\nbearer_token_env_var = "${ENV}"`;
const codexTomlKeyless = `[mcp_servers.${NAME}]\nurl = "${URL}"`;
const zedJson = JSON.stringify({ context_servers: { [NAME]: { url: URL } } }, null, 2);
const windsurfJson = JSON.stringify({ mcpServers: { [NAME]: { serverUrl: URL, headers: { Authorization: `Bearer ${KEY_PLACEHOLDER}` } } } }, null, 2);
const clineJson = JSON.stringify({ mcpServers: { [NAME]: { type: "streamableHttp", url: URL, headers: { Authorization: `Bearer ${KEY_PLACEHOLDER}` } } } }, null, 2);
const pluginAdd = `/plugin marketplace add ${C.repoOwner}/${C.repoName}`;
const pluginInstall = `/plugin install ${NAME}@${NAME}`;

const tierTable = `| Tier | Tools | What opens it |
|---|---|---|
| Unkeyed | ${list(ANON)} | Nothing. ${C.anonCaps.perAddressPerDay} calls a day per address, ${C.anonCaps.globalPerDay} a day across every unkeyed caller, a search is one page of ${C.anonCaps.searchRows} rows. |
| Free key | ${list(KEYED_READ)} (and the unkeyed tools at a higher cap) | A free key from ${C.keyPage} — ${C.freeKeyDailyQuota} calls a day. |
| Paid or pass | ${list(PAID)} | The paid API tier, or a live pass on the key's account (${C.passPage}). |
| Apply | ${list(APPLY)} | A key linked to an account with an Agent plan or a live pass, and a mandate — see \`key_status\`. |`;

const privacy = `## Privacy

Every search you run travels to the server as the query you typed. A key is stored as its hash and its first characters, never the key. For unkeyed calls the server keeps a truncated hash of your network address for the daily cap and drops it after ${C.anonAddressHashRetentionDays} days; the address itself is never stored. The tools never write to your machine. A key belongs in an environment variable, a keychain prompt or a host's secret store — never in a file you commit, a URL, a badge or a base64 config. Nothing in this repository carries a key.`;

const unkeyedSentence = `${prose(ANON)} answer with no key at all, so a fresh connection works on its first call from any host.`;
const jobIdSentence = `A \`${C.jobsPage}?job=<id>\` link's \`id\` is the argument \`get_job\`, \`fetch\`, \`check_apply_support\` and \`request_application\` take.`;
const signInSentence = `From a host with no header field (claude.ai, Claude Desktop, ChatGPT) the keyed tools reach your own account through the server's OAuth sign-in; if the Connect card does not complete, the unkeyed tools still answer there and a key works from any host with a header field.`;

// ------------------------------------------------------------------ README
const readme = `<!-- GENERATED by scripts/build.mjs from mcp.config.json — edit those, not this file. -->
# ${C.displayName} — MCP server

[![Install MCP Server](${cursorBadgeDark})](${cursorWebLink})
[![Install in VS Code](${vscodeBadgeImg})](${vscodeBadgeLink})
[![MCP Registry](${registryBadgeImg})](https://registry.modelcontextprotocol.io/v0.1/servers?search=${encodeURIComponent(C.registryName)})

${C.description} ${unkeyedSentence}

- Server: \`${URL}\` (Streamable HTTP, stateless)
- Tools: ${C.tools.length} — ${list(C.tools.map((t) => t.name))}
- Docs and the tool descriptions: ${C.agentsPage}
- Free key: ${C.keyPage}
- Registry name: \`${C.registryName}\`

${jobIdSentence} ${signInSentence}

## Tiers

${tierTable}

## Install

### Claude Code

One line, no key — the unkeyed tools answer at once; the keyed tools need a key (below) or the server's sign-in:

\`\`\`sh
${claudeCodeKeyless}
\`\`\`

With a free key, for every project:

\`\`\`sh
export ${ENV}=${KEY_PLACEHOLDER}
${claudeCodeKeyed}
\`\`\`

Or clone this repository: its \`.mcp.json\` is a project-scope server, so Claude Code asks once to approve it and you are connected. As a plugin (adds the \`/${NAME}:setup\` and \`/${NAME}:find-jobs\` skills):

\`\`\`text
${pluginAdd}
${pluginInstall}
\`\`\`

The \`.mcp.json\` in this repo reads the key from the environment: \`\${${ENV}:-}\` expands to the key when \`${ENV}\` is set and to nothing otherwise, and the server answers an empty header as the unkeyed tier — so the same file works with a key and without one. The keyless variant, if you would rather no header be sent at all:

\`\`\`json
${mcpJsonKeyless}
\`\`\`

### Cursor

[![Install MCP Server](${cursorBadgeDark})](${cursorWebLink})

Deep link (the config holds only the URL): \`${cursorDeepLink}\`

Or in \`~/.cursor/mcp.json\`, with your key:

\`\`\`json
${cursorJsonKeyed}
\`\`\`

### VS Code

[![Install in VS Code](${vscodeBadgeImg})](${vscodeBadgeLink})

Link: \`${vscodeLink}\` (Insiders: \`${vscodeInsidersLink}\`). Or \`.vscode/mcp.json\`, which prompts for the key instead of storing it:

\`\`\`json
${vscodeMcpJson}
\`\`\`

### Gemini CLI

\`\`\`sh
${geminiAdd}
\`\`\`

With a key: \`${geminiAddKeyed}\`. Or install this repository as an extension — it declares the key as a setting, prompted at install and kept in your keychain:

\`\`\`sh
${geminiExtInstall}
\`\`\`

### OpenAI Codex CLI

In \`~/.codex/config.toml\`:

\`\`\`toml
${codexToml}
\`\`\`

Without a key, the same block minus the env line, then \`codex mcp login ${NAME}\` for sign-in:

\`\`\`toml
${codexTomlKeyless}
\`\`\`

### Zed

\`settings.json\` — with no \`Authorization\` header Zed offers the server's sign-in itself:

\`\`\`json
${zedJson}
\`\`\`

With a key: add \`"headers": { "Authorization": "Bearer ${KEY_PLACEHOLDER}" }\` to the server.

### Windsurf

\`\`\`json
${windsurfJson}
\`\`\`

### Cline

\`\`\`json
${clineJson}
\`\`\`

Cline can also read [llms-install.md](./llms-install.md) and do this itself.

### ChatGPT (developer mode)

Settings → Security and login → Developer mode; then chatgpt.com/plugins → **+** → paste \`${URL}\`, name it, **Create** → open your personal plugins and install it → in a chat switch the tab to **Work** and type \`@\` followed by the name you gave it. Choose **Mixed** so \`search\` and \`fetch\` answer before sign-in (OAuth alone asks for sign-in first); there is no field for a key.

### claude.ai and Claude Desktop

**Customize → Connectors → Add custom connector** → paste \`${URL}\` → (if asked) **Sign in when needed** and **Register automatically** for the OAuth client → **Add**. The unkeyed tools answer at once; a keyed tool shows a Connect card.

### Any other MCP client

POST JSON-RPC to \`${URL}\`; send \`Authorization: Bearer <key>\` on each request for the keyed tools, nothing for the unkeyed ones.

## The plugin's skills

- \`/${NAME}:setup\` — mint a free key, put it in \`${ENV}\`, reconnect.
- \`/${NAME}:find-jobs\` — the search → verify → apply order, with the gates named.

${privacy}

## This repository

- \`mcp.config.json\` is the only place a URL, tool name, cap or quota is written. \`npm run build\` regenerates every other file; \`npm test\` fails if any generated file was edited by hand or the constants changed without a rebuild, and validates each manifest against the schema its host publishes (copies under \`schemas/\`, fetched 2026-09-16).
- The tool list is a mirror of the server's registry (\`${C.mirror.of}\` at \`${C.mirror.at}\`); when that changes, this file is re-synced and rebuilt.
- \`server.json\` is the entry for the official MCP Registry.

## License

MIT — for the files in this repository. The server, the board and its data are ${C.site}'s own and are governed by its terms.
`;

// ------------------------------------------------------------ llms-install
const llmsInstall = `<!-- GENERATED by scripts/build.mjs from mcp.config.json — edit those, not this file. -->
# Installing the ${C.displayName} MCP server (for an agent doing the install)

You are configuring a REMOTE MCP server. There is nothing to download, build or run locally.

- Transport: Streamable HTTP
- URL: ${URL}
- Server name to register: ${NAME}
- Optional credential: an environment variable \`${ENV}\` holding a \`${C.keyPrefix}...\` key. Never write a key into a config file, a URL or a log; if the person has none, register the server with no header — ${prose(ANON)} answer unkeyed.

## Steps

1. Ask the person which host they use, or detect it from the config file present.
2. Write the block for that host (below). Substitute nothing except the key placeholder, and only when the person hands you a key.
3. Restart or reconnect the host's MCP servers (Claude Code: \`/mcp\`; Cursor: reload MCP settings; Cline: the MCP panel's restart).
4. Verify with one unkeyed call: \`board_stats\` takes no arguments and answers with no key. With a key, \`key_status\` answers what the key may do.

## Blocks

Claude Code:

    ${claudeCodeKeyless}

Claude Code with a key in the environment:

    ${claudeCodeKeyed}

Cline (\`cline_mcp_settings.json\`):

${clineJson.split("\n").map((l) => "    " + l).join("\n")}

Cursor (\`~/.cursor/mcp.json\`):

${cursorJsonKeyed.split("\n").map((l) => "    " + l).join("\n")}

VS Code (\`.vscode/mcp.json\`):

${vscodeMcpJson.split("\n").map((l) => "    " + l).join("\n")}

Gemini CLI:

    ${geminiAdd}

Codex CLI (\`~/.codex/config.toml\`):

${codexToml.split("\n").map((l) => "    " + l).join("\n")}

Zed (\`settings.json\`):

${zedJson.split("\n").map((l) => "    " + l).join("\n")}

Windsurf:

${windsurfJson.split("\n").map((l) => "    " + l).join("\n")}

## What the tools are

Unkeyed (no key at all): ${list(ANON)}. Any free key adds: ${list(KEYED_READ)}.
Paid or pass: ${list(PAID)}. Apply (account with a mandate): ${list(APPLY)}.

${jobIdSentence}

Do not invent a posting, a salary or an employer fact the tools did not return. \`check_jobs_open\` re-verifies a shortlist cheaply before \`get_jobs\`. Never call \`request_application\` without the person's explicit yes for that job id.
`;

// ------------------------------------------------------------------ skills
const setupSkill = `---
name: setup
description: Connect the ${C.displayName} MCP server with a free key. Use when the person asks to set up, connect, or add a key for ${NAME}, or when a keyed tool refuses for want of a key.
---

# Set up the ${C.displayName} connection

This plugin's \`.mcp.json\` registers \`${NAME}\` at \`${URL}\` and reads the key from \`${ENV}\` — unset, it sends no key. ${unkeyedSentence} Everything else needs a free key.

1. Tell the person to open ${C.keyPage} and mint a key (it starts with \`${C.keyPrefix}\`). Do not ask them to paste it into the chat; ask them to put it in their shell environment:

       export ${ENV}=${KEY_PLACEHOLDER}

2. Reconnect: the plugin's server reads \`${ENV}\` on its next start. If the server was added by hand without the header, register a keyed copy instead:

       ${claudeCodeKeyed}

3. Run \`/mcp\` and reconnect, then call \`key_status\` — it answers the tier, the calls left today and whether the paid and apply tools would work, with any blocker named.

Never write the key into \`.mcp.json\`, a URL, or a file that is committed. If \`key_status\` says the paid tools are closed, a pass or plan at ${C.passPage} opens them; name the gate, never a price.
`;

const findJobsSkill = `---
name: find-jobs
description: Search the live ${C.displayName} for a person, verify the shortlist is still open, and only then discuss applying. Use for any job search, "is this posting still open", employer hiring record, or apply request.
---

# Find jobs on the board

Order of calls, and why:

1. \`key_status\` first when a keyed tool is about to be called — it names the tier and any blocker, so nothing is discovered by refusal.
2. \`search_jobs\` with the role read from the person's CV or words (never invented) and their location; read its disclosures (\`ignoredFilters\`, \`countUnavailable\`) back to them. Unkeyed, a search is one page of ${C.anonCaps.searchRows} rows.
3. \`check_jobs_open\` on the shortlist before \`get_jobs\` — it re-verifies from the board's index, up to many ids per call, and names that basis.
4. \`get_job\` or \`get_jobs\` for the full text of the ones that survived. ${jobIdSentence}
5. \`employer_hiring_record\` for an employer's own record — per board, never summed, never a ranking; a takedown is a takedown, never a hire.
6. \`check_apply_support\` before any talk of applying; \`request_application\` only after the person says yes to that specific job id, and only if \`key_status\` shows the apply tools open (account, mandate, plan or pass).

Rules: never invent a posting, salary or employer fact the tools did not return; show pay only when the card states it; say "unknown" when the tool does. Tools that need a key or a pass: name the gate (${C.keyPage} for a key, ${C.passPage} for a pass), never a price.
`;

// -------------------------------------------------------------------- write
const OUT = {
  ".mcp.json": JSON.stringify(mcpJson, null, 2) + "\n",
  ".claude-plugin/plugin.json": JSON.stringify(pluginJson, null, 2) + "\n",
  ".claude-plugin/marketplace.json": JSON.stringify(marketplaceJson, null, 2) + "\n",
  "gemini-extension.json": JSON.stringify(geminiExtension, null, 2) + "\n",
  "server.json": JSON.stringify(serverJson, null, 2) + "\n",
  "README.md": readme,
  "llms-install.md": llmsInstall,
  "SETUP.md": setupSkill,
  "skills/setup/SKILL.md": setupSkill,
  "skills/find-jobs/SKILL.md": findJobsSkill,
};

export const GENERATED = Object.keys(OUT);
export const LINKS = { cursorDeepLink, cursorWebLink, vscodeLink, vscodeInsidersLink, vscodeBadgeLink };

const check = process.argv.includes("--check");
let drift = 0;
for (const [rel, body] of Object.entries(OUT)) {
  const abs = join(ROOT, rel);
  if (check) {
    const cur = existsSync(abs) ? readFileSync(abs, "utf8") : null;
    if (cur !== body) {
      drift++;
      console.error(`drift: ${rel}${cur === null ? " (missing)" : ""}`);
    }
  } else {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
    console.log(`wrote ${rel}`);
  }
}
if (check) {
  if (drift) {
    console.error(`${drift} generated file(s) differ from mcp.config.json — run \`npm run build\``);
    process.exit(1);
  }
  console.log(`${GENERATED.length} generated files match mcp.config.json`);
}
