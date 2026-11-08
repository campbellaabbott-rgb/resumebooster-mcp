#!/usr/bin/env node
// Diffs the README's tool bullets against the live server's tools/list.
//
//   node scripts/check-live.mjs [README.md]
//       asks the server for tools/list with no key and compares it with the
//       README's "With no key, `tools/list` lists N:" bullet;
//   RESUMEBOOSTER_KEY=<key> node scripts/check-live.mjs
//       also asks with the key and compares that answer with the no-key
//       bullet plus "With a key it also lists:".
//
// It also reads the build the server names in its x-fn-build header and
// fails when it is older than mcp.config.json's mirror.serverBuild, the build
// whose strings the README quotes: the pages are re-synced to a deploy before
// it ships, so this is the check that says the deploy is live and the pages
// may be published.
//
// It reads production (tools/list is free and unmetered on the server), so
// `npm test` never runs it; the weekly CI job does, and test/check-live.test.mjs
// proves the comparison offline against a local stand-in server. MCP_URL
// overrides the address (the test points it at that stand-in). The key is
// sent only as the Authorization header and never printed.
//
// Exit 0: the README names what the server lists, and the server runs the
// build the README quotes or a later one. Exit 1: they differ, and every
// difference is printed. Exit 2: the README could not be read, or the server
// could not be asked.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The four tool bullets the build writes under "- Tools: N in all.", as name lists. */
export function readmeToolLists(readme) {
  const names = (text) => [...text.matchAll(/`([a-z][a-z0-9_]*)`/g)].map((m) => m[1]);
  const grab = (re, label) => {
    const m = readme.match(re);
    if (!m) throw new Error(`the README has no "${label}" bullet, so there is nothing to compare`);
    return m;
  };
  const total = grab(/^- Tools: (\d+) in all\.$/m, "Tools: N in all.");
  const noKey = grab(/^ {2}- With no key, `tools\/list` lists (\d+): (.+)$/m, "With no key, `tools/list` lists N:");
  const keyAdds = grab(/^ {2}- With a key it also lists: (.+)$/m, "With a key it also lists:");
  const never = grab(/^ {2}- Answered on a key, never listed: (.+)$/m, "Answered on a key, never listed:");
  const notOnChatGpt = grab(/^ {2}- Never listed inside ChatGPT: (.+)$/m, "Never listed inside ChatGPT:");
  return {
    total: Number(total[1]),
    noKeyCount: Number(noKey[1]),
    noKey: names(noKey[2]),
    keyAdds: names(keyAdds[1]),
    neverListed: names(never[1]),
    notOnChatGpt: names(notOnChatGpt[1]),
  };
}

/**
 * Every way the README's lists and the live answers disagree, as sentences.
 * `live.keyless` is the names a keyless tools/list answered; `live.keyed`,
 * when present, the names a keyed one answered. Order is not compared: the
 * README prints the registry's order and the server its own.
 */
export function diffToolLists(lists, live) {
  const problems = [];
  const dupes = (xs) => xs.filter((x, i) => xs.indexOf(x) !== i);
  for (const [label, xs] of Object.entries({ "no key": lists.noKey, "with a key": lists.keyAdds, "never listed": lists.neverListed })) {
    if (dupes(xs).length) problems.push(`the README's "${label}" bullet names ${dupes(xs).join(", ")} twice`);
  }
  if (lists.noKeyCount !== lists.noKey.length) problems.push(`the README says a keyless tools/list lists ${lists.noKeyCount} but names ${lists.noKey.length}`);
  const all = new Set([...lists.noKey, ...lists.keyAdds, ...lists.neverListed]);
  if (lists.total !== all.size) problems.push(`the README says ${lists.total} tools in all but its bullets name ${all.size}`);
  for (const n of lists.notOnChatGpt) if (!all.has(n)) problems.push(`the README's ChatGPT bullet names ${n}, which no other bullet names`);
  const diff = (label, readme, server) => {
    const serverOnly = server.filter((n) => !readme.includes(n));
    const readmeOnly = readme.filter((n) => !server.includes(n));
    if (serverOnly.length) problems.push(`${label}: the server lists ${serverOnly.join(", ")}, which the README does not`);
    if (readmeOnly.length) problems.push(`${label}: the README lists ${readmeOnly.join(", ")}, which the server does not`);
  };
  diff("tools/list with no key", lists.noKey, live.keyless);
  if (live.keyed) diff("tools/list with a key", [...lists.noKey, ...lists.keyAdds], live.keyed);
  return problems;
}

