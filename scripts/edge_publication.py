"""Separate frequently changing observations from deployable application commits."""
from __future__ import annotations

import json
import shutil
import subprocess


class DataPublisher:
    branch = "edge-data"

    def __init__(self, root, folder):
        self.root, self.folder = root, folder
        self.ready = False
        probe = self.git(root, "ls-remote", "--exit-code", "--heads", "origin", self.branch, check=False)
        if probe.returncode not in (0, 2):
            raise RuntimeError("Data branch discovery failed")
        exists = probe.returncode == 0
        if exists:
            self.git(root, "fetch", "--depth", "1", "origin", self.branch)
            self.git(root, "worktree", "add", "--detach", str(folder), "FETCH_HEAD")
        else:
            self.git(root, "worktree", "add", "--detach", str(folder), "HEAD")
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
    def git(folder, *args, check=True):
        return subprocess.run(["git", *args], cwd=folder, check=check, capture_output=True, text=True, timeout=90)

    def persist(self):
        shutil.copytree(self.root / "state/edge_v2", self.folder / "state/edge_v2", dirs_exist_ok=True)
        self.git(self.folder, "add", "--", "state/edge_v2", "vercel.json", "web/vercel.json")
        if self.git(self.folder, "diff", "--cached", "--quiet", check=False).returncode == 1:
            self.git(self.folder, "commit", "-m", "Record EDGE observations without deploying the application")
            self.git(self.folder, "push", "origin", f"HEAD:refs/heads/{self.branch}")
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
