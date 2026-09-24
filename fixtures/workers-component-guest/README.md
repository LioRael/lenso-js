# Local Workers Portable HTTP Component Guest probe

This unpublished fixture executes the same `portable-http-endpoint/guest` Rust
source used by the Native Wasmtime Component test. The build compiles its core
Wasm, wraps it as a WIT Component, then uses pinned Jco 1.35.0 to transpile
that Component to a precompiled core Wasm module and JS bindings that workerd
can load. It does **not** load a Component directly in workerd. The generated
files stay under ignored `pkg/` and are not a published Plugin artifact.

Use a reviewed, clean Lenso Rust checkout and set `LENSO_RUST_ROOT` and its
full `LENSO_RUST_SHA`. Provide `JCO` as an absolute path to the local Jco
1.35.0 executable. The build requires the repository's Rust toolchain with
`wasm32-unknown-unknown` installed, and locked Cargo dependencies. In the
approved isolated environment:

```sh
node fixtures/workers-component-guest/build.mjs
wrangler dev --local --config fixtures/workers-component-guest/wrangler.jsonc --ip 127.0.0.1 --port 63739
node fixtures/workers-component-guest/smoke.mjs
```

For a bounded run that starts and stops its own local server, set
`WRANGLER_JS` to the pinned Wrangler entrypoint and run
`node fixtures/workers-component-guest/run-local.mjs` instead of the final
two commands. A network-disabled Linux container may use this entrypoint
with the reviewed source and generated `pkg/` mounted read-only. If that
runtime-only container omits Git, set `LENSO_RUNTIME_ONLY=1` there; the build
must already have validated the clean Rust checkout on the host, and smoke
still checks the exact SHA and both source-file digests against build metadata.
Create the empty, ignored `fixtures/workers-component-guest/.wrangler/`
directory before a read-only bind mount, then mount a tmpfs over it so Wrangler
cannot write generated files into the source checkout.

The smoke checks the reviewed Rust SHA, generated Component/core/JS digests,
the running Worker's embedded build identity, a request-only V4 Plan admission
marker, and ten raw-loopback HTTP vectors. The Worker supplies a fixture-authored
Plan projection to `@lenso/workers-runtime/component-requests`; the package
checks the selected Component and Guest descriptor before readiness and rejects
Plan-declared Host imports, core Wasm imports, unsupported interactions,
dependencies, and execution classes. This
is not a Host-generated, signed-package-derived Plan or a Kernel Execution
Adapter. The public Host build still rejects Workers/wasm targets. This probe
does not implement full header/auth propagation (only one `x-test` field and
bearer scheme are probed), request deadline/cancellation, stream/WebSocket,
Guest egress, or a persistent App's target switch. Its diagnostic build route
is test-only; never deploy this Worker. The separate raw ingress corpus's
repeated-header failure remains non-passing.
