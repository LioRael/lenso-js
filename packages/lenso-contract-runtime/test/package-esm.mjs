import assert from "node:assert/strict";
import {
  decodePortableJson,
  encodePortableJson,
  lowerProviderStreamWithCleanup,
} from "@lenso/contract-runtime";
import { validateSchema } from "@lenso/contract-runtime/browser";

const value = { format: "esm" };
assert.equal(typeof lowerProviderStreamWithCleanup, "function");
assert.deepEqual(
  decodePortableJson(encodePortableJson(value, "request")),
  value,
);
assert.doesNotThrow(() =>
  validateSchema("portable", { type: "string" }, "value"),
);
