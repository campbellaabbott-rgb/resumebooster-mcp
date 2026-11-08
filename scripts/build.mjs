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
// The apply agent's tools are retired on the server (owner decision
// 2026-10-11: RETIRED_TOOLS, listed to nobody), so the site's mirror lists no
// apply tool and nothing below describes that tier. A tool listed in it again
// needs its gate re-worded from the site before anything here prints it.
if (APPLY.length) throw new Error(`apply-tier tools listed (${APPLY.join(", ")}): the apply tier is retired on the server — re-word the tier table and skills from the site before publishing them`);
const ANON = C.anonTools;
const KEYED_READ = READ.filter((n) => !ANON.includes(n));
// What tools/list shows (the server's listedTools): with no credential the
// unkeyed tools; with one, every tool but NEVER_LISTED; inside ChatGPT never
// NOT_ON_CHATGPT. The README's tool bullets are these three sets, in the
// registry's order, so scripts/check-live.mjs can diff them against a live
// tools/list.
const NEVER_LISTED = C.neverListed;
const NOT_ON_CHATGPT = C.notOnChatGpt;
const RETIRED = C.retiredTools;
const LISTED_NO_KEY = C.tools.map((t) => t.name).filter((n) => ANON.includes(n));
const LISTED_WITH_KEY_ADDS = C.tools.map((t) => t.name).filter((n) => !ANON.includes(n) && !NEVER_LISTED.includes(n));
for (const n of [...NEVER_LISTED, ...NOT_ON_CHATGPT]) if (!C.tools.some((t) => t.name === n)) throw new Error(`${n} is named in neverListed/notOnChatGpt but is not a tool`);
for (const n of RETIRED) if (C.tools.some((t) => t.name === n)) throw new Error(`${n} is retired on the server (RETIRED_TOOLS) and must not be listed as a tool`);
for (const n of ANON) if (NEVER_LISTED.includes(n)) throw new Error(`${n} is unkeyed and never listed — the server lists every unkeyed tool`);
const list = (names) => names.map((n) => `\`${n}\``).join(", ");
const prose = (names) =>
  names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
const orProse = (names) =>
  names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
