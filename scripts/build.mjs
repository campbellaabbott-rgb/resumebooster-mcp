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
import { dirname, join, resolve } from "node:path";
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

// A key is pasted by the PERSON into their environment, never by us into a
// value: no generated file carries a placeholder inside an Authorization
// value (the mirror test walks every file for that). The export line names
// where the key goes in words.
const KEY_PASTE = "<paste your key here>";
const ENV = C.keyEnvVar;
const NAME = C.serverName;
const URL = C.mcpUrl;
const AS_URL = C.authorizationServerMetadataUrl;
// The six switchboard hosts (the site's MCP_HOSTS, by id and order) and the
// long tail under "More…" (the site's MCP_MORE_HOSTS). Both lists mirror the
// site; the README prints them in that order.
const HOSTS = C.hosts;
const MORE_HOSTS = C.moreHosts;
const ALL_HOSTS = [...HOSTS, ...MORE_HOSTS];

// ---------------------------------------------------------------- links
// Cursor: "cursor://anysphere.cursor-deeplink/mcp/install?name=$NAME&config=$BASE64_ENCODED_CONFIG"
// where config is "JSON.stringify the configuration then base64 encode it"
// (cursor.com/docs/mcp/install-links, fetched 2026-09-16). The config holds
// ONLY the url — a key never travels in a link.
const cursorConfigB64 = Buffer.from(JSON.stringify({ url: URL })).toString("base64");
const cursorDeepLink = `cursor://anysphere.cursor-deeplink/mcp/install?name=${NAME}&config=${cursorConfigB64}`;
// No cursor.com/install-mcp web form and no badge: neither is on the
// install-links page (docs-snapshot.md), so the README shows the raw deeplink.

// VS Code: `vscode:mcp/install?${encodeURIComponent(JSON.stringify(obj))}`
// (code.visualstudio.com/api/extension-guides/ai/mcp, fetched 2026-09-16).
const vscodeObj = { name: NAME, type: "http", url: URL };
const vscodeLink = `vscode:mcp/install?${encodeURIComponent(JSON.stringify(vscodeObj))}`;
const vscodeInsidersLink = `vscode-insiders:mcp/install?${encodeURIComponent(JSON.stringify(vscodeObj))}`;
// GitHub's markdown sanitiser drops non-http link schemes, so the README badge
// goes through vscode.dev's redirect (the pattern github/github-mcp-server
// uses). The redirect form is NOT in VS Code's docs (docs-snapshot.md), so it
// is README-only and labelled; the documented links are printed beside it.
const vscodeBadgeLink = `https://insiders.vscode.dev/redirect?url=${encodeURIComponent(vscodeLink)}`;
const vscodeBadgeImg = "https://img.shields.io/badge/VS_Code-Install_Server-0098FF?logo=visualstudiocode&logoColor=white";
// No registry badge until the entry is published (project_public_data_api:
// the registry entry is the owner's call, after the sign-in service is on).

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
  // The registry pins a server to its GitHub repository by numeric id (the
  // name can be reassigned; the id cannot). gh api repos/<owner>/<name> --jq .id
  repository: { url: C.repoUrl, source: "github", id: C.repoId },
  icons: [{ src: C.iconUrl, mimeType: "image/png", sizes: ["512x512"] }],
  remotes: [
    {
      type: "streamable-http",
      url: URL,
      headers: [
        {
          name: "Authorization",
          description: `Optional. A free ${C.keyPrefix} key from ${C.keyPage}, sent as Bearer <key>. Without it ${prose(ANON)} still answer.`,
          isRequired: false,
          isSecret: true,
        },
      ],
    },
  ],
};

