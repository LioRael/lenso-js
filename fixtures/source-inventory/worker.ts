import definition from "./dist/plugin.mjs";
import { prepareWorkersRequestPlugin } from "../../packages/lenso-workers-runtime/plugin.mjs";

const capability = definition.providers[0].descriptor;
const lifecycle = (request) => {
  const deadline = Date.now() + 1000;
  return {
    requestId: "1",
    get cancelled() { return request.signal.aborted; },
    signal: request.signal,
    remainingTimeoutMs: () => Math.max(0, deadline - Date.now()),
  };
};

// Explicit adapter qualification consumer, not a replacement Kernel/Plan.
// Every event owns both instances; no cross-event I/O or generation caching.
export default {
  async fetch(request) {
    if (new URL(request.url).pathname === "/health") return new Response("ready");
    const context = lifecycle(request);
    const provider = await prepareWorkersRequestPlugin(definition, {
      providedEndpoints: [capability], configuration: { prefix: "provider-a" },
      dependencies: { upstream: [] }, lifecycle: context,
    });
    let consumer;
    try {
      consumer = await prepareWorkersRequestPlugin(definition, {
        providedEndpoints: [capability], configuration: { prefix: "consumer-b" },
        dependencies: { upstream: [{
          providerInstance: "provider-a", descriptor: capability,
          invokeRequest: (operation, call, payload) => provider.invokeRequest(capability.capability_id, operation, call, payload),
        }] },
        lifecycle: context,
      });
      const first = await consumer.invokeRequest(capability.capability_id, "corpus_round_trip", context, { value: { name: "Ada" } });
      const second = await consumer.invokeRequest(capability.capability_id, "corpus_round_trip", context, { value: { name: "Grace" } });
      return Response.json({ first, second });
    } finally {
      if (consumer) await consumer.stop(context);
      await provider.stop(context);
    }
  },
};