// The hiring systems whose real application form apply_myself returns, and
// the pair it reads inside ChatGPT: the site's MCP_FORM_VENDORS (with
// MCP_FORM_VENDORS_AFTER_DEPLOY) and MCP_FORM_VENDORS_ON_CHATGPT, held to the
// server's FORM_READER_VENDORS and PUBLIC_API_FORM_VENDORS by the mirror test.
const FORM_VENDORS = orProse(C.formVendors.map((v) => v.label));
const FORM_VENDORS_CHATGPT = orProse(C.formVendors.filter((v) => C.formVendorsOnChatGpt.includes(v.key)).map((v) => v.label));
// The site's MCP_EXAMPLE_QUESTION: the first question every page suggests, in
// the words a person types (the server moves "in <known place>" to location).
const EXAMPLE_QUESTION = `Find ${C.testQuery} jobs in Texas with ${C.connectorName} and show me ten.`;
// What a job tool takes besides the id: agent-mcp's job-link.ts reads the
// board's ?job= links and posting pages and the employer's own Greenhouse,
// Lever and Ashby links (the mirror test holds the reader to these).
const JOB_LINKS = `a \`${C.jobsPage}?job=<id>\` link, a \`${C.site}/jobs/posting/\` page, or the employer's own Greenhouse, Lever or Ashby posting link`;

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
// long tail under the "Other apps" heading (the site's MCP_MORE_HOSTS). Both
// id lists mirror the site; the README prints them in that order. The tail's
// heading is this file's own label, never the site's "more" button text
// (SEO-027: a published page does not print that button by name).
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
// The registry entry is published (C.registry: listed, with the date it was
// published and the date that was last read off the registry's own API). The
// README names it in prose with the registry's page and the entry's API
// record, and carries no badge.
// With C.registry.listed false, the README says the name is reserved and
// links nothing (the test pins both directions).

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
      description: `Optional. A free ${C.keyPrefix} key from ${C.keyPage} adds ${prose(LISTED_WITH_KEY_ADDS)}; leave it empty and ${prose(ANON)} still answer.`,
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
// The one-step form names the marketplace source with --marketplace
// (code.claude.com/docs/en/discover-plugins, fetched 2026-11-08: v2.1.275 in a
// session, v2.1.292 from the shell). Installed copies from a third-party
// marketplace do not update themselves ("Off by default"), so the README says
// how to take a new version.
const pluginInstallShell = `claude plugin install ${NAME} --marketplace ${C.repoOwner}/${C.repoName}`;
const pluginUpdate = `claude plugin update ${NAME}@${NAME}`;

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
  searchRows: String(C.anonCaps.searchRows),
  dailyQuota: String(C.freeKeyDailyQuota),
  fitFreePerDay: String(C.fitFreePerDay),
  fitFullPerDay: String(C.fitFullPerDay),
  keyIdleDays: String(C.freeKeyIdleRevokeDays),
  keyPage: C.keyPage,
  privacyPage: C.privacyPage,
  jobsPage: C.jobsPage,
  jobLinks: JOB_LINKS,
  anonToolCount: String(LISTED_NO_KEY.length),
  exampleQuestion: EXAMPLE_QUESTION,
  chatgptPricingUrl: C.chatgptPlanRule.url,
  chatgptPlanRead: C.chatgptPlanRule.read,
  chatgptPlanQuote: C.chatgptPlanRule.quote,
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
    keyed: `With a free key, for every project:\n\n\`\`\`sh\n${exportLine}\n${claudeCodeKeyed}\n\`\`\`\n\nOr clone this repository: its \`.mcp.json\` is a project-scope server, so Claude Code asks once to approve it and you are connected. As a plugin (adds the \`/${NAME}:setup\` and \`/${NAME}:find-jobs\` skills), in one command from your shell (Claude Code 2.1.292 or newer):\n\n\`\`\`sh\n${pluginInstallShell}\n\`\`\`\n\nor, in a session:\n\n\`\`\`text\n${pluginAdd}\n${pluginInstall}\n\`\`\`\n\n(on 2.1.275 or newer, \`/plugin install ${NAME} --marketplace ${C.repoOwner}/${C.repoName}\` does both in one line). Claude Code does not update a plugin from a marketplace like this one by itself (auto-update is off by default for third-party marketplaces); to take a new version, run \`${pluginUpdate}\`.\n\nThe \`.mcp.json\` in this repo reads the key from the environment: \`\${${ENV}:-}\` expands to the key when \`${ENV}\` is set and to nothing otherwise, and the server answers an empty header as the unkeyed tier — so the same file works with a key and without one. The keyless variant, if you would rather no header be sent at all:\n\n\`\`\`json\n${mcpJsonKeyless}\n\`\`\``,
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
  // "Other apps" is the heading that introduces the long tail; its own steps
  // are the intro, and the curl block belongs to the one client it describes.
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
  if (h.lead) parts.push(fill(h.lead), "");
  parts.push(h.steps.map((s, i) => `${i + 1}. ${fill(s)}`).join("\n"), "");
  if (b.block) parts.push(`\`\`\`${b.block[0]}\n${b.block[1]}\n\`\`\``, "");
  if (b.keyed) parts.push(b.keyed, "");
  if (h.keyed) parts.push(fill(h.keyed), "");
  if (h.signInOn) parts.push(`When sign-in is on — ${fill(h.signInOn)}`, "");
  parts.push(`**How you know it worked:** ${fill(h.verify)}`, "");
  return parts.join("\n");
};

