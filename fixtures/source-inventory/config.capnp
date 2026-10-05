using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
  services = [(name = "main", worker = .main)],
  sockets = [(name = "http", address = "127.0.0.1:0", http = (), service = "main")]
);
const main :Workerd.Worker = (
  compatibilityDate = "2026-10-02",
  modules = [(name = "worker.mjs", esModule = embed "dist/worker.mjs")]
);
