const assert = require("node:assert/strict");
const {
  decodePortableJson,
  encodePortableJson,
} = require("@lenso/contract-runtime");
const { validateSchema } = require("@lenso/contract-runtime/browser");

const value = { format: "commonjs" };
assert.deepEqual(
  decodePortableJson(encodePortableJson(value, "request")),
  value,
);
assert.doesNotThrow(() =>
  validateSchema("portable", { type: "string" }, "value"),
);