// ------------------------------------------------------------ host blocks
// Every block is KEYLESS FIRST: it works on the first call from any host.
// A keyed variant reads the key from the host's own documented indirection
// (an env var, ${env:NAME}, ${input:id}, bearer_token_env_var) — the key
// itself is never written into a file this repo generates.
const claudeCodeKeyless = `claude mcp add --transport http --scope user ${NAME} ${URL}`;
const claudeCodeKeyed = `claude mcp add --transport http --scope user ${NAME} ${URL} --header "Authorization: Bearer $${ENV}"`;
const exportLine = `export ${ENV}=${KEY_PASTE}`;
const mcpJsonKeyless = JSON.stringify({ mcpServers: { [NAME]: { type: "http", url: URL } } }, null, 2);
const cursorJsonKeyless = JSON.stringify({ mcpServers: { [NAME]: { url: URL } } }, null, 2);
// Cursor resolves ${env:NAME} in `headers` (cursor.com/docs/context/mcp), so
// the keyed file names the variable, not the key.
const cursorJsonKeyed = JSON.stringify(
  { mcpServers: { [NAME]: { url: URL, headers: { Authorization: `Bearer \${env:${ENV}}` } } } },
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
const codexAdd = `codex mcp add ${NAME} --url ${URL}`;
const codexToml = `[mcp_servers.${NAME}]\nurl = "${URL}"\nbearer_token_env_var = "${ENV}"`;
// Zed and Cline document a `headers` object and no variable expansion, so
// their keyed form is a sentence (add the header in the host's own
// user-level file), never a value with a placeholder in it.
const zedJson = JSON.stringify({ context_servers: { [NAME]: { url: URL } } }, null, 2);
const clineJson = JSON.stringify({ mcpServers: { [NAME]: { type: "streamableHttp", url: URL } } }, null, 2);
// Windsurf resolves ${env:NAME} in `headers` (docs.devin.ai/desktop/cascade/mcp,
// docs-snapshot.md), so its keyed file names the variable like Cursor's.
const windsurfJson = JSON.stringify({ mcpServers: { [NAME]: { serverUrl: URL } } }, null, 2);
const windsurfJsonKeyed = JSON.stringify(
  { mcpServers: { [NAME]: { serverUrl: URL, headers: { Authorization: `Bearer \${env:${ENV}}` } } } },
  null,
  2,
);
// The protocol revision is the constants file's, spelled once here and mirrored to the site's MCP_PROTOCOL_VERSION.
const PROTOCOL = C.protocolVersion;
const curlInitialize = `curl -s -X POST ${URL} -H 'content-type: application/json' -H 'mcp-protocol-version: ${PROTOCOL}' -d '${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "curl", version: "0" } } })}'`;
const signInReader = `${curlInitialize} | jq '.result._meta["${C.signInMetaKey}"].state'`;
const indent = (block) => block.split("\n").map((l) => "    " + l).join("\n");

const pluginAdd = `/plugin marketplace add ${C.repoOwner}/${C.repoName}`;
const pluginInstall = `/plugin install ${NAME}@${NAME}`;

// ------------------------------------------------------------- placeholders
// Step, verify and troubleshooting text in mcp.config.json carries
// {{placeholders}}; every one resolves here to a constant or a block above,
// and an unknown one throws — so a sentence can neither type a number nor
// name a thing this file does not know.
const FILL = {
  url: URL,
  displayName: C.connectorName,
  serverName: NAME,
  serverInfoName: C.serverInfoName,
  toolCount: String(C.tools.length),
  perAddressPerDay: String(C.anonCaps.perAddressPerDay),
  searchRows: String(C.anonCaps.searchRows),
  dailyQuota: String(C.freeKeyDailyQuota),
  keyPage: C.keyPage,
  passPage: C.passPage,
  jobsPage: C.jobsPage,
  agentsPage: C.agentsPage,
  keyPrefix: C.keyPrefix,
  envVar: ENV,
  anonToolsProse: prose(ANON.map((n) => `\`${n}\``)),
  anonToolsBare: ANON.join(", "),
  keyPageUrl: C.keyPage,
  claudeCodeKeyless,
  cursorDeepLink,
  vscodeLink,
  vscodeInsidersLink,
  geminiAdd,
  codexAdd,
};
const fill = (text) =>
  text.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    if (!(k in FILL)) throw new Error(`unknown placeholder {{${k}}}`);
    return FILL[k];
  });
