// scripts/check-live.mjs diffs the README's tool bullets against a live
// tools/list. These tests never reach production: the comparison is run on
// the built README and on mutated copies of it, and the script itself is run
// against a stand-in server on 127.0.0.1.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildProblem, compareBuilds, diffToolLists, readmeToolLists } from "../scripts/check-live.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const C = JSON.parse(readFileSync(join(ROOT, "mcp.config.json"), "utf8"));
const README = readFileSync(join(ROOT, "README.md"), "utf8");
const ANON = C.anonTools;
const KEY_ADDS = C.tools.map((t) => t.name).filter((n) => !ANON.includes(n) && !C.neverListed.includes(n));

test("the reader takes the built README's bullets as the unkeyed, keyed, never-listed and ChatGPT sets the constants hold", () => {
  const lists = readmeToolLists(README);
  assert.equal(lists.total, C.tools.length);
  assert.equal(lists.noKeyCount, ANON.length);
  assert.deepEqual([...lists.noKey].sort(), [...ANON].sort());
  assert.deepEqual([...lists.keyAdds].sort(), [...KEY_ADDS].sort());
  assert.deepEqual(lists.neverListed, C.neverListed);
  assert.deepEqual(lists.notOnChatGpt, C.notOnChatGpt);
});

test("a server that lists the unkeyed tools in another order matches the README", () => {
  const lists = readmeToolLists(README);
  assert.deepEqual(diffToolLists(lists, { keyless: [...ANON].reverse() }), []);
  assert.deepEqual(diffToolLists(lists, { keyless: [...ANON], keyed: [...KEY_ADDS, ...ANON] }), []);
});

test("a tool the server lists and the README does not is named", () => {
  const problems = diffToolLists(readmeToolLists(README), { keyless: [...ANON, "brand_new_tool"] });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /the server lists brand_new_tool, which the README does not/);
});

test("a retired tool a mutated README still lists is named as one the server does not list", () => {
  const retired = C.retiredTools[0];
  const mutated = README.replace(/^( {2}- With no key, `tools\/list` lists )(\d+): (.+)$/m, (_, head, n, rest) => `${head}${Number(n) + 1}: ${rest}, \`${retired}\``);
  assert.notEqual(mutated, README, "the mutation must land");
  const problems = diffToolLists(readmeToolLists(mutated), { keyless: [...ANON] });
  assert.ok(problems.some((p) => p.includes(`the README lists ${retired}, which the server does not`)), problems.join("\n"));
});

test("a keyed tools/list missing a tool the README says a key adds is named", () => {
  const dropped = KEY_ADDS[0];
  const problems = diffToolLists(readmeToolLists(README), { keyless: [...ANON], keyed: [...ANON, ...KEY_ADDS.slice(1)] });
  assert.ok(problems.some((p) => p.startsWith("tools/list with a key:") && p.includes(`the README lists ${dropped}`)), problems.join("\n"));
});

test("a count that disagrees with the names beside it is named", () => {
  const mutated = README.replace(/^( {2}- With no key, `tools\/list` lists )(\d+):/m, (_, head, n) => `${head}${Number(n) + 2}:`);
  const problems = diffToolLists(readmeToolLists(mutated), { keyless: [...ANON] });
  assert.ok(problems.some((p) => p.includes(`lists ${ANON.length + 2} but names ${ANON.length}`)), problems.join("\n"));
  const total = README.replace(/^- Tools: (\d+) in all\.$/m, (_, n) => `- Tools: ${Number(n) - 1} in all.`);
  assert.ok(diffToolLists(readmeToolLists(total), { keyless: [...ANON] }).some((p) => p.includes(`${C.tools.length - 1} tools in all`)));
});

