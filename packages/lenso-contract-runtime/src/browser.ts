import { isRuntimeFailureKind, validatePortableJson } from "./index.js";

export { validatePortableJson } from "./index.js";

/** JSON Schema subset accepted by generated browser request clients. */
export type PortableSchema = Readonly<Record<string, unknown>>;

/** Validates a payload against the portable contract schema subset. */
export function validateSchema(
  value: unknown,
  schema: PortableSchema,
  label: string,
): void {
  validatePortableJson(value);
  if (!isSupportedSchema(schema) || !matchesSchema(value, schema)) {
    throw new Error(`invalid ${label} payload`);
  }
}

/** Validates the result envelope and operation payload returned to a browser client. */
export function validateResult(
  result: unknown,
  responseSchema: PortableSchema,
  errorSchema: PortableSchema,
): void {
  if (!isRecord(result) || typeof result.ok !== "boolean") {
    throw new Error("invalid Capability result envelope");
  }
  if (result.ok) {
    if (!Object.hasOwn(result, "value")) {
      throw new Error("successful Capability result is missing value");
    }
    validateSchema(result.value, responseSchema, "response");
    return;
  }
  if (
    !isRecord(result.error) ||
    !["domain", "runtime"].includes(String(result.error.kind))
  ) {
    throw new Error("invalid invocation error envelope");
  }
  if (result.error.kind === "domain") {
    validateDomainError(result.error.error, errorSchema);
  } else if (
    !isRecord(result.error.error) ||
    !isRuntimeFailureKind(result.error.error.kind)
  ) {
    throw new Error("invalid Runtime Failure payload");
  }
}

function validateDomainError(value: unknown, schema: PortableSchema): void {
  if (!isSupportedSchema(schema)) {
    throw new Error("invalid Domain Error payload");
  }
  if (matchesSchema(value, schema)) return;
  if (typeof value === "string") return;
  if (isRecord(value) && typeof value.code === "string") return;
  throw new Error("invalid Domain Error payload");
}

function matchesSchema(value: unknown, schema: PortableSchema): boolean {
  const oneOf = schemaList(schema.oneOf);
  if (
    oneOf &&
    oneOf.filter((candidate) => matchesSchema(value, candidate)).length !== 1
  ) {
    return false;
  }
  const anyOf = schemaList(schema.anyOf);
  if (anyOf && !anyOf.some((candidate) => matchesSchema(value, candidate))) {
    return false;
  }
  if (Object.hasOwn(schema, "const") && !jsonDeepEqual(value, schema.const)) {
    return false;
  }
  if (
    Array.isArray(schema.enum) &&
    !schema.enum.some((candidate) => jsonDeepEqual(value, candidate))
  ) {
    return false;
  }
  if (Array.isArray(schema.type)) {
    return schema.type.some((type) => matchesSchema(value, { ...schema, type }));
  }
  if (schema.type === "null") return value === null;
  if (schema.type === "string") {
    if (typeof value !== "string" || !matchesFormat(value, schema.format)) {
      return false;
    }
    if (
      typeof schema.pattern === "string" &&
      !matchesUnicodePattern(value, schema.pattern)
    ) {
      return false;
    }
    const length = Array.from(value).length;
    if (typeof schema.minLength === "number" && length < schema.minLength) {
      return false;
    }
    if (typeof schema.maxLength === "number" && length > schema.maxLength) {
      return false;
    }
  }
  if (schema.type === "boolean" && typeof value !== "boolean") return false;
  if (
    schema.type === "number" &&
    (typeof value !== "number" || !Number.isFinite(value))
  ) {
    return false;
  }
  if (schema.type === "integer" && !Number.isSafeInteger(value)) return false;
  if (schema.type === "number" || schema.type === "integer") {
    if (typeof value !== "number" || !matchesNumericBounds(value, schema)) {
      return false;
    }
  }
  if (schema.type === "array") {
    if (!Array.isArray(value)) return false;
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      return false;
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      return false;
    }
    if (schema.uniqueItems === true && containsDeepDuplicate(value)) {
      return false;
    }
    if (isRecord(schema.items)) {
      return value.every((item) => matchesSchema(item, schema.items as PortableSchema));
    }
  }
  if (schema.type === "object") {
    if (!isRecord(value) || Array.isArray(value)) return false;
    const required = Array.isArray(schema.required) ? schema.required : [];
    if (
      required.some(
        (key) => typeof key !== "string" || !Object.hasOwn(value, key),
      )
    ) {
      return false;
    }
    const properties = isRecord(schema.properties) ? schema.properties : {};
    for (const [key, item] of Object.entries(value)) {
      const property = properties[key];
      if (isRecord(property)) {
        if (!matchesSchema(item, property)) return false;
      } else if (schema.additionalProperties === false) {
        return false;
      } else if (
        isRecord(schema.additionalProperties) &&
        !matchesSchema(item, schema.additionalProperties)
      ) {
        return false;
      }
    }
  }
  return true;
}

