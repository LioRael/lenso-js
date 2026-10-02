# J1 cleanup qualification in real workerd

This focused fixture loads the checked-out production Workers Host, HTTP,
runner, scope and clock modules directly into workerd. Six bounded requests
cover successful operation completion, ordinary operation rejection, explicit
scope cancellation with resolving/rejecting asynchronous cleanup, and the two
corresponding Host finalizer outcomes. A cleanup rejection must make settlement
unclean and suppress a successful HTTP response and receipt. Cleanup success
must preserve the response and receipt. Cancellation is explicit scope abort
or Host finalization, not a claim about a disconnected remote HTTP client.

The Host's generated wasm-bindgen facade is a minimal JavaScript fixture with
a real WebAssembly.Memory. No compiled Guest/component or Jco App is involved.
This qualifies J1 inside real workerd, not a full application, deployed Workers,
Relay, D1, external services, performance, or broader stream lifecycle behavior.

Install official `workerd@1.20260926.1` in a separate task-owned tools directory,
retaining its package-lock.json. Pass its Linux x64 binary explicitly:

```sh
python3 fixtures/workerd-j1-cleanup/run.py \
  --workerd /absolute/tools/node_modules/@cloudflare/workerd-linux-64/bin/workerd \
  --output /absolute/new-evidence-directory
```

The harness uses a pre-opened loopback socket, makes six sequential fixture
requests, and terminates/reaps its own server with SIGTERM. It records binary
and source hashes, raw observations, actual exit codes and PID/port cleanup.
Exit 0 means all fixed invariants passed; exit 1 means a regression was observed;
exit 2 means a harness/startup/cleanup failure. It never installs software.

For the red control, restore only production `scope.mjs` from
`e772986cf433a6c7ce62652f0c10ca9cc8e38654` in a separate worktree, keeping this
fixture and every other Runtime module identical. Exactly `scope/abort-reject`
and `host/abort-reject` should fail. Fixed production base:
`4c97f9a890ee7e10112f8df0fe09811be3c551a1`. No production change is needed.
