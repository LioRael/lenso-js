# @lenso/bun

The supported Bun authoring SDK for Lenso Plugins. It combines the Bun Plugin
runtime with generated projections of official portable Capability contracts.
Capability semantics remain in their owning repositories; this package owns
their directly consumable Bun projection. `capabilities.lock.json` pins every
source repository revision and the checked Descriptor/Schema snapshot used to
reproduce it.

```ts
import { definePlugin } from "@lenso/bun";
import { bindJobsProvider } from "@lenso/bun/capabilities/jobs";
import { jobs } from "./jobs.ts"; // Implements JobsProvider.

export default definePlugin({ providers: [bindJobsProvider(jobs)] });
```

The generated Plugin entrypoint starts the runtime. Author code does not call
`serve` or depend on its transport contract.

Run `bun run capabilities:check` with `lenso-contract-codegen` on `PATH` to
verify all locked projections. Maintainers use `bun run capabilities:sync`
after advancing an immutable source revision. Custom Capability projections
remain an authoring-time code-generation path in the Bun package that owns
them.

This authoring SDK executes in Bun. Portable Capability schemas and use of Web
APIs do not make a Bun Plugin executable in Workers. The Rust static Workers
profile uses compiled Rust Plugin implementations and `@lenso/workers-runtime`;
it does not embed Bun. A TypeScript/Guest Workers implementation needs its own
supported compiler, Adapter and real target qualification before it is admitted.
