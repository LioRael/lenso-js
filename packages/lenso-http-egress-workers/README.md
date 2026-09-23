# Workers HTTP egress transport

`@lenso/http-egress-workers` supplies event-owned Fetch transport for the Rust
HTTP Egress Plugin. `createEventHttpFetch` accepts the current event's `fetch`,
`setTimeout`, and `clearTimeout`; pass the returned function to the Rust
`HttpEgressEventFactory::from_js` bridge. The Rust Plugin validates requests and
owns authorization. This package does not grant network authority.

`createScopedHttpFetch` additionally binds Fetch and native response reads to
the `@lenso/workers-runtime` event scope. Do not retain its returned transport
between events. Redirects are returned without following them, and the
validated request's body, header, and timeout limits are enforced at the Fetch
boundary.

The source and tests are maintained in `LioRael/lenso-js`. The corresponding
Rust Plugin remains in `LioRael/lenso`.
