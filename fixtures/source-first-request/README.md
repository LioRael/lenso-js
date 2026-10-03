# Same-source Request slice

One `plugin.ts` uses the existing source-first Plugin API, configuration and a
generated typed Capability dependency. It builds into a Native Bun V2 process
entry and a Workers JS definition. It does not manually author descriptors,
codecs, artifact identities or wire messages.

From the JS workspace:

```sh
bun install --frozen-lockfile
bun run build
bun fixtures/source-first-request/build.ts
bun test packages/lenso-bun-plugin/test/v2.test.ts
npm ci --ignore-scripts --prefix fixtures/source-first-request/tooling
python3 fixtures/source-first-request/run.py \
  --workerd fixtures/source-first-request/tooling/node_modules/@cloudflare/workerd-linux-64/bin/workerd \
  --output /tmp/lenso-source-first-workerd.json
```

Native proof starts two real Bun V2 processes from the same bundled artifact.
Its authenticated Host callback routes the consumer's generated Profile client
to the other real process. Workers proof runs the compiled definition in real
workerd 2026-10-02. Two instances have separate configuration and mutable state;
the consumer's typed optional dependency calls the provider. Two calls in each
event show independent instance counters; a second event shows fresh instances.
The Python harness validates results and process/port cleanup.

Use `@lenso/bun-plugin/authoring` for target-independent declarations. Existing
`@lenso/bun-plugin` and `@lenso/bun` imports retain their Native behavior.
`buildPluginTarget({ entrypoint, outfile, target })` from
`@lenso/bun-plugin/targets` accepts `native-bun` or `workers-js`.
The Native entry uses the existing `servePluginV2`; the Workers output exports
the definition for the JS Host. Build-time checks reject known Node/Bun imports,
Native globals and computed global access for Workers. They are conservative
admission diagnostics, not a security sandbox or a proof about arbitrary JS.
The compiler does not execute `create`.

`prepareWorkersRequestPlugin` from `@lenso/workers-runtime/plugin` is the
narrow internal JS execution interface. It receives the Host's exact admitted
endpoint set, validated configuration, resolved authorized dependency routes and
finite lifecycle context. It validates contract identity and cardinality before
`create`, constructs typed clients, binds the complete instance, and exposes
Request dispatch and stop. It retains physical request capacity after logical
cancellation and rejects stop until pending work settles. The Host owns
permissions, timers, generation abandonment and request-scoped resource cleanup;
this projection never resolves a graph or changes those policies.

This is a runnable adapter qualification App with explicit Host routes, **not
yet a `lenso app build --target workers` integration or Rust Kernel proof**.
Core assembly must connect this interface to its admitted Plan endpoints/routes,
invoke it in the owning Workers event/generation and own uncertain cleanup.
Existing linked Rust/Wasm Workers and Workers HTTP streaming stay unchanged.
`prepareWorkersRequestPlugin` deliberately retains **Request only** admission.
The additive `prepareWorkersPlugin` supports the explicitly bounded generated
server-output Stream slice in [the Stream fixture](../source-first-stream/README.md).
Event still fails before instance construction. Full Kernel-connected application
assembly remains a separate integration; no Bun process API is polyfilled into Workers.

Local baseline: JS `f0ea1bd4254dfecd68dbbe7a4c108e7ef81e3e2a`, Core inspected
at `20a2f5fe184c8e1f174d38348f837bc3ea008565`. This slice changes no Core files.
On this Linux cloud workspace with Bun 1.4.2, identical workspace typecheck
took 1.161 s before / 1.127 s after; affected Bun Plugin tests took 1.699 s
before / 2.006 s after (additional target and real two-process cases).
Building both fixture targets took 0.213 s; after editing the business literal
`hello` to `hello-edited`, rebuilding took 0.209 s and build plus a fresh real
workerd proof took 0.560 s. Both workerd runs passed; the edit was then reverted.
These single local observations show this slice's feedback cost, not an
estimated whole-CI speedup or a statistical performance claim.
