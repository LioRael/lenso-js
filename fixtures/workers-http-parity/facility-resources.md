# Facility consumer and infrastructure evidence

The packed fixture tests the public event-facility API without source imports:

```sh
node fixtures/workers-http-parity/packed-facilities.mjs /tmp/packed-facilities.json
```

It installs the runtime tarball into a fresh directory with its own npm cache.
The receipt records its integrity, SHA-256, Node version and result. Its four
vectors cover two same-package Instances, independent events, named resource
selection, explicit no-cache, cancellation fencing and an uncertain late write
without replay. Binding objects are stand-ins; this fixture claims no database
driver or deployed infrastructure acceptance.

For real resources, use the owning Plugin's SQL and private `create` adapter in
a normal source App. Build with the paired Rust candidate's `app build --target
workers --wasm-bindgen PATH --workers-runtime PATH --workers-facilities PATH
--workers-host-limits PATH`. Run that artifact first with local workerd and then
in an authorized test Worker. Keep operator schema setup separate from startup.
No business SQL or migrations belong in this fixture or the language runtime.

Each owner's receipt must identify:

| Evidence | Required content |
| --- | --- |
| Sources and artifacts | Exact Rust/JS/owner Git SHAs, runtime tarball integrity, build receipt and Worker version |
| Environment | Native/local workerd/deployed Workers, actual driver and tool versions, compatibility date |
| Infrastructure | Real DB versus stand-in, safe binding name, physical resource identity and authorized schema/namespace |
| PG connection | Direct PG or Hyperdrive path, concrete PG driver, query cache configuration |
| Schema | Operator setup receipt/version, readiness check; no startup migration |
| Semantics | Read, stale CAS, idempotent replay, changed-intent conflict, restart persistence and concurrent outcomes |
| Event boundary | Exact deadlines, cancellation/cleanup result, uncertain operation ID and reconciliation result |

Use different explicit binding names for two DBs of the same type; do not select
them by array order. One event may own independent D1 and PG adapters, or two
authorized schemas on one PG. Pass only selected bindings and non-sensitive
owner configuration to each adapter. Credentials come from secure operator
injection; do not include connection strings, keys or environment values in
receipts, logs or URL parameters.

Authoritative PG reads through Hyperdrive require a separately configured,
cache-disabled test binding. Record that configuration rather than using SQL
comments to evade a cache. Setup/upgrade uses a direct or explicitly supported
management connection. Remote Hyperdrive acceptance is deferred for this
candidate: record `not_run`. Native PG and real D1 receipts remain separate
qualification rows and do not imply Hyperdrive support.

After an unconfirmed write, inspect the owner receipt/state using a distinct
read; do not resend the write. Preserve `unknown` until the owner can reconcile
it. A timeout, disconnect or clean new generation does not demonstrate rollback.
