# npm releases

The JavaScript workspace owns the release path for `@lenso/workers-runtime`,
`@lenso/http-egress-workers`, and `@lenso/web-ingress-workers`, alongside the
other selectable SDK packages in `release-npm.yml`. The Rust Plugin crates stay
in `LioRael/lenso` and are published separately.

Run `release-npm.yml` on `main` with the reviewed package choice, exact manifest
version, full landed source SHA, and `mode=dry-run` first. The verification job
tests the workspace, packs one npm archive, and reports its SHA-256. Review that
source commit and successful run. For publication, dispatch the same source SHA
and version with `mode=publish`, `publish_confirmation=publish`, and the exact
dry-run hash in `reviewed_archive_sha256`. The publication run re-packs the
source and fails if its archive differs from the reviewed bytes; a changed source
SHA requires another dry run. It publishes the verified archive, not a rebuilt
package directory.

Only the publication job has npm OIDC permission, and no token fallback is
configured. Publication consumes the archive with lifecycle scripts disabled;
source-controlled build hooks run only in the verification job without OIDC.
For each selected npm package, configure its Trusted Publisher for
repository `LioRael/lenso-js`, workflow `release-npm.yml`, and no environment.
Explicitly enable direct `npm publish`: newly configured Trusted Publishers may
allow staged publishing only, but this workflow does not call
`npm stage publish`. Packages previously linked to a different repository or
workflow need an npm owner to change that Trusted Publisher before publication.
For a package name not yet allocated on npm, an owner-authorized interactive
bootstrap is needed before Trusted Publishing; do not add a long-lived token to
this repository.

Versions are explicit in each package manifest. Never overwrite or reuse a
published version. Publish a compatible Runtime before Web Ingress when their
versions change together. Verify registry version, integrity, and provenance
after publication. Workflow success alone does not establish consumer adoption;
consumer lockfiles and Workers deployment are separate reviewed changes.
