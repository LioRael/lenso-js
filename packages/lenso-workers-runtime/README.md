# Lenso Workers Runtime

This JavaScript package is maintained in the Lenso JavaScript workspace. Its
source was imported with history from `LioRael/lenso-runtime-rust` at
`d7eb465baa2e668ed2378fa832aab1769965a3d9`; the Rust Workers Driver and
Host integration belong to `LioRael/lenso`.

This package owns event resources, generation admission and reset, and the
JavaScript timer domain used by the `lenso-workers-driver` Rust crate. It does
not resolve Plugins, grant network authority, authenticate, or authorize requests.
The buffered HTTP Host entry is available starting with version 0.1.2.

The `0.1.6` source candidate adds `./facilities` for the normal Rust static
Workers App profile, `lenso.linked-rust-workers@1`. The Rust CLI resolves and
compiles that graph; this JavaScript package owns event scopes and the Host
facade. The candidate is unpublished until a separate release completes.
Nonempty configuration, multiple typed Plugin Instances and named request Ports
are carried in the resolved Kernel Plan. It does not admit arbitrary execution
classes, streams/events, dynamic loading or cross-event Plugin memory.

### Source-owned event facilities

The generated Host supplies exact Instance/package identities, source-owned
factory functions, and explicit operator grants to
`createInstanceFacilityScope({ instances, grants, factories, env, limits })`.
Business Plugins receive the owner's typed Rust handle, never the full `env`.
Each JavaScript factory receives only `create(binding, scope, configuration)`.
It must return its private adapter synchronously; that adapter starts asynchronous
I/O through `scope.run` or `scope.operation`. SQL, credentials, identity policy
and owner configuration schemas stay in the owner repository.

```js
import { createInstanceFacilityScope } from "@lenso/workers-runtime";
import { create as createState } from "./owner-state.mjs";

const createScope = (_request, env) => createInstanceFacilityScope({
  instances: [{ instanceKey: "example.state/primary", packageId: "example.state" }],
  factories: [{ packageId: "example.state", slot: "state", create: createState }],
  grants: {
    schema: "lenso.host-facilities.v1",
    instances: {
      "example.state/primary": {
        state: { binding: "PRIMARY_DB", configuration: { profile: "owner-profile" } },
      },
    },
  },
  env,
  limits: { cleanupTimeoutMs: 1000, maxOperations: 128 },
});
```

The table matches exact identities and slot names before running a factory.
Unknown Instances, slots, override fields, inherited environment properties and
missing bindings fail closed. Owner configuration is copied and frozen. Two
same-package Instances and multiple resource types are independent of table
order. An explicit `binding: null` passes `undefined`; the owner decides whether
that profile supplies an optional cache or a declared simulated backend. A
simulated backend is not real DB qualification.

The internal `facility(scope, instanceKey, slot)` entry is used by generated
Host glue to construct one private adapter per event lease. Closed scopes cannot
construct adapters or start I/O. Late results cannot enter a replacement
generation. Cleanup uncertainty is preserved and never causes automatic replay
of a write. A Rust Plugin's memory is reconstructed on every HTTP event; durable
state belongs to the selected owner backend.

Run `node fixtures/workers-http-parity/packed-facilities.mjs /tmp/receipt.json`
from this repository for an isolated packed-consumer proof. Its stand-in tests
cover scope/identity/explicit-none boundaries, not real PG or D1. Owner fixtures
record real driver, binding identities, compatibility date, migration state,
query-cache mode and exact artifacts separately. Remote Hyperdrive acceptance
is deferred for this candidate and must be recorded as `not_run`.

The candidate `./component-requests` entry admits one already-selected
`lenso.wasm-component@1` Instance from a V4 Plan for the request-only
`lenso.json-request@1` Guest ABI. It compares the Guest's ready descriptor with
the Plan before handling requests, requires an import-free precompiled core
module, and instantiates a fresh Guest for each invocation. It rejects other
Instances, Capability bindings, Plan-declared Host imports, core Wasm imports,
Stream/Event endpoints, WebSocket
requirements, custom admission and Kernel supervision instead of falling back
to Native. The [local workerd fixture](../../fixtures/workers-component-guest/README.md)
uses this entry.

For authoring V2, the Host must pass `expectedDescriptorDigests`, an exact map
from each Plan-provided Capability ID to a trusted `sha256:` Descriptor digest.
The Guest's `describe` result must contain the same `descriptor_digest` for
every Capability. Missing, extra, malformed, or mismatched digests fail before
request admission. Authoring V1 retains its legacy no-digest Guest shape and
rejects a digest map; neither mode derives trust from the Guest's self-report.

