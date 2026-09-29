# Local Workers HTTP parity fixture

For the source candidate's isolated packed facility consumer and real-resource
receipt requirements, see [Facility consumer and infrastructure evidence](facility-resources.md).

This fixture joins the public `@lenso/workers-runtime` HTTP Host to the Rust
`lenso-workers-http-parity-host` fixture and the canonical Web Ingress corpus.
It is a local workerd target probe, not a deployment provider, production
budget, or proof that Workers streaming, WebSocket, or WASI components work.
Do not deploy this Worker: its `/_parity/*` diagnostic routes expose the corpus.

The `/_shared/*` test route also runs the same host-API-free Rust business
handler from `tests/fixtures/portable-http-endpoint/src/lib.rs` as the Native
loopback and Wasmtime Component tests. Its Workers implementation is a linked
factory compiled into this target-specific Host, **not** a Wasm Component Guest
running inside workerd. Run `shared-source-smoke.mjs` after the build and
local workerd start below. It compares the same success, binary, routing,
Domain Error and Runtime Failure vectors over raw loopback HTTP and checks
the Host readiness and clean shutdown receipts. This does not certify general
Workers Component support or alter the separate raw ingress parity result.

Use an explicit, clean, reviewed `LioRael/lenso` checkout containing
`tests/fixtures/workers-http-parity-host` and
`tests/fixtures/http-parity-plugin/corpus.json`. The integrated local Rust
candidate has not yet been target-qualified; set `LENSO_RUST_SHA` to the exact
reviewed commit of the Rust checkout used for this run.
Build the generated module with `@lenso/workers-runtime`'s locked Rust 1.94.0
and wasm-bindgen 0.2.127 toolchain, then bundle/run this Worker with an
externally provisioned, digest-recorded Wrangler/workerd cohort. The fixture
pins `compatibility_date` to `2026-07-01` for the available local workerd
`1.20260701.1`; this is a local runtime pairing, not production qualification.
Keep all builds, dependency installation, and target execution in the approved
isolated environment; no implicit `npx` download or host-side install is part
of this fixture.

Stage a writable copy of the reviewed JS workspace inside the sandbox scratch
area. Mount the Rust source and its Git worktree metadata read-only, including
both the checkout's `.git` pointer and the exact common `.git` directory at the
absolute path named by that pointer. The build and smoke scripts use this
metadata to verify the checkout's exact SHA and clean state. From the JS
scratch copy, with both variables set to the reviewed Rust checkout:

```sh
LENSO_RUST_ROOT=/absolute/path/to/reviewed/lenso \
LENSO_RUST_SHA=8ea03b356a58552bfcf3e70a8a9ec5b7253904e7 \
  node fixtures/workers-http-parity/build.mjs

"$WRANGLER" dev --local \
  --config fixtures/workers-http-parity/wrangler.jsonc \
  --ip 127.0.0.1 --port 63737
```

In the same isolation boundary, run:

```sh
LENSO_RUST_ROOT=/absolute/path/to/reviewed/lenso \
LENSO_RUST_SHA=8ea03b356a58552bfcf3e70a8a9ec5b7253904e7 \
  node fixtures/workers-http-parity/smoke.mjs
```

The build script writes the reviewed Rust SHA, Wasm digest, and generated
JavaScript digest into ignored `pkg/` provenance files. The smoke checks the
current Rust checkout, local generated files, and the running Worker's embedded
provenance before comparing the Wasm-embedded corpus bytes with the Rust source.
The fixture also uses a private Cargo target directory keyed by that SHA;
otherwise two worktrees sharing a target cache can incorrectly reuse old Wasm
while stamping it with the new source SHA.

The same Worker separately probes the Plan-bound `lenso.http.client@1` through
the Rust event Egress Plugin. Run `egress-smoke.mjs` against the local workerd
origin with `LENSO_RUST_SHA` set to the generated Wasm's reviewed source SHA.
It checks a binary response, exact-origin refusal before Fetch, cancellation
that aborts Fetch, and a healthy subsequent event. The upstream is an
event-local Fetch mock with an exact fixture origin: this proves the real
workerd JS/Rust/Kernel bridge and its policy handoff, not external networking,
DNS/TLS behavior, production network ACLs, or a portable Wasm Guest caller.
The original inbound parity smoke remains separate and can still fail on
repeated-header normalization.
It sends each vector through raw local HTTP, preserving repeated fields and
attempting TRACE, then through a separately constructed Worker `Request` and
the same Host. The raw network path must pass every vector. The synthetic
Request path reports API normalization as limited support, while its
representable vectors must pass. A `method-TRACE` constructor `TypeError` that
identifies TRACE as forbidden or unsupported is also limited support; other
constructor rejections still fail. A missing Host receipt or parity mismatch is
non-passing. The in-Worker route is a diagnostic, not a substitute for the
network path. No historical G2 result is inherited.

For vectors that assert repeated request-header values, the smoke also sends
the same raw header lines to a local Worker-ingress diagnostic route. A mismatch
is labeled `worker_request_headers_non_lossless` only when that route observes
the same values as the Endpoint; the report includes expected, Endpoint, and
Worker `Request` values. This label is a failure, not an exception to raw
network parity. Workers `Headers` combines repeated non-`Set-Cookie` values into
one comma-delimited value, so the original field-line boundary cannot be
recovered from a Worker `Request` alone.

The Host limits request/response bodies to 64 KiB, request head to 16 KiB,
body read to 250 ms, and runner event to 1,000 ms; the Rust bridge independently
sets a 500 ms ingress deadline and 200 ms shutdown. A failure at either layer
must be recorded, not silently downgraded to a supported target. The smoke also
requires a 65,537-byte request to fail with the Worker's exact transport 413
response, without a Host receipt, and a subsequent ordinary request to receive
a clean Host receipt.
