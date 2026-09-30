# Managed facilities npm candidates

This preparation selects `@lenso/cli@0.17.5` and
`@lenso/workers-runtime@0.1.6`. Neither version is published by committing or
landing this change. The public registry was read on 2026-09-30: its latest CLI
was `0.17.4`, its latest Workers runtime was `0.1.5`, and both candidate versions
were unoccupied. Each publish job checks occupancy again.

The CLI archive must contain native `lenso 0.6.5` binaries built from exact Rust
source `cac6db9d3293197754cce0ec707e909e0bed79a6`. Its Rust managed-facilities SDK
release set and normalized Cargo archive validation belong to `LioRael/lenso`;
an npm launcher release does not publish those crates. The Workers runtime's
files are unchanged from qualified source
`18e3cfb2837c8dfe5d5b907e39fe95ae15dc0a65` through this preparation's JavaScript
base `04a40669c46356323f0bad65cedd2752b046e52b`. Consumer and deployment receipts
keep their original exact source revisions.

After recording this preparation's full JavaScript commit, run
`release-cli-npm.yml` at that commit with `mode=dry-run`, the exact JavaScript
and Rust source SHAs, and `version=0.17.5`. The existing gate builds and runs
Darwin ARM64, Darwin x64, Linux GNU x64, and Windows x64 binaries, assembles one
npm archive, and installs that same archive on all four runners. Retain its run
ID, archive SHA-256, platform receipts, and immutable artifact manifest. A local
single-platform binary does not replace this gate.

The runtime uses its separate `release-npm.yml` gate on `main`, with the landed
JavaScript source SHA, `package=lenso-workers-runtime`, `version=0.1.6`, and
`mode=dry-run`. Retain that archive hash and the isolated packed-facility proof.
Only a separately authorized publish run may use `mode=publish` and the reviewed
archive digest. The CLI publication consumes the reviewed dry-run archive;
runtime publication verifies the repacked source against its reviewed hash.
After publication, check registry tarball integrity and provenance separately
from workflow success and App qualification.
