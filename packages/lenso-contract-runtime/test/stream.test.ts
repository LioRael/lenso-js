import { expect, test } from "bun:test";
import { lowerProviderStreamWithCleanup } from "../src/stream.ts";

test("server-output cancellation awaits asynchronous finally and never emits clean late EOF", async () => {
  let unblock!: () => void, cleaned = false, produced = 0;
  const wait = new Promise<void>(resolve => { unblock = resolve; });
  const stream = lowerProviderStreamWithCleanup((async function* () {
    try {
      produced++; yield 1;
      await wait;
      produced++; yield 2;
    } finally {
      await new Promise(resolve => setTimeout(resolve, 5));
      cleaned = true;
    }
  })(), () => new Error("no inbound"));
  expect(produced).toBe(0);
  expect(await stream.receive()).toEqual({ kind: "message", message: 1 });
  const pending = stream.receive();
  const cleanup = stream.cancel();
  expect(cleaned).toBe(false);
  unblock();
  await expect(pending).rejects.toThrow("stream_cancelled");
  await cleanup;
  await stream.closed;
  expect(cleaned).toBe(true);
});

test("natural terminal and finally work are confirmed before closed fulfills", async () => {
  let cleaned = false;
  const stream = lowerProviderStreamWithCleanup((async function* () {
    try { yield 7; }
    finally { await Promise.resolve(); cleaned = true; }
  })(), () => new Error("no inbound"));
  expect(await stream.receive()).toEqual({ kind: "message", message: 7 });
  expect(cleaned).toBe(false);
  expect(await stream.receive()).toEqual({ kind: "terminal", outcome: { ok: true } });
  await stream.closed;
  expect(cleaned).toBe(true);
});

test("generator cleanup failure rejects the physical receipt", async () => {
  const stream = lowerProviderStreamWithCleanup((async function* () {
    try { yield 1; }
    finally { await Promise.resolve(); throw new Error("cleanup failed"); }
  })(), () => new Error("no inbound"));
  await stream.receive();
  await expect(stream.cancel()).rejects.toThrow("cleanup failed");
  await expect(stream.closed!).rejects.toThrow("cleanup failed");
});
