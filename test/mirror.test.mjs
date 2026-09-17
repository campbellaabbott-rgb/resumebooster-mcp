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
  assert.ok(C.anonCaps.perAddressPerDay < C.anonCaps.globalPerDay);
  assert.ok(C.freeKeyDailyQuota > C.anonCaps.perAddressPerDay, "a key must raise the cap or the key page lies");
  assert.ok(!/^(api[_-]?key|token|secret|password|auth)/i.test(C.keyEnvVar), "Claude Code reads credential-named env vars as empty in remote headers");
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
  assert.ok(!readme.includes("registry.modelcontextprotocol.io"), "a registry badge over an unpublished entry is a claim");
  assert.deepEqual(JSON.parse(Buffer.from(b64, "base64").toString()), { url: C.mcpUrl }, "the deep link's config holds only the URL");
  const vscode = `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: C.serverName, type: "http", url: C.mcpUrl }))}`;
  assert.ok(readme.includes(vscode), "vscode link");
  assert.ok(readme.includes(`https://insiders.vscode.dev/redirect?url=${encodeURIComponent(vscode)}`), "vscode badge");
  assert.ok(readme.includes(`Tools: ${C.tools.length} —`), "the count is the list's length");
  for (const t of C.tools) assert.ok(readme.includes(`\`${t.name}\``), `README names ${t.name}`);
  for (const a of C.anonTools) assert.ok(readme.includes(a), `README names unkeyed ${a}`);
  assert.ok(readme.includes(`${C.anonCaps.perAddressPerDay} calls a day per network address`), "the cap names the network address, never a bare 'address'");
  assert.ok(!/calls a day per address\b/.test(readme), "'per address' is undefined for a reader");
  assert.ok(readme.includes(`${C.anonCaps.perAddressPerDay} free calls a day per network address`), "the address gloss");
  assert.ok(readme.includes(`${C.freeKeyDailyQuota} calls a day`));
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
  const allowedDigits = new Set([C.tools.length, C.anonTools.length, C.anonCaps.perAddressPerDay, C.anonCaps.globalPerDay, C.anonCaps.searchRows, C.freeKeyDailyQuota, C.anonAddressHashRetentionDays].map(String));
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
  // The retention the privacy paragraph states is the mirrored constant, and
  // the constant is the one mcp_anon_check prunes at (checked cross-runtime
  // below when the website repo is present).
  assert.ok(readText("README.md").includes(`drops it after ${C.anonAddressHashRetentionDays} days`));
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
  }
});

test("the hosts are in the owner's order (six, then the long tail), ids unique, every step's placeholders resolve", async () => {
  assert.deepEqual(C.hosts.map((h) => h.id), ["claude", "chatgpt", "claude-code", "cursor", "vscode", "more"]);
  assert.deepEqual(C.moreHosts.map((h) => h.id), ["gemini-cli", "codex-cli", "cline", "zed", "windsurf", "any-client", "copy-the-prompt"]);
  const { fill } = await import("../scripts/build.mjs");
  for (const h of [...C.hosts, ...C.moreHosts]) {
    assert.ok(h.steps.length >= 1 && h.steps.every((s) => s.length > 10), `${h.id}: steps`);
    for (const t of [...h.steps, h.verify, h.signInOn ?? "", h.keyed ?? ""]) fill(t);
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

test("the comment stripper drops a trailing comment on a code line and keeps a URL", () => {
  const src = '{ name: "real", tier: "read" }, // { name: "ghost", tier: "read" }\nconst u = "https://example.test/x"; // trailing';
  const out = stripComments(src);
  assert.ok(!out.includes("ghost"), "a tool entry in a trailing comment must not survive");
  assert.ok(out.includes('name: "real", tier: "read"'));
  assert.ok(out.includes("https://example.test/x"), "a URL's // is not a comment");
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
  () => {
    assert.ok(existsSync(mirrorFile), `CI must check the website repo out beside this one (${mirrorFile}) — the mirror is unenforced otherwise; MIRROR_SKIP_OK=1 skips knowingly`);
    const ts = stripComments(readFileSync(mirrorFile, "utf8"));
    const block = ts.match(/export const MCP_TOOLS[^=]*=\s*\[([\s\S]*?)\n\];/);
    assert.ok(block, "MCP_TOOLS array not found");
    const entries = [...block[1].matchAll(/name:\s*"([^"]+)",\s*tier:\s*"([^"]+)"/g)].map((m) => ({ name: m[1], tier: m[2] }));
    assert.ok(entries.length > 0, "no tool entries parsed");
    assert.deepEqual(C.tools, entries, "tool list or tiers drifted from the website mirror — re-sync mcp.config.json and rebuild");

    const anon = ts.match(/MCP_ANON_TOOL_NAMES[^=]*=\s*\[([^\]]*)\]/);
    assert.ok(anon, "MCP_ANON_TOOL_NAMES not found");
    assert.deepEqual(C.anonTools, [...anon[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));

    const caps = ts.match(/MCP_ANON_CAPS\s*=\s*\{([^}]*)\}/);
    assert.ok(caps, "MCP_ANON_CAPS not found");
    const num = (k) => Number(caps[1].match(new RegExp(`${k}:\\s*(\\d+)`))[1]);
    assert.deepEqual(C.anonCaps, { perAddressPerDay: num("perAddressPerDay"), globalPerDay: num("globalPerDay"), searchRows: num("searchRows") });

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
    } else {
      console.log(`  note: ${mirrorFile} predates connect3 (no MCP_SIGN_IN_META_KEY, no MCP_HOSTS ids) — host-id and meta-key mirror not yet enforceable; mirror.at=${C.mirror.at}`);
    }
    // Server strings the troubleshooting rows quote: each `server` symptom
    // occurs in the comment-stripped Deno source once agent-mcp .7 (the
    // as-probe module) is in the sibling; before that, the .7-only rows are
    // reported as pending rather than failed.
    const fnDir = join(siblingDir, "supabase", "functions", "agent-mcp");
    const serverSrc = ["index.ts", "oauth.ts"].map((n) => stripComments(readFileSync(join(fnDir, n), "utf8"))).join("\n");
    const dot7 = existsSync(join(fnDir, "as-probe.ts"));
    const pending = [];
    for (const r of C.troubleshooting.filter((x) => x.flag === "server")) {
      const found = serverSrc.includes(r.symptom);
      if (found) continue;
      if (!dot7) pending.push(r.symptom);
      else assert.fail(`troubleshooting symptom not in the server source: "${r.symptom}"`);
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
