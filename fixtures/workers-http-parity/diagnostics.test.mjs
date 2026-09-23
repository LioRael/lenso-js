import assert from "node:assert/strict";
import test from "node:test";
import { headerValues, workerRequestCollapsedHeaders } from "./diagnostics.mjs";

test("reports the exact endpoint values for repeated fields", () => {
  const headers = [{ name: "x-test", value: "one, two" }];
  assert.deepEqual(headerValues(headers, "X-Test"), ["one, two"]);
});

test("attributes a duplicate-field mismatch only when Worker ingress saw the same collapse", () => {
  const differences = [{ name: "x-test", expected: ["one", "two"], observed: ["one, two"] }];
  assert.equal(workerRequestCollapsedHeaders(differences, { "x-test": ["one, two"] }), true);
  assert.equal(workerRequestCollapsedHeaders(differences, { "x-test": ["one", "two"] }), false);
  assert.equal(workerRequestCollapsedHeaders(differences, undefined), false);
  assert.equal(workerRequestCollapsedHeaders([], { "x-test": ["one, two"] }), false);
  assert.equal(workerRequestCollapsedHeaders([
    { name: "x-test", expected: ["one", "two"], observed: ["one", "changed"] },
  ], { "x-test": ["one", "changed"] }), false);
});