// The unkeyed row is the /agents page's developer disclosure (AgentConnect.tsx),
// its figures read from the mirrored MCP_ANON_CAPS — the split by platform,
// never the site's legacy perAddressPerDay/hostPoolPerDay/globalPerDay names.
// The fit row is the site's MCP_FIT_ALLOWANCE and fit_resume's own gate.
const A = C.anonCaps;
const unkeyedAllowance = `A daily allowance split by where the call comes from: Claude's users share ${A.shares.claude}; ChatGPT's share ${A.shares.chatgpt} (${A.chatgptPerPerson} for each person when ChatGPT's call names them, ${A.chatgptNoSubject} shared by calls that name nobody); every other caller has ${A.otherPerConnection} per internet connection (an IPv4 address or an IPv6 /64); ${A.overallPerDay} a day in all, and at most ${A.perMinute.overall} a minute across every keyless caller. Reading an application form draws on a separate pool of ${A.forms.overall} a day. A keyless search returns ${A.searchRows} rows a page, to offset ${A.maxOffset}; \`board_stats\` is never counted.`;
const tierTable = `| Tier | Tools | What opens it |
|---|---|---|
| Unkeyed | ${list(ANON)} | Nothing. ${unkeyedAllowance} |
| Free key | ${list(KEYED_READ)} (and the unkeyed tools at a higher cap) | A free key from ${C.keyPage} — ${C.freeKeyDailyQuota} calls a day. |
| Confirmed key | ${list(PAID)} | A key whose email address was confirmed (the free key the emailed link issues), or an account that has proven its mailbox — ${C.fitFreePerDay} scorings a day; ${C.fitFullPerDay} on an account with a paid plan, counted together with \`POST /v1/fit\` on the data API. Never offered inside ChatGPT. |`;

// The privacy rows are the site's MCP_PRIVACY_ROWS, word for word (the mirror
// test pins each by id). The search row is computed on the site from a flag
// and a date, so this paragraph links the table for it rather than copy it.
const privacyRow = (id) => {
  const r = C.privacyRows.find((x) => x.id === id);
  if (!r) throw new Error(`privacyRows has no ${id}`);
  return r;
};
const privacy = `## Privacy

What reaches the server from your AI, and what it keeps, is the table under "Using Resume Booster from your own AI" on ${C.privacyPage}. Its rows, word for word, except the first, whose answer depends on the app and the day, so it is linked rather than copied:

| What | What is kept |
|---|---|
| Your search words and filters | The first row of the table on ${C.privacyPage}, for each app. |
${["job-ids", "address", "chatgpt-id", "usage", "cv", "chat"].map((id) => `| ${privacyRow(id).what} | ${privacyRow(id).kept} |`).join("\n")}

A key is stored as its hash and its first characters, never the key. The tools never write to your machine. A key belongs in an environment variable, a keychain prompt or a host's secret store — never in a file you commit, a URL, a badge or a base64 config. Nothing in this repository carries a key.`;

