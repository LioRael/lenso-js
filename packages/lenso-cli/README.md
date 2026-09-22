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
workspace before release packaging.
