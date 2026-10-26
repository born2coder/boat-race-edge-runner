import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.edge_publication import DataPublisher


class PublicationBootstrapTests(unittest.TestCase):
    def test_existing_data_branch_uses_extended_timeout_only_for_bootstrap_fetch(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "root"
            folder = Path(tmp) / "data"
            root.mkdir()
            calls = []

            def fake_git(cwd, *args, check=True, timeout=90):
                calls.append((args, check, timeout))
                if args[0] == "ls-remote":
                    return subprocess.CompletedProcess(args, 0, "abc refs/heads/edge-data\n", "")
                if args[:2] == ("worktree", "add"):
                    folder.mkdir(parents=True)
                if args[:2] == ("rev-parse", "HEAD"):
                    return subprocess.CompletedProcess(args, 0, "abc\n", "")
                return subprocess.CompletedProcess(args, 0, "", "")

            with patch.object(DataPublisher, "git", side_effect=fake_git):
                DataPublisher(root, folder)

            fetch = next(call for call in calls if call[0][0] == "fetch")
            self.assertEqual(fetch[2], 300)
            ordinary = [call for call in calls if call[0][0] != "fetch"]
            self.assertTrue(all(call[2] == 90 for call in ordinary))


if __name__ == "__main__":
    unittest.main()
