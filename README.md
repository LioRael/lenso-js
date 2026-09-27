# Lenso JavaScript and TypeScript

The JavaScript and TypeScript authoring workspace for Lenso:

- `@lenso/contract-runtime` owns portable TypeScript wire values and browser
  validation shared by generated Capability bindings.
- `@lenso/process-protocol` owns strict Process and Authoring V2 wire values,
  proof framing, and execution-target profile validation.
- `@lenso/bun` is the supported Bun Plugin authoring SDK and contains the
  generated projections of selected public Capability contracts.
- `@lenso/bun-plugin` implements the low-level Bun runtime used by generated
  Plugin entrypoints.
- `@lenso/web-client` generates typed browser clients from an explicitly
  selected public OpenAPI document.
- `@lenso/workers-runtime` owns JavaScript event scopes, generation boundaries,
  the buffered HTTP Host facade, and the Workers Host build helper.
- `@lenso/http-egress-workers` binds the Rust HTTP Egress Plugin to event-owned
  Fetch without granting network authority.
- `@lenso/web-ingress-workers` binds an authorized Rust WebSocket session to a
  Workers `WebSocketPair` under the Runtime event scope.
- `fixtures/bun` owns the JavaScript side of Rust/Bun protocol conformance.

Rust framework crates, execution adapters, Host executables, and canonical
protocol fixtures live in [`LioRael/lenso`](https://github.com/LioRael/lenso).
The three checked-in protocol vector snapshots under `fixtures/` mirror that
Rust spec for standalone package tests; `fixtures:check` compares them with an
explicit Rust checkout. They are not independent contract sources.
Product Capability semantics remain in their owning App repositories. This
separation keeps language tooling together without making a language SDK the
owner of business policy.

## Author a Bun Plugin

```sh
bun add @lenso/bun
```

```ts
import { definePlugin } from "@lenso/bun";
import { Jobs, type JobsProvider } from "@lenso/bun/capabilities/jobs";
import { jobs } from "./jobs.ts";

export default definePlugin({
  provides: [Jobs],
  create() {
    return jobs satisfies JobsProvider;
  },
});
```

The generated entrypoint owns runtime startup. Plugin authors do not implement
the process handshake or transport. Request, bidirectional Stream, Event,
per-Instance construction, dependency routing, cancellation, and bounded stop
hooks are covered by the workspace tests and the cross-language suite.

## Validation

```sh
bun install --frozen-lockfile
LENSO_RUST_ROOT=/absolute/path/to/lenso bun run fixtures:check
bun run --filter '@lenso/bun' capabilities:check
bun run build
bun run typecheck
bun run test:typescript
bun run test:workers
bun run package-smoke
npm pack --dry-run ./packages/lenso-bun
npm pack --dry-run ./packages/lenso-bun-plugin
npm pack --dry-run ./packages/lenso-contract-runtime
npm pack --dry-run ./packages/lenso-http-egress-workers
npm pack --dry-run ./packages/lenso-process-protocol
npm pack --dry-run ./packages/lenso-web-client
npm pack --dry-run ./packages/lenso-web-ingress-workers
npm pack --dry-run ./packages/lenso-cli
npm pack --dry-run ./packages/lenso-workers-runtime
```

The dispatch-only npm release workflow covers packages built entirely in this
workspace; `@lenso/cli` stays outside that workflow. Its separate
[`release-cli-npm.yml`](.github/workflows/release-cli-npm.yml) dry run pins exact
JS and Rust commits, builds and runs the CLI on macOS ARM64/x64, Linux x64,
and Windows x64, then puts their source and artifact receipts inside one npm
archive. Four clean consumers install that archive and create an App. The
workflow is a candidate gate until a successful remote run proves all four
targets. A later, separately authorized publish run must reuse that successful
run's immutable archive, match its reviewed SHA-256, find both commits on main,
and pass the unoccupied-version check. Configure npm Trusted Publishing for
this workflow before authorizing publish; neither a local pack nor a dry run
publishes the candidate.
See [Workers npm release guidance](docs/workers-npm-release.md) for the
reviewed-archive hash and Trusted Publisher requirements.

Cross-language validation is run from the Rust repository with this checkout
provided explicitly:

```sh
export LENSO_RUST_ROOT=/absolute/path/to/lenso
LENSO_JS_ROOT="$PWD" cargo test \
  --manifest-path "$LENSO_RUST_ROOT/Cargo.toml" \
  -p lenso-bun-adapter --features js-integration \
  --test bun_cross_runtime -- --ignored --test-threads=1
```

The workspace preserves the relevant histories from `LioRael/lenso-bun-adapter`
and `LioRael/lenso-cli`. The two protocol npm package sources were imported
from `LioRael/lenso-protocols` at `67adbc2ea6b250d9fdda9cc7289180391b41be89`.
`@lenso/workers-runtime` was imported with its package history from
`LioRael/lenso-runtime-rust` at `d7eb465baa2e668ed2378fa832aab1769965a3d9`.
Those older source repositories are migration sources, not the current
ownership boundary.
The two Workers transport packages were moved from the Rust-owned
`LioRael/lenso` source after the language ownership cutover; their Rust Plugin
counterparts remain there.
