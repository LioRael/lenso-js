import assert from "node:assert/strict";
import test from "node:test";
import { createEventScope } from "../scope.mjs";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

for (const outcome of ["resolve", "reject"]) {
  test(`generation invalidation fences late ${outcome} without invoking foreign I/O`, async () => {
    const scope = createEventScope();
    const native = deferred();
    let callbacks = 0,
      aborts = 0,
      rustCancels = 0;
    scope.attach(() => rustCancels++);
    scope
      .operation(() => ({ promise: native.promise, abort: () => aborts++ }))
      .promise.then(
        () => callbacks++,
        () => callbacks++,
      );
    scope.invalidate();
    assert.equal(aborts, 0);
    assert.equal(rustCancels, 0);
    scope.abort();
    assert.equal(aborts, 1);
    native[outcome]("late");
    assert.equal(await scope.settled(), true);
    await tick();
    assert.equal(callbacks, 0);
  });
}

test("normal result and domain rejection reach the current event", async () => {
  const scope = createEventScope();
  assert.equal(
    await scope.run(
      () => Promise.resolve(3),
      (value) => value + 1,
    ),
    4,
  );
  const failure = new Error("native failure");
  await assert.rejects(
    scope.run(() => Promise.reject(failure)),
    (error) => error === failure,
  );
  await assert.rejects(
    scope.run(() => {
      throw failure;
    }),
    (error) => error === failure,
  );
  scope.abort();
  assert.equal(await scope.settled(), true);
});

test("scope owns every operation without adapter lifecycle registration", async () => {
  const first = deferred(),
    second = deferred();
  const scope = createEventScope();
  let aborts = 0;
  const start = (native) =>
    scope.operation(() => ({
      promise: native.promise,
      abort() {
        aborts++;
        native.resolve("closed");
      },
    })).promise;
  const values = [start(first), start(second)];
  scope.abort();
  scope.abort();
  assert.equal(aborts, 2);
  assert.equal(await scope.settled(), true);
  assert.deepEqual(await Promise.all(values), ["closed", "closed"]);
});

test("cleanup includes cancellation created after the first pending snapshot", async () => {
  const read = deferred(),
    cancel = deferred();
  const scope = createEventScope({}, { cleanupTimeoutMs: 200 });
  const tracked = scope.trackNative(read.promise);
  tracked.then(() => scope.trackNative(cancel.promise));
  let finished = false;
  const settlement = scope.settled().then((value) => {
    finished = true;
    return value;
  });
  read.resolve();
  await tick();
  assert.equal(finished, false);
  cancel.resolve();
  assert.equal(await settlement, true);
});

test("unabortable work has bounded uncertain cleanup and detached callbacks", async () => {
  const scope = createEventScope({}, { cleanupTimeoutMs: 10 });
  const native = deferred();
  let callbacks = 0;
  scope.run(() => native.promise).then(() => callbacks++);
  scope.abort();
  const settlement = scope.settled();
  assert.equal(scope.settled(), settlement);
  assert.equal(await settlement, false);
  native.resolve("committed");
  await tick();
  assert.equal(callbacks, 0);
});

test("capacity and closed admission cannot start native side effects", async () => {
  const scope = createEventScope({}, { maxOperations: 1 });
  const native = deferred();
  const first = scope.run(() => native.promise);
  let starts = 0;
  await assert.rejects(
    scope.run(() => {
      starts++;
    }),
    /capacity/,
  );
  scope.abort();
  await assert.rejects(
    scope.run(() => {
      starts++;
    }),
    /closed/,
  );
  assert.equal(starts, 0);
  native.resolve();
  await first;
  assert.equal(await scope.settled(), true);
});

test("abort failures are uncertain cleanup, never a successful receipt", async () => {
  const scope = createEventScope();
  const native = deferred();
  scope.operation(() => ({
    promise: native.promise,
    abort() {
      throw new Error("cannot abort");
    },
  }));
  scope.abort();
  native.resolve();
  assert.equal(await scope.settled(), false);
});

