# Same-source Request/Stream slice

`plugin.ts` is the only business Plugin source. It uses Plugin, configuration,
the generated Profile/Conversation Capabilities and an optional typed dependency.
Two differently configured instances run the same artifact. No author-written
Descriptor, codec, cleanup profile or transport message is required.

From the JS workspace, after `bun install --frozen-lockfile`:

```sh
bun run build
bun fixtures/source-first-stream/build.ts
bun test packages/lenso-bun-plugin/test/v2.test.ts
npm ci --ignore-scripts --prefix fixtures/source-first-request/tooling
python3 fixtures/source-first-stream/run.py \
  --workerd fixtures/source-first-request/tooling/node_modules/@cloudflare/workerd-linux-64/bin/workerd \
  --output /tmp/lenso-source-first-stream-workerd.json
```

The Native test starts two real Bun V2 processes and forwards authenticated
typed dependency calls between them. The Workers entry runs two event-owned
instances in real workerd. Both cover natural terminal, domain rejection and
cancel during a blocked receive. There is one pull per received message, no
prefetch; cancellation follows the typed dependency and waits for asynchronous
`finally` work on both instances. Late receive is cancelled rather than clean
EOF. Workers also checks bounded admission, overlapping receive, half-close
and rejection of stop while physical work remains. The harness records exact
source, artifact and binary hashes and verifies process/port cleanup.

`buildPluginTarget` chooses `native-bun` or `workers-js`. Its execution packaging
recognizes the current generated server-output Stream lowering and carries a
physical cleanup receipt through generated provider and typed client bindings.
The generated source and Descriptor digest remain unchanged. Unknown generated
lowering fails the build. Native-only APIs fail the Workers build before create;
there is no OS/Bun polyfill. The supported Workers slice is Request plus generated
server-output async iterable Stream. Event fails preparation before create.
Custom sessions need a truthful physical `closed` Promise; missing or failed
cleanup fences the generation, which the Host must abandon. This is not a claim
of complete Stream/API support or a replacement for Host deadlines and grants.

For the existing Core compiler, use the additive
`createPluginTargetBuildPlugin(target)` from `@lenso/bun-plugin/targets` as a
`Bun.build` plugin. Apply it to generated modules in the real compiler pipeline,
and preserve each normalized declaration's `streamLifecycleProfile` when
replacing its binder. The Workers execution interface is
`prepareWorkersPlugin(definition, { providedEndpoints, dependencies,
configuration, lifecycle, maxOpenStreams, maxStreamMessageBytes })`; dependency
routes add an exact Host-authorized `openStream` function to the existing Request
route. The adapter resolves no graph and changes no Kernel protocol.

These entries qualify the adapter with explicit Host routes. Full
`lenso app build` / admitted Plan / Rust Kernel integration belongs to the Core
assembly slice and is not proved by this fixture. Existing Rust Native and
linked/Wasm Workers paths remain unchanged. Package versions in this source
checkout have not been published; a registry application must use an authorized
immutable candidate bootstrap or wait for separately authorized publication.

The earlier Request fixture retains its measured baseline and business-edit
feedback observations; this Stream increment makes no whole-CI performance claim.
