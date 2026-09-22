# Agent instructions

This repository owns the JavaScript and TypeScript authoring surface for
Lenso. Rust framework, Host, Adapter, and protocol implementations belong in
`LioRael/lenso`; product Capability semantics remain with their owning Apps.

Keep cross-language fixtures here and verify them against an explicit Lenso
Rust checkout; the Rust test command receives this checkout through
`LENSO_JS_ROOT`. Use Conventional Commits and the locked Bun workspace checks.