export { FILL, fill };

// The block each host pastes, keyless, and the keyed sentence beside it.
const HOST_BLOCKS_GEMINI = () => ({
  keyed: `With a key: \`${geminiAddKeyed}\`. Or install this repository as an extension — it declares the key as a setting, prompted at install and kept in your keychain:\n\n\`\`\`sh\n${geminiExtInstall}\n\`\`\``,
});
const HOST_BLOCKS_CODEX = () => ({
  keyed: `With a key, in \`~/.codex/config.toml\` (the key is read from \`${ENV}\`, never written here):\n\n\`\`\`toml\n${codexToml}\n\`\`\``,
});
const HOST_BLOCKS = {
  claude: {},
  chatgpt: {},
  "claude-code": {
    keyed: `With a free key, for every project:\n\n\`\`\`sh\n${exportLine}\n${claudeCodeKeyed}\n\`\`\`\n\nOr clone this repository: its \`.mcp.json\` is a project-scope server, so Claude Code asks once to approve it and you are connected. As a plugin (adds the \`/${NAME}:setup\` and \`/${NAME}:find-jobs\` skills):\n\n\`\`\`text\n${pluginAdd}\n${pluginInstall}\n\`\`\`\n\nThe \`.mcp.json\` in this repo reads the key from the environment: \`\${${ENV}:-}\` expands to the key when \`${ENV}\` is set and to nothing otherwise, and the server answers an empty header as the unkeyed tier — so the same file works with a key and without one. The keyless variant, if you would rather no header be sent at all:\n\n\`\`\`json\n${mcpJsonKeyless}\n\`\`\``,
  },
  cursor: {
    block: ["json", cursorJsonKeyless],
    keyed: `With a free key, the same file names the variable and Cursor fills it in (\`\${env:${ENV}}\` is resolved in \`headers\`), so the key never sits in the file:\n\n\`\`\`sh\n${exportLine}\n\`\`\`\n\n\`\`\`json\n${cursorJsonKeyed}\n\`\`\``,
  },
  vscode: {
    block: ["json", vscodeMcpJson],
    // GitHub makes no vscode: link clickable; the badge goes through
    // vscode.dev's redirect, which VS Code's docs do not describe — so it
    // is labelled as a convenience, and the documented link sits in step 1.
    keyed: `[![Install in VS Code](${vscodeBadgeImg})](${vscodeBadgeLink}) — the same link as step 1, made clickable through vscode.dev's redirect (a convenience GitHub needs; VS Code's docs describe only the \`vscode:\` form).`,
  },
  cline: {
    block: ["json", clineJson],
    keyed: `With a key: add \`"headers": { "Authorization": "Bearer …" }\` with your key to that server, in your own user-level file only — never in a committed one.`,
  },
  zed: {
    // The keyed sentence is Zed's step 1: its sign-in prompt fires whenever
    // no header is set, so the rule and the key belong in the same breath.
    block: ["json", zedJson],
  },
  windsurf: {
    block: ["json", windsurfJson],
    keyed: `With a free key, the same file names the variable and Windsurf fills it in (\`\${env:${ENV}}\` is resolved in \`headers\`), so the key never sits in the file:\n\n\`\`\`sh\n${exportLine}\n\`\`\`\n\n\`\`\`json\n${windsurfJsonKeyed}\n\`\`\``,
  },
  // "More…" is the heading that introduces the long tail; its own steps are
  // the intro, and the curl block belongs to the one client it describes.
  more: {},
  "gemini-cli": HOST_BLOCKS_GEMINI(),
  "codex-cli": HOST_BLOCKS_CODEX(),
  "any-client": {
    block: ["sh", curlInitialize],
  },
  "copy-the-prompt": {},
};
for (const h of ALL_HOSTS) if (!(h.id in HOST_BLOCKS)) throw new Error(`no block entry for host ${h.id}`);

