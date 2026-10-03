#!/usr/bin/env python3
"""Qualify generated Request/Stream sessions and physical cleanup in real workerd."""
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
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    binary = args.workerd.resolve(strict=True)
    artifact = root / "dist/worker.mjs"
    evidence = {
        "workerd": subprocess.check_output([str(binary), "--version"], text=True).strip(),
        "binary_sha256": hashlib.sha256(binary.read_bytes()).hexdigest(),
        "artifact_sha256": hashlib.sha256(artifact.read_bytes()).hexdigest(),
        "source_sha256": hashlib.sha256((root / "plugin.ts").read_bytes()).hexdigest(),
        "proof_scope": "real workerd JS Request/Stream projection with typed Stream dependency; no Rust Kernel/Plan integration",
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
            for mode in ["complete", "cancel", "domain"]:
                status, body = get(port, "/" + mode)
                assert status == 200, (status, body)
                result = json.loads(body)
                if mode == "domain":
                    assert result["result"] == {"kind": "domain", "value": "room_closed"}, result
                    assert result["stats"] == {name: {"produced": 0, "cleaned": 0} for name in ["provider", "consumer"]}, result
                else:
                    assert result["before"] == {name: {"produced": 0, "cleaned": 0} for name in ["provider", "consumer"]}, result
                    assert result["afterFirst"] == {name: {"produced": 1, "cleaned": 0} for name in ["provider", "consumer"]}, result
                    assert result["capacity"]["failure"]["kind"] == "resource_exhausted", result
                    assert result["halfClose"] == {"kind": "accepted"}, result
                    assert result["closed"] is True, result
                    count = 3 if mode == "complete" else 1
                    assert result["final"] == {name: {"produced": count, "cleaned": 1} for name in ["provider", "consumer"]}, result
                    if mode == "complete":
                        assert result["messages"] == [
                            *[{"kind": "message", "value": {"text": f"consumer-b: provider-a: {index}"}} for index in range(3)],
                            {"kind": "terminal_success"},
                        ], result
                    else:
                        assert result["overlap"]["failure"]["kind"] == "resource_exhausted", result
                        assert result["late"]["failure"]["kind"] == "cancelled", result
                        assert result["closedDuringCleanup"] is False, result
                        assert "physically settled" in result["prematureStop"], result
                evidence["cases"].append({"mode": mode, "passed": True, "observation": result})
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
