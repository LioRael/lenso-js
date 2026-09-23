export function headerValues(headers, name) {
  return headers
    .filter((item) => typeof item.name === "string" && item.name.toLowerCase() === name.toLowerCase())
    .map((item) => item.value);
}

export function workerRequestCollapsedHeaders(differences, ingressValues) {
  return differences.length > 0 && differences.every(({ name, expected, observed }) =>
    expected.length > 1 &&
    observed.length === 1 &&
    JSON.stringify(ingressValues?.[name]) === JSON.stringify(observed),
  );
}