// One README section per host, in the order mcp.config.json lists them:
// numbered steps, the pasteable block, the keyed sentence, "when sign-in is
// on" (a rule, never a state), and "How you know it worked".
const hostSection = (h) => {
  const b = HOST_BLOCKS[h.id];
  const parts = [`### ${h.name}${h.also ? ` (${h.also})` : ""}`, ""];
  parts.push(h.steps.map((s, i) => `${i + 1}. ${fill(s)}`).join("\n"), "");
  if (b.block) parts.push(`\`\`\`${b.block[0]}\n${b.block[1]}\n\`\`\``, "");
  if (b.keyed) parts.push(b.keyed, "");
  if (h.keyed) parts.push(fill(h.keyed), "");
  if (h.signInOn) parts.push(`When sign-in is on — ${fill(h.signInOn)}`, "");
  parts.push(`**How you know it worked:** ${fill(h.verify)}`, "");
  return parts.join("\n");
};

const tierTable = `| Tier | Tools | What opens it |
|---|---|---|
| Unkeyed | ${list(ANON)} | Nothing. ${C.anonCaps.perAddressPerDay} calls a day per network address, ${C.anonCaps.globalPerDay} a day across every unkeyed caller, a search is one page of ${C.anonCaps.searchRows} rows. |
| Free key | ${list(KEYED_READ)} (and the unkeyed tools at a higher cap) | A free key from ${C.keyPage} — ${C.freeKeyDailyQuota} calls a day. |
| Paid or pass | ${list(PAID)} | The paid API tier, or a live pass on the key's account (${C.passPage}). |
| Apply | ${list(APPLY)} | A key linked to an account with an Agent plan or a live pass, and a mandate — see \`key_status\`. |`;

const privacy = `## Privacy

Every search you run travels to the server as the query you typed. A key is stored as its hash and its first characters, never the key. For unkeyed calls the server keeps a truncated hash of your network address for the daily cap and drops it after ${C.anonAddressHashRetentionDays} days; the address itself is never stored. The tools never write to your machine. A key belongs in an environment variable, a keychain prompt or a host's secret store — never in a file you commit, a URL, a badge or a base64 config. Nothing in this repository carries a key.`;

const unkeyedSentence = `${prose(ANON)} answer with no key at all, so a fresh connection works on its first call from any host.`;
const jobIdSentence = `A \`${C.jobsPage}?job=<id>\` link's \`id\` is the argument \`get_job\`, \`fetch\`, \`check_apply_support\` and \`request_application\` take.`;
// THE RULE, NEVER THE STATE. Whether sign-in works from Claude and ChatGPT
// is a fact the server computes at request time and publishes on its own
// initialize answer; this file is rebuilt by hand, so it states the rule and
// hands the reader the one-line curl that prints today's state.
const signInRule = `Claude, Claude Desktop and ChatGPT have no field for a key. They sign you in instead — but only while the server's sign-in service is switched on. When it is off, a tool that needs your account answers in words (no Connect card), and ${prose(ANON.map((n) => `\`${n}\``))} still answer.`;
const signInReaderTail = `which prints \`"on"\`, \`"off"\` or \`"unknown"\` — the same word the page shows (the server reads the sign-in service's own metadata at \`${AS_URL}\` and caches the answer briefly).`;
const signInParagraph = `${signInRule} Today's state: press **Test the server** on ${C.agentsPage}, or run\n\n\`\`\`sh\n${signInReader}\n\`\`\`\n\n${signInReaderTail}`;
const verifyLine = `**Verify:** ask your agent to call \`board_stats\`. It answers with no key and says how many free calls are left today.`;
const addressGloss = `${C.anonCaps.perAddressPerDay} free calls a day per network address — an office, a home connection or a chat service's own servers count as one address, so from Claude or ChatGPT the number left can start lower because other people share it.`;
const troubleshootingTable = [
  `| What you see | Why | What to do |`,
  `|---|---|---|`,
  ...C.troubleshooting.map((r) => `| ${fill(r.symptom)}${r.state === "off" ? " (while sign-in is off)" : r.state === "on" ? " (while sign-in is on)" : ""} | ${fill(r.why)} | ${fill(r.fix)} |`),
].join("\n");

