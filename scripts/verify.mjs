#!/usr/bin/env node
// Validates every manifest in this repo against the schema its host publishes.
//
//   node scripts/verify.mjs
//
// Schemas are the copies under schemas/ (fetched 2026-09-16):
//   schemas/mcp-registry-server.schema.json
//     ← https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json
//   schemas/claude-code-plugin-manifest.schema.json
//     ← https://json.schemastore.org/claude-code-plugin-manifest.json (the URL
//       code.claude.com/docs/en/plugins-reference names for plugin.json)
//   schemas/claude-code-marketplace.schema.json
//     ← https://json.schemastore.org/claude-code-marketplace.json
// Gemini publishes no JSON Schema for gemini-extension.json; its rules are
// checked from the prose of google-gemini/gemini-cli docs/extensions/reference.md
// (name and version required; every env var an MCP server reads must be
// declared in `settings[].envVar`). Claude Code's .mcp.json has no published
// schema either; the shape is the one code.claude.com/docs/en/mcp documents.
//
// The validator below is a deliberately small draft-07 subset — type,
// properties, required, additionalProperties:false, items, enum, pattern,
// minLength/maxLength, minItems, format:uri, $ref within the document, allOf,
// anyOf, oneOf — which covers every keyword the three schemas use on the
// paths these manifests exercise. It is not ajv; it does not claim to be.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// VERIFY_ROOT lets the test point this at a mutated copy to prove the checks bite.
const ROOT = process.env.VERIFY_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => JSON.parse(readFileSync(join(ROOT, rel), "utf8"));

