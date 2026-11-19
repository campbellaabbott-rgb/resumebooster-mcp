// Every URL, name, tool, cap and quota published by this repo is pinned to
// mcp.config.json here, and the checks are proven to bite on a mutated copy.
//
// The tool list, the unkeyed tier and the caps in mcp.config.json are a
// MIRROR of resume-signal-pro/src/config/mcp-tools.ts (itself the frontend's
// mirror of supabase/functions/agent-mcp). Nothing here fetches from
// production. When the website repo is checked out beside this one (or
// RESUME_SIGNAL_PRO_DIR names it), the last test reads that TypeScript file
// and fails on drift; when it is absent the test is skipped with a note, and
// `mirror.at` in mcp.config.json says which commit the list was copied from.
// Re-sync the mirror when that file changes, then `npm run build`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compareBuilds } from "../scripts/check-live.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const C = JSON.parse(readFileSync(join(ROOT, "mcp.config.json"), "utf8"));
const readJson = (rel, root = ROOT) => JSON.parse(readFileSync(join(root, rel), "utf8"));
const readText = (rel, root = ROOT) => readFileSync(join(root, rel), "utf8");
const run = (script, env = {}, root = ROOT) =>
  spawnSync(process.execPath, [join(ROOT, "scripts", script), ...(script === "build.mjs" ? ["--check"] : [])], {
    env: { ...process.env, ...env },
    encoding: "utf8",
  });

// A working copy of the repo to mutate; scripts are always the real ones.
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), "resumebooster-mcp-"));
  cpSync(ROOT, dir, { recursive: true, filter: (src) => !src.includes("node_modules") && !src.includes("/.git/") && !src.endsWith("/.git") });
  return dir;
};

test("every generated file is exactly what mcp.config.json produces", () => {
  const r = run("build.mjs");
  assert.equal(r.status, 0, r.stderr + r.stdout);
});

test("every manifest validates against its host's schema", () => {
  const r = run("verify.mjs");
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /5\/5 manifests valid/);
});

