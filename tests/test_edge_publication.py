import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

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

    def test_push_response_loss_is_accepted_only_when_remote_has_local_commit(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp); root = base / "code"; remote = base / "remote.git"
            def run(cwd, *args):
                return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()
            run(base, "init", "--bare", str(remote)); run(base, "init", "-b", "main", str(root))
            run(root, "config", "user.name", "test"); run(root, "config", "user.email", "test@example.invalid")
            (root / "web").mkdir(); (root / "web/vercel.json").write_text("{}")
            state = root / "state/edge_v2/index.json"; state.parent.mkdir(parents=True); state.write_text('{"revision":1}')
            run(root, "add", "."); run(root, "commit", "-m", "fixture"); run(root, "remote", "add", "origin", str(remote))
            run(root, "push", "-u", "origin", "main")
            publisher = DataPublisher(root, base / "data")
            original_git = publisher.git
            response_lost = False

            def ambiguous_git(folder, *args, check=True):
                nonlocal response_lost
                if args[:2] == ("push", "origin") and not response_lost:
                    response_lost = True
                    original_git(folder, *args)
                    return subprocess.CompletedProcess(["git", *args], 1, "", "simulated response loss")
                return original_git(folder, *args, check=check)

            publisher.git = ambiguous_git
            state.write_text('{"revision":2}')
            publisher.persist()
            self.assertTrue(response_lost)
            self.assertEqual(json.loads(run(remote, "show", "edge-data:state/edge_v2/index.json"))["revision"], 2)

    def test_push_and_several_verification_response_losses_do_not_false_stop(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp); root = base / "code"; remote = base / "remote.git"
            def run(cwd, *args):
                return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()
            run(base, "init", "--bare", str(remote)); run(base, "init", "-b", "main", str(root))
            run(root, "config", "user.name", "test"); run(root, "config", "user.email", "test@example.invalid")
            (root / "web").mkdir(); (root / "web/vercel.json").write_text("{}")
            state = root / "state/edge_v2/index.json"; state.parent.mkdir(parents=True); state.write_text('{"revision":1}')
            run(root, "add", "."); run(root, "commit", "-m", "fixture"); run(root, "remote", "add", "origin", str(remote))
            run(root, "push", "-u", "origin", "main")
            publisher = DataPublisher(root, base / "data")
            original_git = publisher.git
            publisher.push_verify_seconds = 0
            push_response_lost = False
            verification_responses = 0

            def ambiguous_git(folder, *args, check=True):
                nonlocal push_response_lost, verification_responses
                if args[:2] == ("push", "origin") and not push_response_lost:
                    push_response_lost = True
                    original_git(folder, *args)
                    return subprocess.CompletedProcess(["git", *args], 1, "", "simulated response loss")
                if args[:2] == ("ls-remote", "--exit-code"):
                    verification_responses += 1
                    if verification_responses <= 3:
                        return subprocess.CompletedProcess(["git", *args], 1, "", "simulated verification loss")
                return original_git(folder, *args, check=check)

            publisher.git = ambiguous_git
            state.write_text('{"revision":2}')
            publisher.persist()
            self.assertTrue(push_response_lost)
            self.assertEqual(verification_responses, 4)
            self.assertEqual(json.loads(run(remote, "show", "edge-data:state/edge_v2/index.json"))["revision"], 2)

    def test_rejected_push_still_raises_when_remote_does_not_have_local_commit(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp); root = base / "code"; remote = base / "remote.git"
            def run(cwd, *args):
                return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()
            run(base, "init", "--bare", str(remote)); run(base, "init", "-b", "main", str(root))
            run(root, "config", "user.name", "test"); run(root, "config", "user.email", "test@example.invalid")
            (root / "web").mkdir(); (root / "web/vercel.json").write_text("{}")
            state = root / "state/edge_v2/index.json"; state.parent.mkdir(parents=True); state.write_text('{"revision":1}')
            run(root, "add", "."); run(root, "commit", "-m", "fixture"); run(root, "remote", "add", "origin", str(remote))
            run(root, "push", "-u", "origin", "main")
            publisher = DataPublisher(root, base / "data")
            original_git = publisher.git

            def rejected_git(folder, *args, check=True):
                if args[:2] == ("push", "origin"):
                    return subprocess.CompletedProcess(["git", *args], 1, "", "simulated rejection")
                return original_git(folder, *args, check=check)

            publisher.git = rejected_git
            state.write_text('{"revision":2}')
            with self.assertRaises(subprocess.CalledProcessError):
                publisher.persist()

    def test_one_transient_push_failure_retries_only_while_remote_is_unchanged(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp); root = base / "code"; remote = base / "remote.git"
            def run(cwd, *args):
                return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()
            run(base, "init", "--bare", str(remote)); run(base, "init", "-b", "main", str(root))
            run(root, "config", "user.name", "test"); run(root, "config", "user.email", "test@example.invalid")
            (root / "web").mkdir(); (root / "web/vercel.json").write_text("{}")
            state = root / "state/edge_v2/index.json"; state.parent.mkdir(parents=True); state.write_text('{"revision":1}')
            run(root, "add", "."); run(root, "commit", "-m", "fixture"); run(root, "remote", "add", "origin", str(remote))
            run(root, "push", "-u", "origin", "main")
            publisher = DataPublisher(root, base / "data")
            state.write_text('{"revision":2}')
            publisher.persist()
            publisher.ready = True
            original_git = publisher.git
            publisher.push_retry_seconds = 0
            pushes = 0

            def transient_once(folder, *args, check=True):
                nonlocal pushes
                if args[:2] == ("push", "origin"):
                    pushes += 1
                    if pushes == 1:
                        return subprocess.CompletedProcess(
                            ["git", *args], 1, "", "RPC failed; HTTP/2 stream was reset")
                return original_git(folder, *args, check=check)

            publisher.git = transient_once
            state.write_text('{"revision":3}')
            publisher.persist()
            self.assertEqual(pushes, 2)
            self.assertEqual(json.loads(run(remote, "show", "edge-data:state/edge_v2/index.json"))["revision"], 3)

    def test_auth_or_unknown_push_failure_never_retries(self):
        for message, category in (("fatal: Authentication failed", "hard_stop"),
                                  ("simulated rejection", "unknown")):
            with self.subTest(message=message), tempfile.TemporaryDirectory() as tmp:
                base = Path(tmp); root = base / "code"; remote = base / "remote.git"
                def run(cwd, *args):
                    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()
                run(base, "init", "--bare", str(remote)); run(base, "init", "-b", "main", str(root))
                run(root, "config", "user.name", "test"); run(root, "config", "user.email", "test@example.invalid")
                (root / "web").mkdir(); (root / "web/vercel.json").write_text("{}")
                state = root / "state/edge_v2/index.json"; state.parent.mkdir(parents=True); state.write_text('{"revision":1}')
                run(root, "add", "."); run(root, "commit", "-m", "fixture"); run(root, "remote", "add", "origin", str(remote))
                run(root, "push", "-u", "origin", "main")
                publisher = DataPublisher(root, base / "data")
                state.write_text('{"revision":2}')
                publisher.persist()
                publisher.ready = True
                original_git = publisher.git
                pushes = 0

                def rejected(folder, *args, check=True):
                    nonlocal pushes
                    if args[:2] == ("push", "origin"):
                        pushes += 1
                        return subprocess.CompletedProcess(["git", *args], 1, "", message)
                    return original_git(folder, *args, check=check)

                publisher.git = rejected
                state.write_text('{"revision":3}')
                with self.assertRaises(subprocess.CalledProcessError) as raised:
                    publisher.persist()
                self.assertEqual(pushes, 1)
                diagnostics = raised.exception.edge_publication_diagnostics
                self.assertEqual({key: diagnostics[key] for key in
                                  ("operation", "category", "retryAttempted")},
                    {"operation":"push_edge_data", "category":category, "retryAttempted":False})
                self.assertEqual(diagnostics["returncode"], 1)
                self.assertEqual(diagnostics["localHead"], run(publisher.folder, "rev-parse", "HEAD"))
                self.assertEqual(diagnostics["parentHead"], diagnostics["remoteHeadBeforeRetry"])

    def test_push_timeout_verifies_the_remote_without_replaying_the_push(self):
        head, parent = "a" * 40, "b" * 40
        for remote, stderr, category in (
            (head, b"", None),
            (parent, b"", "transient_transport"),
            (parent, b"Authentication failed", "hard_stop"),
        ):
            with self.subTest(remote=remote, category=category):
                publisher = DataPublisher.__new__(DataPublisher)
                publisher.folder = Path(".")
                publisher.push_verify_seconds = 0
                command = ["git", "push", "origin", "HEAD:refs/heads/edge-data"]
                timeout = subprocess.TimeoutExpired(command, 90, stderr=stderr)
                results = [
                    subprocess.CompletedProcess([], 0, head + "\n"),
                    subprocess.CompletedProcess([], 0, parent + "\n"),
                    timeout,
                ]
                if remote == head:
                    results.append(subprocess.TimeoutExpired(["git", "ls-remote"], 90))
                results.append(subprocess.CompletedProcess([], 0, remote + "\trefs/heads/edge-data\n"))
                publisher.git = Mock(side_effect=results)
                if category is None:
                    publisher.push_data_branch()
                else:
                    with self.assertRaises(subprocess.CalledProcessError) as raised:
                        publisher.push_data_branch()
                    evidence = raised.exception.edge_publication_diagnostics
                    self.assertEqual(evidence["operation"], "push_edge_data")
                    self.assertEqual(evidence["category"], category)
                    self.assertFalse(evidence["retryAttempted"])
                    self.assertEqual(evidence["localHead"], head)
                    self.assertEqual(evidence["parentHead"], parent)
                    self.assertEqual(evidence["remoteHeadBeforeRetry"], remote)
                pushes = [call for call in publisher.git.call_args_list if call.args[1] == "push"]
                self.assertEqual(len(pushes), 1)

    def test_output_evidence_does_not_persist_credentials_or_arbitrary_text(self):
        result = subprocess.CompletedProcess(["git", "push"], 1, "secret-output",
            "fatal: https://user:secret-password@example.invalid/path?token=secret-token "
            "Authorization: Bearer private-value; remote rejected; cannot lock ref")
        evidence = DataPublisher.output_evidence(result)
        serialized = json.dumps(evidence)
        for secret in ("secret-output", "secret-password", "secret-token", "private-value", "example.invalid"):
            self.assertNotIn(secret, serialized)
        self.assertEqual(evidence["stderr"]["signals"], ["remote rejected", "cannot lock ref"])
        self.assertEqual(len(evidence["stderr"]["sha256"]), 64)

    def test_empty_output_has_explicit_evidence(self):
        evidence = DataPublisher.output_evidence(subprocess.CompletedProcess(["git"], 1, None, b""))
        self.assertEqual(evidence["stdout"]["bytes"], 0)
        self.assertEqual(evidence["stderr"]["signals"], [])
        self.assertEqual(evidence["stdout"], evidence["stderr"])


if __name__ == "__main__": unittest.main()
