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
  assert.equal(mcp.mcpServers[C.serverName].headers, undefined, ".mcp.json is keyless by decision");

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
  assert.ok(readme.includes(`https://cursor.com/install-mcp?name=${C.serverName}&config=${encodeURIComponent(b64)}`), "cursor web link");
  assert.equal(JSON.parse(Buffer.from(b64, "base64").toString()).url, C.mcpUrl, "the deep link's config holds only the URL");
  const vscode = `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: C.serverName, type: "http", url: C.mcpUrl }))}`;
  assert.ok(readme.includes(vscode), "vscode link");
  assert.ok(readme.includes(`https://insiders.vscode.dev/redirect?url=${encodeURIComponent(vscode)}`), "vscode badge");
  assert.ok(readme.includes(`Tools: ${C.tools.length} —`), "the count is the list's length");
  for (const t of C.tools) assert.ok(readme.includes(`\`${t.name}\``), `README names ${t.name}`);
  for (const a of C.anonTools) assert.ok(readme.includes(a), `README names unkeyed ${a}`);
  assert.ok(readme.includes(`${C.anonCaps.perAddressPerDay} calls a day per address`));
  assert.ok(readme.includes(`${C.freeKeyDailyQuota} calls a day`));
  assert.ok(readme.includes(`/plugin marketplace add ${C.repoOwner}/${C.repoName}`));
  assert.ok(readme.includes(`gemini extensions install ${C.repoUrl}`));
  assert.ok(readme.includes(`bearer_token_env_var = "${C.keyEnvVar}"`));
  assert.ok(readme.includes(`"serverUrl": "${C.mcpUrl}"`), "windsurf block");
  assert.ok(readme.includes(`"type": "streamableHttp"`), "cline block");
  assert.ok(readme.includes(`"context_servers"`), "zed block");
  assert.ok(readme.includes(`\${input:${C.serverName}-key}`), "vscode prompts for the key");
  assert.ok(readme.includes(`\${${C.keyEnvVar}:-}`), "env-header variant documented");
  for (const forbidden of [/\bhired\b/i, /\$\d+/, /leaderboard/i, /fastest[- ]growing/i]) {
    assert.ok(!forbidden.test(readme), `README must not say ${forbidden}`);
  }
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
// The cross-runtime mirror. Comments are stripped before any regex runs so a
// name written in prose can neither satisfy nor fail the check.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const siblingDir = process.env.RESUME_SIGNAL_PRO_DIR ?? join(ROOT, "..", "resume-signal-pro");
const mirrorFile = join(siblingDir, "src", "config", "mcp-tools.ts");

test(
  "the tool list, unkeyed tier, caps and quota match resume-signal-pro/src/config/mcp-tools.ts",
  { skip: existsSync(mirrorFile) ? false : `website repo not beside this one (${mirrorFile}); mcp.config.json.mirror.at says which commit the list was copied from` },
  () => {
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

    const env = join(siblingDir, ".env");
    if (existsSync(env)) {
      const base = readFileSync(env, "utf8").match(/^VITE_SUPABASE_URL="?([^"\n]+)"?/m);
      assert.ok(base, "VITE_SUPABASE_URL not in .env");
      assert.equal(C.mcpUrl, `${base[1]}/functions/v1/agent-mcp`, "MCP_URL is VITE_SUPABASE_URL + the function path (AgentConnect.tsx)");
    }
  },
);
