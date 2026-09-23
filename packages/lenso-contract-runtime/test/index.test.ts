import { expect, test } from "bun:test";
import {
  decodeDomainError,
  decodePortableJson,
  encodePortableJson,
  portableValueProfile,
  validatePortableJson,
} from "@lenso/contract-runtime";

test("portable JSON rejects unsafe numbers recursively", () => {
  expect(() => validatePortableJson({ value: 9_007_199_254_740_992 })).toThrow(
    "unsafe number",
  );
  expect(() => validatePortableJson(Number.POSITIVE_INFINITY)).toThrow(
    "unsafe number",
  );
  expect(validatePortableJson({ values: [1, 1.5, null] })).toBeUndefined();
});

test("portable JSON round-trips missing and null distinctly", () => {
  const value = { explicit: null, present: "value" };
  expect(
    decodePortableJson<typeof value>(encodePortableJson(value, "request")),
  ).toEqual(value);
  expect(portableValueProfile.missingAndNull).toBe("distinct");
});

test("Domain Errors preserve known strings and opaque future values", () => {
  type ErrorValue = string | { readonly code: string; readonly [key: string]: unknown };
  expect(decodeDomainError<ErrorValue>('"rejected"', ["rejected"])).toBe(
    "rejected",
  );
  expect(decodeDomainError<ErrorValue>('"future"', ["rejected"])).toEqual({
    code: "future",
  });
  expect(
    decodeDomainError<ErrorValue>(
      '{"code":"future","payload":null,"retry_after_ms":2500}',
      ["rejected"],
    ),
  ).toEqual({ code: "future", payload: null, retry_after_ms: 2500 });
});
