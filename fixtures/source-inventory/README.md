# Same-package source inventory

Task card: make two lightweight Plugin declarations importable from one package,
and select `greeting` as two independent Instances without constructing `unused`.
SDK authoring, static extraction and target packaging belong to `lenso-js`.
Core owns declared-source expansion, Candidate conversion, App selection,
Instance defaults and the existing resolver. No Instance registry is added here.

`package.json` declares `lenso.sources: ["plugin.ts"]`. `plugin.ts` exports
`example.greeting` and `example.unused`; the latter throws if constructed.
`reexports.ts` proves aliases refer to the same declarations. The ordinary
`helper` export stays a language helper. The existing generated Profile Request
Capability supplies typed configuration and an optional `upstream` dependency.
Each Instance owns its call counter and decoded prefix.

From the locked workspace after building the SDK:

```sh
bun packages/lenso-bun-plugin/dist/extract.js --inventory fixtures/source-inventory plugin.ts
bun test packages/lenso-bun-plugin/test/inventory.test.ts
bun test packages/lenso-bun-plugin/test/v2.test.ts -t 'source-inventory selected'
bun fixtures/source-inventory/build.ts
python3 fixtures/source-first-request/run.py --root fixtures/source-inventory \
  --workerd /path/to/workerd --output /tmp/lenso-source-inventory.json
```

The Native case reuses the real authenticated Bun V2 harness, with two processes
running the selected named export and a Host-admitted dependency callback.
The Workers case imports the selected target bundle in real workerd, constructs
fresh Instances in each request event, exercises both typed calls, stops the
consumer and provider, and confirms process/port cleanup. This is JS Adapter
qualification through explicit Host routes; it does not claim Rust Plan/Kernel
execution on Workers. Core integration has its own owner and acceptance.

Local validation on 2026-10-05 used Bun 1.4.2 and workerd 2026-10-02:
the two counters/configurations/routes were independent, `unused` never
constructed, both workerd events succeeded, exit was 0, and the port closed.
Inventory rejects distinct duplicate IDs, missing/dynamic metadata, mutable
Plugin exports and source escape. Existing target tests preserve unsupported
Workers API rejection before module evaluation; this slice adds no interaction
admission beyond the existing Native Bun/Workers JS Request facts.

Publication task card: release only `@lenso/bun-plugin` with the next approved
version (proposed 0.4.4). `@lenso/contract-runtime` remains 0.3.2 and
`@lenso/process-protocol` remains 0.2.4. No registry publication, remote candidate
push, main landing, or deployment is authorized by this fixture. A local
candidate tgz is used for ordinary install/frozen-lock/typecheck/build proof;
published 0.4.3 has no inventory API. Core scaffolding must provide a clear SDK
upgrade diagnostic until the new cohort is published.
