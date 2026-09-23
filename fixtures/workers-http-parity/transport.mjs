import http from "node:http";

// Node's raw HTTP client can send TRACE and repeated field lines that Fetch
// may reject or coalesce before the Worker sees them.
export function send(base, vector) {
  const target = new URL(base);
  const body = Buffer.from(vector.body);
  const headers = vector.headers.flat();
  if (!headers.some((_, index) => index % 2 === 0 && headers[index].toLowerCase() === "host")) {
    headers.push("Host", target.host);
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: vector.uri,
        method: vector.method,
        headers,
        agent: false,
      },
      (response) => {
        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > 131_072) {
            response.destroy(new Error("response exceeds parity transport bound"));
          } else {
            chunks.push(chunk);
          }
        });
        response.on("error", fail);
        response.on("end", () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks, size),
          });
        });
      },
    );
    const timer = setTimeout(() => request.destroy(new Error("parity transport deadline")), 10_000);
    function fail(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    }
    request.on("error", fail);
    request.end(body);
  });
}