// ------------------------------------------------------------------ README
const readme = `<!-- GENERATED by scripts/build.mjs from mcp.config.json — edit those, not this file. -->
# ${C.displayName} — MCP server

${C.description} ${unkeyedSentence}

${verifyLine}

- Server address: \`${URL}\` — this address is on Supabase, the company that hosts our server; it is ours. Paste it exactly as it is (do not add \`/mcp\`). It is a plain web address your agent talks to (MCP over Streamable HTTP, one POST per message, no session to keep); there is nothing to install.
- Tools: ${C.tools.length} — ${list(C.tools.map((t) => t.name))}
- The how-to, per app, with a **Test the server** button: ${C.agentsPage}
- Free key: ${C.keyPage}
- One server, four names: \`${C.serverInfoName}\` is what \`initialize\` answers, \`${NAME}\` is the install name in every block below, \`${C.connectorName}\` is the name you type into Claude's or ChatGPT's own dialog, and \`${C.registryName}\` is the name reserved for the MCP Registry (not published yet).

${jobIdSentence}

${signInParagraph}

## Tiers

${tierTable}

The unkeyed allowance is ${addressGloss}

## Install

Pick your app. Every block but Zed's works with no key on its first call (Zed asks you to sign in when no key is set — its section says what to do); the keyed variant under a block is optional.

${HOSTS.map(hostSection).join("\n")}
${MORE_HOSTS.map(hostSection).join("\n").replace(/^### /gm, "#### ")}
## If it does not work

Symptoms are the server's own words, or a label the app's documentation prints (docs-snapshot.md). Rows marked "while sign-in is off" or "on" apply in that state only — the curl line above prints today's.

${troubleshootingTable}

## The plugin's skills

- \`/${NAME}:setup\` — get a free key, put it in \`${ENV}\`, reconnect.
- \`/${NAME}:find-jobs\` — the search → verify → apply order, with the gates named.

${privacy}

## This repository

- \`mcp.config.json\` is the only place a URL, tool name, cap, quota, host step or troubleshooting row is written. \`npm run build\` regenerates every other file; \`npm test\` fails if any generated file was edited by hand or the constants changed without a rebuild, validates each manifest against the schema its host publishes (copies under \`schemas/\`, fetched 2026-09-16), and checks that no generated file carries a placeholder inside an Authorization value.
- The tool list, the host ids (the six above and the long tail) and the sign-in key are a mirror of the site's own (\`${C.mirror.of}\` at \`${C.mirror.at}\`); when that changes, this file is re-synced and rebuilt.
- Every vendor label in the steps above is quoted from the vendor's documentation on the date in [docs-snapshot.md](./docs-snapshot.md); a label that is not there is not published here.
- \`server.json\` is the entry for the official MCP Registry.

## License

MIT — for the files in this repository. The server, the board and its data are ${C.site}'s own and are governed by its terms.
`;