const unkeyedSentence = `${prose(ANON)} answer with no key at all, so a fresh connection works on its first call from any host.`;
const jobIdSentence = `Every tool that takes a job (\`get_job\`, \`get_jobs\`, \`fetch\`, \`check_jobs_open\` and \`apply_myself\`) takes its id or the posting's link: ${JOB_LINKS}.`;
// The board has no sponsorship filter (search_jobs takes none); the owner's
// 2026-11-07 decision is that answers say so plainly. Rule (1) of applyRules
// already forbids inferring it.
const visaSentence = "The board cannot filter by visa sponsorship: no search filter takes it. An AI asked about sponsorship says so plainly, and never infers it from a posting.";
// apply_myself is the only apply path, free and keyless; the person submits.
const applySentence = `\`apply_myself\` is how a person applies, free and with no key: when the posting's hiring system is ${FORM_VENDORS}, it returns the employer's real application form, every question with its options and who should answer it; otherwise it returns the posting's apply link. Inside ChatGPT it reads the form only for ${FORM_VENDORS_CHATGPT}. The person reads every answer and presses Submit on the employer's own site: ${C.connectorName} never submits anything for anyone. Reading a form draws on a pool of its own (${C.anonCaps.forms.overall} a day across keyless callers), so it never spends a search.`;
const applyRulesSentence = `An AI helping someone apply follows the server's own rules, word for word: ${C.applyRules}`;
// THE RULE, NEVER THE STATE. Whether sign-in works from Claude and ChatGPT
// is a fact the server computes at request time and publishes on its own
// initialize answer; this file is rebuilt by hand, so it states the rule and
// hands the reader the one-line curl that prints today's state.
const signInRule = `Claude, Claude Desktop and ChatGPT have no field for a key. They can sign you in instead — but only while the server's sign-in service is switched on, and a connector added while it was off may need removing and adding again first. When it is off, a tool that needs your account answers in words (no Connect card), and ${prose(ANON.map((n) => `\`${n}\``))} still answer.`;
const signInReaderTail = `which prints \`"on"\`, \`"off"\` or \`"unknown"\` — the same word the page shows (the server reads the sign-in service's own metadata at \`${AS_URL}\` and caches the answer briefly).`;
const signInParagraph = `${signInRule} Today's state: press **Test the server** on ${C.agentsPage}, or run\n\n\`\`\`sh\n${signInReader}\n\`\`\`\n\n${signInReaderTail}`;
// board_stats is cached and never counted (agent-mcp's keyless board_stats
// answer says so), so the line names the count it returns, not calls left.
// That count is the whole board's: it includes the withheld systems'
// postings, which no tool here returns (its excludedSources names them). The
// figure an AI can search is the one the home page prints, dated.
const verifyLine = `**Verify:** ask your agent to call \`board_stats\`. It answers with no key and names the number of open postings; it is never counted against the free allowance. That number is the whole board's: it includes the postings of the hiring systems this server does not hand on (the answer's \`excludedSources\` names them), so your AI can search fewer. The home page, ${C.site}, prints the number your AI can search and the day it was counted.`;
// What tools/list answers each kind of caller, as four bullets that
// scripts/check-live.mjs reads back and diffs against a live tools/list.
const toolBullets = [
  `- Tools: ${C.tools.length} in all.`,
  `  - With no key, \`tools/list\` lists ${LISTED_NO_KEY.length}: ${list(LISTED_NO_KEY)}`,
  `  - With a key it also lists: ${list(LISTED_WITH_KEY_ADDS)}`,
  `  - Answered on a key, never listed: ${list(NEVER_LISTED)}`,
  `  - Never listed inside ChatGPT: ${list(NOT_ON_CHATGPT)}`,
].join("\n");
// The site's MCP_ADDRESS_GLOSS, word for word (C.addressGloss): count-free on
// the site's purpose — the figures sit in the tier table above it.
// The registry, said once with its links while the entry is listed, and as a
// reserved name (no link) when it is not.
const registryBullet = C.registry?.listed
  ? `- Listed in the official MCP Registry as \`${C.registryName}\`: ${C.registry.listingUrl} (the entry as the registry's API serves it: ${C.registry.recordUrl})\n`
  : "";
const registryName = C.registry?.listed
  ? `\`${C.registryName}\` is its name in the official MCP Registry`
  : `\`${C.registryName}\` is the name reserved for the MCP Registry (not published yet)`;
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