test("a README with no tool bullets is refused, not passed", () => {
  const stripped = README.replace(/^ {2}- With no key, `tools\/list` lists .+$/m, "");
  assert.throws(() => readmeToolLists(stripped), /has no "With no key/);
  assert.throws(() => readmeToolLists("# nothing here\n"), /has no "Tools: N in all\."/);
});

test("builds compare by day, then by the day's sequence as a number", () => {
  assert.ok(compareBuilds("agent-mcp.2026-11-08.1", "agent-mcp.2026-11-03.1") > 0);
  assert.ok(compareBuilds("agent-mcp.2026-11-08.10", "agent-mcp.2026-11-08.9") > 0, "sequence 10 is after 9");
  assert.equal(compareBuilds("agent-mcp.2026-11-08.1", "agent-mcp.2026-11-08.1"), 0);
  assert.ok(compareBuilds("agent-mcp.2026-10-31.4", "agent-mcp.2026-11-01.1") < 0);
  assert.throws(() => compareBuilds("job-board.2026-11-08.1", "agent-mcp.2026-11-08.1"), /not an agent-mcp build/);
});

test("a live build older than the one the README quotes is a problem that names both, and none or a newer one is judged too", () => {
  const want = C.mirror.serverBuild;
  assert.match(buildProblem("agent-mcp.2026-11-03.1", want), new RegExp(`runs agent-mcp\\.2026-11-03\\.1, older than ${want.replace(/\./g, "\\.")}`));
  assert.match(buildProblem(null, want), /sent no x-fn-build/);
  assert.equal(buildProblem(want, want), null);
  assert.equal(buildProblem("agent-mcp.2099-01-01.1", want), null);
});

// The script run end to end against a stand-in for the server, which names
// its build in x-fn-build as agent-mcp does (the README's build unless told).
const standIn = (names, build = C.mirror.serverBuild) =>
  new Promise((resolveServer) => {
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const msg = JSON.parse(body);
        res.setHeader("content-type", "application/json");
        if (build) res.setHeader("x-fn-build", build);
        res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools: names.map((name) => ({ name, inputSchema: { type: "object" } })) } }));
      });
    });
    server.listen(0, "127.0.0.1", () => resolveServer(server));
  });

const runScript = (url, readmePath) =>
  new Promise((resolveRun) => {
    const env = { ...process.env, MCP_URL: url };
    delete env.RESUMEBOOSTER_KEY;
    const child = spawn(process.execPath, [join(ROOT, "scripts", "check-live.mjs"), ...(readmePath ? [readmePath] : [])], { env });
    let out = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (out += c));
    child.on("close", (status) => resolveRun({ status, out }));
  });

test("the script exits 0 when the stand-in lists what the README names, and 1 naming the tool when it lists one more", async () => {
  const same = await standIn([...ANON].reverse());
  try {
    const r = await runScript(`http://127.0.0.1:${same.address().port}`);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /the README names what the server lists/);
  } finally {
    same.close();
  }
  const more = await standIn([...ANON, "brand_new_tool"]);
  try {
    const r = await runScript(`http://127.0.0.1:${more.address().port}`);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /DIFF tools\/list with no key: the server lists brand_new_tool/);
  } finally {
    more.close();
  }
});

test("the script exits 1 before the deploy the README quotes is live, naming the live build and the one it waits for", async () => {
  const old = await standIn([...ANON], "agent-mcp.2026-11-03.1");
  try {
    const r = await runScript(`http://127.0.0.1:${old.address().port}`);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /DIFF the live server runs agent-mcp\.2026-11-03\.1, older than/);
    assert.ok(r.out.includes(C.mirror.serverBuild), r.out);
  } finally {
    old.close();
  }
  const silent = await standIn([...ANON], null);
  try {
    const r = await runScript(`http://127.0.0.1:${silent.address().port}`);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /sent no x-fn-build/);
  } finally {
    silent.close();
  }
});

test("the script exits 2 when the README has no bullets to compare, before it asks any server", async () => {
  const dir = mkdtempSync(join(tmpdir(), "check-live-"));
  try {
    const bare = join(dir, "README.md");
    writeFileSync(bare, "# no tool bullets\n");
    const r = await runScript("http://127.0.0.1:9", bare);
    assert.equal(r.status, 2, r.out);
    assert.match(r.out, /has no "Tools: N in all\."/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
