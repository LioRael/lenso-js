import definition from "./dist/plugin.mjs";
import { prepareWorkersPlugin } from "../../packages/lenso-workers-runtime/plugin.mjs";

const providedEndpoints = definition.providers.map(value => value.descriptor);
const profile = providedEndpoints.find(value => value.capability_id === "example.profile@1");
const conversation = providedEndpoints.find(value => value.capability_id === "example.conversation@1");
const delay = () => new Promise(resolve => setTimeout(resolve, 1));

// Qualification entry; assembly connects the same adapter to the real Plan.
export default {
  async fetch(request) {
    const mode = new URL(request.url).pathname.slice(1);
    if (mode === "health") return new Response("ready");
    if (!["complete", "cancel", "domain"].includes(mode)) return new Response("unknown case", { status: 404 });
    const deadline = Date.now() + 2000;
    const context = {
      requestId: "1", signal: request.signal,
      get cancelled() { return request.signal.aborted; },
      remainingTimeoutMs: () => Math.max(0, deadline - Date.now()),
    };
    const provider = await prepareWorkersPlugin(definition, {
      providedEndpoints, configuration: { prefix: "provider-a" },
      dependencies: { upstream: [] }, lifecycle: context, maxOpenStreams: 1,
    });
    let consumer;
    try {
      consumer = await prepareWorkersPlugin(definition, {
        providedEndpoints, configuration: { prefix: "consumer-b" },
        dependencies: { upstream: [{
          providerInstance: "provider-a", descriptor: conversation,
          invokeRequest: (operation, call, payload) => provider.invokeRequest(conversation.capability_id, operation, call, payload),
          openStream: (operation, call, payload) => provider.openStream(conversation.capability_id, operation, call, payload),
        }] },
        lifecycle: context, maxOpenStreams: 1,
      });
      const stats = async () => ({
        provider: (await provider.invokeRequest(profile.capability_id, "corpus_round_trip", context, { value: {} })).value.value,
        consumer: (await consumer.invokeRequest(profile.capability_id, "corpus_round_trip", context, { value: {} })).value.value,
      });
      if (mode === "domain") {
        const result = await provider.openStream(conversation.capability_id, "chat", context, { room: "closed" });
        return Response.json({ mode, result, stats: await stats() });
      }
      const opened = await consumer.openStream(conversation.capability_id, "chat", context, { room: mode === "cancel" ? "blocked" : "general" });
      if (opened.kind !== "opened") throw new Error(JSON.stringify(opened));
      const stream = opened.stream;
      let closed = false;
      stream.closed.then(() => { closed = true; });
      const before = await stats();
      const capacity = await consumer.openStream(conversation.capability_id, "chat", context, { room: "general" });
      const first = await stream.receive();
      const afterFirst = await stats();
      const halfClose = await stream.closeSend();
      if (mode === "complete") {
        const messages = [first];
        while (true) {
          const next = await stream.receive();
          messages.push(next);
          if (next.kind !== "message") break;
        }
        await stream.closed;
        return Response.json({ mode, before, afterFirst, capacity, halfClose, messages, closed, final: await stats() });
      }
      const pending = stream.receive();
      await delay();
      const overlap = await stream.receive();
      const cancellation = stream.cancel();
      let prematureStop;
      try { await consumer.stop(context); prematureStop = "unexpected"; }
      catch (error) { prematureStop = error.message; }
      const closedDuringCleanup = closed;
      const late = await pending;
      await cancellation;
      return Response.json({ mode, before, afterFirst, capacity, halfClose, overlap, late, prematureStop, closedDuringCleanup, closed, final: await stats() });
    } finally {
      if (consumer) await consumer.stop(context);
      await provider.stop(context);
    }
  },
};