- Server address: \`${URL}\` — this address is on Supabase, the company that hosts our server; it is ours. Paste it exactly as it is (it also answers with \`/mcp\` on the end, but needs nothing added). It is a plain web address your agent talks to (MCP over Streamable HTTP, one POST per message, no session to keep); there is nothing to install.
${toolBullets}
- The how-to, per app, with a **Test the server** button: ${C.agentsPage}
- Free key: ${C.keyPage}
${registryBullet}- Also on the site: the Ghost Job Index, the board's live measure of which postings are real (open roles, how old they are by the employer's own date, the takedowns it has logged), at ${C.ghostJobIndexPage}; and live ATS score benchmarks from the site's own résumé scans, at ${C.atsBenchmarksPage}.
- One server, four names: \`${C.serverInfoName}\` is what \`initialize\` answers, \`${NAME}\` is the install name in every block below, \`${C.connectorName}\` is the name you type into Claude's or ChatGPT's own dialog, and ${registryName}.

${jobIdSentence}

${C.withheldNote}

${visaSentence}

## Applying yourself

${applySentence}

${applyRulesSentence}

## Sign-in

${signInParagraph}

## Tiers

${tierTable}

${C.addressGloss}

## Install

Pick your app. Every block but Zed's works with no key on its first call (Zed asks you to sign in when no key is set — its section says what to do); the keyed variant under a block is optional.

${HOSTS.map(hostSection).join("\n")}
${MORE_HOSTS.map(hostSection).join("\n").replace(/^### /gm, "#### ")}
## If it does not work

Symptoms are the server's own words, or a label the app's documentation prints (docs-snapshot.md). Rows marked "while sign-in is off" or "on" apply in that state only — the curl line above prints today's.

${troubleshootingTable}

## The plugin's skills

- \`/${NAME}:setup\` — get a free key, put it in \`${ENV}\`, reconnect.
- \`/${NAME}:find-jobs\` — search, re-check the shortlist is open, read it, then help the person apply themselves with \`apply_myself\`, under the server's apply rules.

${privacy}

## This repository

- \`mcp.config.json\` is the only place a URL, tool name, cap, quota, host step or troubleshooting row is written. \`npm run build\` regenerates every other file; \`npm test\` fails if any generated file was edited by hand or the constants changed without a rebuild, validates each manifest against the schema its host publishes (copies under \`schemas/\`, fetched 2026-09-16), and checks that no generated file carries a placeholder inside an Authorization value.
- The tool list, the host ids (the six above and the long tail) and the sign-in key are a mirror of the site's own (\`${C.mirror.of}\`), and the server's own words are quoted from its build \`${C.mirror.serverBuild}\`; when either changes, this file is re-synced and rebuilt.
- \`npm run check-live\` asks the live server for its \`tools/list\` with no key (and with \`${ENV}\` too, when it is set) and fails if the tool bullets at the top of this file name a different set, or if the server runs a build older than \`${C.mirror.serverBuild}\`. It reads production, so \`npm test\` never runs it; the weekly CI run does.
- Every vendor label in the steps above is quoted from the vendor's documentation on the date in [docs-snapshot.md](./docs-snapshot.md); a label that is not there is not published here.
- \`server.json\` is the entry for the official MCP Registry, at version ${C.version}; the registry's API record linked above shows the version it serves.

## License

MIT — for the files in this repository. The server, the board and its data are ${C.site}'s own and are governed by its terms.
`;