const supportedSchemaKeywords = new Set([
  "$defs",
  "additionalProperties",
  "anyOf",
  "const",
  "enum",
  "exclusiveMaximum",
  "exclusiveMinimum",
  "format",
  "items",
  "maxItems",
  "maxLength",
  "maximum",
  "minItems",
  "minLength",
  "minimum",
  "oneOf",
  "pattern",
  "properties",
  "required",
  "type",
  "uniqueItems",
]);

const harmlessAnnotationKeywords = new Set([
  "$anchor",
  "$comment",
  "$dynamicAnchor",
  "$id",
  "$schema",
  "default",
  "deprecated",
  "description",
  "examples",
  "readOnly",
  "title",
  "writeOnly",
  "x-lenso-sensitive",
]);

const portableSchemaTypes = new Set([
  "array",
  "boolean",
  "integer",
  "null",
  "number",
  "object",
  "string",
]);

const portableFormats = new Set([
  "byte",
  "date-time",
  "duration",
  "int64",
  "uint64",
]);

function isSupportedSchema(schema: PortableSchema): boolean {
  if (
    Object.keys(schema).some(
      (keyword) =>
        !supportedSchemaKeywords.has(keyword) &&
        !harmlessAnnotationKeywords.has(keyword),
    )
  ) {
    return false;
  }

  if (Object.hasOwn(schema, "type")) {
    if (typeof schema.type === "string") {
      if (!portableSchemaTypes.has(schema.type)) return false;
    } else if (
      !Array.isArray(schema.type) ||
      schema.type.length === 0 ||
      schema.type.some(
        (type, index, types) =>
          typeof type !== "string" ||
          !portableSchemaTypes.has(type) ||
          types.indexOf(type) !== index,
      )
    ) {
      return false;
    }
  }

  for (const keyword of ["oneOf", "anyOf"] as const) {
    if (
      Object.hasOwn(schema, keyword) &&
      (!Array.isArray(schema[keyword]) ||
        schema[keyword].length === 0 ||
        schema[keyword].some(
          (candidate) =>
            !isSchemaObject(candidate) || !isSupportedSchema(candidate),
        ))
    ) {
      return false;
    }
  }

  if (
    Object.hasOwn(schema, "enum") &&
    (!Array.isArray(schema.enum) || schema.enum.length === 0)
  ) {
    return false;
  }
  if (
    Object.hasOwn(schema, "required") &&
    (!Array.isArray(schema.required) ||
      schema.required.some((key) => typeof key !== "string"))
  ) {
    return false;
  }
  if (
    Object.hasOwn(schema, "pattern") &&
    (typeof schema.pattern !== "string" ||
      !isValidUnicodePattern(schema.pattern))
  ) {
    return false;
  }
  if (
    Object.hasOwn(schema, "format") &&
    (typeof schema.format !== "string" || !portableFormats.has(schema.format))
  ) {
    return false;
  }
  if (
    Object.hasOwn(schema, "uniqueItems") &&
    typeof schema.uniqueItems !== "boolean"
  ) {
    return false;
  }

  for (const keyword of ["minLength", "maxLength", "minItems", "maxItems"] as const) {
    if (
      Object.hasOwn(schema, keyword) &&
      (!Number.isSafeInteger(schema[keyword]) || Number(schema[keyword]) < 0)
    ) {
      return false;
    }
  }
  for (const keyword of [
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
  ] as const) {
    if (
      Object.hasOwn(schema, keyword) &&
      (typeof schema[keyword] !== "number" ||
        !Number.isFinite(schema[keyword]))
    ) {
      return false;
    }
  }

  if (Object.hasOwn(schema, "items")) {
    if (!isSchemaObject(schema.items) || !isSupportedSchema(schema.items)) {
      return false;
    }
  }
  if (Object.hasOwn(schema, "properties")) {
    if (
      !isSchemaObject(schema.properties) ||
      Object.values(schema.properties).some(
        (property) =>
          !isSchemaObject(property) || !isSupportedSchema(property),
      )
    ) {
      return false;
    }
  }
  if (Object.hasOwn(schema, "$defs")) {
    if (
      !isSchemaObject(schema.$defs) ||
      Object.values(schema.$defs).some(
        (definition) =>
          !isSchemaObject(definition) || !isSupportedSchema(definition),
      )
    ) {
      return false;
    }
  }
  if (
    Object.hasOwn(schema, "additionalProperties") &&
    typeof schema.additionalProperties !== "boolean" &&
    (!isSchemaObject(schema.additionalProperties) ||
      !isSupportedSchema(schema.additionalProperties))
  ) {
    return false;
  }

  return true;
}