function validate(schema, root, value, path = "$", errors = []) {
  if (schema.$ref) {
    const target = schema.$ref.replace(/^#\//, "").split("/").reduce((o, k) => o?.[k], root);
    if (!target) return errors.push(`${path}: unresolved $ref ${schema.$ref}`), errors;
    return validate(target, root, value, path, errors);
  }
  for (const sub of schema.allOf ?? []) validate(sub, root, value, path, errors);
  if (schema.anyOf) {
    const ok = schema.anyOf.some((sub) => validate(sub, root, value, path, []).length === 0);
    if (!ok) errors.push(`${path}: matches none of anyOf`);
  }
  if (schema.oneOf) {
    const n = schema.oneOf.filter((sub) => validate(sub, root, value, path, []).length === 0).length;
    if (n !== 1) errors.push(`${path}: matches ${n} of oneOf, expected exactly 1`);
  }
  if (schema.type) {
    const types = [].concat(schema.type);
    const actual = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
    const okType = types.some((t) => (t === "integer" ? Number.isInteger(value) : t === actual));
    if (!okType) return errors.push(`${path}: expected ${types.join("|")}, got ${actual}`), errors;
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: ${JSON.stringify(value)} not in enum`);
  if (typeof value === "string") {
    if (schema.minLength != null && value.length < schema.minLength) errors.push(`${path}: shorter than ${schema.minLength}`);
    if (schema.maxLength != null && value.length > schema.maxLength) errors.push(`${path}: ${value.length} chars exceeds maxLength ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: does not match ${schema.pattern}`);
    if (schema.format === "uri") {
      try { new URL(value); } catch { errors.push(`${path}: not a URI`); }
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) errors.push(`${path}: fewer than ${schema.minItems} items`);
    if (schema.items) value.forEach((v, i) => validate(schema.items, root, v, `${path}[${i}]`, errors));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const k of schema.required ?? []) if (!(k in value)) errors.push(`${path}: missing required ${k}`);
    for (const [k, v] of Object.entries(value)) {
      const sub = schema.properties?.[k];
      if (sub) validate(sub, root, v, `${path}.${k}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${path}: unexpected property ${k}`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") validate(schema.additionalProperties, root, v, `${path}.${k}`, errors);
    }
  }
  return errors;
}

const results = [];
const check = (label, errors) => {
  results.push({ label, errors });
  console.log(`${errors.length ? "FAIL" : "ok  "} ${label}${errors.length ? "\n  " + errors.join("\n  ") : ""}`);
};

// 1. server.json ← registry schema
{
  const schema = read("schemas/mcp-registry-server.schema.json");
  const doc = read("server.json");
  const errors = validate(schema, schema, doc);
  if (doc.$schema !== schema.$id) errors.push(`$schema ${doc.$schema} is not the schema's $id ${schema.$id}`);
  if (!doc.remotes?.length) errors.push("remotes-only server has no remotes");
  if (doc.packages?.length) errors.push("a remote-only server must not list packages");
  for (const r of doc.remotes ?? []) {
    if (r.type !== "streamable-http") errors.push(`remote type ${r.type}: the docs deprecate sse`);
    for (const h of r.headers ?? []) {
      if (h.value) errors.push(`header ${h.name} carries a value — a key never ships in a manifest`);
      if (h.name === "Authorization" && (h.isRequired !== false || h.isSecret !== true)) errors.push("Authorization must be optional and secret");
    }
  }
  check("server.json against 2025-12-11 server.schema.json", errors);
}

// 2. .claude-plugin/plugin.json ← schemastore plugin manifest schema
{
  const schema = read("schemas/claude-code-plugin-manifest.schema.json");
  const doc = read(".claude-plugin/plugin.json");
  const errors = validate(schema, schema, doc);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(doc.name)) errors.push("name is not kebab-case");
  check("plugin.json against claude-code-plugin-manifest.json", errors);
}

// 3. .claude-plugin/marketplace.json ← schemastore marketplace schema
{
  const schema = read("schemas/claude-code-marketplace.schema.json");
  const doc = read(".claude-plugin/marketplace.json");
  const errors = validate(schema, schema, doc);
  const reserved = ["claude-code-marketplace","claude-code-plugins","claude-plugins-official","claude-plugins-community","claude-community","anthropic-marketplace","anthropic-plugins","agent-skills","anthropic-agent-skills","knowledge-work-plugins","life-sciences","claude-for-legal","claude-for-financial-services","financial-services-plugins","first-party-plugins","claude-tag-plugins","healthcare"];
  if (reserved.includes(doc.name)) errors.push("marketplace name is reserved for Anthropic");
  for (const p of doc.plugins ?? []) {
    if (typeof p.source === "string" && !p.source.startsWith("./")) errors.push(`plugin ${p.name}: a relative source must start with ./`);
    if (typeof p.source === "string" && p.source.includes("..")) errors.push(`plugin ${p.name}: source escapes the marketplace root`);
  }
  check("marketplace.json against claude-code-marketplace.json", errors);
}

// 4. gemini-extension.json ← rules from docs/extensions/reference.md (no published schema)
{
  const doc = read("gemini-extension.json");
  const errors = [];
  for (const k of ["name", "version"]) if (typeof doc[k] !== "string" || !doc[k]) errors.push(`missing required ${k}`);
  if (!/^[a-z0-9-]+$/.test(doc.name ?? "")) errors.push("name must be lowercase letters, digits and dashes");
  const declared = new Set((doc.settings ?? []).map((s) => s.envVar));
  for (const [name, srv] of Object.entries(doc.mcpServers ?? {})) {
    if (!srv.httpUrl && !srv.url && !srv.command) errors.push(`server ${name}: needs httpUrl, url or command`);
    if ("trust" in srv) errors.push(`server ${name}: trust is the one option extensions may not set`);
    const refs = JSON.stringify(srv).match(/\$\{?([A-Z_][A-Z0-9_]*)/g) ?? [];
    for (const ref of refs) {
      const v = ref.replace(/^\$\{?/, "");
      if (!declared.has(v)) errors.push(`server ${name} reads $${v} but settings[] does not declare it — Gemini strips undeclared env`);
    }
  }
  for (const s of doc.settings ?? []) for (const k of ["name", "description", "envVar"]) if (!s[k]) errors.push(`settings entry missing ${k}`);
  check("gemini-extension.json against docs/extensions/reference.md rules", errors);
}

// 5. .mcp.json ← the shape code.claude.com/docs/en/mcp documents for a remote server
{
  const doc = read(".mcp.json");
  const errors = [];
  if (!doc.mcpServers || typeof doc.mcpServers !== "object") errors.push("no mcpServers object");
  for (const [name, srv] of Object.entries(doc.mcpServers ?? {})) {
    if (srv.type !== "http") errors.push(`server ${name}: type must be http for a Streamable HTTP remote`);
    if (!/^https:\/\//.test(srv.url ?? "")) errors.push(`server ${name}: url must be https`);
    if (/rb_live_[A-Za-z0-9]{8,}/.test(JSON.stringify(srv))) errors.push(`server ${name}: a key is written into the file`);
  }
  check(".mcp.json shape", errors);
}

const failed = results.filter((r) => r.errors.length);
console.log(`\n${results.length - failed.length}/${results.length} manifests valid`);
process.exit(failed.length ? 1 : 0);
