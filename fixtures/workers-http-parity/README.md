# Local Workers HTTP parity fixture

This fixture joins the public `@lenso/workers-runtime` HTTP Host to the Rust
`lenso-workers-http-parity-host` fixture and the canonical Web Ingress corpus.
It is a local workerd target probe, not a deployment provider, production
budget, or proof that Workers streaming, WebSocket, or WASI components work.
Do not deploy this Worker: its `/_parity/*` diagnostic routes expose the corpus.

Use an explicit, reviewed `LioRael/lenso` checkout containing
`tests/fixtures/workers-http-parity-host` and
`tests/fixtures/http-parity-plugin/corpus.json`. The current Rust fixture was
prepared at `29ece834` but has not yet been target-compiled. Build the generated
module with `@lenso/workers-runtime`'s locked Rust 1.94.0 and wasm-bindgen
0.2.127 toolchain, then bundle/run this Worker with an externally provisioned,
recorded Wrangler/workerd cohort. Keep all builds, dependency installation,
and target execution in the approved isolated environment; no implicit `npx`
download or host-side install is part of this fixture.

From the JS workspace root, with `LENSO_RUST_ROOT` set to that exact checkout:

```sh
node packages/lenso-workers-runtime/build.mjs \
  --manifest "$LENSO_RUST_ROOT/tests/fixtures/workers-http-parity-host/Cargo.toml" \
  --package lenso-workers-http-parity-host \
  --out-dir fixtures/workers-http-parity/pkg

"$WRANGLER" dev --local \
  --config fixtures/workers-http-parity/wrangler.jsonc \
  --ip 127.0.0.1 --port 63737
```

In the same isolation boundary, run:

```sh
LENSO_RUST_ROOT=/absolute/path/to/reviewed/lenso \
  node fixtures/workers-http-parity/smoke.mjs
```

The smoke refuses non-loopback origins and first requires the Wasm-embedded
corpus bytes to equal the Rust checkout's source corpus. It sends each vector
through raw local HTTP, preserving repeated fields and attempting TRACE, then
through a separately constructed Worker `Request` and the same Host. A missing
Host receipt, Request-constructor rejection, Request API normalization, and
parity mismatch are different non-passing results. The in-Worker route is a
diagnostic, not a substitute for the network path. No historical G2 result is
inherited by this fixture.

The Host limits request/response bodies to 64 KiB, request head to 16 KiB,
body read to 250 ms, and runner event to 1,000 ms; the Rust bridge independently
sets a 500 ms ingress deadline and 200 ms shutdown. A failure at either layer
must be recorded, not silently downgraded to a supported target. The smoke also
requires a 65,537-byte request to fail with 413 before Host admission and a
subsequent ordinary request to receive a clean Host receipt.