This entry does not validate a signed package or Component WIT metadata,
generate a Plan, run the Kernel,
provide HTTP routing or Auth policy, enforce Guest memory/turn limits, or build
a Workers distribution. Its caller must supply the exact verified artifact and
resolved Plan from its own Host authority. The public `app build/prepare`
Workers Component targets remain independently gated; this entry alone is a bounded
Adapter primitive, not an App builder or deployment qualification. The Rust
local Bundle-only App target is a separate candidate and must supply the
trusted digest map for V2.

The `./knowledge-settings-local` entry is a separate, exact-identity-gated
adapter for the reference Knowledge Base's `GET/PUT /settings` slice in a
local workerd qualification. It requires the private
`lenso:knowledge-settings-local@1.0.0/plugin` world, selected
`lenso.reference.knowledge-settings/default` Plan Instance, a locally verified
Artifact digest matching the Plan, and the pinned HTTP Endpoint Descriptor.
Its Guest has four exact exports (`describe`, `invoke`, `prepareSettings`,
`completeSettings`) and no imports. The ordinary `./component-requests` entry
still admits only the canonical two-export Guest.

The local adapter's `handle(request)` accepts only `GET` and `PUT` at
`/settings`. A caller must pass an explicit loopback `bridgeOrigin`, its own
`fetchBridge` function, and a bounded `bridgeTimeoutMs` (default 1000 ms). The
deadline covers the request body and bridge response as one wall-clock budget.
The adapter sends the incoming Bearer credential only to the local Host bridge,
not to the Guest; the Guest validates a bounded settings command and maps the
Host-validated result to an HTTP Endpoint response. The bridge performs one
bounded read or CAS request with no redirect, fallback, or automatic write
retry. The Host sidecar still owns bearer-to-user policy, PostgreSQL
transactions, and verification of the signed Bundle and copied Artifact
bytes. This entry does not provide generic Component storage imports or
production Workers database support.

Use `lenso-workers-build --manifest Cargo.toml --package my-host --out-dir pkg`
to build a consumer Host with its locked dependency graph. It requires Rust
1.94.0, `wasm32-unknown-unknown`, and wasm-bindgen CLI 0.2.127. `CARGO` and
`WASM_BINDGEN` may select executable paths. No sibling repository layout is
required. The generated module imports `@lenso/workers-runtime/clock`; the Host
must give its runner `clearTimers` from that same module. Use one runner per
generated module/timer domain. Multiple independent Wasm modules require separate
timer domains and are not supported by the shared default clock export.

For a buffered HTTP Host, use the high-level entry with the generated module
namespace and its Wasm module. The scope factory is the explicit composition
seam for Plugin and resource bindings and receives Cloudflare's request, env,
and execution context for every request:

```js
import * as bindings from "./pkg/my_host.js";
import wasmModule from "./pkg/my_host_bg.wasm";
import {
  createEventScope,
  createWorkersHttpHost,
} from "@lenso/workers-runtime";

import { bindStorage } from "./storage.mjs";

const host = createWorkersHttpHost({
  bindings,
  wasmModule,
  limits: {
    eventLimitMs: 1000,
    maxRequestBodyBytes: 64 * 1024,
    maxResponseBodyBytes: 64 * 1024,
  },
  createScope(request, env) {
    // bindStorage is the storage owner's adapter: it tracks I/O in this scope.
    return createEventScope(scope => ({
      storage: bindStorage(env.DB, scope),
    }));
  },
  onReceipt(result, response, request, env, ctx) {
    response.headers.set("x-host-generation", String(result.generation));
  },
});

export default { fetch: host.fetch };
```

The entry wires `initSync({ module: wasmModule })`, reset-state support, Wasm
constructors, and the package timer domain. It returns `{ fetch }`. `limits`
accepts flat runner,
buffered HTTP, and default-scope fields; unknown limit names are rejected.
`onReceipt` also receives the request, env, and execution context. Existing `createEventRunner`,
`createEventScope`, and `createHttpHandler` integrations remain available for
streaming or other Hosts that need lower-level assembly.