const MAX_PORTABLE_PATTERN_CODE_POINTS = 4_096;
const MAX_PORTABLE_REPETITION = 10_000;
const PORTABLE_UNICODE_PROPERTY_ESCAPE = "\\p{Letter}";

/**
 * Accepts only regular-expression syntax with shared Rust `regex` and
 * ECMAScript Unicode-mode semantics. Engine-specific shorthand classes and
 * internal anchors, wildcard dots, lookarounds, backreferences, flags, and
 * backtracking-unsafe repetition shapes fail closed. Fully anchored patterns
 * may use the complete safe subset; start-anchored prefix patterns are limited
 * to fixed-shape expressions.
 * The shared `^`/`$` anchors remain allowed; `$` is normalized below to Rust's
 * absolute end-of-input behavior before the browser engine sees it.
 */
function hasPortablePatternSyntax(pattern: string): boolean {
  if (
    Array.from(pattern).length > MAX_PORTABLE_PATTERN_CODE_POINTS ||
    pattern[0] !== "^"
  ) {
    return false;
  }

  let index = 0;
  let inClass = false;
  let classStart: number | undefined;
  const frames: PortablePatternFrame[] = [newPortablePatternFrame()];
  while (index < pattern.length) {
    const character = pattern[index];
    if (character === undefined) return false;

    if (inClass) {
      if (character === "\\") {
        if (pattern.startsWith(PORTABLE_UNICODE_PROPERTY_ESCAPE, index)) {
          index += PORTABLE_UNICODE_PROPERTY_ESCAPE.length;
          continue;
        }
        const escaped = pattern[index + 1];
        const sharedClassEscape =
          escaped !== undefined && "^$\\.*+?()[]{}|/-".includes(escaped);
        if (!sharedClassEscape) return false;
        index += 2;
        continue;
      }
      if (character === "]") {
        if (classStart === undefined) return false;
        const content = pattern.slice(classStart, index);
        if (content === "" || content === "^") return false;
        inClass = false;
        classStart = undefined;
        const frame = frames[frames.length - 1];
        if (frame === undefined || !pushPortablePatternAtom(frame, newPortablePatternAtom())) {
          return false;
        }
        index += 1;
        continue;
      }
      if (character === "[") return false;
      if (
        ["&", "-", "~", "|"].includes(character) &&
        pattern[index + 1] === character
      ) {
        return false;
      }
      const codePoint = pattern.codePointAt(index);
      if (!isPortablePatternCodePoint(codePoint)) return false;
      index += (codePoint as number) > 0xffff ? 2 : 1;
      continue;
    }

    if (character === "\\") {
      if (pattern.startsWith(PORTABLE_UNICODE_PROPERTY_ESCAPE, index)) {
        index += PORTABLE_UNICODE_PROPERTY_ESCAPE.length;
      } else {
        const escaped = pattern[index + 1];
        const sharedSyntaxEscape =
          escaped !== undefined && "^$\\.*+?()[]{}|/".includes(escaped);
        if (!sharedSyntaxEscape) return false;
        index += 2;
      }
      const frame = frames[frames.length - 1];
      if (frame === undefined || !pushPortablePatternAtom(frame, newPortablePatternAtom())) {
        return false;
      }
      continue;
    }
    if (character === "[") {
      inClass = true;
      classStart = index + 1;
      index += 1;
      continue;
    }
    if (character === "]" || character === "}") return false;
    if (character === ".") return false;
    if (character === "(") {
      if (pattern[index + 1] === "?") {
        if (!pattern.startsWith("(?:", index)) return false;
        index += 3;
      } else {
        index += 1;
      }
      frames.push(newPortablePatternFrame());
      continue;
    }
    if (character === ")") {
      if (frames.length === 1) return false;
      const group = frames.pop();
      if (group === undefined) return false;
      const canMatchEmpty =
        group.earlierBranchCanMatchEmpty || group.sequenceCanMatchEmpty;
      if (canMatchEmpty) return false;
      const atom = newPortablePatternAtom({
        canMatchEmpty,
        hasVariableShape:
          group.containsVariableRepetition || group.containsAlternation,
        containsVariableRepetition: group.containsVariableRepetition,
        containsAlternation: group.containsAlternation,
        isGroup: true,
      });
      const parent = frames[frames.length - 1];
      if (parent === undefined || !pushPortablePatternAtom(parent, atom)) return false;
      index += 1;
      continue;
    }
    if (character === "|") {
      if (frames.length === 1) return false;
      const frame = frames[frames.length - 1];
      if (frame === undefined) return false;
      frame.containsAlternation = true;
      frame.earlierBranchCanMatchEmpty ||= frame.sequenceCanMatchEmpty;
      frame.sequenceCanMatchEmpty = true;
      frame.branchHasVariableShape = false;
      frame.lastAtom = undefined;
      index += 1;
      continue;
    }
    if (character === "*" || character === "+" || character === "?") {
      const repetition =
        character === "*"
          ? { minimum: 0, maximum: undefined }
          : character === "+"
            ? { minimum: 1, maximum: undefined }
            : { minimum: 0, maximum: 1 };
      const frame = frames[frames.length - 1];
      if (frame === undefined || !applyPortableRepetition(frame, repetition)) {
        return false;
      }
      index += 1;
      continue;
    }
    if (character === "{") {
      const close = pattern.indexOf("}", index + 1);
      if (close < 0) return false;
      const repetition = parsePortableRepetition(pattern.slice(index + 1, close));
      const frame = frames[frames.length - 1];
      if (
        repetition === undefined ||
        frame === undefined ||
        !applyPortableRepetition(frame, repetition)
      ) {
        return false;
      }
      index = close + 1;
      continue;
    }
    if (character === "^" && index === 0) {
      const frame = frames[frames.length - 1];
      if (frame === undefined) return false;
      frame.lastAtom = undefined;
      index += 1;
      continue;
    }
    if (character === "$" && isPortableEndAnchor(pattern, index)) {
      const frame = frames[frames.length - 1];
      if (frame === undefined) return false;
      frame.lastAtom = undefined;
      index += 1;
      continue;
    }
    if (character === "^" || character === "$") return false;

    const codePoint = pattern.codePointAt(index);
    if (!isPortablePatternCodePoint(codePoint)) return false;
    const frame = frames[frames.length - 1];
    if (frame === undefined || !pushPortablePatternAtom(frame, newPortablePatternAtom())) {
      return false;
    }
    index += (codePoint as number) > 0xffff ? 2 : 1;
  }

  if (inClass || frames.length !== 1) return false;
  const frame = frames[0];
  if (frame === undefined) return false;
  return (
    hasPortableEndAnchor(pattern) ||
    (frame.lastAtom !== undefined &&
      !frame.containsVariableRepetition &&
      !frame.containsAlternation)
  );
}

