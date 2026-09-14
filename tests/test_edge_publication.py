import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from scripts.edge_publication import DataPublisher


class PublicationTests(unittest.TestCase):
    def test_data_branch_handover_preserves_main_and_restart_loads_latest_data(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp); root = base / "code"; remote = base / "remote.git"
            def run(cwd, *args):
                return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()
            run(base, "init", "--bare", str(remote)); run(base, "init", "-b", "main", str(root))
            run(root, "config", "user.name", "test"); run(root, "config", "user.email", "test@example.invalid")
            (root / "web").mkdir(); (root / "web/vercel.json").write_text('{"regions":["hnd1"]}')
            state = root / "state/edge_v2/index.json"; state.parent.mkdir(parents=True); state.write_text('{"revision":1}')
            run(root, "add", "."); run(root, "commit", "-m", "fixture"); run(root, "remote", "add", "origin", str(remote))
            run(root, "push", "-u", "origin", "main")
            publisher = DataPublisher(root, base / "data")
            state.write_text('{"revision":2}'); publisher.persist()
            self.assertEqual(json.loads(run(remote, "show", "main:state/edge_v2/index.json"))["revision"], 2)
            before = run(remote, "rev-parse", "main")
            publisher.acknowledge({"storage_branch": "wrong"}); self.assertFalse(publisher.ready)
            publisher.acknowledge({"storage_branch": "edge-data"}); state.write_text('{"revision":3}'); publisher.persist()
            self.assertEqual(run(remote, "rev-parse", "main"), before)
            self.assertEqual(json.loads(run(remote, "show", "edge-data:state/edge_v2/index.json"))["revision"], 3)
            self.assertFalse(json.loads(run(remote, "show", "edge-data:web/vercel.json"))["git"]["deploymentEnabled"])
            self.assertNotIn("git", json.loads(run(remote, "show", "main:web/vercel.json")))
            restarted = DataPublisher(root, base / "data2")
            self.assertEqual(json.loads(state.read_text())["revision"], 3)


if __name__ == "__main__": unittest.main()