test("asynchronous abort rejection cannot issue a clean settlement receipt", async () => {
  const scope = createEventScope();
  const native = deferred();
  scope.operation(() => ({
    promise: native.promise,
    async abort() {
      native.resolve();
      throw new Error("native cleanup rejected");
    },
  }));
  scope.abort();
  assert.equal(await scope.settled(), false);
  assert.equal(scope.invalidated, true);
});

for (const outcome of ["resolve", "reject"]) {
  test(`settlement drains asynchronous abort ${outcome} once after native completion`, async () => {
    const scope = createEventScope();
    const native = deferred(), cleanup = deferred();
    let aborts = 0, releases = 0;
    const operation = scope.operation(() => ({
      promise: native.promise,
      abort() {
        aborts++;
        native.resolve("closed");
        return cleanup.promise.finally(() => releases++);
      },
    }));
    // Cleanup may begin while the native completion is already being drained.
    const settlement = scope.settled();
    let finished = false;
    settlement.then(() => { finished = true; });
    scope.abort();
    scope.abort();
    operation.abort();
    assert.equal(await operation.promise, "closed");
    await tick();
    assert.equal(aborts, 1);
    assert.equal(releases, 0);
    assert.equal(finished, false);
    assert.equal(scope.settled(), settlement);
    cleanup[outcome](new Error("cleanup failed"));
    assert.equal(await settlement, outcome === "resolve");
    assert.equal(releases, 1);
    assert.equal(scope.invalidated, outcome === "reject");
    let starts = 0;
    await assert.rejects(scope.run(() => { starts++; }), /closed/);
    assert.equal(starts, 0);
    scope.abort();
    assert.equal(aborts, 1);
    assert.equal(await scope.settled(), outcome === "resolve");
  });
}

test("asynchronous abort failure remains local and native rejection remains a domain result", async () => {
  const failed = createEventScope(), healthy = createEventScope();
  const native = deferred(), cleanup = deferred();
  failed.operation(() => ({
    promise: native.promise,
    abort() {
      native.resolve();
      return cleanup.promise;
    },
  }));
  failed.abort();
  const settlement = failed.settled();
  const domainFailure = new Error("native domain rejection");
  await assert.rejects(
    healthy.run(() => Promise.reject(domainFailure)),
    (error) => error === domainFailure,
  );
  cleanup.reject(new Error("cleanup failed"));
  assert.equal(await settlement, false);
  assert.equal(failed.invalidated, true);
  assert.equal(healthy.closed, false);
  assert.equal(healthy.invalidated, false);
  assert.equal(await healthy.run(() => Promise.resolve("still usable")), "still usable");
  healthy.abort();
  assert.equal(await healthy.settled(), true);
});

test("invalidated scope observes asynchronous abort failure without reviving callbacks", async () => {
  const scope = createEventScope();
  const native = deferred(), cleanup = deferred();
  let callbacks = 0, aborts = 0;
  scope.operation(() => ({
    promise: native.promise,
    async abort() {
      aborts++;
      try {
        await cleanup.promise;
      } finally {
        native.resolve("late");
      }
    },
  })).promise.then(() => callbacks++, () => callbacks++);
  scope.attach(() => callbacks++);
  scope.invalidate();
  assert.equal(aborts, 0);
  scope.abort();
  const settlement = scope.settled();
  cleanup.reject(new Error("cleanup failed"));
  assert.equal(await settlement, false);
  await tick();
  assert.equal(callbacks, 0);
  assert.equal(aborts, 1);
});

test("bindings cannot override lifecycle methods and are immutable", () => {
  assert.throws(() => createEventScope({ invalidate() {} }), /reserved/);
  const scope = createEventScope((owner) => ({
    query: () => owner.run(() => Promise.resolve("ok")),
  }));
  assert.equal(scope.query, scope.bindings.query);
  assert.equal(Object.isFrozen(scope), true);
  assert.equal(Object.isFrozen(scope.bindings), true);
});