function hasPortableEndAnchor(pattern: string): boolean {
  if (pattern[pattern.length - 1] !== "$") return false;
  let precedingBackslashes = 0;
  for (
    let index = pattern.length - 2;
    index >= 0 && pattern[index] === "\\";
    index -= 1
  ) {
    precedingBackslashes += 1;
  }
  return precedingBackslashes % 2 === 0;
}

function isPortableEndAnchor(pattern: string, index: number): boolean {
  return index === pattern.length - 1 && hasPortableEndAnchor(pattern);
}

interface PortablePatternAtom {
  canMatchEmpty: boolean;
  hasVariableShape: boolean;
  isQuantified: boolean;
  prefixCanMatchEmpty: boolean;
  containsVariableRepetition: boolean;
  containsAlternation: boolean;
  isGroup: boolean;
}

interface PortablePatternFrame {
  sequenceCanMatchEmpty: boolean;
  earlierBranchCanMatchEmpty: boolean;
  containsVariableRepetition: boolean;
  containsAlternation: boolean;
  branchHasVariableShape: boolean;
  lastAtom: PortablePatternAtom | undefined;
}

interface PortableRepetition {
  minimum: number;
  maximum: number | undefined;
}

function newPortablePatternAtom(
  overrides: Partial<PortablePatternAtom> = {},
): PortablePatternAtom {
  return {
    canMatchEmpty: false,
    hasVariableShape: false,
    isQuantified: false,
    prefixCanMatchEmpty: false,
    containsVariableRepetition: false,
    containsAlternation: false,
    isGroup: false,
    ...overrides,
  };
}