// ------------------------------------------------------------ llms-install
const llmsInstall = `<!-- GENERATED by scripts/build.mjs from mcp.config.json — edit those, not this file. -->
# Installing the ${C.displayName} MCP server (for an agent doing the install)

You are configuring a REMOTE MCP server. There is nothing to download, build or run locally.

- Transport: Streamable HTTP (one POST per JSON-RPC message, no session to keep)
- URL: ${URL} — paste it exactly; do not append \`/mcp\`
- Server name to register: ${NAME}
- Optional credential: an environment variable \`${ENV}\` holding a \`${C.keyPrefix}...\` key. A key belongs in the host's own secret store, its prompt, or its user-level config file (the blocks below name each); never in a committed file, a URL, a badge, a base64 config or a log. If the person has none, register the server with no header — ${prose(ANON)} answer unkeyed.

## Steps

1. Ask the person which host they use, or detect it from the config file present.
2. Write the KEYLESS block for that host (below). Add the keyed form only when the person hands you a key, and only through the host's own indirection (an env var, \`\${env:${ENV}}\`, \`\${input:…}\`, \`bearer_token_env_var\`) — never paste the key into a value.
3. Restart or reconnect the host's MCP servers (Claude Code: \`/mcp\`; Cursor: reload MCP settings; Cline: the MCP panel's restart).
4. Verify with one unkeyed call: \`board_stats\` takes no arguments and answers with no key, and its answer says how many unkeyed calls are left today. With a key, \`key_status\` answers what the key may do.

## Sign-in from chat apps (a rule, not today's state)

${signInRule} Today's state: press **Test the server** on ${C.agentsPage}, or run

${indent(signInReader)}

${signInReaderTail}

## Blocks

Claude Code:

    ${claudeCodeKeyless}

Claude Code with a key in the environment:

    ${claudeCodeKeyed}

Cursor (\`~/.cursor/mcp.json\`; with a key, add \`"headers": { "Authorization": "Bearer \${env:${ENV}}" }\` — Cursor resolves the variable):

${indent(cursorJsonKeyless)}

VS Code (\`.vscode/mcp.json\`; it prompts for the key at start — leave it empty for the unkeyed tools; the \`vscode:mcp/install\` link form declares no input and asks nothing):

${indent(vscodeMcpJson)}

Gemini CLI:

    ${geminiAdd}

Codex CLI:

    ${codexAdd}

Codex CLI with a key (\`~/.codex/config.toml\`; the key is read from \`${ENV}\`):

${indent(codexToml)}

Cline (the Cline CLI's \`~/.cline/mcp.json\`; the VS Code extension's settings JSON is under the MCP Servers panel → Configure → Configure MCP Servers; or the Remote Servers tab: Server Name, Server URL, Transport Type "Streamable HTTP", Add Server):

${indent(clineJson)}

Zed (\`settings.json\`; Zed prompts for the server's sign-in whenever no Authorization header is set — if the reader above prints "off", add \`"headers": { "Authorization": "Bearer …" }\` with the person's key, in their own settings file only):

${indent(zedJson)}

Windsurf (\`~/.codeium/windsurf/mcp_config.json\` — the legacy Cascade agent's file; the Devin Local agent reads the Devin CLI config files instead; with a key, add \`"headers": { "Authorization": "Bearer \${env:${ENV}}" }\` — Windsurf resolves the variable):

${indent(windsurfJson)}

Claude (claude.ai, Claude Desktop) and ChatGPT have no config file: the person adds the address in the app's own dialog — the steps are on ${C.agentsPage} and in README.md.

## What the tools are

Unkeyed (no key at all): ${list(ANON)}. Any free key adds: ${list(KEYED_READ)}.
Paid or pass: ${list(PAID)}. Apply (account with a mandate): ${list(APPLY)}.

${jobIdSentence}

Do not invent a posting, a salary or an employer fact the tools did not return. \`check_jobs_open\` re-verifies a shortlist cheaply before \`get_jobs\`. Never call \`request_application\` without the person's explicit yes for that job id.

## If a tool refuses

${C.troubleshooting.filter((r) => r.flag === "server").map((r) => `- "${fill(r.symptom)}"${r.state === "off" ? " (while sign-in is off)" : r.state === "on" ? " (while sign-in is on)" : ""} — ${fill(r.why)} ${fill(r.fix)}`).join("\n")}
`;

