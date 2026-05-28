import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { parseRegistry, extractCodeLoci } from "../src/toml-registry.ts";
import { parseTraceability } from "../src/traceability.ts";
import { parseCodemap } from "../src/codemap.ts";
import { parseHeadDeltas } from "../src/head-deltas.ts";
import { parseSeams } from "../src/seams.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (name: string) => readFileSync(resolve(ROOT, name), "utf8");

const registry = parseRegistry(read("ade-invariant-registry.toml"));
const trace = parseTraceability(read("ade-TRACEABILITY.md"));
const codemap = parseCodemap(read("ade-CODEMAP.md"));
const head = parseHeadDeltas(read("ade-HEAD_DELTAS.md"));
const seams = parseSeams(read("ade-SEAMS.md"));

test("registry: 291 rules across the five families", () => {
  assert.equal(registry.length, 291);
  const fams = new Set(registry.map((r) => r.family));
  assert.deepEqual([...fams].sort(), ["CN", "DC", "OP", "RO", "T"]);
});

test("registry: ci_script scalar and ci_scripts array both normalize", () => {
  const r = registry.find((x) => x.id === "CN-FORGE-03")!;
  assert.deepEqual(r.ci_scripts, ["ci/ci_check_forge_decode_round_trip.sh"]);
  assert.equal(r.tests.length, 4);
});

test("registry: code_locus extraction yields path tokens, drops prose", () => {
  const loci = extractCodeLoci(
    "crates/ade_codec/src/cbor/envelope.rs (encode_block_envelope, NEW); process notes",
  );
  assert.deepEqual(loci, ["crates/ade_codec/src/cbor/envelope.rs"]);
});

test("registry: status counts match the TRACEABILITY summary", () => {
  const by = (s: string) => registry.filter((r) => r.status === s).length;
  assert.equal(by("enforced"), 159);
  assert.equal(by("partial"), 17);
  assert.equal(by("declared"), 115);
});

test("traceability: drift flags are extracted per rule", () => {
  const r = trace.rules.find((x) => x.id === "T-ENC-03")!;
  assert.ok(r.tests_drift.includes("full_corpus_round_trip"));
});

test("traceability: a declared rule shows explicit gaps", () => {
  const r = trace.rules.find((x) => x.id === "T-ENC-02")!;
  assert.equal(r.code_gap, true);
  assert.equal(r.tests_gap, true);
  assert.equal(r.ci_gap, true);
});

test("traceability: summary parsed from the doc header", () => {
  assert.equal(trace.summary.total, 291);
  assert.equal(trace.summary.enforced, 159);
  assert.equal(trace.summary.by_family.DC, 134);
});

test("traceability: every registry rule has a traceability entry", () => {
  const traceIds = new Set(trace.rules.map((r) => r.id));
  const missing = registry.filter((r) => !traceIds.has(r.id));
  assert.equal(missing.length, 0, `missing: ${missing.map((m) => m.id).join(",")}`);
});

test("codemap: counts come from the Counts table", () => {
  assert.equal(codemap.counts.crates, 11);
  assert.equal(codemap.counts.canonical_types, 444);
  assert.equal(codemap.counts.ci_checks, 97);
  assert.equal(codemap.repo_head, "22eef90");
});

test("codemap: dependency DAG yields directed edges", () => {
  const has = (from: string, to: string) =>
    codemap.dep_edges.some((e) => e.from === from && e.to === to);
  assert.ok(has("ade_codec", "ade_types"));
  assert.ok(has("ade_ledger", "ade_core"));
  assert.ok(has("ade_core", "ade_crypto"));
  // ade_types is a sink (depends on nothing).
  assert.equal(codemap.dep_edges.filter((e) => e.from === "ade_types").length, 0);
});

test("codemap: module attributes captured; ade_network spans two colors", () => {
  const codec = codemap.modules.find((m) => m.name === "ade_codec")!;
  assert.equal(codec.color, "BLUE");
  assert.ok(codec.attributes["MUST NOT"].includes("PreservedCbor"));
  const network = codemap.modules.filter((m) => m.name === "ade_network" && m.kind === "crate");
  const colors = new Set(network.map((m) => m.color));
  assert.ok(colors.has("BLUE") && colors.has("RED"));
});

test("head-deltas: baseline, head, and the +6 rule delta", () => {
  assert.equal(head.baseline, "dbee4d5");
  assert.equal(head.head, "22eef90");
  assert.equal(head.new_rules.length, 6);
  assert.equal(head.rules_at_baseline, 285);
  assert.equal(head.rules_at_head, 291);
  assert.ok(head.head_date?.startsWith("2026-05-28"));
});

test("seams: pipelines and registries extracted", () => {
  assert.equal(seams.pipelines.length, 4);
  assert.ok(seams.closed_registries.some((r) => r.registry === "LeaderCheckVerdict"));
  assert.ok(seams.extensible_registries.length >= 5);
});
