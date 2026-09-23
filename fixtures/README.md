# Protocol conformance vector mirrors

The JSON files under `portable-contract/`, `process-protocol/`, and
`execution-target-capability-profile/` are byte-for-byte mirrors of the
canonical files in `LioRael/lenso/spec/fixtures/`. They let the npm packages
run their own tests without a sibling checkout. They are not maintained
protocol sources or generated TypeScript bindings.

After a protocol change, copy the three files from an explicit Lenso Rust
checkout and run `LENSO_RUST_ROOT=/absolute/path/to/lenso bun run fixtures:check`.
The check rejects a missing or divergent mirror. Cross-language runtime tests
use the same explicit Rust checkout independently.
