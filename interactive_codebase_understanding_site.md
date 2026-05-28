# Interactive Codebase Understanding Site

Ade Atlas
Interactive authority, invariant, and enforcement map for the replay-first Cardano node.

## Purpose

Build a read-only evidence dashboard that helps engineers, reviewers, and coordinators understand the Ade codebase through its authority boundaries, invariants, seams, recent changes, and enforcement status.

The site should not replace the repo, generated docs, tests, or CI. It should make them easier to inspect, search, and navigate.

## Core Principle

The website is a visual projection of authoritative project evidence.

```text
Repo + generated Markdown docs + invariant registry + tests + CI
        ↓
parser / indexer
        ↓
structured JSON data
        ↓
interactive read-only website
```

The site explains the codebase, but the repo remains the source of truth.

## Primary Data Sources

| Source document | Role in the site | What it powers |
|---|---|---|
| `ade-CODEMAP.md` | Module authority map | Architecture graph, BLUE/GREEN/RED classification, ownership, dependencies, entry points, MUST NOT rules |
| `ade-SEAMS.md` | Legal attachment map | “Where can I add code?” explorer, ingress surfaces, extension points, forbidden bypasses |
| `ade-HEAD_DELTAS.md` | Recent-change summary | Cluster timeline, new/modified modules, added CI checks, current follow-ons |
| `ade-TRACEABILITY.md` | Invariant enforcement audit | Invariant explorer, enforcement dashboard, gaps, drift, code/test/CI links |
| `docs/ade-invariant-registry.toml` | Canonical invariant registry | Rule metadata, tier/status/family/source, registry-to-traceability comparison |
| Cluster docs | Slice/cluster context | Planning timeline, invariant slice history, open risks, proof obligations |
| Actual repo files | Ground truth | Code links, test links, CI script links, drift validation |

## Recommended Site Areas

### 1. Architecture Map

Powered primarily by `ade-CODEMAP.md`.

Shows:

- crates/modules grouped by BLUE, GREEN, RED
- authority ownership per module
- entry points
- inbound/outbound dependencies
- “MUST NOT” rules
- CI checks guarding each module or color boundary

Useful questions it answers:

- Where does this responsibility belong?
- Is this module allowed to depend on that module?
- Is this logic BLUE, GREEN, or RED?
- Which module owns this authority surface?

### 2. Seam Explorer

Powered primarily by `ade-SEAMS.md`.

Shows:

- external ingress surfaces
- legal attachment points
- canonical reduction pipelines
- closed registries
- forbidden bypasses
- authority chokepoints

Useful questions it answers:

- I want to add a new mini-protocol path — where may it attach?
- I want to add an operator file type — what is the legal RED-to-BLUE path?
- Is this proposal creating a second decode, encode, signing, or transport authority?

### 3. Invariant Explorer

Powered primarily by `ade-TRACEABILITY.md` and `docs/ade-invariant-registry.toml`.

Shows:

- invariant ID
- tier: true, derived, release, operational
- status: enforced, partial, declared, deprecated
- source document
- requirement text
- code loci
- tests
- CI scripts
- drift warnings
- enforcement gaps

Useful questions it answers:

- Is this invariant actually enforced?
- Which tests prove it?
- Which CI script prevents regression?
- Which invariants are only declared and still need closure?

### 4. HEAD Delta / Cluster Timeline

Powered primarily by `ade-HEAD_DELTAS.md` and cluster docs.

Shows:

- baseline commit
- current HEAD
- commits since baseline
- closed clusters
- new modules
- modified modules
- new or modified CI checks
- invariant strengthenings
- declared follow-ons

Useful questions it answers:

- What changed since the last baseline?
- Which cluster introduced this module?
- Which CI check was added by this slice?
- What follow-on work remains open?

### 5. Enforcement Dashboard

Powered primarily by `ade-TRACEABILITY.md`.

Shows summary counts:

- total rules
- enforced rules
- partial rules
- declared rules
- release obligations
- operational obligations
- drift count
- missing tests
- missing CI scripts

Useful questions it answers:

- What is the enforcement health of the project?
- Which true invariants lack mechanical CI?
- Which registry entries reference missing tests or scripts?
- What should be prioritized next for assurance closure?

### 6. Bounty / Certification Readiness View

Powered by the challenge criteria, project plan, traceability, and cluster evidence.

Shows:

- sync-to-tip readiness
- block production readiness
- N2N/N2C protocol coverage
- private testnet readiness
- tx validity agreement evidence
- block validity agreement evidence
- consensus tip agreement evidence
- power-loss recovery evidence
- memory measurement evidence

Important classification:

Bounty checks are certification targets, not constitutional laws. They trace upward to derived and true invariants, but they must never weaken the true invariants.

## Data Update Pipeline

The site should stay updated from the repo automatically.

```text
git commit / cluster close
        ↓
run tests and CI checks
        ↓
regenerate living docs
        ↓
parse Markdown + TOML into JSON
        ↓
validate links and drift
        ↓
build website
        ↓
deploy static site or refresh dashboard
```

## Generated Site Data

The parser should produce structured artifacts such as:

```text
site-data/
  manifest.json
  codemap.json
  seams.json
  head_deltas.json
  traceability.json
  invariants.json
  clusters.json
  ci_checks.json
  tests.json
  repo_index.json
```

### `manifest.json`

Should include:

```json
{
  "repo_head": "22eef90",
  "docs_generated_at": "2026-05-28",
  "parser_version": "0.1.0",
  "source_docs": {
    "codemap": "docs/ade-CODEMAP.md",
    "seams": "docs/ade-SEAMS.md",
    "head_deltas": "docs/ade-HEAD_DELTAS.md",
    "traceability": "docs/ade-TRACEABILITY.md",
    "registry": "docs/ade-invariant-registry.toml"
  },
  "counts": {
    "crates": 11,
    "canonical_types": 444,
    "ci_checks": 97,
    "invariant_rules": 291
  }
}
```

The exact values should be generated from the current repo, not hand-maintained.

## CI Update Strategy

Run the site pipeline on:

- every merge to `main`
- every cluster close
- every regeneration of CODEMAP, SEAMS, HEAD_DELTAS, or TRACEABILITY
- optionally every pull request that touches architecture docs, registry, tests, CI, or module boundaries

Recommended CI stages:

```text
1. cargo test / project tests
2. run ci/ci_check_*.sh
3. regenerate architecture docs
4. parse docs into site-data JSON
5. validate site-data against repo files
6. build website
7. publish artifact or deploy
```

## Drift Checks That Should Fail the Build

The website build should fail if:

- a module exists in code but not in `ade-CODEMAP.md`
- a module is listed in `ade-CODEMAP.md` but no longer exists
- an invariant exists in the registry but not in `ade-TRACEABILITY.md`
- `ade-TRACEABILITY.md` references a missing test
- `ade-TRACEABILITY.md` references a missing CI script
- a seam references a deleted module or closed registry that no longer exists
- generated docs claim one HEAD but the repo is at another HEAD
- a BLUE module lacks the required core contract banner
- a BLUE module depends on a RED crate
- a new ingress path bypasses the canonical chokepoint model
- a new block encoder/decoder/signing path appears outside the declared authority

These checks keep the website from becoming stale documentation theater.

## Read-Only Constraint

The site should be read-only.

It may:

- search
- filter
- visualize
- link to files
- show evidence
- compare registry/docs/code
- export reports

It should not directly edit invariants, docs, cluster plans, or source code.

All authoritative changes should happen through normal repo workflow: branch, slice, tests, CI, review, merge.

## Suggested User Flows

### “I want to add new code”

1. Start in Seam Explorer.
2. Identify the legal attachment point.
3. Open the related CODEMAP module.
4. Review MUST NOT rules.
5. Open related invariants in Traceability.
6. Confirm required tests and CI checks.
7. Draft an invariant slice.

### “I want to review a cluster close”

1. Open HEAD Delta / Cluster Timeline.
2. Review changed modules and CI checks.
3. Open each touched CODEMAP entry.
4. Open affected TRACEABILITY rules.
5. Confirm no drift or enforcement gaps were introduced.

### “I want to know if an invariant is real”

1. Search invariant ID in Invariant Explorer.
2. Check tier and status.
3. Inspect code loci.
4. Inspect tests.
5. Inspect CI script.
6. Treat any missing cell as an enforcement gap.

### “I want to understand bounty readiness”

1. Open Certification Readiness View.
2. Select a bounty criterion.
3. Follow links to derived and true invariants.
4. Inspect traceability evidence.
5. Confirm whether the criterion is mechanically supported or still only partially evidenced.

## Implementation Shape

A simple first version can be a static site:

```text
Markdown/TOML parser → JSON files → React/Next.js static dashboard
```

A later version can add a lightweight database or search index:

```text
Markdown/TOML parser → SQLite/Meilisearch/Lucene index → web UI
```

Keep the parser deterministic:

- stable ordering
- explicit schema versions
- no hidden network fetches
- no timestamp-dependent content except the manifest generation time
- fail on malformed or ambiguous source docs

## Recommended Pages

```text
/
  Dashboard summary

/modules
  CODEMAP-powered module graph

/modules/:module
  Module authority profile

/seams
  Legal attachment explorer

/invariants
  Searchable invariant registry + traceability table

/invariants/:id
  Rule detail: source → code → tests → CI → drift

/deltas
  HEAD delta timeline

/clusters
  Cluster and slice history

/enforcement
  Enforcement health dashboard

/certification
  Bounty/readiness evidence map
```

## What Not To Do

Do not make the site an alternate source of truth.

Do not manually curate site records that can drift from the repo.

Do not let the site infer authority that the generated docs do not claim.

Do not hide declared or partial invariants behind green dashboards.

Do not classify release or operational practices as runtime semantic invariants.

Do not use the website to justify weakening a true invariant for bounty convenience.

## Bottom Line

Yes: use these documents as the main semantic data source for the interactive website.

But use them as a commit-pinned, regenerated explanation layer over the repo. The actual authority remains:

```text
source code + invariant registry + generated docs + tests + CI
```

The site is valuable because it makes that authority navigable, searchable, and auditable without changing what is authoritative.

