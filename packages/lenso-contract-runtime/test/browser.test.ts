import { expect, test } from "bun:test";
import { runtimeFailureKinds } from "@lenso/contract-runtime";
import { validateResult, validateSchema } from "@lenso/contract-runtime/browser";
import portablePatternFixture from "../../../fixtures/portable-contract/portable-pattern-conformance.json";

const requestSchema = {
  type: "object",
  required: ["signed", "unsigned", "label", "payload", "timestamp", "duration", "values"],
  additionalProperties: false,
  properties: {
    signed: { type: "string", format: "int64" },
    unsigned: { type: "string", format: "uint64" },
    label: { type: "string", minLength: 2, maxLength: 4 },
    payload: { type: "string", format: "byte" },
    timestamp: { type: "string", format: "date-time" },
    duration: { type: "string", format: "duration" },
    values: {
      type: "array",
      minItems: 1,
      maxItems: 2,
      items: { type: "integer", minimum: 0, exclusiveMaximum: 10 },
    },
  },
} as const;

test("browser schema validation preserves portable formats and constraints", () => {
  const valid = {
    signed: "-9223372036854775808",
    unsigned: "18446744073709551615",
    label: "wire",
    payload: "AQI=",
    timestamp: "2026-08-23T12:34:56Z",
    duration: "PT1.5S",
    values: [0, 9],
  };
  expect(validateSchema(valid, requestSchema, "request")).toBeUndefined();

  for (const invalid of [
    { ...valid, signed: "9223372036854775808" },
    { ...valid, unsigned: "18446744073709551616" },
    { ...valid, label: "x" },
    { ...valid, payload: "AQJ=" },
    { ...valid, timestamp: "2026-02-30T12:34:56Z" },
    { ...valid, duration: "P" },
    { ...valid, values: [10] },
    { ...valid, extra: true },
  ]) {
    expect(() => validateSchema(invalid, requestSchema, "request")).toThrow(
      "invalid request payload",
    );
  }
});

test("browser result validation preserves success and native failure envelopes", () => {
  const responseSchema = {
    type: "object",
    required: ["accepted"],
    additionalProperties: false,
    properties: { accepted: { type: "boolean" } },
  } as const;
  const errorSchema = { oneOf: [{ const: "rejected" }] } as const;

  expect(
    validateResult({ ok: true, value: { accepted: true } }, responseSchema, errorSchema),
  ).toBeUndefined();
  expect(
    validateResult(
      { ok: false, error: { kind: "domain", error: { code: "future" } } },
      responseSchema,
      errorSchema,
    ),
  ).toBeUndefined();
  expect(
    validateResult(
      { ok: false, error: { kind: "runtime", error: { kind: "cancelled" } } },
      responseSchema,
      errorSchema,
    ),
  ).toBeUndefined();
  expect(() => validateResult({ ok: true }, responseSchema, errorSchema)).toThrow(
    "missing value",
  );
});

test("browser schema validation enforces Unicode string patterns", () => {
  const requestIdSchema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "urn:lenso:test:request-id",
    title: "Request ID",
    description: "A portable request identifier.",
    default: "request-1",
    examples: ["request-1", "request:2"],
    "x-lenso-sensitive": true,
    type: "string",
    pattern: "^[A-Za-z0-9._:-]+$",
  } as const;
  const unicodeSchema = { type: "string", pattern: "^\\p{Letter}+$" } as const;

  expect(validateSchema("request:1", requestIdSchema, "request")).toBeUndefined();
  expect(() => validateSchema("request/1", requestIdSchema, "request")).toThrow(
    "invalid request payload",
  );
  expect(() => validateSchema("request:1\n", requestIdSchema, "request")).toThrow(
    "invalid request payload",
  );
  expect(validateSchema("Καλημέρα", unicodeSchema, "request")).toBeUndefined();
  for (const pattern of ["^\\d+$", "\\Avalue"]) {
    expect(() =>
      validateSchema("123", { type: "string", pattern }, "request"),
    ).toThrow("invalid request payload");
  }
});

test("browser matches the shared portable pattern safety corpus", () => {
  for (const vector of portablePatternFixture) {
    const validate = () =>
      validateSchema(
        vector.sample,
        { type: "string", pattern: vector.pattern },
        "request",
      );
    if (vector.accepted) {
      expect(validate, vector.name).not.toThrow();
    } else {
      expect(validate, vector.name).toThrow("invalid request payload");
    }
  }
});

test("browser schema validation rejects deep-equal unique items", () => {
  const schema = {
    type: "array",
    uniqueItems: true,
    items: {
      title: "Entry",
      type: "object",
      required: ["first", "second"],
      additionalProperties: false,
      properties: {
        first: { type: "integer" },
        second: { type: "integer" },
      },
    },
  } as const;

  expect(
    validateSchema(
      [{ first: 1, second: 2 }, { first: 2, second: 1 }],
      schema,
      "request",
    ),
  ).toBeUndefined();
  expect(() =>
    validateSchema(
      [{ first: 1, second: 2 }, { second: 2, first: 1 }],
      schema,
      "request",
    )
  ).toThrow("invalid request payload");
  expect(() => validateSchema([-0, 0], { type: "array", uniqueItems: true }, "request"))
    .toThrow("invalid request payload");
});

test("browser schema validation rejects unsupported assertions recursively", () => {
  const schemas = [
    { type: "object", minProperties: 1 },
    {
      type: "object",
      properties: { nested: { type: "array", contains: { const: "required" } } },
    },
  ] as const;

  for (const schema of schemas) {
    expect(() => validateSchema({}, schema, "request")).toThrow(
      "invalid request payload",
    );
  }
});

test("browser result validation accepts every canonical Runtime Failure kind", () => {
  const responseSchema = { type: "null" } as const;
  const errorSchema = { const: "rejected" } as const;

  for (const kind of runtimeFailureKinds) {
    expect(
      validateResult(
        { ok: false, error: { kind: "runtime", error: { kind, detail: null } } },
        responseSchema,
        errorSchema,
      ),
    ).toBeUndefined();
  }
});

test("browser result validation rejects impossible Runtime Failure kinds", () => {
  const responseSchema = { type: "null" } as const;
  const errorSchema = { const: "rejected" } as const;

  for (const kind of ["future_failure", 7]) {
    expect(() =>
      validateResult(
        { ok: false, error: { kind: "runtime", error: { kind } } },
        responseSchema,
        errorSchema,
      )
    ).toThrow("invalid Runtime Failure payload");
  }
});

const durationVectors = [
  ["P3Y6M4DT12H30M5S", true],
  ["-P3DT4H", true],
  ["PT1.5S", true],
  ["P1.5Y", true],
  ["P1Y2.5M", true],
  ["P2W", true],
  ["P1.5W", true],
  ["PT0S", true],
  ["P", false],
  ["PT", false],
  ["P1.S", false],
  ["P.5D", false],
  ["P1.5Y2M", false],
  ["P1DT1.5H30M", false],
  ["P1D2M", false],
  ["P1Y2Y", false],
  ["PT1S2M", false],
  ["PT1M2M", false],
  ["P1W2D", false],
  ["P1Y2W", false],
  ["P1WT2H", false],
] as const;

test("browser duration validation follows the strict ISO 8601 grammar", () => {
  const schema = { type: "string", format: "duration" } as const;

  for (const [value, accepted] of durationVectors) {
    const validate = () => validateSchema(value, schema, "request");
    if (accepted) {
      expect(validate()).toBeUndefined();
    } else {
      expect(validate).toThrow("invalid request payload");
    }
  }
});
