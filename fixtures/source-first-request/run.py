#!/usr/bin/env python3
"""Qualify the Request projection in real workerd, with two Plugin Instances."""
import argparse
import hashlib
import http.client
import json
from pathlib import Path
import signal
import socket
import subprocess
import time


def get(port, path):
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
    try:
        connection.request("GET", path)
        response = connection.getresponse()
        return response.status, response.read().decode()
    finally:
        connection.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workerd", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--expect", default="hello")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    binary = args.workerd.resolve(strict=True)
    artifact = root / "dist/worker.mjs"
    evidence = {
        "workerd": subprocess.check_output([str(binary), "--version"], text=True).strip(),
        "binary_sha256": hashlib.sha256(binary.read_bytes()).hexdigest(),
        "artifact_sha256": hashlib.sha256(artifact.read_bytes()).hexdigest(),
        "source_sha256": hashlib.sha256((root / "plugin.ts").read_bytes()).hexdigest(),
        "proof_scope": "real workerd JS Request projection; explicit Host routes; no Rust Kernel/Plan integration",
        "cases": [],
    }
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen()
    port = listener.getsockname()[1]
    process = None
    started = time.monotonic()
    try:
        with args.output.with_suffix(".log").open("wb") as log:
            process = subprocess.Popen(
                [str(binary), "serve", str(root / "config.capnp"), "--socket-fd", f"http={listener.fileno()}"],
                stdout=log, stderr=subprocess.STDOUT, pass_fds=(listener.fileno(),),
            )
            listener.close()
            deadline = time.monotonic() + 5
            while True:
                if process.poll() is not None:
                    raise RuntimeError(f"workerd exited: {process.returncode}")
                try:
                    if get(port, "/health") == (200, "ready"):
                        break
                except OSError:
                    pass
                if time.monotonic() >= deadline:
                    raise TimeoutError("workerd readiness")
                time.sleep(0.025)
            evidence["readiness_seconds"] = round(time.monotonic() - started, 4)
            for event in range(2):
                status, body = get(port, "/")
                assert status == 200, (status, body)
                result = json.loads(body)
                for key, count, name in [("first", 1, "Ada"), ("second", 2, "Grace")]:
                    expected = {"kind": "success", "value": {"value": {
                        "message": f"{args.expect} consumer-b", "calls": count,
                        "input": {"name": name}, "upstream": {
                            "message": f"{args.expect} provider-a", "calls": count,
                            "input": {"name": name},
                        },
                    }}}
                    assert result[key] == expected, result[key]
                evidence["cases"].append({"event": event, "passed": True, "observation": result})
            evidence["passed"] = True
    except Exception as error:
        evidence["passed"] = False
        evidence["error"] = repr(error)
    finally:
        listener.close()
        if process:
            if process.poll() is None:
                process.send_signal(signal.SIGTERM)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
                evidence["passed"] = False
                evidence["cleanup_error"] = "workerd required SIGKILL"
            evidence["exit_code"] = process.returncode
        with socket.socket() as probe:
            evidence["port_closed"] = probe.connect_ex(("127.0.0.1", port)) != 0
        evidence["total_seconds"] = round(time.monotonic() - started, 4)
        args.output.write_text(json.dumps(evidence, indent=2) + "\n")
    print(json.dumps(evidence))
    return int(not evidence["passed"] or not evidence["port_closed"])


if __name__ == "__main__":
    raise SystemExit(main())