// ------------------------------------------------------------ docs snapshot
const docsSnapshot = `<!-- GENERATED by scripts/build.mjs from mcp.config.json — edit those, not this file. -->
# Docs snapshot — the sentence each published label rests on

Every host label, menu path, command form and config field in README.md and llms-install.md was quoted from the vendor's own documentation on the date shown. A label that is not on this page is not published here. Re-fetch before changing a step; if a sentence is gone from the doc, the step that rests on it comes out.

${C.docsSnapshot.map((d) => [`## ${d.url}`, ``, `Fetched ${d.fetched} · used by: ${d.block}`, ``, ...d.sentences.map((x) => `- ${x}`), ...(d.absent?.length ? [``, `Not on the page (so not published): ${d.absent.map((x) => `\`${x}\``).join(", ")}`] : []), ``].join("\n")).join("\n")}`;

// ------------------------------------------------------------------ skills
const setupSkill = `---
name: setup
description: Connect the ${C.displayName} MCP server with a free key. Use when the person asks to set up, connect, or add a key for ${NAME}, or when a keyed tool refuses for want of a key.
---

# Set up the ${C.displayName} connection

This plugin's \`.mcp.json\` registers \`${NAME}\` at \`${URL}\` and reads the key from \`${ENV}\` — unset, it sends no key. ${unkeyedSentence} Everything else needs a free key.

1. Tell the person to open ${C.keyPage} and get a key (it starts with \`${C.keyPrefix}\`). Do not ask them to paste it into the chat; ask them to put it in their shell environment:

       ${exportLine}

2. Reconnect: the plugin's server reads \`${ENV}\` on its next start. If the server was added by hand without the header, register a keyed copy instead:

       ${claudeCodeKeyed}

3. Run \`/mcp\` and reconnect, then call \`key_status\` — it answers the tier, the calls left today and whether the paid and apply tools would work, with any blocker named.

Never write the key into \`.mcp.json\`, a URL, or a file that is committed. If a keyed tool answers that sign-in through the server is not switched on, this connection holds no key and no sign-in: say that ${prose(ANON.map((n) => `\`${n}\``))} still answer, point at ${C.keyPage}, and stop. If \`key_status\` says the paid tools are closed, a pass or plan at ${C.passPage} opens them; name the gate, never a price.
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
4. \`get_job\` or \`get_jobs\` for the full text of the ones that survived (\`fetch\` reads one posting with no key). ${jobIdSentence}
5. \`employer_hiring_record\` for an employer's own record — per board, never summed, never a ranking; a takedown is a takedown, never a hire.
6. \`check_apply_support\` before any talk of applying; \`request_application\` only after the person says yes to that specific job id, and only if \`key_status\` shows the apply tools open (account, mandate, plan or pass).

Rules: never invent a posting, salary or employer fact the tools did not return; show pay only when the card states it; say "unknown" when the tool does. Tools that need a key or a pass: name the gate (${C.keyPage} for a key, ${C.passPage} for a pass), never a price. A tool that answers "Sign-in through this server is not switched on yet" needs a key this connection does not hold: say so, name the unkeyed tools, and stop.
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
  "docs-snapshot.md": docsSnapshot,
  // SETUP.md was a byte-identical hand copy of the setup skill — two copies of
  // one text is the drift shape (project_claim_drift); the skill is the one.
  "skills/setup/SKILL.md": setupSkill,
  "skills/find-jobs/SKILL.md": findJobsSkill,
};

export const GENERATED = Object.keys(OUT);
export const LINKS = { cursorDeepLink, vscodeLink, vscodeInsidersLink, vscodeBadgeLink, signInReader, curlInitialize };

// The write/check loop runs only when this file is the entry point; a test
// that imports FILL, GENERATED or LINKS must never rewrite the tree.
const isEntry = !!process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isEntry) {
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
}