test("mcp.config.json is internally consistent", () => {
  assert.match(C.mcpUrl, /^https:\/\/[^/]+\/functions\/v1\/agent-mcp$/);
  assert.ok(C.description.length <= 100, "registry caps description at 100");
  assert.match(C.registryName, /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
  assert.ok(C.registryName.endsWith("/jobs"), "the name keeps the substring registry search finds");
  assert.match(C.version, /^\d+\.\d+\.\d+$/);
  const names = C.tools.map((t) => t.name);
  assert.equal(new Set(names).size, names.length, "duplicate tool");
  for (const t of C.tools) assert.ok(["read", "paid", "apply"].includes(t.tier), t.name);
  for (const a of C.anonTools) assert.ok(names.includes(a), `unkeyed tool ${a} is not a tool`);
  for (const a of C.anonTools) assert.equal(C.tools.find((t) => t.name === a).tier, "read", "an unkeyed tool is a read tool");
  assert.ok(!C.tools.some((t) => t.tier === "apply"), "the apply tier is retired on the server (RETIRED_TOOLS); build.mjs refuses to print it");
  assert.ok(C.anonCaps.otherPerConnection < C.anonCaps.shares.other && C.anonCaps.shares.other < C.anonCaps.overallPerDay);
  assert.ok(C.anonCaps.chatgptPerPerson < C.anonCaps.shares.chatgpt);
  assert.ok(C.freeKeyDailyQuota > C.anonCaps.otherPerConnection && C.freeKeyDailyQuota > C.anonCaps.chatgptPerPerson, "a key must raise the cap or the key page lies");
  assert.ok(C.fitFreePerDay > 0 && C.fitFullPerDay > C.fitFreePerDay, "a paid plan must raise the fit allowance");
  assert.ok(!/^(api[_-]?key|token|secret|password|auth)/i.test(C.keyEnvVar), "Claude Code reads credential-named env vars as empty in remote headers");
  for (const n of [...C.neverListed, ...C.notOnChatGpt]) assert.ok(names.includes(n), `${n} (neverListed/notOnChatGpt) is not a tool`);
  for (const n of C.retiredTools) assert.ok(!names.includes(n), `${n} is retired on the server and listed as a tool`);
  for (const n of C.anonTools) assert.ok(!C.neverListed.includes(n) && !C.notOnChatGpt.includes(n), `${n} is unkeyed, so every caller's tools/list shows it`);
  const vendorKeys = C.formVendors.map((v) => v.key);
  for (const k of C.formVendorsOnChatGpt) assert.ok(vendorKeys.includes(k), `ChatGPT form vendor ${k} is not a form vendor`);
  assert.match(C.chatgptPlanRule.read, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(C.chatgptPlanRule.url, "https://chatgpt.com/pricing");
  assert.equal(C.passPage, undefined, "the Agent Pass is retired; no constant may point at its page");
  assert.match(C.mirror.serverBuild, /^agent-mcp\.\d{4}-\d{2}-\d{2}\.\d+$/, "the build whose strings these pages quote, as the server's x-fn-build spells it");
});

test("the plugin, the marketplace, the extension and the registry entry carry one version, above the one the registry published", () => {
  const semver = (v) => v.split(".").map(Number);
  const above = (a, b) => { const [x, y] = [semver(a), semver(b)]; for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
  const versions = [readJson(".claude-plugin/plugin.json").version, readJson(".claude-plugin/marketplace.json").version, readJson(".claude-plugin/marketplace.json").plugins[0].version, readJson("gemini-extension.json").version, readJson("server.json").version];
  assert.deepEqual([...new Set(versions)], [C.version], "every manifest carries mcp.config.json's version");
  // Registry versions are immutable and installed plugin copies only see a
  // new version, so a corrected text must ship under a higher one.
  assert.ok(above(C.version, C.registry.publishedVersion), `version ${C.version} must be above the registry's published ${C.registry.publishedVersion}`);
});

test("each manifest carries the one URL and the one name", () => {
  const mcp = readJson(".mcp.json");
  assert.deepEqual(Object.keys(mcp.mcpServers), [C.serverName]);
  assert.equal(mcp.mcpServers[C.serverName].url, C.mcpUrl);
  assert.equal(mcp.mcpServers[C.serverName].type, "http");
  // PLAN §6(a): the header reads the key from the environment and expands to
  // nothing when unset, which the server answers as the unkeyed tier. The
  // env var's name is not credential-shaped (Claude Code blanks those).
  assert.deepEqual(mcp.mcpServers[C.serverName].headers, { Authorization: `Bearer \${${C.keyEnvVar}:-}` }, ".mcp.json carries the env-header form the plan specifies");
  assert.ok(!/rb_live_[A-Za-z0-9]{8,}/.test(JSON.stringify(mcp)), "no key in the file");

  const plugin = readJson(".claude-plugin/plugin.json");
  assert.equal(plugin.name, C.serverName);
  assert.equal(plugin.version, C.version);
  assert.equal(plugin.homepage, C.agentsPage);
  assert.equal(plugin.repository, C.repoUrl);
  assert.equal(plugin.license, "MIT");

  const market = readJson(".claude-plugin/marketplace.json");
  assert.equal(market.name, C.serverName);
  assert.equal(market.plugins.length, 1);
  assert.equal(market.plugins[0].name, C.serverName);
  assert.equal(market.plugins[0].source, "./", "the plugin is the marketplace root");
  assert.equal(market.plugins[0].version, C.version);

  const gemini = readJson("gemini-extension.json");
  assert.equal(gemini.name, C.serverName);
  assert.equal(gemini.version, C.version);
  assert.equal(gemini.mcpServers[C.serverName].httpUrl, C.mcpUrl);
  assert.equal(gemini.mcpServers[C.serverName].headers.Authorization, `Bearer $${C.keyEnvVar}`);
  assert.deepEqual(gemini.settings.map((s) => s.envVar), [C.keyEnvVar]);
  assert.equal(gemini.settings[0].sensitive, true);

  const server = readJson("server.json");
  assert.equal(server.name, C.registryName);
  assert.equal(server.version, C.version);
  assert.equal(server.description, C.description);
  assert.equal(server.$schema, C.registrySchema);
  assert.equal(server.websiteUrl, C.agentsPage);
  assert.equal(server.repository.url, C.repoUrl);
  assert.equal(server.icons[0].src, C.iconUrl);
  assert.equal(server.remotes.length, 1);
  assert.equal(server.remotes[0].url, C.mcpUrl);
  assert.equal(server.remotes[0].type, "streamable-http");
  assert.equal(server.packages, undefined, "remotes only");
  assert.equal(server.remotes[0].headers[0].isRequired, false);
  assert.equal(server.remotes[0].headers[0].isSecret, true);
});

test("the README's links, count and tool names come from the constants", () => {
  const readme = readText("README.md");
  const b64 = Buffer.from(JSON.stringify({ url: C.mcpUrl })).toString("base64");
  assert.ok(readme.includes(`cursor://anysphere.cursor-deeplink/mcp/install?name=${C.serverName}&config=${b64}`), "cursor deep link");
  // The web form (cursor.com/install-mcp) and the badge are not on Cursor's
  // install-links page (docs-snapshot.md), so the README carries neither.
  assert.ok(!readme.includes("cursor.com/install-mcp"), "an undocumented cursor web link");
  assert.ok(!readme.includes("cursor.com/deeplink/mcp-install"), "an undocumented cursor badge");
  // The registry line follows C.registry.listed both ways: a listed entry is
  // named with its two links and never as "not published yet"; an unlisted
  // one is a reserved name and links nothing (a link over an unpublished
  // entry is a claim). The teeth for the unlisted side are below.
  if (C.registry.listed) {
    assert.ok(readme.includes(`Listed in the official MCP Registry as \`${C.registryName}\`: ${C.registry.listingUrl}`), "the listing is named with the registry's page");
    assert.ok(readme.includes(C.registry.recordUrl), "the entry's API record is linked");
    assert.ok(!readme.includes("not published yet"), "a listed entry is never called unpublished");
  } else {
    assert.ok(!readme.includes("registry.modelcontextprotocol.io"), "a registry link over an unpublished entry is a claim");
  }
  assert.deepEqual(JSON.parse(Buffer.from(b64, "base64").toString()), { url: C.mcpUrl }, "the deep link's config holds only the URL");
  const vscode = `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: C.serverName, type: "http", url: C.mcpUrl }))}`;
  assert.ok(readme.includes(vscode), "vscode link");
  assert.ok(readme.includes(`https://insiders.vscode.dev/redirect?url=${encodeURIComponent(vscode)}`), "vscode badge");
  assert.ok(readme.includes(`- Tools: ${C.tools.length} in all.`), "the count is the list's length");
  const noKeyListed = C.tools.map((t) => t.name).filter((n) => C.anonTools.includes(n));
  assert.ok(readme.includes(`  - With no key, \`tools/list\` lists ${C.anonTools.length}: ${noKeyListed.map((n) => `\`${n}\``).join(", ")}\n`), "the no-key bullet is what a keyless tools/list answers");
  assert.ok(readme.includes(`  - Answered on a key, never listed: ${C.neverListed.map((n) => `\`${n}\``).join(", ")}\n`), "the never-listed bullet");
  for (const t of C.tools) assert.ok(readme.includes(`\`${t.name}\``), `README names ${t.name}`);
  for (const a of C.anonTools) assert.ok(readme.includes(a), `README names unkeyed ${a}`);
  // The unkeyed row prints the split the site's developer disclosure prints,
  // from the mirrored MCP_ANON_CAPS (never its legacy per-address names).
  assert.ok(readme.includes(`${C.anonCaps.otherPerConnection} per internet connection (an IPv4 address or an IPv6 /64)`), "the per-connection cap says what a connection is, never a bare 'address'");
  assert.ok(!/calls a day per address\b/.test(readme), "'per address' is undefined for a reader");
  assert.ok(readme.includes(`Claude's users share ${C.anonCaps.shares.claude}; ChatGPT's share ${C.anonCaps.shares.chatgpt} (${C.anonCaps.chatgptPerPerson} for each person`), "the platform split");
  assert.ok(readme.includes(`${C.anonCaps.overallPerDay} a day in all`), "the overall day");
  assert.ok(readme.includes(`\n${C.addressGloss}\n`), "the site's address gloss, word for word, as its own paragraph");
  assert.ok(readme.includes(`${C.freeKeyDailyQuota} calls a day`));
  assert.ok(readme.includes(`${C.fitFreePerDay} scorings a day; ${C.fitFullPerDay} on an account with a paid plan`), "the fit allowance");
  assert.ok(readme.includes(`/plugin marketplace add ${C.repoOwner}/${C.repoName}`));
  assert.ok(readme.includes(`gemini extensions install ${C.repoUrl}`));
  assert.ok(readme.includes(`bearer_token_env_var = "${C.keyEnvVar}"`));
  assert.ok(readme.includes(`codex mcp add ${C.serverName} --url ${C.mcpUrl}`), "codex add is the documented CLI form");
  assert.ok(readme.includes(`"Authorization": "Bearer \${env:${C.keyEnvVar}}"`), "cursor's keyed block names the variable Cursor resolves");
  assert.ok(readme.includes(`~/.cline/mcp.json`), "cline's documented file");
  assert.ok(readme.includes("**Remote Servers** tab"), "cline's documented tab");
  assert.ok(readme.includes("~/.codeium/windsurf/mcp_config.json"), "windsurf's documented file");
  assert.ok(readme.includes("2.1.186 or newer"), "claude mcp login carries its version caveat");
  assert.ok(readme.includes(`claude mcp login ${C.serverName}`));
  for (const m of readme.matchAll(/claude mcp add [^\n`]*/g)) assert.ok(m[0].includes("--scope user"), `${m[0]} lacks --scope user`);
  assert.ok(readme.indexOf("**Verify:**") < readme.indexOf("## Tiers"), "the verify line sits under the title, before the tiers");
  assert.ok(readme.includes("## If it does not work"));
  for (const r of C.troubleshooting) assert.ok(readme.includes(r.symptom.replace(/\{\{\w+\}\}/g, "").slice(0, 30)), `README lacks the row ${r.symptom}`);
  assert.ok(readme.includes(`"serverUrl": "${C.mcpUrl}"`), "windsurf block");
  assert.ok(readme.includes(`"type": "streamableHttp"`), "cline block");
  assert.ok(readme.includes(`"context_servers"`), "zed block");
  assert.ok(readme.includes(`\${input:${C.serverName}-key}`), "vscode prompts for the key");
  assert.ok(readme.includes(`\${${C.keyEnvVar}:-}`), "env-header variant documented");
  for (const forbidden of [/\bhired\b/i, /\$\d+/, /leaderboard/i, /fastest[- ]growing/i]) {
    assert.ok(!forbidden.test(readme), `README must not say ${forbidden}`);
  }
});

test("the registry links are the registry's own forms for this name, dated", () => {
  assert.equal(typeof C.registry.listed, "boolean");
  assert.equal(C.registry.listingUrl, `https://registry.modelcontextprotocol.io/?q=${C.registryName}`, "the registry's page, its search box filled with the name (the page reads ?q=)");
  assert.equal(C.registry.recordUrl, `https://registry.modelcontextprotocol.io/v0/servers/${encodeURIComponent(C.registryName)}/versions/latest`, "the v0 API's record path for the name");
  assert.match(C.registry.publishedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(C.registry.checkedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(C.registry.checkedAt >= C.registry.publishedAt, "the entry was read after it was published");
});

test("teeth: with the entry unlisted, the README calls the name reserved and links no registry page", () => {
  const dir = scratch();
  try {
    const cfg = readJson("mcp.config.json", dir);
    cfg.registry.listed = false;
    writeFileSync(join(dir, "mcp.config.json"), JSON.stringify(cfg, null, 2) + "\n");
    const r = spawnSync(process.execPath, [join(ROOT, "scripts", "build.mjs")], { env: { ...process.env, BUILD_ROOT: dir }, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const readme = readText("README.md", dir);
    assert.ok(readme.includes(`\`${C.registryName}\` is the name reserved for the MCP Registry (not published yet)`));
    assert.ok(!readme.includes("registry.modelcontextprotocol.io"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no generated file prints the site's long-tail button text as a heading or a name (SEO-027)", async () => {
  const { GENERATED } = await import("../scripts/build.mjs");
  for (const f of GENERATED) assert.ok(!/More…|More\.\.\./.test(readText(f)), `${f} prints the "More…" button text`);
  assert.ok(![...C.hosts, ...C.moreHosts].some((h) => /^More\b/.test(h.name)), "a host is named More…");
});

test("every generated markdown file spells no count, no price and no takedown-as-hire (project_claim_drift)", async () => {
  const { GENERATED } = await import("../scripts/build.mjs");
  const md = GENERATED.filter((f) => f.endsWith(".md"));
  assert.ok(md.length >= 4, `expected the README, llms-install, docs-snapshot and the skills: ${md.join(",")}`);
  assert.ok(!md.includes("SETUP.md") && !existsSync(join(ROOT, "SETUP.md")), "SETUP.md was a hand copy of the setup skill — it stays deleted");
  // A spelled count beside a noun the constants own (tools, tier members,
  // calls, rows, ids) — "the first four", "15 tools" — must be derived, so
  // the only digits allowed beside those nouns are the constants' values.
  // "one" is an article ("one page of", "one call") and is not judged.
  const spelledCount = /\b(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty)\b(?=[^.\n]{0,40}\b(?:tools?|need no key|calls?|rows?|ids?)\b)/i;
  // Named caps only, not every number nested in anonCaps: that set holds 15
  // (perMinute.other), which is also the old tool count, so a stale "15 tools"
  // would pass. The build prints searchRows; the other three are the fields
  // this list named before the caps became nested (2026-11-07).
  // checkJobsOpenIds joined 2026-11-08: the find-jobs skill prints it.
  const allowedDigits = new Set([C.tools.length, C.anonTools.length, C.anonCaps.perAddressPerDay, C.anonCaps.hostPoolPerDay, C.anonCaps.globalPerDay, C.anonCaps.searchRows, C.anonCaps.checkJobsOpenIds, C.freeKeyDailyQuota, C.fitFreePerDay, C.fitFullPerDay, C.anonAddressHashRetentionDays, C.freeKeyIdleRevokeDays].map(String));
  for (const f of md.filter((x) => x !== "docs-snapshot.md")) {
    const text = readText(f);
    assert.ok(!spelledCount.test(text), `${f} spells a count in words: ${spelledCount.exec(text)?.[0]}`);
    for (const m of text.matchAll(/\b(\d+)\s+(?:tools?|calls|rows|ids|days)\b/g)) {
      assert.ok(allowedDigits.has(m[1]), `${f} types ${m[0]} — not one of the constants' values`);
    }
    for (const forbidden of [/\bhired\b/i, /\$\d+/, /leaderboard/i, /fastest[- ]growing/i]) {
      assert.ok(!forbidden.test(text), `${f} must not say ${forbidden}`);
    }
  }
  // The retention the privacy table states is the site's row, which names the
  // mirrored constant, and the constant is the one mcp_anon_check and
  // mcp_anon_check_v2 prune at (checked cross-runtime below when the website
  // repo is present).
  const address = C.privacyRows.find((r) => r.id === "address");
  assert.ok(address.kept.includes(`kept for ${C.anonAddressHashRetentionDays} days`), "the address row names the retention constant");
  assert.ok(readText("README.md").includes(`| ${address.what} | ${address.kept} |`), "the README's privacy table carries the address row word for word");
});

test("no file in the repo carries a key or a token", () => {
  const walk = (dir, out = []) => {
    for (const name of readdirSync(dir)) {
      if (name === ".git" || name === "node_modules") continue;
      const p = join(dir, name);
      statSync(p).isDirectory() ? walk(p, out) : out.push(p);
    }
    return out;
  };
  for (const f of walk(ROOT)) {
    const s = readFileSync(f, "utf8");
    assert.ok(!/rb_live_[A-Za-z0-9]{12,}/.test(s), `${f} looks like it holds a key`);
    assert.ok(!/Bearer [A-Za-z0-9_-]{24,}/.test(s), `${f} looks like it holds a token`);
    assert.ok(!/eyJ[A-Za-z0-9_-]{40,}\.eyJ/.test(s), `${f} looks like it holds a JWT`);
  }
});

test("the build check bites: a changed constant without a rebuild fails", () => {
  const dir = scratch();
  try {
    const cfg = readJson("mcp.config.json", dir);
    cfg.mcpUrl = "https://example.invalid/functions/v1/agent-mcp";
    writeFileSync(join(dir, "mcp.config.json"), JSON.stringify(cfg, null, 2) + "\n");
    const r = run("build.mjs", { BUILD_ROOT: dir }, dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /drift: README\.md/);
    assert.match(r.stderr, /drift: server\.json/);
    assert.match(r.stderr, /drift: \.mcp\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the build check bites: a hand edit to a generated file fails", () => {
  const dir = scratch();
  try {
    writeFileSync(join(dir, "README.md"), readText("README.md", dir).replace("## Tiers", "## Tiers (hand-edited)"));
    const r = run("build.mjs", { BUILD_ROOT: dir }, dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /drift: README\.md/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the schema check bites: a 101-char description, a header value, an sse remote", () => {
  const dir = scratch();
  try {
    const server = readJson("server.json", dir);
    server.description = "x".repeat(101);
    server.remotes[0].headers[0].value = "placeholder"; // any value at all is the defect
    server.remotes.push({ type: "sse", url: C.mcpUrl });
    writeFileSync(join(dir, "server.json"), JSON.stringify(server, null, 2) + "\n");
    const r = run("verify.mjs", { VERIFY_ROOT: dir }, dir);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /exceeds maxLength 100/);
    assert.match(r.stdout, /carries a value/);
    assert.match(r.stdout, /deprecate sse/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the schema check bites: a Gemini server reading an undeclared env var", () => {
  const dir = scratch();
  try {
    const g = readJson("gemini-extension.json", dir);
    g.settings = [];
    writeFileSync(join(dir, "gemini-extension.json"), JSON.stringify(g, null, 2) + "\n");
    const r = run("verify.mjs", { VERIFY_ROOT: dir }, dir);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /settings\[\] does not declare it/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the schema check bites: a marketplace missing owner, a plugin with no name", () => {
  const dir = scratch();
  try {
    const m = readJson(".claude-plugin/marketplace.json", dir);
    delete m.owner;
    writeFileSync(join(dir, ".claude-plugin/marketplace.json"), JSON.stringify(m, null, 2) + "\n");
    const p = readJson(".claude-plugin/plugin.json", dir);
    delete p.name;
    writeFileSync(join(dir, ".claude-plugin/plugin.json"), JSON.stringify(p, null, 2) + "\n");
    const r = run("verify.mjs", { VERIFY_ROOT: dir }, dir);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /missing required owner/);
    assert.match(r.stdout, /missing required name/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// connect3 (2026-09-16): the published instructions are keyless-first, carry
// no placeholder inside an Authorization value, quote only labels a vendor
// doc prints, state the sign-in RULE (never today's state) beside the curl
// that reads the state, and mirror the site's host ids and sign-in key.

const PUBLISHED = () => ["README.md", "llms-install.md", "skills/setup/SKILL.md", "skills/find-jobs/SKILL.md"];
const fenced = (text) => [...text.matchAll(/```(\w*)\n([\s\S]*?)```/g)].map((m) => ({ lang: m[1], body: m[2] }));

test("no generated file carries a placeholder inside an Authorization value, in a fence or in prose", async () => {
  const { GENERATED } = await import("../scripts/build.mjs");
  // docs-snapshot.md quotes vendors' own example lines verbatim (a doc's
  // `Bearer your-token` is the vendor's placeholder, not ours) — it is a
  // quotation, not an instruction, and is judged by the snapshot test instead.
  for (const f of GENERATED.filter((x) => x !== "docs-snapshot.md")) {
    const text = readText(f);
    // A value that pretends to be a key: the old `rb_live_...your key...`,
    // a vendor's `your-token`, or anything after `Bearer ` that is not a
    // documented indirection ($VAR, ${VAR:-}, ${env:VAR}, ${input:id}) or the
    // prose forms `<key>` / `…`.
    for (const m of text.matchAll(/Bearer ([^"'`\s]+)/g)) {
      const v = m[1].replace(/[.,;)]+$/, "");
      // Allowed: a documented indirection ($VAR, ${…}), the prose forms
      // `<key>` / `…` / `rb_live_…`, or the word "header" in a sentence.
      assert.ok(/^\$/.test(v) || ["<key>", "…", `${C.keyPrefix}…`, "header"].includes(v), `${f}: Authorization value "${v}" is a placeholder, not an indirection`);
    }
    assert.ok(!/your key\.\.\.|your-token|\.\.\.your/.test(text), `${f} carries a key placeholder`);
    for (const { lang, body } of fenced(text)) {
      if (lang !== "json") continue;
      const parsed = JSON.parse(body);
      const walk = (o) => {
        if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) k === "Authorization" ? assert.match(v, /^Bearer \$/, `${f}: ${v}`) : walk(v);
      };
      walk(parsed);
    }
  }
});

test("every block is keyless first: the first fenced block or step under each host names no Authorization header", () => {
  const readme = readText("README.md");
  for (const h of [...C.hosts, ...C.moreHosts]) {
    const start = readme.indexOf(`## ${h.name}`);
    assert.ok(start > 0, `README lacks a section for ${h.name}`);
    const next = readme.search(new RegExp(`\\n#{3,4} (?!More apps)`.replace("\\\\n", "\\n")));
    const rest = readme.slice(start + 1);
    const nextRel = rest.search(/\n#{3,4} /);
    const section = nextRel > 0 ? readme.slice(start, start + 1 + nextRel) : readme.slice(start, readme.indexOf("\n## If it does not work"));
    const firstBlock = fenced(section)[0];
    if (firstBlock && firstBlock.lang !== "sh") assert.ok(!/Authorization/.test(firstBlock.body) || /\$\{input:/.test(firstBlock.body), `${h.name}: the first block is keyed`);
    if (h.id === "copy-the-prompt") continue;
    const firstStep = section.split("\n").find((l) => /^1\. /.test(l)) ?? "";
    assert.ok(firstStep.length > 0, `${h.name}: no numbered step`);
    assert.ok(!/--header|Authorization/.test(firstStep), `${h.name}: step 1 needs a key`);
    assert.ok(section.includes("**How you know it worked:**"), `${h.name}: no verify line`);
    if (h.id === "zed") {
      // Zed's doc: with no Authorization header it prompts for the server's
      // sign-in, unconditionally. The section carries that rule and the
      // reader next to the block — never a "when sign-in is on" slot alone.
      const rule = section.split("\n").find((l) => /^2\. /.test(l)) ?? "";
      assert.match(rule, /whenever no `Authorization` header is set/, "Zed: the prompt rule is step 2");
      assert.match(rule, /curl above prints `"off"`/, "Zed: the rule hands the reader the state reader");
      assert.match(rule, /"Bearer …"/, "Zed: the keyed form is a prose placeholder, never a value");
      assert.ok(!/When sign-in is on — /.test(section), "Zed: no on-state slot (the prompt does not wait for the state)");
    }
  }
  // The README's own claim about keyless blocks names the one exception.
  assert.ok(readme.includes("Every block but Zed's works with no key on its first call"), "the keyless claim exempts Zed");
});

test("the hosts are in the owner's order (six, then the long tail), ids unique, every step's placeholders resolve", async () => {
  assert.deepEqual(C.hosts.map((h) => h.id), ["claude", "chatgpt", "claude-code", "cursor", "vscode", "more"]);
  assert.deepEqual(C.moreHosts.map((h) => h.id), ["gemini-cli", "codex-cli", "cline", "zed", "windsurf", "any-client", "copy-the-prompt"]);
  const { fill } = await import("../scripts/build.mjs");
  for (const h of [...C.hosts, ...C.moreHosts]) {
    assert.ok(h.steps.length >= 1 && h.steps.every((s) => s.length > 10), `${h.id}: steps`);
    for (const t of [...h.steps, h.verify, h.signInOn ?? "", h.keyed ?? "", h.lead ?? ""]) fill(t);
    assert.ok(!/\b\d+ (?:tools|calls|rows|results)\b/.test([...h.steps, h.verify].join(" ")), `${h.id}: a typed number in a step`);
    // The first step names no jargon a newcomer has not been given.
    // A vendor's own bold label (**Streamable HTTP** is Cline's transport
    // name) is quoted, not explained; the jargon rule reads the prose.
    if (!["more", "any-client", "copy-the-prompt"].includes(h.id)) assert.ok(!/401|WWW-Authenticate|bearer|Streamable|stateless|PRM|metadata/i.test(h.steps[0].replace(/\*\*[^*]+\*\*/g, "")), `${h.id}: jargon in step 1`);
  }
  assert.throws(() => fill("{{noSuchThing}}"), /unknown placeholder/);
});

test("no forbidden label in the published instructions (labels no vendor doc prints today)", () => {
  for (const f of PUBLISHED()) {
    const text = readText(f);
    for (const bad of [/\bMixed\b/, /Work tab/i, /published identity/i, /cline_mcp_settings\.json/, /No Authentication/, /switch the tab to/i, /green dot/i]) {
      assert.ok(!bad.test(text), `${f} says ${bad}`);
    }
  }
});

// ---------------------------------------------------------------------------
// W0 (connect/apply audit 2026-11-07: APPLY-1107-04, PLT-1107-05, PLT-1107-06,
// GEO-1107-01): the published files had sold the retired apply agent, listed
// its retired tools, walked ChatGPT users through a developer-mode switch and
// never named apply_myself. These pin what replaced them.

const MANIFESTS = [".claude-plugin/plugin.json", ".claude-plugin/marketplace.json", "gemini-extension.json", "server.json"];
// What the owner's rules forbid any published file to say (2026-11-07): the
// retired products, the retired tools, a developer-mode step, a price, or
// that we apply for anyone, or that a key is what opens reading. Returns the
// offending matches.
const staleClaims = (text) => {
  const found = [];
  for (const n of C.retiredTools) if (new RegExp(`\\b${n}\\b`).test(text)) found.push(n);
  for (const re of [/Agent plan/i, /Agent Pass/i, /\blive pass\b/i, /agents\/pass/, /Apply Assistant/i, /developer mode/i, /\$\d/, /applying is paid/i, /\bwe (?:apply|submit|send)\b/i, /\bscan packs?\b/i, /opens every read tool/i]) {
    const m = re.exec(text);
    if (m) found.push(m[0]);
  }
  return found;
};

test("no published file or manifest sells a retired product, names a retired tool, asks for developer mode, prints a price or says reading needs a key", () => {
  for (const f of [...PUBLISHED(), ...MANIFESTS]) assert.deepEqual(staleClaims(readText(f)), [], `${f} says something the owner's rules forbid`);
});

test("teeth: the stale-claim reader reports each forbidden phrase pasted into the README", () => {
  const pasted = ["request_application", "Agent plan", "Agent Pass", "a live pass", "https://resumebooster.work/agents/pass", "the Apply Assistant", "turn on Developer mode", "$29", "Applying is paid", "we apply for you", "scan packs", "a free key opens every read tool"];
  for (const p of pasted) assert.ok(staleClaims(`${readText("README.md")}\n${p}\n`).length > 0, `the reader missed "${p}"`);
});

test("the ChatGPT steps are OpenAI's documented flow, with its plan rule quoted, linked and dated, and send ChatGPT Free users to Claude's free plan", () => {
  const readme = readText("README.md");
  const section = readme.slice(readme.indexOf("### ChatGPT"), readme.indexOf("### Claude Code"));
  assert.ok(section.length > 100, "the README has a ChatGPT section");
  assert.ok(section.includes(`"${C.chatgptPlanRule.quote}"`), "the plan rule, quoted");
  assert.ok(section.includes(`(${C.chatgptPlanRule.url}, read ${C.chatgptPlanRule.read})`), "its link and the day it was read");
  assert.ok(section.includes("Claude's free plan can add one custom connector"), "the pointer to Claude's free plan");
  assert.ok(section.indexOf(C.chatgptPlanRule.quote) < section.indexOf("\n1. "), "the plan rule comes before the first step");
  assert.ok(!/developer mode|Security and login/i.test(section), "no developer-mode switch");
  assert.ok(section.includes(`with no sign-in there are ${C.anonTools.length}.`), "the tool count a keyless ChatGPT sees, from the constants");
  const pricing = C.docsSnapshot.find((d) => d.url === C.chatgptPlanRule.url);
  assert.ok(pricing && pricing.sentences.includes(C.chatgptPlanRule.quote) && pricing.fetched === C.chatgptPlanRule.read, "the quote is in the docs snapshot, fetched the day it says");
  const freeClaude = C.docsSnapshot.find((d) => d.url.startsWith("https://claude.com/docs/connectors/custom/remote-mcp#"));
  assert.ok(freeClaude?.sentences.some((s) => s.includes("On the Free plan, you can add one custom connector.")), "Claude's one-connector rule is quoted in the snapshot");
  // Every bold label in the ChatGPT steps is one OpenAI's connect page prints.
  const connect = C.docsSnapshot.find((d) => d.url === "https://developers.openai.com/apps-sdk/deploy/connect-chatgpt");
  assert.ok(!connect.sentences.some((s) => /developer mode/i.test(s)), "the snapshot no longer rests a step on developer mode");
  const said = connect.sentences.join(" ");
  const steps = section.slice(section.indexOf("\n1. "), section.indexOf("\nWhen sign-in is on"));
  for (const [, label] of steps.matchAll(/\*\*([^*]+)\*\*/g)) {
    if (["+", "@", C.connectorName].includes(label)) continue;
    assert.ok(said.includes(label), `ChatGPT step label **${label}** is not on OpenAI's connect page as snapshotted`);
  }
});

test("the Claude sign-in line never says a tool that answers with no key needs an account", async () => {
  const { fill } = await import("../scripts/build.mjs");
  const line = fill(C.hosts.find((h) => h.id === "claude").signInOn);
  for (const stale of [/open a posting/i, /check a shortlist/i]) assert.ok(!stale.test(line), `the line says ${stale}, which answers with no key`);
  for (const n of C.anonTools) assert.ok(!line.includes(n), `the line names ${n}, an unkeyed tool`);
  assert.ok(line.includes("Searching, reading postings and applying yourself never need it."));
});

test("the README's apply section is the free path where the person submits, under the server's own rules", () => {
  const readme = readText("README.md");
  const section = readme.slice(readme.indexOf("## Applying yourself"), readme.indexOf("## Sign-in"));
  assert.ok(section.includes("`apply_myself` is how a person applies, free and with no key"));
  assert.ok(section.includes("never submits anything for anyone"));
  assert.ok(section.includes(C.applyRules), "the rules, word for word");
  for (const v of C.formVendors) assert.ok(section.includes(v.label), `names ${v.label}`);
  // Exactly the readers, never one more: a vendor the connector stopped
  // reading (Ashby, OD14-ASHBY-1) left in this sentence over-claims its form.
  const named = /when the posting's hiring system is ([^,.]+(?:, [^,.]+)*?),? it returns the employer's real application form/.exec(section);
  assert.ok(named, "the apply sentence's reader list is not found — RE-ANCHOR");
  assert.deepEqual(named[1].split(/, | or /), C.formVendors.map((v) => v.label), "the apply sentence names a different set of form readers than formVendors");
  const pair =C.formVendors.filter((v) => C.formVendorsOnChatGpt.includes(v.key)).map((v) => v.label);
  assert.ok(section.includes(`Inside ChatGPT it reads the form only for ${pair.join(" or ")}.`));
  for (const f of ["llms-install.md", "skills/find-jobs/SKILL.md"]) {
    assert.ok(readText(f).includes(C.applyRules), `${f} carries the rules word for word`);
    assert.ok(readText(f).includes("`apply_myself` is how a person applies"), `${f} names the apply path`);
  }
});

test("the find-jobs skill starts with a search, not key_status, and names only tools the server has", () => {
  const skill = readText("skills/find-jobs/SKILL.md");
  assert.match(skill, /^1\. `search_jobs`/m, "step 1 is the search");
  assert.ok(!/^\d\. `key_status`/m.test(skill), "no step leads with key_status");
  // A flag the server's apply answers carry, and a field the person writes in
  // their own host's config; neither is a tool.
  const nonTools = ["draft_from_your_cv", "bearer_token_env_var"];
  const tools = C.tools.map((t) => t.name);
  for (const f of PUBLISHED()) {
    const prose = readText(f).replace(/```[\s\S]*?```/g, "");
    for (const [, word] of prose.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)) {
      assert.ok(tools.includes(word) || nonTools.includes(word), `${f} names \`${word}\`, which is not a tool the server has`);
    }
  }
});

test("the README gives the one-step plugin install with its version floor, and says how a plugin copy takes a new version", () => {
  const readme = readText("README.md");
  assert.ok(readme.includes(`claude plugin install ${C.serverName} --marketplace ${C.repoOwner}/${C.repoName}`));
  assert.ok(readme.includes("(Claude Code 2.1.292 or newer)"));
  assert.ok(readme.includes(`/plugin install ${C.serverName} --marketplace ${C.repoOwner}/${C.repoName}\` does both in one line`));
  assert.ok(readme.includes(`claude plugin update ${C.serverName}@${C.serverName}`));
  const doc = C.docsSnapshot.find((d) => d.url === "https://code.claude.com/docs/en/discover-plugins");
  const said = doc.sentences.join(" ");
  for (const s of ["Requires Claude Code v2.1.292 or later.", "Requires Claude Code v2.1.275 or later.", "**Off by default**", "claude plugin update <plugin>@<marketplace>"]) assert.ok(said.includes(s), `the snapshot lacks ${s}`);
});

test("the verify line says board_stats counts postings no tool returns, and where the searchable figure is", () => {
  const readme = readText("README.md");
  const line = readme.split("\n").find((l) => l.startsWith("**Verify:**"));
  assert.ok(line.includes("`excludedSources`") && line.includes("so your AI can search fewer"));
  assert.ok(line.includes(`The home page, ${C.site}, prints the number your AI can search and the day it was counted.`));
  assert.ok(readText("llms-install.md").includes("do not tell the person they can search that many"));
});

// The two shapes the old pages used: an order to leave the suffix off, and
// the suffix named as the cause of a failure.
const mcpSuffixClaims = (text) => [/do not (?:add|append) `\/mcp`/, /`\/mcp` was added to it/, /`\/mcp` appended to the address/].filter((re) => re.test(text)).map(String);

test("no published line tells the reader to leave /mcp off or blames it, since the server answers either way", () => {
  for (const f of PUBLISHED()) assert.deepEqual(mcpSuffixClaims(readText(f)), [], `${f} tells the reader the /mcp suffix breaks the address`);
});

test("teeth: the /mcp reader reports each old shape pasted into the README", () => {
  const readme = readText("README.md");
  assert.equal(mcpSuffixClaims(`${readme}\nPaste it exactly as it is (do not add \`/mcp\`).\n`).length, 1);
  assert.equal(mcpSuffixClaims(`${readme}\n| x | The address was mistyped, \`/mcp\` was added to it. | y |\n`).length, 1);
  assert.equal(mcpSuffixClaims(`${readme}\n| x | Wrong transport, or \`/mcp\` appended to the address. | y |\n`).length, 1);
});

test("the allowance row names no key and no app, as the site's row does, because it is seen from every app (CJ-08)", () => {
  const row = C.troubleshooting.find((r) => r.symptom === "The unkeyed allowance is spent");
  assert.ok(!/\bkey\b|Claude Code|Cursor|VS Code/.test(row.fix), `the row sends a chat reader to a key or an app: ${row.fix}`);
  assert.ok(row.fix.includes("{{jobsPage}}"), "it names where every posting stays meanwhile");
});

// ---------------------------------------------------------------------------
// The seo-connect re-sync (2026-11-08): the site's W2 copy on /agents
// (fix/seo-connect-fe) and the strings agent-mcp 2026-11-08.1 answers
// (fix/connect-mcp). The pages had kept copy W2 took off /agents, and quoted
// strings that deploy changes; they are published only once it is live
// (scripts/check-live.mjs refuses an older live build).

// What W2 took off /agents (CJ-02, CJ-08, CJ-09, PLT-1107-09): the first
// question that named a tool and its arguments, the order to pick the
// sign-in options by hand behind an "if Claude asks", the chat row that sent
// a seeker to a terminal app for a key, and ChatGPT's sign-in promised
// unconditionally. And what HO-1 took off it (the owner's check of Claude's
// dialog, 2026-11-18): the step that kept whatever authentication Claude
// detected. /agents now names one choice, Sign in when needed, as a plain
// step (the site's CLAUDE_AUTH_STEP), which the mirror test holds word for word.
const w2RemovedCopy = (text) =>
  [/call search_jobs with query/, /If Claude asks about \*\*Authentication\*\*/, /\*\*Register automatically\*\*/, /Do not choose \*\*No sign-in\*\*/, /To use every tool, connect from/, /ChatGPT shows its sign-in/, /Keep them as they are and click/]
    .filter((re) => re.test(text))
    .map(String);

test("no published file carries copy the site's W2 or HO-1 took off /agents: the tool-call first question, the conditional sign-in choice, the key push in a chat row, ChatGPT's promised sign-in, the kept detected settings", () => {
  for (const f of PUBLISHED()) assert.deepEqual(w2RemovedCopy(readText(f)), [], `${f} still says what /agents no longer says`);
  const off = C.troubleshooting.find((r) => r.state === "off");
  assert.ok(off.fix.startsWith("Everything you need to search, read postings in full and apply yourself works with no sign-in."), `the sign-in-off row says what works first: ${off.fix}`);
});

test("teeth: the W2 reader reports each removed line pasted into the README", () => {
  const readme = readText("README.md");
  const pasted = [
    'Ask: `Using Resume Booster, call search_jobs with query "nurse" and location "Texas", and show me the first ten.`',
    "If Claude asks about **Authentication**, choose **Sign in when needed**.",
    "If it asks about **OAuth client**, choose **Register automatically**.",
    "Do not choose **No sign-in**: Claude cannot change that later.",
    "To use every tool, connect from Claude Code, Cursor or VS Code with a free key.",
    "if a tool needs your account, ChatGPT shows its sign-in for Resume Booster",
    "Claude shows the authentication settings it detected. Keep them as they are and click **Continue**.",
  ];
  for (const p of pasted) assert.ok(w2RemovedCopy(`${readme}\n${p}\n`).length > 0, `the reader missed "${p}"`);
});

test("the Claude steps are the help article's dialog in its order, every label is one Claude's documents print, and a phone reader is told where the dialog is first", () => {
  const readme = readText("README.md");
  const section = readme.slice(readme.indexOf("### Claude ("), readme.indexOf("### ChatGPT"));
  const steps = section.slice(section.indexOf("\n1. "), section.indexOf("\nWhen sign-in is on"));
  const order = ["Click **+ Add**, then **Add custom connector**", "Enter the name:", "Paste this address into the server URL field", "Click **Continue**.", "Under authentication, choose **Sign in when needed** and click **Continue**.", "Click **Add**."];
  let at = -1;
  for (const s of order) {
    const i = steps.indexOf(s, at + 1);
    assert.ok(i > at, `"${s}" is missing from the Claude steps or out of order`);
    at = i;
  }
  const said = C.docsSnapshot.filter((d) => d.block.split(/,\s*/).includes("claude")).flatMap((d) => d.sentences).join(" ");
  for (const [, label] of steps.matchAll(/\*\*([^*]+)\*\*/g)) {
    if (label === C.connectorName) continue;
    assert.ok(said.includes(label), `Claude step label **${label}** is not in Claude's documents as snapshotted`);
  }
  const phone = section.indexOf("On a phone?");
  assert.ok(phone > 0 && phone < section.indexOf("\n1. "), "the phone note sits before step 1");
});

test("the job-id row and the id sentence say a pasted posting link is read, as agent-mcp's job-link reader does", () => {
  const row = C.troubleshooting.find((r) => r.symptom === "That is not a job id from this board.");
  assert.ok(!/You passed a link or a title/.test(row.why), "the row blames a link the server reads from agent-mcp 2026-11-08.1");
  for (const f of ["README.md", "llms-install.md", "skills/find-jobs/SKILL.md"]) {
    const text = readText(f);
    assert.ok(text.includes("the employer's own Greenhouse, Lever or Ashby posting link"), `${f} names the employer links the server reads`);
    assert.ok(text.includes(`${C.site}/jobs/posting/`), `${f} names the board's posting pages`);
  }
});

test("every troubleshooting row is the server's string or cites a doc in the snapshot, and its symptom is rendered", () => {
  const snapshotUrls = new Set(C.docsSnapshot.map((d) => d.url));
  for (const r of C.troubleshooting) {
    assert.ok(["server", "vendor"].includes(r.flag), r.symptom);
    assert.ok(["off", "on", "any"].includes(r.state), r.symptom);
    if (r.flag === "vendor") assert.ok(snapshotUrls.has(r.doc), `${r.symptom}: cites ${r.doc}, which is not in docsSnapshot`);
    else assert.equal(r.doc, undefined, `${r.symptom}: a server string cites no doc`);
  }
  assert.ok(C.troubleshooting.some((r) => r.state === "off"), "the off-state row exists");
  for (const d of C.docsSnapshot) {
    assert.match(d.fetched, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(d.sentences.length > 0, d.url);
  }
  const snap = readText("docs-snapshot.md");
  for (const d of C.docsSnapshot) assert.ok(snap.includes(`## ${d.url}`), `docs-snapshot lacks ${d.url}`);
});

test("the sign-in paragraph states the rule and the reader, never today's state", () => {
  for (const f of ["README.md", "llms-install.md"]) {
    const text = readText(f);
    assert.ok(text.includes(`.result._meta["${C.signInMetaKey}"].state`), `${f}: the curl reader names the meta key`);
    assert.ok(text.includes(C.authorizationServerMetadataUrl), `${f}: names the metadata the server probes`);
    assert.ok(text.includes("only while the server's sign-in service is switched on"), `${f}: the rule`);
    // A state word about sign-in is allowed only inside a conditional clause.
    for (const m of text.matchAll(/sign-in[^.|\n]{0,30}?\bis (?:on|off)\b/g)) {
      const before = text.slice(Math.max(0, m.index - 60), m.index + m[0].length);
      assert.match(before, /\b(?:when|while|if|says|marked)\b/i, `${f}: states the sign-in state as a fact: "${m[0]}"`);
    }
    assert.ok(!/Connect card that signs you in|shows a Connect card\./.test(text), `${f}: promises the card unconditionally`);
  }
  assert.equal(C.authorizationServerMetadataUrl, `${new URL(C.mcpUrl).origin}/.well-known/oauth-authorization-server/auth/v1`, "the AS metadata URL is the RFC 8414 form on the server's own origin");
});

test("teeth: a placeholder pasted into a keyed block, and a hand-typed 'Mixed', are reported", async () => {
  const dir = scratch();
  try {
    const readme = readText("README.md", dir);
    writeFileSync(join(dir, "README.md"), readme.replace(`"Bearer \${env:${C.keyEnvVar}}"`, `"Bearer ${C.keyPrefix}...your key..."`).replace("## Tiers", "Choose **Mixed** so search answers.\n\n## Tiers"));
    const mutated = readFileSync(join(dir, "README.md"), "utf8");
    assert.ok(mutated !== readme);
    const bad = [...mutated.matchAll(/Bearer ([^"'`\s]+)/g)].map((m) => m[1]).filter((v) => !/^\$/.test(v) && v !== "<key>" && v !== "…");
    assert.ok(bad.length >= 1, "the placeholder must be found");
    assert.match(mutated, /\bMixed\b/);
    const r = run("build.mjs", { BUILD_ROOT: dir }, dir);
    assert.equal(r.status, 1, "a hand edit is drift");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The cross-runtime mirror. Comments are stripped before any regex runs so a
// name written in prose can neither satisfy nor fail the check.
// Block comments, whole-line comments AND trailing comments go (a `//` not
// preceded by `:` — a URL's `https://` stays), so a tool entry written in a
// trailing comment can neither satisfy nor fail the parse.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
// The object a comment-stripped `const NAME = { … }` declares, as data: the
// braces are matched, numeric separators dropped, keys quoted and trailing
// commas removed, then JSON.parse. Anything that is not a plain literal (a
// computed value, a spread, a call) fails the parse and names the constant,
// so a reshaped constant on the site is re-anchored, never half-read. The
// site's MCP_ANON_CAPS nests objects, which a `\{([^}]*)\}` regex cannot read.
const objectLiteral = (src, name) => {
  const at = src.search(new RegExp(`\\b${name}\\s*(?::[^=]*)?=\\s*\\{`));
  if (at < 0) return null;
  const start = src.indexOf("{", at);
  let depth = 0;
  let end = -1;
  for (let i = start; i < src.length && end < 0; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) end = i;
  }
  if (end < 0) return null;
  const body = src.slice(start, end + 1)
    .replace(/(\d)_(?=\d)/g, "$1")
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
    .replace(/,(\s*[}\]])/g, "$1");
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`${name} is not a plain object literal — RE-ANCHOR the mirror's reader`);
  }
};

test("importing the build script writes nothing: the write loop runs only when it is the entry point", async () => {
  const before = Object.fromEntries(["README.md", ".mcp.json"].map((f) => [f, statSync(join(ROOT, f)).mtimeMs]));
  const readmeBefore = readText("README.md");
  const { GENERATED, fill } = await import(`../scripts/build.mjs?nocache=${Date.now()}`);
  assert.ok(GENERATED.length >= 10 && typeof fill === "function");
  for (const [f, t] of Object.entries(before)) assert.equal(statSync(join(ROOT, f)).mtimeMs, t, `${f} was rewritten by an import`);
  assert.equal(readText("README.md"), readmeBefore);
});

test("the comment stripper drops a trailing comment on a code line and keeps a URL", () => {
  const src = '{ name: "real", tier: "read" }, // { name: "ghost", tier: "read" }\nconst u = "https://example.test/x"; // trailing';
  const out = stripComments(src);
  assert.ok(!out.includes("ghost"), "a tool entry in a trailing comment must not survive");
  assert.ok(out.includes('name: "real", tier: "read"'));
  assert.ok(out.includes("https://example.test/x"), "a URL's // is not a comment");
});

test("the object-literal reader takes a nested constant with separators and refuses a computed one", () => {
  const src = stripComments("export const X = {\n  /** the day */\n  overall: 20_000,\n  shares: { claude: 10_000, other: 4_000 }, // split\n  share: 0.05,\n} as const;\nconst Z = { y: 1 };");
  assert.deepEqual(objectLiteral(src, "X"), { overall: 20000, shares: { claude: 10000, other: 4000 }, share: 0.05 });
  assert.equal(objectLiteral(src, "NOPE"), null);
  assert.throws(() => objectLiteral("const Y = { a: B * 2 };", "Y"), /RE-ANCHOR/);
});

const siblingDir = process.env.RESUME_SIGNAL_PRO_DIR ?? join(ROOT, "..", "resume-signal-pro");
const mirrorFile = join(siblingDir, "src", "config", "mcp-tools.ts");

// Locally the test skips with a reason when the website repo is not beside
// this one. In CI (the workflow checks the sibling out) an absent sibling is
// a FAILURE, not a skip: a mirror nobody enforces is the drift this file
// exists to catch. Set MIRROR_SKIP_OK=1 to allow the skip in CI knowingly.
const inCi = !!process.env.CI && !process.env.MIRROR_SKIP_OK;
test(
  "the tool list, unkeyed tier, caps and quota match resume-signal-pro/src/config/mcp-tools.ts",
  { skip: existsSync(mirrorFile) || inCi ? false : `website repo not beside this one (${mirrorFile}); mcp.config.json.mirror.at says which commit the list was copied from` },
  async () => {
    assert.ok(existsSync(mirrorFile), `CI must check the website repo out beside this one (${mirrorFile}) — the mirror is unenforced otherwise; MIRROR_SKIP_OK=1 skips knowingly`);
    const ts = stripComments(readFileSync(mirrorFile, "utf8"));
    // First, the build whose strings these pages quote: the site's agent-mcp
    // is at it or past it, so a page never quotes a server the site has not
    // merged (a push before the merge fails here, naming both builds).
    const fnBuild = stripComments(readFileSync(join(siblingDir, "supabase", "functions", "agent-mcp", "index.ts"), "utf8")).match(/const FN_BUILD = "(agent-mcp\.\d{4}-\d{2}-\d{2}\.\d+)";/);
    assert.ok(fnBuild, "FN_BUILD not found in agent-mcp — RE-ANCHOR");
    assert.ok(compareBuilds(fnBuild[1], C.mirror.serverBuild) >= 0, `the site's agent-mcp is ${fnBuild[1]}, older than ${C.mirror.serverBuild}, the build whose strings these pages quote — the site has not merged it; do not push before it`);
    const block = ts.match(/export const MCP_TOOLS[^=]*=\s*\[([\s\S]*?)\n\];/);
    assert.ok(block, "MCP_TOOLS array not found");
    const entries = [...block[1].matchAll(/name:\s*"([^"]+)",\s*tier:\s*"([^"]+)"/g)].map((m) => ({ name: m[1], tier: m[2] }));
    assert.ok(entries.length > 0, "no tool entries parsed");
    assert.deepEqual(C.tools, entries, "tool list or tiers drifted from the website mirror — re-sync mcp.config.json and rebuild");

    const anon = ts.match(/MCP_ANON_TOOL_NAMES[^=]*=\s*\[([^\]]*)\]/);
    assert.ok(anon, "MCP_ANON_TOOL_NAMES not found");
    assert.deepEqual(C.anonTools, [...anon[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));

    // The whole MCP_ANON_CAPS, as the site's own reverse check
    // (the-install-files-point-at-this-server.test.ts) compares it.
    const caps = objectLiteral(ts, "MCP_ANON_CAPS");
    assert.ok(caps, "MCP_ANON_CAPS not found");
    assert.deepEqual(C.anonCaps, caps, "anonCaps drifted from the site's MCP_ANON_CAPS — re-sync mcp.config.json and rebuild");

    // The address gloss is the site's MCP_ADDRESS_GLOSS, word for word (a
    // template's ${MCP_ANON_CAPS.path} filled from the mirror, if it has any).
    const gloss = ts.match(/MCP_ADDRESS_GLOSS\s*=\s*(?:"([^"]+)"|`([^`]+)`)/);
    assert.ok(gloss, "MCP_ADDRESS_GLOSS not found");
    const glossText = (gloss[1] ?? gloss[2]).replace(/\$\{MCP_ANON_CAPS\.([\w.]+)\}/g, (_, p) => String(p.split(".").reduce((o, k) => o?.[k], C.anonCaps)));
    assert.ok(!glossText.includes("${") && !glossText.includes("undefined"), "MCP_ADDRESS_GLOSS reads a constant this mirror does not carry");
    assert.equal(C.addressGloss, glossText, "addressGloss drifted from the site's MCP_ADDRESS_GLOSS");
    assert.ok(readText("README.md").includes(glossText), "the README's address gloss drifted from the site's MCP_ADDRESS_GLOSS");

    // The fit allowance the tier table and the fit rows print.
    const fitFree = ts.match(/MCP_FIT_FREE_PER_DAY\s*=\s*([\d_]+)/);
    const fitFull = ts.match(/MCP_FIT_FULL_PER_DAY\s*=\s*([\d_]+)/);
    assert.ok(fitFree && fitFull, "MCP_FIT_FREE_PER_DAY / MCP_FIT_FULL_PER_DAY not found");
    assert.equal(C.fitFreePerDay, Number(fitFree[1].replace(/_/g, "")), "fitFreePerDay drifted from the site's MCP_FIT_FREE_PER_DAY");
    assert.equal(C.fitFullPerDay, Number(fitFull[1].replace(/_/g, "")), "fitFullPerDay drifted from the site's MCP_FIT_FULL_PER_DAY");

    // The withheld-systems note is the site's MCP_WITHHELD_NOTE, word for word.
    const withheld = ts.match(/MCP_WITHHELD_NOTE\s*=\s*"([^"]+)"/);
    assert.ok(withheld, "MCP_WITHHELD_NOTE not found");
    assert.equal(C.withheldNote, withheld[1], "withheldNote drifted from the site's MCP_WITHHELD_NOTE");

    const quota = ts.match(/MCP_FREE_KEY_DAILY_QUOTA\s*=\s*(\d+)/);
    assert.ok(quota, "MCP_FREE_KEY_DAILY_QUOTA not found");
    assert.equal(C.freeKeyDailyQuota, Number(quota[1]));

    // The address-hash retention the privacy paragraph states is the prune
    // inside the winning mcp_anon_check definition (comment-stripped SQL).
    const migDir = join(siblingDir, "supabase", "migrations");
    const defining = readdirSync(migDir).filter((n) => n.endsWith(".sql")).sort()
      .filter((n) => readFileSync(join(migDir, n), "utf8").includes("FUNCTION public.mcp_anon_check("));
    assert.ok(defining.length > 0, "no migration defines mcp_anon_check");
    const sql = readFileSync(join(migDir, defining.at(-1)), "utf8").replace(/--[^\n]*/g, "");
    const prune = sql.match(/DELETE FROM public\.mcp_anon_rate r WHERE r\.day < v_today - (\d+);/);
    assert.ok(prune, "mcp_anon_check's prune statement not found — RE-ANCHOR");
    assert.equal(C.anonAddressHashRetentionDays, Number(prune[1]), "the README's retention drifted from mcp_anon_check's prune");
    // The meter that runs today is mcp_anon_check_v2; its prune is the same day count.
    const definingV2 = readdirSync(migDir).filter((n) => n.endsWith(".sql")).sort()
      .filter((n) => readFileSync(join(migDir, n), "utf8").includes("FUNCTION public.mcp_anon_check_v2("));
    assert.ok(definingV2.length > 0, "no migration defines mcp_anon_check_v2");
    const pruneV2 = readFileSync(join(migDir, definingV2.at(-1)), "utf8").replace(/--[^\n]*/g, "").match(/DELETE FROM public\.mcp_anon_rate r WHERE r\.day < v_today - (\d+);/);
    assert.ok(pruneV2, "mcp_anon_check_v2's prune statement not found — RE-ANCHOR");
    assert.equal(C.anonAddressHashRetentionDays, Number(pruneV2[1]), "the README's retention drifted from mcp_anon_check_v2's prune");

    // The privacy rows are the site's MCP_PRIVACY_ROWS, word for word, by id.
    const privacySrc = stripComments(readFileSync(join(siblingDir, "src", "config", "mcp-privacy.ts"), "utf8"));
    for (const row of C.privacyRows) {
      const obj = privacySrc.match(new RegExp(`\\{\\s*id: "${row.id}",([\\s\\S]*?)\\n  \\}`));
      assert.ok(obj, `MCP_PRIVACY_ROWS has no row ${row.id} — RE-ANCHOR`);
      const what = obj[1].match(/what: "([^"]+)"/);
      const kept = obj[1].match(/kept: "([^"]+)"/);
      assert.ok(what && kept, `row ${row.id}'s what/kept are not plain strings — RE-ANCHOR`);
      assert.equal(row.what, what[1], `privacy row ${row.id}: what drifted from the site`);
      assert.equal(row.kept, kept[1], `privacy row ${row.id}: kept drifted from the site`);
    }

    // The form vendors are the systems the server reads: the site's
    // MCP_FORM_VENDORS, then MCP_FORM_VENDORS_AFTER_DEPLOY (the five agent-mcp
    // 2026-11-08.1 adds, which the site holds apart until the frontend publish
    // after that deploy folds them in), and as a set the server's own
    // FORM_READER_VENDORS. The ChatGPT pair is the site's
    // MCP_FORM_VENDORS_ON_CHATGPT and the server's PUBLIC_API_FORM_VENDORS.
    const vendorList = (name) => {
      const m = ts.match(new RegExp(`export const ${name}:[^=]*=\\s*\\[([\\s\\S]*?)\\];`));
      return m ? [...m[1].matchAll(/\{ key: "([^"]+)", label: "([^"]+)" \}/g)].map((x) => ({ key: x[1], label: x[2] })) : null;
    };
    const vendors = vendorList("MCP_FORM_VENDORS");
    assert.ok(vendors, "MCP_FORM_VENDORS not found — RE-ANCHOR");
    assert.deepEqual(C.formVendors, [...vendors, ...(vendorList("MCP_FORM_VENDORS_AFTER_DEPLOY") ?? [])], "formVendors drifted from the site's MCP_FORM_VENDORS (+ MCP_FORM_VENDORS_AFTER_DEPLOY)");
    const formSrc = stripComments(readFileSync(join(siblingDir, "supabase", "functions", "_shared", "application-form.ts"), "utf8"));
    const serverVendors = (name) => {
      const m = formSrc.match(new RegExp(`export const ${name}[^=]*=\\s*\\[([^\\]]*)\\]`));
      assert.ok(m, `${name} not found in _shared/application-form.ts — RE-ANCHOR`);
      return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    };
    // The connector reads the shared readers less its own FORM_NOT_READ_HERE
    // (agent-mcp/index.ts; Ashby since OD14-ASHBY-1, agent-mcp 2026-11-18.2),
    // which the site mirrors as MCP_FORM_NOT_READ_HERE.
    const notReadHere = stripComments(readFileSync(join(siblingDir, "supabase", "functions", "agent-mcp", "index.ts"), "utf8")).match(/const FORM_NOT_READ_HERE[^=]*=\s*\[([^\]]*)\]/);
    const notRead = notReadHere ? [...notReadHere[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
    assert.deepEqual(C.formVendors.map((v) => v.key).sort(), serverVendors("FORM_READER_VENDORS").filter((k) => !notRead.includes(k)).sort(), "formVendors names a system the connector does not read, or leaves out one it does (FORM_READER_VENDORS less FORM_NOT_READ_HERE)");
    const siteNotRead = ts.match(/export const MCP_FORM_NOT_READ_HERE[^=]*=\s*\[([^\]]*)\]/);
    if (siteNotRead) assert.deepEqual([...siteNotRead[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]).sort(), [...notRead].sort(), "the site's MCP_FORM_NOT_READ_HERE and agent-mcp's FORM_NOT_READ_HERE disagree — RE-ANCHOR");
    for (const k of notRead) for (const f of PUBLISHED()) assert.ok(!new RegExp(`real application form[^.]*\\b${k}\\b`, "i").test(readText(f)), `${f} names ${k} as a form reader, which the connector does not read`);
    const onChatGpt = ts.match(/export const MCP_FORM_VENDORS_ON_CHATGPT:[^=]*=\s*\[([^\]]*)\]/);
    assert.ok(onChatGpt, "MCP_FORM_VENDORS_ON_CHATGPT not found — RE-ANCHOR");
    assert.deepEqual(C.formVendorsOnChatGpt, [...onChatGpt[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
    assert.deepEqual([...C.formVendorsOnChatGpt].sort(), serverVendors("PUBLIC_API_FORM_VENDORS").sort(), "the ChatGPT pair drifted from the server's PUBLIC_API_FORM_VENDORS");

    // The first question every page suggests is the site's MCP_EXAMPLE_QUESTION.
    const testQuery = ts.match(/export const MCP_TEST_QUERY\s*=\s*"([^"]+)"/);
    assert.ok(testQuery, "MCP_TEST_QUERY not found — RE-ANCHOR");
    assert.equal(C.testQuery, testQuery[1]);
    const example = ts.match(/export const MCP_EXAMPLE_QUESTION\s*=\s*`([^`]+)`/);
    assert.ok(example, "MCP_EXAMPLE_QUESTION not found — RE-ANCHOR");
    const { FILL: filled, fill: fillText } = await import("../scripts/build.mjs");
    assert.equal(filled.exampleQuestion, example[1].replace("${MCP_CONNECTOR_NAME}", C.connectorName).replace("${MCP_TEST_QUERY}", C.testQuery));

    // The three seeker hosts' "how you know it worked" lines are the site's.
    const hostsBlock = ts.slice(ts.indexOf("export const MCP_HOSTS"), ts.indexOf("export const MCP_MORE_HOSTS"));
    const siteFill = (s) => s
      .replace(/\$\{MCP_CONNECTOR_NAME\}/g, C.connectorName).replace(/\$\{MCP_ANON_CAPS\.searchRows\}/g, String(C.anonCaps.searchRows))
      .replace(/\$\{MCP_SERVER_KEY\}/g, C.serverName).replace(/\$\{ASK_STATS\}/g, "call board_stats").replace(/\$\{ASK_KEY\}/g, "call key_status");
    for (const id of ["claude", "chatgpt", "claude-code"]) {
      const at = hostsBlock.indexOf(`id: "${id}",`);
      assert.ok(at >= 0, `MCP_HOSTS has no ${id} — RE-ANCHOR`);
      const verify = hostsBlock.slice(at).match(/verify:\s*`((?:[^`\\]|\\.)*)`/);
      assert.ok(verify, `${id}'s verify line not found — RE-ANCHOR`);
      const site = siteFill(verify[1].replace(/\\`/g, "`"));
      assert.ok(!site.includes("${"), `${id}'s verify reads a constant this check does not fill — RE-ANCHOR`);
      assert.equal(fillText(C.hosts.find((h) => h.id === id).verify), site, `${id}'s verify line drifted from the site's`);
    }

    // Claude's dialog as the site walks it (W2, CJ-02): the authentication
    // step is the site's CLAUDE_AUTH_STEP, text and note, word for word; the
    // address goes into the field the site names; and every bold label up to
    // the dialog's **Add** is the site's, in the site's order. Since HO-1
    // (2026-11-18) the step names MCP_CLAUDE_AUTH_CHOICE in a template and
    // picks its note by that choice; a plain { text, note } is read too.
    const authBlock = ts.match(/const CLAUDE_AUTH_STEP[^=]*=\s*\{([\s\S]*?)\n?\};/);
    assert.ok(authBlock, "CLAUDE_AUTH_STEP not found — RE-ANCHOR");
    const unquote = (s) => JSON.parse(`"${s}"`);
    const authChoice = ts.match(/export const MCP_CLAUDE_AUTH_CHOICE[^=]*=\s*"([^"]+)"/);
    const fillChoice = (s) => (authChoice ? s.replace(/\$\{MCP_CLAUDE_AUTH_CHOICE\}/g, authChoice[1]) : s);
    const textM = authBlock[1].match(/text:\s*(?:"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`)/);
    const noteChosen = authBlock[1].match(/note:\s*MCP_CLAUDE_AUTH_CHOICE\s*===\s*"([^"]+)"\s*\?\s*"((?:[^"\\]|\\.)*)"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    const notePlain = authBlock[1].match(/note:\s*"((?:[^"\\]|\\.)*)"/);
    assert.ok(textM && (noteChosen || notePlain), "CLAUDE_AUTH_STEP's text or note is in a shape this reader does not take — RE-ANCHOR");
    assert.ok(!noteChosen || authChoice, "CLAUDE_AUTH_STEP picks its note by MCP_CLAUDE_AUTH_CHOICE, which is not found — RE-ANCHOR");
    const authText = textM[1] !== undefined ? unquote(textM[1]) : fillChoice(textM[2].replace(/\\`/g, "`"));
    const authNote = noteChosen ? unquote(authChoice[1] === noteChosen[1] ? noteChosen[2] : noteChosen[3]) : unquote(notePlain[1]);
    assert.ok(!authText.includes("${"), "CLAUDE_AUTH_STEP's text reads a constant this check does not fill — RE-ANCHOR");
    const claudeSteps = C.hosts.find((h) => h.id === "claude").steps.map(fillText);
    assert.ok(claudeSteps.includes(`${authText} ${authNote}`), "the Claude authentication step drifted from the site's CLAUDE_AUTH_STEP (text then note, word for word)");
    const manual = ts.match(/const claudeManualSteps\s*=\s*\([^)]*\)[^=]*=>\s*\[([\s\S]*?)\n\];/);
    assert.ok(manual, "claudeManualSteps not found — RE-ANCHOR");
    const manualText = manual[1].replace(/\bCLAUDE_AUTH_STEP\b/, `{ text: "${authText}", note: "${authNote}" }`);
    const into = manualText.match(/addressStep\(ctx, "([^"]+)"\)/);
    assert.ok(into, "the Claude address step's field is not named — RE-ANCHOR");
    assert.ok(claudeSteps.some((s) => s.startsWith(`Paste this address into ${into[1]}:`)), `the address step names a field the site does not: ${into[1]}`);
    const labelsUpToAdd = (text) => {
      const end = text.indexOf("Click **Add**.");
      assert.ok(end > 0, "no **Add** step — RE-ANCHOR");
      return [...text.slice(0, end + "Click **Add**.".length).matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1]);
    };
    assert.deepEqual(labelsUpToAdd(claudeSteps.join("\n")), labelsUpToAdd(manualText), "the Claude dialog's labels drifted from the site's claudeManualSteps");

    // ChatGPT's sign-in line is the site's signIn("on"), which since
    // PLT-1107-09 promises nothing OpenAI does not document.
    const chatgptOn = hostsBlock.slice(hostsBlock.indexOf('id: "chatgpt",')).match(/s === "on"\s*\?\s*`((?:[^`\\]|\\.)*)`/);
    assert.ok(chatgptOn, "chatgpt's signIn('on') not found — RE-ANCHOR");
    assert.equal(fillText(C.hosts.find((h) => h.id === "chatgpt").signInOn), siteFill(chatgptOn[1]).replace(/^When a tool needs your account, /, "if a tool needs your account, "), "ChatGPT's sign-in line drifted from the site's signIn('on')");

    // connect3: the host ids and the sign-in meta key mirror the page lane's
    // MCP_HOSTS[].id / MCP_SIGN_IN_META_KEY. Until that commit lands on the
    // site, the file has neither identifier; the check then reports the
    // gap instead of skipping silently, and bites the moment the identifiers
    // exist. (Not an exemption list: nothing here is turned off by name.)
    const metaKey = ts.match(/MCP_SIGN_IN_META_KEY\s*=\s*"([^"]+)"/);
    const idsOf = (name) => {
      const block = ts.match(new RegExp(`export const ${name}[^=]*=\\s*\\[([\\s\\S]*?)\\n\\];`));
      return block ? [...block[1].matchAll(/^\s{4}id:\s*"([^"]+)"/gm)].map((m) => m[1]) : [];
    };
    const siteHostIds = idsOf("MCP_HOSTS");
    const siteMoreIds = idsOf("MCP_MORE_HOSTS");
    if (metaKey || siteHostIds.length) {
      assert.ok(metaKey, "the site declares host ids but no MCP_SIGN_IN_META_KEY");
      assert.equal(C.signInMetaKey, metaKey[1], "signInMetaKey drifted from the site's MCP_SIGN_IN_META_KEY");
      assert.deepEqual(C.hosts.map((h) => h.id), siteHostIds, "host ids or order drifted from the site's MCP_HOSTS — re-sync mcp.config.json, re-stamp mirror.at, rebuild");
      assert.deepEqual(C.moreHosts.map((h) => h.id), siteMoreIds, "the long tail drifted from the site's MCP_MORE_HOSTS");
    } else if (inCi) {
      // CI checks the site out at its default branch: a sibling with no
      // connect3 identifiers means the site commit has not landed, and a
      // push before it is exactly what this test exists to refuse.
      assert.fail(`${mirrorFile} has no MCP_SIGN_IN_META_KEY / MCP_HOSTS ids — the site's connect3 commit is not on its default branch yet; do not push the install repo before it`);
    } else {
      console.log(`  note: ${mirrorFile} predates connect3 (no MCP_SIGN_IN_META_KEY, no MCP_HOSTS ids) — host-id and meta-key mirror not yet enforceable; mirror.at=${C.mirror.at}`);
    }
    // Server strings the troubleshooting rows quote: each `server` symptom
    // occurs in the comment-stripped Deno source once agent-mcp .7 (the
    // as-probe module) is in the sibling; before that, the .7-only rows are
    // reported as pending rather than failed.
    const fnDir = join(siblingDir, "supabase", "functions", "agent-mcp");
    const serverSrc = ["index.ts", "oauth.ts"].map((n) => stripComments(readFileSync(join(fnDir, n), "utf8"))).join("\n");
    assert.ok(serverSrc.includes(`name: "${C.serverInfoName}",`), "serverInfoName drifted from SERVER_INFO.name — the README's verify line would name a server that does not exist");
    // The keyless note the Claude verify line quotes is the server's own
    // sentence shape (the anchor the site's first-call guard uses), and
    // board_stats's note is the one the verify lines lean on.
    assert.ok(serverSrc.includes("keyless: ${bucketLeft} of ${d.bucket_cap") && serverSrc.includes("${what} left today") && serverSrc.includes(': "lookups";'), "the keyless note's wording moved in index.ts — re-word the verify lines");
    assert.ok(C.hosts.find((h) => h.id === "claude").verify.includes("note begins \"keyless:\" and says how many free lookups are left today"), "the Claude verify line quotes the server's note");
    assert.ok(serverSrc.includes("board_stats is never counted against the keyless allowance."), "board_stats's keyless note moved — re-word the verify line and the Claude Code step");
    // The unkeyed tier and the retired apply tools are the server's own lists.
    const listIn = (name) => {
      const m = serverSrc.match(new RegExp(`const ${name}[^=]*=\\s*\\[([^\\]]*)\\]`));
      assert.ok(m, `${name} not found in agent-mcp — RE-ANCHOR`);
      return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    };
    assert.deepEqual(C.anonTools, listIn("ANON_TOOLS"), "anonTools drifted from agent-mcp's ANON_TOOLS");
    assert.deepEqual(C.retiredTools, listIn("RETIRED_TOOLS"), "retiredTools drifted from agent-mcp's RETIRED_TOOLS");
    assert.deepEqual(C.neverListed, listIn("NEVER_LISTED"), "neverListed drifted from agent-mcp's NEVER_LISTED");
    assert.deepEqual(C.notOnChatGpt, listIn("NOT_ON_CHATGPT"), "notOnChatGpt drifted from agent-mcp's NOT_ON_CHATGPT");
    // A pasted posting link is read (the job-id sentence and row): the
    // server's job-link reader takes the board's ?job= links and posting
    // pages and the employers' own Greenhouse, Lever and Ashby links.
    const jobLinkFile = join(fnDir, "job-link.ts");
    assert.ok(existsSync(jobLinkFile), "agent-mcp/job-link.ts is not in the site: the pages say a pasted posting link is read, which only agent-mcp 2026-11-08.1 does");
    const jobLink = stripComments(readFileSync(jobLinkFile, "utf8"));
    for (const host of ["greenhouse\\.io", "lever\\.co", "ashbyhq\\.com"]) assert.ok(jobLink.includes(host), `job-link.ts no longer reads ${host.replace(/\\/g, "")} links`);
    assert.ok(jobLink.includes('seg[1] === "posting"') && jobLink.includes('searchParams.get("job")'), "job-link.ts no longer reads the board's own links");
    // The apply rules are the server's HONESTY_RULES, word for word.
    const honesty = serverSrc.match(/const HONESTY_RULES\s*=\s*((?:\s*"(?:[^"\\]|\\.)*"\s*\+?)+);/);
    assert.ok(honesty, "HONESTY_RULES not found in agent-mcp — RE-ANCHOR");
    assert.equal(C.applyRules, [...honesty[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`)).join(""), "applyRules drifted from agent-mcp's HONESTY_RULES");
    for (const n of listIn("RETIRED_TOOLS")) {
      assert.ok(!C.tools.some((t) => t.name === n), `${n} is retired on the server (RETIRED_TOOLS) but listed here`);
      for (const f of PUBLISHED()) assert.ok(!new RegExp(`\\b${n}\\b`).test(readText(f)), `${f} names ${n}, which the server has retired`);
    }
    // The allowance the tier table prints is the server's ANON_ALLOWANCE
    // (allowance.ts), field for field, wherever the mirror carries the field.
    const allowance = objectLiteral(stripComments(readFileSync(join(fnDir, "allowance.ts"), "utf8")), "ANON_ALLOWANCE");
    assert.ok(allowance, "ANON_ALLOWANCE not found in agent-mcp/allowance.ts — RE-ANCHOR");
    for (const k of ["overallPerDay", "shares", "chatgptPerPerson", "chatgptNoSubject", "otherPerConnection", "perMinute", "forms", "searchRows", "maxOffset"]) assert.ok(k in allowance, `ANON_ALLOWANCE has no ${k}, which the README prints`);
    for (const k of Object.keys(C.anonCaps).filter((x) => x in allowance)) assert.deepEqual(C.anonCaps[k], allowance[k], `anonCaps.${k} drifted from agent-mcp's ANON_ALLOWANCE.${k}`);
    // The idle-key revocation the key-revoked row names is the server's.
    assert.ok(serverSrc.includes(`it went unused for ${C.freeKeyIdleRevokeDays} days`), "freeKeyIdleRevokeDays drifted from agent-mcp's revoked-key answer");
    // The connector name and the protocol revision mirror the site's constants.
    const connector = ts.match(/MCP_CONNECTOR_NAME\s*=\s*"([^"]+)"/);
    const protocol = ts.match(/MCP_PROTOCOL_VERSION\s*=\s*"([^"]+)"/);
    if (connector || protocol || inCi) {
      assert.ok(connector && protocol, "the site declares MCP_CONNECTOR_NAME and MCP_PROTOCOL_VERSION");
      assert.equal(C.connectorName, connector[1], "connectorName drifted from the site's MCP_CONNECTOR_NAME");
      assert.equal(C.protocolVersion, protocol[1], "protocolVersion drifted from the site's MCP_PROTOCOL_VERSION");
    }
    const dot7 = existsSync(join(fnDir, "as-probe.ts"));
    const pending = [];
    for (const r of C.troubleshooting.filter((x) => x.flag === "server")) {
      const found = serverSrc.includes(r.symptom);
      if (found) continue;
      if (!dot7 && !inCi) pending.push(r.symptom);
      else assert.fail(`troubleshooting symptom not in the server source: "${r.symptom}"${dot7 ? "" : " (agent-mcp .7's as-probe.ts is not in the sibling — the site commit has not landed; do not push before it)"}`);
    }
    if (pending.length) console.log(`  note: ${pending.length} row(s) quote agent-mcp .7 strings not yet in the sibling: ${pending.map((x) => JSON.stringify(x)).join(", ")}`);

    const env = join(siblingDir, ".env");
    if (existsSync(env)) {
      const base = readFileSync(env, "utf8").match(/^VITE_SUPABASE_URL="?([^"\n]+)"?/m);
      assert.ok(base, "VITE_SUPABASE_URL not in .env");
      assert.equal(C.mcpUrl, `${base[1]}/functions/v1/agent-mcp`, "MCP_URL is VITE_SUPABASE_URL + the function path (AgentConnect.tsx)");
    }
  },
);