function newPortablePatternFrame(): PortablePatternFrame {
  return {
    sequenceCanMatchEmpty: true,
    earlierBranchCanMatchEmpty: false,
    containsVariableRepetition: false,
    containsAlternation: false,
    branchHasVariableShape: false,
    lastAtom: undefined,
  };
}

function pushPortablePatternAtom(
  frame: PortablePatternFrame,
  atom: PortablePatternAtom,
): boolean {
  if (atom.hasVariableShape && frame.branchHasVariableShape) return false;
  atom.prefixCanMatchEmpty = frame.sequenceCanMatchEmpty;
  frame.sequenceCanMatchEmpty &&= atom.canMatchEmpty;
  frame.branchHasVariableShape ||= atom.hasVariableShape;
  frame.containsVariableRepetition ||= atom.containsVariableRepetition;
  frame.containsAlternation ||= atom.containsAlternation;
  frame.lastAtom = atom;
  return true;
}

function applyPortableRepetition(
  frame: PortablePatternFrame,
  repetition: PortableRepetition,
): boolean {
  const atom = frame.lastAtom;
  if (atom === undefined || atom.isQuantified || repetition.maximum === 0) {
    return false;
  }
  if (
    atom.isGroup &&
    (atom.canMatchEmpty ||
      atom.containsVariableRepetition ||
      atom.containsAlternation)
  ) {
    return false;
  }

  const hasVariableExtent = repetition.maximum !== repetition.minimum;
  if (hasVariableExtent && frame.branchHasVariableShape) return false;
  atom.isQuantified = true;
  atom.hasVariableShape ||= hasVariableExtent;
  atom.canMatchEmpty = repetition.minimum === 0 || atom.canMatchEmpty;
  frame.sequenceCanMatchEmpty =
    atom.prefixCanMatchEmpty && atom.canMatchEmpty;
  frame.branchHasVariableShape ||= hasVariableExtent;
  frame.containsVariableRepetition ||= hasVariableExtent;
  return true;
}

