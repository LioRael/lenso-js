import { createEventScope } from "./runtime/scope.mjs";
import { createWorkersHttpHost } from "./runtime/host.mjs";

const delay = () => new Promise((resolve) => setTimeout(resolve, 5));
const observe = (promise) => promise.then(
  (value) => ({ kind: "fulfilled", value }),
  (error) => ({ kind: "rejected", error: error.message }),
);

function pendingResource(scope, rejectCleanup, trace) {
  let complete;
  const state = { abortCalls: 0, cleanupFinished: false };
  const operation = scope.operation(() => ({
    promise: new Promise((resolve) => { complete = resolve; }),
    async abort() {
      state.abortCalls++;
      trace.push("abort");
      complete("cancelled-native");
      // Real request-owned workerd timer; rejection occurs after an async turn.
      await delay();
      state.cleanupFinished = true;
      trace.push(rejectCleanup ? "cleanup-rejected" : "cleanup-resolved");
      if (rejectCleanup) throw new Error("native cleanup rejected");
    },
  }));
  return { state, operation, outcome: observe(operation.promise) };
}

async function scopeCase(mode) {
  const scope = createEventScope();
  const trace = [];
  let abortCalls = 0, cleanupFinished = true, cancellationCallbacks = 0;
  let outcome;
  if (mode.startsWith("abort-")) {
    scope.attach(() => { cancellationCallbacks++; });
    const resource = pendingResource(scope, mode === "abort-reject", trace);
    scope.abort();
    scope.abort();
    resource.operation.abort();
    outcome = await resource.outcome;
    const settlement = scope.settled();
    const cachedSettlement = settlement === scope.settled();
    const clean = await settlement;
    ({ abortCalls, cleanupFinished } = resource.state);
    trace.push("settled");
    const admission = await observe(scope.run(() => Promise.resolve("unexpected")));
    return { mode, outcome, abortCalls, cleanupFinished, cancellationCallbacks,
      clean, cachedSettlement, closed: scope.closed, invalidated: scope.invalidated,
      admission, trace };
  }
  const operation = scope.operation(() => ({
    promise: mode === "complete" ? Promise.resolve(41) : Promise.reject(new Error("domain rejection")),
    abort() { abortCalls++; },
  }), (value) => value + 1);
  outcome = await observe(operation.promise);
  scope.abort();
  const settlement = scope.settled();
  const cachedSettlement = settlement === scope.settled();
  const clean = await settlement;
  const admission = await observe(scope.run(() => Promise.resolve("unexpected")));
  return { mode, outcome, abortCalls, cleanupFinished, cancellationCallbacks,
    clean, cachedSettlement, closed: scope.closed, invalidated: scope.invalidated,
    admission, trace };
}

async function hostCase(request, env, ctx, mode) {
  const trace = [], receipts = [];
  let scope, resource;
  // Only the generated wasm-bindgen facade is a minimal fixture. All Host,
  // HTTP, runner, scope and timer-domain modules come directly from production.
  // This is not a compiled Guest, Jco App or deployed Workers qualification.
  const bindings = {
    initSync() {
      return { memory: new WebAssembly.Memory({ initial: 1 }), __wasm_call_ctors() {} };
    },
    __wbg_reset_state() {},
    handle_http() {
      trace.push("app-complete");
      return JSON.stringify({ status: 200, headers: [], body: [111, 107], shutdown: "clean" });
    },
  };
  const host = createWorkersHttpHost({
    bindings,
    wasmModule: {},
    createScope() {
      scope = createEventScope();
      resource = pendingResource(scope, mode === "abort-reject", trace);
      return scope;
    },
    onReceipt(receipt) { receipts.push(receipt); trace.push("receipt"); },
  });
  const response = await host.fetch(request, env, ctx);
  trace.push("host-return");
  const body = await response.text();
  return Response.json({ mode, status: response.status, body,
    receipts: receipts.length, ...resource.state, outcome: await resource.outcome,
    clean: await scope.settled(), closed: scope.closed, invalidated: scope.invalidated,
    trace }, { status: response.status });
}

export default {
  async fetch(request, env, ctx) {
    const { pathname, searchParams } = new URL(request.url);
    if (pathname === "/health") return new Response("ready");
    const mode = searchParams.get("case");
    if (pathname === "/scope" && ["complete", "domain-reject", "abort-resolve", "abort-reject"].includes(mode)) {
      return Response.json(await scopeCase(mode));
    }
    if (pathname === "/host" && ["abort-resolve", "abort-reject"].includes(mode)) {
      return hostCase(request, env, ctx, mode);
    }
    return new Response("unknown fixture case", { status: 404 });
  },
};
