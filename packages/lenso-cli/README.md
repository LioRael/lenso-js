# `@lenso/cli`

The JavaScript launcher and TypeScript Host authoring surface for the native
Lenso CLI. The Rust CLI implementation lives in the
[`LioRael/lenso`](https://github.com/LioRael/lenso) workspace; this package
contains only the Node.js-facing launcher, static Host declaration extractor,
and process ownership bridge.

```bash
npm install -g @lenso/cli
```

The published package includes a platform-specific native `lenso` executable.
Source builds of that executable are produced and validated in the Rust
workspace before release packaging. Each new version must pass the four-target
[CLI release gate](https://github.com/LioRael/lenso-js/blob/main/.github/workflows/release-cli-npm.yml)
before it is independently consumable from npm.

## Official Marketplace adoption

```bash
lenso app add PLUGIN_ID@VERSION --marketplace
```

The CLI checks the official current catalog at `marketplace.lenso.dev`, verifies
its publishing provenance, and checks the selected release status and exact
artifact before changing your App. First use downloads an independently pinned
official verifier into a private local cache. You do not create signing keys,
log in to GitHub, or renew catalog signatures. New adoption needs an online
current catalog; existing locked Apps do not need it to keep running.

The npm package supports this keyless adoption path on macOS ARM64/x64 and
Linux GNU x64. Windows keyless adoption is not supported in this release.
The Windows launcher still supports ordinary CLI commands; it does not fall
back to unverified Marketplace adoption.

Source-content adoption may also need `--content-id` and
`--content-destination`. Review downloaded source before selecting or running
it. Catalog provenance does not establish source safety or Host compatibility.