function parsePortableRepetition(value: string): PortableRepetition | undefined {
  const parts = value.split(",");
  if (parts.length > 2) return undefined;
  const minimumText = parts[0];
  if (minimumText === undefined) return undefined;
  const minimum = parsePortableRepetitionBound(minimumText);
  if (minimum === undefined) return undefined;
  const maximumText = parts[1];
  if (maximumText === undefined) return { minimum, maximum: minimum };
  if (maximumText === "") return { minimum, maximum: undefined };
  const maximum = parsePortableRepetitionBound(maximumText);
  return maximum !== undefined && maximum >= minimum
    ? { minimum, maximum }
    : undefined;
}

function parsePortableRepetitionBound(value: string): number | undefined {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) return undefined;
  const bound = Number(value);
  return bound <= MAX_PORTABLE_REPETITION ? bound : undefined;
}

function isPortablePatternCodePoint(codePoint: number | undefined): boolean {
  return !(
    codePoint === undefined ||
    codePoint < 0x20 ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    (codePoint >= 0xd800 && codePoint <= 0xdfff)
  );
}

function isValidUnicodePattern(pattern: string): boolean {
  if (!hasPortablePatternSyntax(pattern)) return false;
  try {
    new RegExp(normalizePortableEcmaAnchors(pattern), "u");
    return true;
  } catch {
    return false;
  }
}

function matchesUnicodePattern(value: string, pattern: string): boolean {
  try {
    return new RegExp(normalizePortableEcmaAnchors(pattern), "u").test(value);
  } catch {
    return false;
  }
}

function normalizePortableEcmaAnchors(pattern: string): string {
  let normalized = "";
  let index = 0;
  let inClass = false;
  while (index < pattern.length) {
    const character = pattern[index];
    if (character === undefined) return pattern;
    if (character === "\\") {
      normalized += pattern.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (character === "[") inClass = true;
    if (character === "]") inClass = false;
    if (character === "$" && !inClass) {
      normalized += "$(?![\\s\\S])";
      index += 1;
      continue;
    }
    const codePoint = pattern.codePointAt(index);
    if (codePoint === undefined) return pattern;
    const width = codePoint > 0xffff ? 2 : 1;
    normalized += pattern.slice(index, index + width);
    index += width;
  }
  return normalized;
}

function containsDeepDuplicate(values: readonly unknown[]): boolean {
  const seen = new Set<string>();
  for (const value of values) {
    const fingerprint = jsonSemanticFingerprint(value);
    if (seen.has(fingerprint)) return true;
    seen.add(fingerprint);
  }
  return false;
}

function jsonSemanticFingerprint(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return `boolean:${String(value)}`;
  if (typeof value === "number") {
    return `number:${value === 0 ? "0" : JSON.stringify(value)}`;
  }
  if (typeof value === "string") return `string:${JSON.stringify(value)}`;
  if (Array.isArray(value)) {
    return `array:${JSON.stringify(value.map(jsonSemanticFingerprint))}`;
  }
  if (isSchemaObject(value)) {
    const entries = Object.keys(value)
      .sort()
      .map((key) => [key, jsonSemanticFingerprint(value[key])]);
    return `object:${JSON.stringify(entries)}`;
  }
  return `non-json:${typeof value}:${String(value)}`;
}

function jsonDeepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => jsonDeepEqual(value, right[index]))
    );
  }
  if (!isSchemaObject(left) || !isSchemaObject(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.hasOwn(right, key) && jsonDeepEqual(left[key], right[key]),
    )
  );
}

function matchesNumericBounds(value: number, schema: PortableSchema): boolean {
  return !(
    (typeof schema.minimum === "number" && value < schema.minimum) ||
    (typeof schema.maximum === "number" && value > schema.maximum) ||
    (typeof schema.exclusiveMinimum === "number" &&
      value <= schema.exclusiveMinimum) ||
    (typeof schema.exclusiveMaximum === "number" &&
      value >= schema.exclusiveMaximum)
  );
}

