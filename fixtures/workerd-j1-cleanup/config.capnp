using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [(name = "main", worker = .main)],
  sockets = [(name = "http", address = "127.0.0.1:0", http = (), service = "main")]
);

const main :Workerd.Worker = (
  compatibilityDate = "2026-09-26",
  modules = [
    (name = "worker.mjs", esModule = embed "worker.mjs"),
    (name = "runtime/host.mjs", esModule = embed "../../packages/lenso-workers-runtime/host.mjs"),
    (name = "runtime/http.mjs", esModule = embed "../../packages/lenso-workers-runtime/http.mjs"),
    (name = "runtime/runner.mjs", esModule = embed "../../packages/lenso-workers-runtime/runner.mjs"),
    (name = "runtime/scope.mjs", esModule = embed "../../packages/lenso-workers-runtime/scope.mjs"),
    (name = "runtime/clock.mjs", esModule = embed "../../packages/lenso-workers-runtime/clock.mjs")
  ]
);