```js
import { createEventScope, createEventRunner } from '@lenso/workers-runtime';
import { clearTimers } from '@lenso/workers-runtime/clock';
const runner = createEventRunner({
  instantiate: () => initSync({ module }), resetState: __wbg_reset_state, clearTimers,
});
// Inside this request's owner context, never at module scope:
const scope = createEventScope(scope => ({
  batch: input => scope.run(() => database.batch(prepare(input)), JSON.stringify),
}));
const result = await runner.run(() => invoke(input, scope), { scope, signal: request.signal });
```

An adapter uses `scope.operation(() => ({ promise, abort }))` for abortable work,
`scope.run(start, project)` for unabortable work, and `scope.trackNative(promise)`
for native reads/cancellation spawned by that operation. Native adapters must
bound this work; `trackNative` is not an application admission API. Projection
functions must be JavaScript-only and must not capture Wasm callbacks. The scope
admits at most 128 simultaneous operations by default, rejects new operations on
close, fences stale promise delivery synchronously, and drains native cleanup
including work registered by a late completion. Cleanup has one total 250 ms
budget by default. An uncertain result remains uncertain on repeated settlement;
no retry, rollback, or exactly-once mutation guarantee is implied.

`runner.run` accepts a serialized JSON terminal receipt. `runner.open` accepts
an operation resolving `{ value, closed }`: `value` contains response/session
metadata, while `closed` resolves to `{ shutdown: 'clean' }` only after the body
and App have shut down. It returns `{ value, generation, invoke, cancel, closed }`.
The Host must observe `closed`; failure after headers is a failed stream, not a
replacement HTTP success. Route every subsequent Wasm entry through
`session.invoke(() => ...)`. Do not call old Wasm destructors after abandonment.
`cancel()` signals the event scope; it does not fabricate a terminal receipt.
A cancellation must settle within `cancellationLimitMs` (default 1 s), after
which the generation is abandoned.

Headers keep the original event startup deadline (default 1 s). After opening,
the session has `sessionLimitMs` (default 5 min). Generation retirement waits for
all admitted sessions. A trap or deadline abandons the entire generation,
synchronously fences all admitted scopes, and rejects their owners; native
cleanup runs only in each owner's continuation. These are shared-instance failure
semantics, not independent per-session isolation. WebSocket hibernation is not
provided by this event runtime.

The buffered HTTP compatibility bridge is exported from `./http`. New Host
integrations should create one immutable `createEventScope` for all D1, Fetch and
cancellation bindings. `createCancellationScope` preserves legacy mutable Host
composition only; it is not the preferred API.

The buffered and streaming HTTP helpers receive Fetch-normalized
`Request.headers`. Workers combines repeated non-`Set-Cookie` request fields,
so neither helper can recover their original field-line boundaries; `getAll()`
only supports `Set-Cookie` ([Cloudflare Headers API](https://developers.cloudflare.com/workers/runtime-apis/headers/)).
Endpoints that require those boundaries are unsupported on this target. A local
workerd run of the [30-vector HTTP fixture](../../fixtures/workers-http-parity/README.md)
passed 29 raw-network vectors; `repeated-headers` failed. The gate still
requires 30/30. This result does not establish raw HTTP parity, deployed
Workers qualification, or production readiness.

Run `npm test` for focused resource, HTTP, and session boundary checks. Actual
Workers deployment and each Plugin's own conformance remain separate evidence.

`createStreamingHttpHandler` consumes an `openHttp` adapter returning
`{ value: { status, headers, read }, closed }`. Each `read()` yields one
`Uint8Array` or `null`; the adapter must finish App shutdown for `closed` before
clean EOF. Reads begin only on consumer demand, copy the current Wasm memory
view, and enforce per-chunk and total byte limits. Disconnect cancels the lease;
a failed generation errors an outstanding body read. Historical Rust/Wasm
duplex fixture receipts remain in the source repository at
`experiments/workers-g2/evidence/duplex.json`; this package migration does not
requalify a Workers target. Supply Web's
`createWebSocketTransport()` through `upgradeWebSocket` for authorized status-101
responses. Web owns that transport and its Capability, not Runtime.

When supplying `createScope`, configure its cleanup and operation limits in that
factory. Passing scope limits to the Host at the same time is rejected, so a
custom factory cannot silently ignore a Host limit.

The default event deadline is 1000 ms and default native cleanup budget is
250 ms. Configure explicit budgets for observed infrastructure latency. The
source Rust build's `--workers-host-limits` profile writes the selected limits
into its build receipt and routes scope limits to its generated scope factory.
Extending a budget does not prove side-effect rollback or CPU preemption.