function matchesFormat(value: string, format: unknown): boolean {
  if (!format) return true;
  if (format === "int64") return decimalInRange(value, true);
  if (format === "uint64") return decimalInRange(value, false);
  if (format === "byte") return isCanonicalBase64(value);
  if (format === "date-time") return isRfc3339(value);
  if (format === "duration") return isIso8601Duration(value);
  return false;
}

function decimalInRange(value: string, signed: boolean): boolean {
  const pattern = signed ? /^-?(0|[1-9][0-9]*)$/ : /^(0|[1-9][0-9]*)$/;
  if (!pattern.test(value)) return false;
  try {
    const number = BigInt(value);
    return signed
      ? number >= -9_223_372_036_854_775_808n &&
          number <= 9_223_372_036_854_775_807n
      : number >= 0n && number <= 18_446_744_073_709_551_615n;
  } catch {
    return false;
  }
}

function isCanonicalBase64(value: string): boolean {
  if (value === "") return true;
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    return false;
  }
  try {
    return btoa(atob(value)) === value;
  } catch {
    return false;
  }
}

function isRfc3339(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/.exec(
    value,
  );
  if (!match) return false;
  const [, year, month, day, hour, minute, second, , offsetHour = "0", offsetMinute = "0"] = match;
  const numericYear = Number(year);
  const numericMonth = Number(month);
  const leap =
    numericYear % 4 === 0 &&
    (numericYear % 100 !== 0 || numericYear % 400 === 0);
  const days = [
    0,
    31,
    leap ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][numericMonth] ?? 0;
  return (
    numericMonth >= 1 &&
    numericMonth <= 12 &&
    Number(day) >= 1 &&
    Number(day) <= days &&
    Number(hour) <= 23 &&
    Number(minute) <= 59 &&
    Number(second) <= 60 &&
    Number(offsetHour) <= 23 &&
    Number(offsetMinute) <= 59
  );
}

function isIso8601Duration(value: string): boolean {
  let index = value.startsWith("-") ? 1 : 0;
  if (value[index] !== "P") return false;
  index += 1;
  let inTime = false;
  let sawComponent = false;
  let sawTimeComponent = false;
  let lastDateOrder = -1;
  let lastTimeOrder = -1;
  let sawWeek = false;
  let sawOtherDateUnit = false;

  while (index < value.length) {
    if (value[index] === "T") {
      if (inTime || index + 1 === value.length) return false;
      inTime = true;
      index += 1;
      continue;
    }

    const digitStart = index;
    while (isAsciiDigit(value[index])) index += 1;
    if (index === digitStart) return false;

    let fractional = false;
    if (value[index] === ".") {
      fractional = true;
      index += 1;
      const fractionStart = index;
      while (isAsciiDigit(value[index])) index += 1;
      if (index === fractionStart) return false;
    }

    const unit = value[index];
    if (unit === undefined) return false;
    const order = inTime
      ? ({ H: 0, M: 1, S: 2 } as const)[unit as "H" | "M" | "S"]
      : ({ Y: 0, M: 1, W: 2, D: 3 } as const)[unit as "Y" | "M" | "W" | "D"];
    if (order === undefined) return false;

    if (inTime) {
      if (order <= lastTimeOrder) return false;
      lastTimeOrder = order;
      sawTimeComponent = true;
    } else {
      if (order <= lastDateOrder) return false;
      lastDateOrder = order;
      if (unit === "W") {
        if (sawOtherDateUnit || index + 1 !== value.length) return false;
        sawWeek = true;
      } else {
        if (sawWeek) return false;
        sawOtherDateUnit = true;
      }
    }

    sawComponent = true;
    index += 1;
    if (fractional && index !== value.length) return false;
  }

  return sawComponent && (!inTime || sawTimeComponent);
}

function isAsciiDigit(value: string | undefined): boolean {
  return value !== undefined && value >= "0" && value <= "9";
}

function schemaList(value: unknown): PortableSchema[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(isRecord);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSchemaObject(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && !Array.isArray(value);
}
