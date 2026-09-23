import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";

function git(root, ...args) {
  return execFileSync("git", ["--no-optional-locks", "-c", `safe.directory=${root}`, "-C", root, ...args], {
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 1024 * 1024,
  }).trim();
}

export function reviewedRustRevision(root, expectedSha) {
  if (!/^[a-f0-9]{40}$/.test(expectedSha ?? "")) {
    throw new Error("LENSO_RUST_SHA must be a full lowercase commit SHA");
  }
  const checkout = realpathSync(root);
  if (realpathSync(git(checkout, "rev-parse", "--show-toplevel")) !== checkout) {
    throw new Error("LENSO_RUST_ROOT must be the Rust checkout root");
  }
  const actualSha = git(checkout, "rev-parse", "HEAD");
  if (actualSha !== expectedSha) {
    throw new Error(`reviewed Rust SHA ${expectedSha} differs from checkout ${actualSha}`);
  }
  if (git(checkout, "status", "--porcelain=v1", "--untracked-files=all")) {
    throw new Error("reviewed Rust checkout must be clean");
  }
  return actualSha;
}
