#!/usr/bin/env python3
"""Six bounded real-workerd cases. Exit 1 means a fixed invariant failed."""
import argparse
import datetime
import hashlib
import http.client
import json
import os
from pathlib import Path
import platform
import signal
import socket
import subprocess
import sys
import time


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args], text=True).strip()


def get(port, path):
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
    try:
        connection.request("GET", path)
        response = connection.getresponse()
        return response.status, response.read().decode()
    finally:
        connection.close()


def check_case(boundary, mode, status, value):
    failed = []
    def equal(label, actual, expected):
        if actual != expected:
            failed.append({"field": label, "actual": actual, "expected": expected})
    rejected = mode == "abort-reject"
    equal("clean", value["clean"], not rejected)
    equal("closed", value["closed"], True)
    equal("invalidated", value["invalidated"], rejected or boundary == "host")
    equal("cleanupFinished", value["cleanupFinished"], True)
    equal("abortCalls", value["abortCalls"], int(mode.startswith("abort-")))
    expected_outcome = {"kind": "fulfilled", "value": "cancelled-native"}
    if mode == "complete":
        expected_outcome = {"kind": "fulfilled", "value": 42}
    elif mode == "domain-reject":
        expected_outcome = {"kind": "rejected", "error": "domain rejection"}
    equal("outcome", value["outcome"], expected_outcome)
    if boundary == "host":
        equal("http_status", status, 503 if rejected else 200)
        equal("inner_status", value["status"], status)
        equal("receipts", value["receipts"], 0 if rejected else 1)
        equal("body", value["body"], '{"error":"storage_cleanup_unconfirmed"}' if rejected else "ok")
        expected_trace = ["app-complete", "abort", "cleanup-rejected" if rejected else "cleanup-resolved"]
        if not rejected:
            expected_trace.append("receipt")
        expected_trace.append("host-return")
        equal("trace", value["trace"], expected_trace)
    else:
        equal("http_status", status, 200)
        equal("cachedSettlement", value["cachedSettlement"], True)
        equal("cancellationCallbacks", value["cancellationCallbacks"], int(mode.startswith("abort-")))
        equal("admission", value["admission"], {"kind": "rejected", "error": "event_scope_closed"})
        expected_trace = [] if not mode.startswith("abort-") else ["abort", "cleanup-rejected" if rejected else "cleanup-resolved", "settled"]
        equal("trace", value["trace"], expected_trace)
    return failed


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workerd", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    fixture = Path(__file__).resolve().parent
    root = fixture.parent.parent
    binary = args.workerd.resolve(strict=True)
    args.output.mkdir(parents=True, exist_ok=False)
    evidence = {"started_at": now(), "harness_pid": os.getpid(),
        "source_head": git(root, "rev-parse", "HEAD"),
        "source_tree": git(root, "rev-parse", "HEAD^{tree}"),
        "source_status": git(root, "status", "--porcelain"),
        "platform": platform.platform(), "python": sys.version,
        "workerd_binary": str(binary), "workerd_sha256": digest(binary),
        "workerd_version": subprocess.check_output([str(binary), "--version"], text=True).strip(),
        "source_sha256": {str(path.relative_to(root)): digest(path) for path in sorted([
            *fixture.glob("*.mjs"), *fixture.glob("*.capnp"), Path(__file__).resolve(),
            *(root / "packages/lenso-workers-runtime" / name for name in ["scope.mjs", "host.mjs", "http.mjs", "runner.mjs", "clock.mjs"])
        ])}, "cases": []}
    process = None
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen()
    port = listener.getsockname()[1]
    evidence["port"] = port
    command = [str(binary), "serve", str(fixture / "config.capnp"), "--socket-fd", f"http={listener.fileno()}"]
    evidence["command"] = command
    exit_code = 2
    try:
        with (args.output / "workerd.log").open("wb") as log:
            process = subprocess.Popen(command, cwd=root, stdout=log, stderr=subprocess.STDOUT,
                pass_fds=(listener.fileno(),))
            evidence["workerd_pid"] = process.pid
            listener.close()
            deadline = time.monotonic() + 10
            while True:
                if process.poll() is not None:
                    raise RuntimeError(f"workerd exited during startup: {process.returncode}")
                try:
                    if get(port, "/health") == (200, "ready"):
                        break
                except (OSError, http.client.HTTPException):
                    pass
                if time.monotonic() > deadline:
                    raise TimeoutError("workerd readiness deadline")
                time.sleep(0.025)
            for boundary, modes in [("scope", ["complete", "domain-reject", "abort-resolve", "abort-reject"]),
                                    ("host", ["abort-resolve", "abort-reject"])]:
                for mode in modes:
                    status, body = get(port, f"/{boundary}?case={mode}")
                    value = json.loads(body)
                    failures = check_case(boundary, mode, status, value)
                    evidence["cases"].append({"name": f"{boundary}/{mode}", "http_status": status,
                        "observation": value, "failures": failures, "passed": not failures})
            evidence["health_after"] = get(port, "/health")
            evidence["failed_cases"] = [case["name"] for case in evidence["cases"] if not case["passed"]]
            exit_code = int(bool(evidence["failed_cases"]))
    except Exception as error:
        evidence["harness_error"] = repr(error)
    finally:
        listener.close()
        if process is not None:
            evidence["server_running_before_stop"] = process.poll() is None
            evidence["stop_signal"] = "SIGTERM"
            if process.poll() is None:
                process.send_signal(signal.SIGTERM)
            try:
                evidence["workerd_exit_code"] = process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                evidence["stop_escalation"] = "SIGKILL"
                process.kill()
                evidence["workerd_exit_code"] = process.wait(timeout=5)
                exit_code = 2
            try:
                os.kill(process.pid, 0)
                evidence["pid_gone"] = False
            except ProcessLookupError:
                evidence["pid_gone"] = True
        with socket.socket() as probe:
            probe.settimeout(1)
            evidence["port_closed"] = probe.connect_ex(("127.0.0.1", port)) != 0
        if not evidence.get("pid_gone") or not evidence["port_closed"]:
            exit_code = 2
        evidence["finished_at"] = now()
        evidence["harness_exit_code"] = exit_code
        (args.output / "result.json").write_text(json.dumps(evidence, indent=2) + "\n")
    print(json.dumps({"output": str(args.output), "failed_cases": evidence.get("failed_cases"),
        "harness_error": evidence.get("harness_error"), "exit": exit_code,
        "workerd_exit": evidence.get("workerd_exit_code"), "pid_gone": evidence.get("pid_gone"),
        "port_closed": evidence.get("port_closed")}))
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