// ------------------------------------------------------------ llms-install
const llmsInstall = `<!-- GENERATED by scripts/build.mjs from mcp.config.json — edit those, not this file. -->
# Installing the ${C.displayName} MCP server (for an agent doing the install)

You are configuring a REMOTE MCP server. There is nothing to download, build or run locally.

- Transport: Streamable HTTP (one POST per JSON-RPC message, no session to keep)
- URL: ${URL} — paste it exactly (it also answers with \`/mcp\` appended, but needs nothing added)
- Server name to register: ${NAME}
- Optional credential: an environment variable \`${ENV}\` holding a \`${C.keyPrefix}...\` key. A key belongs in the host's own secret store, its prompt, or its user-level config file (the blocks below name each); never in a committed file, a URL, a badge, a base64 config or a log. If the person has none, register the server with no header — ${prose(ANON)} answer unkeyed.

## Steps

1. Ask the person which host they use, or detect it from the config file present.
2. Write the KEYLESS block for that host (below). Add the keyed form only when the person hands you a key, and only through the host's own indirection (an env var, \`\${env:${ENV}}\`, \`\${input:…}\`, \`bearer_token_env_var\`) — never paste the key into a value.
3. Restart or reconnect the host's MCP servers (Claude Code: \`/mcp\`; Cursor: reload MCP settings; Cline: the MCP panel's restart).
4. Verify with one unkeyed call: \`board_stats\` takes no arguments, answers with no key and is never counted against the keyless allowance (its answer says so). Its posting count is the whole board's, including the systems named in its \`excludedSources\`, which no tool returns; do not tell the person they can search that many (the figure an AI can search is on ${C.site}'s home page, dated). With a key, \`key_status\` answers what the key may do.

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

Claude (claude.ai, Claude Desktop) and ChatGPT have no config file: the person adds the address in the app's own dialog — the steps are on ${C.agentsPage} and in README.md. On ChatGPT Free they cannot: OpenAI's plan table (${C.chatgptPlanRule.url}, read ${C.chatgptPlanRule.read}) says "${C.chatgptPlanRule.quote}". Claude's free plan can add one custom connector.

## What the tools are

Unkeyed (no key at all): ${list(ANON)}. Any free key adds: ${list(KEYED_READ)} (\`tools/list\` never shows ${list(NEVER_LISTED)}; it answers on a key).
A key whose email address was confirmed adds: ${list(PAID)}.

${jobIdSentence}

${C.withheldNote}

${visaSentence}

Do not invent a posting, a salary or an employer fact the tools did not return. \`check_jobs_open\` re-verifies a shortlist cheaply before \`get_jobs\`.

${applySentence}

${applyRulesSentence}

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

1. Tell the person to open ${C.keyPage} and get a key (it starts with \`${C.keyPrefix}\`) — the page emails them a single-use link, and the page that link opens shows the key once. Do not ask them to paste it into the chat; ask them to put it in their shell environment:

       ${exportLine}

2. Reconnect: the plugin's server reads \`${ENV}\` on its next start. If the server was added by hand without the header, register a keyed copy instead:

       ${claudeCodeKeyed}

3. Run \`/mcp\` and reconnect, then call \`key_status\` — it answers the tier, the requests left this minute, the calls left today and the fit scorings left today, with any blocker named.

Never write the key into \`.mcp.json\`, a URL, or a file that is committed. If a keyed tool answers that sign-in through the server is not switched on, this connection holds no key and no sign-in: say that ${prose(ANON.map((n) => `\`${n}\``))} still answer, point at ${C.keyPage}, and stop. If ${prose(PAID.map((n) => `\`${n}\``))} is refused, name the gate: a key whose email address was confirmed (the free key the emailed link issues) scores ${C.fitFreePerDay} times a day, and an account with a paid plan ${C.fitFullPerDay} — never a price. A key is not needed to search, read postings or apply: \`apply_myself\` answers with no key.
`;

const findJobsSkill = `---
name: find-jobs
description: Search the live ${C.displayName} for a person, re-check that the shortlist is still open, read it, and help them apply themselves with apply_myself. Use for any job search, "is this posting still open", employer hiring record, or apply request.
---

# Find jobs on the board, and help the person apply

Every tool below answers with no key: ${list(ANON)}. Order of calls, and why:

1. \`search_jobs\` with the role read from the person's words, or from a CV the person confirms, given in this conversation or kept in its project or memory (never invented). Put the place in \`location\`, not in \`query\`, and send job titles and places, never CV text. Read its disclosures (\`ignoredFilters\`, \`countUnavailable\`) back to them. With no key, a search is one page of ${C.anonCaps.searchRows} rows, to offset ${C.anonCaps.maxOffset}.
2. \`check_jobs_open\` on the shortlist (up to ${C.anonCaps.checkJobsOpenIds} ids a call with no key) before reading it in full — it answers from the board's index, not the employer's site at that instant, and names that basis.
3. \`get_jobs\` or \`get_job\` for the full text of the ones still open (\`fetch\` is the same read in ChatGPT's research shape). ${jobIdSentence}
4. \`employer_hiring_record\` or \`employer_growth\` for an employer's own record — per board, never summed, never a ranking; a takedown is a takedown, never a hire.
5. \`apply_myself\` when the person picks a posting. ${applySentence}

${applyRulesSentence}

Rules: never invent a posting, salary or employer fact the tools did not return; show pay only when the card states it; say "unknown" when the tool does. ${visaSentence} ${C.withheldNote} Tools that need a key (${list([...KEYED_READ, ...PAID])}): name the gate (${C.keyPage} for a free key), never a price. A tool that answers "Sign-in through this server is not switched on yet" needs a key this connection does not hold: say so, name the unkeyed tools, and stop.
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