/**
 * Two agent-mcp builds ("agent-mcp.2026-11-08.1") compared: negative when `a`
 * is older, 0 when equal, positive when newer. The day sorts as text; the
 * day's sequence as a number, so .10 is after .9.
 */
export function compareBuilds(a, b) {
  const parse = (s) => {
    const m = /^agent-mcp\.(\d{4}-\d{2}-\d{2})\.(\d+)$/.exec(String(s ?? ""));
    if (!m) throw new Error(`"${s}" is not an agent-mcp build (agent-mcp.YYYY-MM-DD.N)`);
    return [m[1], Number(m[2])];
  };
  const [[da, na], [db, nb]] = [parse(a), parse(b)];
  return da === db ? na - nb : da < db ? -1 : 1;
}

/** Why a live build cannot carry the README's words, or null when it can. */
export function buildProblem(live, wanted) {
  if (!live) return `the server sent no x-fn-build header, so the build it runs cannot be compared with ${wanted}, the build whose words the README quotes`;
  if (compareBuilds(live, wanted) < 0) return `the live server runs ${live}, older than ${wanted}, the build whose words the README quotes: publish after the deploy that carries it verifies`;
  return null;
}

/** The tool names one tools/list answers, keyless or with `key`, and the build its x-fn-build names. */
export async function liveTools(url, key) {
  const headers = { "content-type": "application/json", "mcp-protocol-version": "2025-06-18" };
  if (key) headers.authorization = `Bearer ${key}`;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`tools/list answered HTTP ${res.status}${key ? " (with a key)" : ""}`);
  const body = await res.json();
  if (body.error) throw new Error(`tools/list answered an error${key ? " (with a key)" : ""}: ${body.error.message}`);
  const tools = body.result?.tools;
  if (!Array.isArray(tools)) throw new Error("tools/list answered no tools array");
  return { names: tools.map((t) => t.name), build: res.headers.get("x-fn-build") };
}

const isEntry = !!process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isEntry) {
  const readmePath = process.argv[2] ?? join(ROOT, "README.md");
  const config = JSON.parse(readFileSync(join(ROOT, "mcp.config.json"), "utf8"));
  const url = process.env.MCP_URL || config.mcpUrl;
  const key = process.env.RESUMEBOOSTER_KEY || "";
  let lists;
  try {
    lists = readmeToolLists(readFileSync(readmePath, "utf8"));
  } catch (e) {
    console.error(`check-live: ${e.message}`);
    process.exit(2);
  }
  let live;
  let build;
  try {
    const keyless = await liveTools(url);
    live = { keyless: keyless.names };
    build = keyless.build;
    if (key) live.keyed = (await liveTools(url, key)).names;
  } catch (e) {
    console.error(`check-live: could not ask ${url}: ${e.message}`);
    process.exit(2);
  }
  const wanted = config.mirror.serverBuild;
  const problems = diffToolLists(lists, live);
  const behind = buildProblem(build, wanted);
  if (behind) problems.push(behind);
  console.log(`check-live: ${url}`);
  console.log(`  live build:         ${build ?? "none named"} (the README quotes ${wanted})`);
  console.log(`  keyless tools/list: ${live.keyless.length} — ${live.keyless.join(", ")}`);
  if (live.keyed) console.log(`  keyed tools/list:   ${live.keyed.length} — ${live.keyed.join(", ")}`);
  else console.log("  keyed tools/list:   not asked (RESUMEBOOSTER_KEY is not set)");
  if (problems.length) {
    for (const p of problems) console.error(`  DIFF ${p}`);
    console.error(`check-live: ${problems.length} difference(s) between the README and the live server`);
    process.exit(1);
  }
  console.log("check-live: the README names what the server lists, and the server runs the build it quotes or a later one");
}
