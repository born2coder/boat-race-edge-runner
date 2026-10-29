"""Separate frequently changing observations from deployable application commits."""
from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import time


class DataPublisher:
    branch = "edge-data"
    push_retry_seconds = 10
    # GitHub can accept a push while both the push response and several
    # immediately following ls-remote responses are unavailable. Keep this a
    # bounded verification-only window: never replay the push while the remote
    # result is unknown, and never poll after a classified authentication or
    # policy failure.
    push_verify_attempts = 5
    push_verify_seconds = 2
    bootstrap_fetch_timeout_seconds = 300

    def __init__(self, root, folder):
        self.root, self.folder = root, folder
        self.ready = False
        probe = self.git(root, "ls-remote", "--exit-code", "--heads", "origin", self.branch, check=False)
        if probe.returncode not in (0, 2):
            raise RuntimeError("Data branch discovery failed")
        exists = probe.returncode == 0
        if exists:
            self.git(
                root, "fetch", "--depth", "1", "origin", self.branch,
                timeout=self.bootstrap_fetch_timeout_seconds,
            )
            self.git(root, "worktree", "add", "--detach", str(folder), "FETCH_HEAD")
        else:
            self.git(root, "worktree", "add", "--detach", str(folder), "HEAD")
        self.revision = self.git(folder, "rev-parse", "HEAD").stdout.strip()
        if exists and (folder / "state/edge_v2").exists():
            shutil.copytree(folder / "state/edge_v2", root / "state/edge_v2", dirs_exist_ok=True)
        # Vercel evaluates this branch's configuration before creating a build.
        # Application deployments on main remain enabled.
        for name in ("vercel.json", "web/vercel.json"):
            path = folder / name
            config = json.loads(path.read_text()) if path.exists() else {}
            config["git"] = {"deploymentEnabled": False}
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(config, indent=2) + "\n")

    @staticmethod
    def git(folder, *args, check=True, timeout=90):
        return subprocess.run(
            ["git", *args], cwd=folder, check=check,
            capture_output=True, text=True, timeout=timeout,
        )

    def push_data_branch(self):
        """Verify ambiguous success and retry one safe transient transport failure.

        The retry is allowed only while the remote still points at this commit's
        parent. Authentication, quota/rate-limit, policy and non-fast-forward
        failures remain hard stops. This avoids replaying over a concurrent
        writer while preventing a short GitHub transport failure from pausing
        the full research day.
        """
        head = self.git(self.folder, "rev-parse", "HEAD").stdout.strip()
        parent_result = self.git(self.folder, "rev-parse", "HEAD^", check=False)
        parent = parent_result.stdout.strip() if parent_result.returncode == 0 else ""
        pushed = self.git(
            self.folder, "push", "origin", f"HEAD:refs/heads/{self.branch}", check=False)
        if pushed.returncode == 0:
            return
        category = self.push_failure_category(pushed)
        remote_head = self.remote_head()
        if remote_head == head:
            return
        # A push can reach GitHub even when the client loses the final response.
        # If the first verification request also loses its response, briefly
        # verify again without replaying the push. A concrete, different remote
        # head still stops immediately, and authentication failures are never
        # polled or retried.
        if not remote_head and category != "hard_stop":
            for _ in range(self.push_verify_attempts - 1):
                time.sleep(self.push_verify_seconds)
                remote_head = self.remote_head()
                if remote_head == head:
                    return
                if remote_head:
                    break
        retry = category == "transient_transport" and remote_head == parent
        if retry:
            time.sleep(self.push_retry_seconds)
            retried = self.git(
                self.folder, "push", "origin", f"HEAD:refs/heads/{self.branch}", check=False)
            if retried.returncode == 0 or self.remote_head() == head:
                return
            self.raise_push_error(
                retried, self.push_failure_category(retried), retry_attempted=True,
                head=head, parent=parent, remote_head=remote_head)
        self.raise_push_error(pushed, category, retry_attempted=False,
                              head=head, parent=parent, remote_head=remote_head)

    def remote_head(self):
        remote = self.git(
            self.folder, "ls-remote", "--exit-code", "--heads", "origin",
            f"refs/heads/{self.branch}", check=False)
        return remote.stdout.split(maxsplit=1)[0] if remote.returncode == 0 and remote.stdout.strip() else ""

    @staticmethod
    def push_failure_category(result):
        detail = (result.stderr or "").lower()
        hard_stop = (
            "authentication failed", "permission denied", "repository not found",
            "could not read username", "write access to repository not granted",
            "non-fast-forward", "fetch first", "stale info", "rate limit",
            "too many requests", "error: 401", "error: 403", "error: 429",
        )
        transient = (
            "connection reset", "remote end hung up", "unexpected disconnect",
            "http/2 stream", "rpc failed", "tls connection", "failed to connect",
            "connection timed out", "operation timed out", "error: 500",
            "error: 502", "error: 503", "error: 504", "internal server error",
            "service unavailable", "gateway timeout",
        )
        if any(marker in detail for marker in hard_stop):
            return "hard_stop"
        if any(marker in detail for marker in transient):
            return "transient_transport"
        return "unknown"

    @staticmethod
    def raise_push_error(result, category, *, retry_attempted,
                         head="", parent="", remote_head=""):
        error = subprocess.CalledProcessError(
            result.returncode, result.args, result.stdout, result.stderr)
        error.edge_publication_diagnostics = {
            "operation": "push_edge_data",
            "category": category,
            "retryAttempted": retry_attempted,
            "returncode": result.returncode,
            "localHead": head,
            "parentHead": parent,
            "remoteHeadBeforeRetry": remote_head,
            "outputEvidence": DataPublisher.output_evidence(result),
        }
        raise error

    @staticmethod
    def output_evidence(result):
        """Persist fingerprints and fixed signals, never arbitrary Git output.

        Git output can contain credential-bearing URLs, headers and server text.
        A denylist is insufficient: only known literal signals leave the runner.
        Hashes also distinguish empty output from repeated identical failures.
        """
        signals = (
            "authentication failed", "permission denied", "repository not found",
            "non-fast-forward", "fetch first", "remote rejected", "remote failure",
            "failed to push some refs", "pre-receive hook declined", "cannot lock ref",
            "connection reset", "remote end hung up", "unexpected disconnect",
            "rpc failed", "http/2 stream", "tls connection", "timed out",
            "could not resolve host", "empty reply from server", "broken pipe",
            "internal server error", "service unavailable", "rate limit",
        )
        evidence = {}
        for stream in ("stdout", "stderr"):
            value = getattr(result, stream, None) or ""
            raw = value.encode("utf-8") if isinstance(value, str) else value
            lowered = raw.decode("utf-8", errors="replace").lower()
            evidence[stream] = {
                "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
                "signals": [signal for signal in signals if signal in lowered],
            }
        return evidence

    def persist(self):
        shutil.copytree(self.root / "state/edge_v2", self.folder / "state/edge_v2", dirs_exist_ok=True)
        self.git(self.folder, "add", "--", "state/edge_v2", "vercel.json", "web/vercel.json")
        if self.git(self.folder, "diff", "--cached", "--quiet", check=False).returncode == 1:
            self.git(self.folder, "commit", "-m", "Record EDGE observations without deploying the application")
            self.push_data_branch()
        self.revision = self.git(self.folder, "rev-parse", "HEAD").stdout.strip()
        # Keep the old production UI alive until its receipt endpoint positively
        # acknowledges the new branch. This is a one-way, compatible handover.
        if not self.ready:
            self.git(self.root, "add", "--", "state/edge_v2")
            if self.git(self.root, "diff", "--cached", "--quiet", check=False).returncode == 1:
                self.git(self.root, "commit", "-m", "Mirror EDGE data during publication migration")
            self.git(self.root, "pull", "--rebase", "origin", "main")
            self.git(self.root, "push", "origin", "HEAD:main")

    def acknowledge(self, receipt):
        if receipt.get("storage_branch") == self.branch:
            self.ready = True
