import copy
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

from scripts.edge_publication import DataPublisher
from scripts import watch_research_forward as flow


class ConfirmedDeliveryRecoveryTests(unittest.TestCase):
    def fixture(self, root):
        code, remote = root / 'code', root / 'remote.git'
        def git(cwd, *args):
            return subprocess.run(['git', *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()
        git(root, 'init', '--bare', str(remote)); git(root, 'init', '-b', 'main', str(code))
        git(code, 'config', 'user.name', 'test'); git(code, 'config', 'user.email', 'test@example.invalid')
        state = {'date': '2026-11-05', 'forward_observations_sent': ['ack-1'], 'races': {}}
        path = code / 'state/edge_v2/days/2026-11-05.json'
        path.parent.mkdir(parents=True); path.write_text(json.dumps(state))
        git(code, 'add', '.'); git(code, 'commit', '-m', 'initial'); git(code, 'remote', 'add', 'origin', str(remote))
        git(code, 'push', '-u', 'origin', 'main')
        publisher = DataPublisher(code, root / 'data'); publisher.ready = True
        state['forward_last_send_completed_at'] = '2026-11-05T01:00:00Z'
        path.write_text(json.dumps(state))
        real_git = publisher.git
        def reject_once(folder, *args, **kwargs):
            if args[:2] == ('push', 'origin'):
                return subprocess.CompletedProcess(['git', *args], 1, '', 'remote rejected; failed to push some refs')
            return real_git(folder, *args, **kwargs)
        with patch.object(publisher, 'git', side_effect=reject_once):
            try: publisher.persist()
            except subprocess.CalledProcessError as error: failure = error
        stop = code / 'state/edge_v2/forward-paused.json'
        stop.write_text(json.dumps({'git': failure.edge_publication_diagnostics, 'stage': 'persist_delivery'}))
        publisher.persist()  # Existing stop-save succeeds, carrying the failed data commit.
        return publisher, state, path, stop, failure, git, remote

    def test_confirmed_checkpoint_recovers_once_without_replaying_receipts(self):
        with tempfile.TemporaryDirectory() as tmp:
            publisher, state, path, stop, error, git, remote = self.fixture(Path(tmp))
            original, sent = stop.read_bytes(), copy.deepcopy(state['forward_observations_sent'])
            main = git(remote, 'rev-parse', 'main')
            self.assertTrue(flow.resume_confirmed_delivery(state, path, stop, publisher, error, 'persist_delivery'))
            self.assertFalse(stop.exists())
            self.assertEqual(git(remote, 'rev-parse', 'main'), main)
            self.assertNotIn('state/edge_v2/forward-paused.json', git(remote, 'ls-tree', '-r', '--name-only', 'edge-data').splitlines())
            saved = json.loads(git(remote, 'show', 'edge-data:state/edge_v2/days/2026-11-05.json'))
            self.assertEqual(saved['forward_observations_sent'], sent)
            self.assertEqual(saved['forward_last_send_completed_at'], state['forward_last_send_completed_at'])
            self.assertIn('forward_git_recovery', saved)
            archive = path.parents[1] / 'recovery/2026-11-05-confirmed-delivery-stop.json'
            self.assertEqual(archive.read_bytes(), original)
            self.assertEqual(git(remote, 'show', 'edge-data:state/edge_v2/recovery/2026-11-05-confirmed-delivery-stop.json'), original.decode())
            stop.write_bytes(original)
            self.assertFalse(flow.resume_confirmed_delivery(state, path, stop, publisher, error, 'persist_delivery'))

    def test_hard_errors_ingestion_unconfirmed_and_nonancestor_never_recover(self):
        with tempfile.TemporaryDirectory() as tmp:
            publisher, state, path, stop, error, git, remote = self.fixture(Path(tmp))
            original = stop.read_bytes()
            for stage in ('capture', 'ingestion', 'persist_observations'):
                self.assertFalse(flow.resume_confirmed_delivery(state, path, stop, publisher, error, stage))
            with patch.dict(error.edge_publication_diagnostics, category='hard_stop'):
                self.assertFalse(flow.resume_confirmed_delivery(state, path, stop, publisher, error, 'persist_delivery'))
            for remote_sha in ('', 'f' * 40):
                with patch.object(publisher, 'remote_head', return_value=remote_sha):
                    self.assertFalse(flow.resume_confirmed_delivery(state, path, stop, publisher, error, 'persist_delivery'))
            with patch.dict(error.edge_publication_diagnostics, localHead='f' * 40):
                self.assertFalse(flow.resume_confirmed_delivery(state, path, stop, publisher, error, 'persist_delivery'))
            self.assertEqual(stop.read_bytes(), original)
            self.assertNotIn('forward_git_recovery', state)

    def test_failed_recovery_save_restores_stop_and_preserves_ack(self):
        with tempfile.TemporaryDirectory() as tmp:
            publisher, state, path, stop, error, git, remote = self.fixture(Path(tmp))
            original, sent = stop.read_bytes(), list(state['forward_observations_sent'])
            real_persist = publisher.persist
            calls = 0
            def fail_first():
                nonlocal calls
                calls += 1
                if calls == 1: raise RuntimeError('save failed')
                return real_persist()
            with patch.object(publisher, 'persist', side_effect=fail_first):
                self.assertFalse(flow.resume_confirmed_delivery(state, path, stop, publisher, error, 'persist_settlement'))
            self.assertEqual(stop.read_bytes(), original)
            self.assertEqual((publisher.folder / 'state/edge_v2/forward-paused.json').read_bytes(), original)
            self.assertEqual(state['forward_observations_sent'], sent)
            self.assertNotIn('forward_git_recovery', state)
            self.assertEqual(git(remote, 'show', 'edge-data:state/edge_v2/forward-paused.json'), original.decode())

    def test_existing_pause_fails_workflow_before_observation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); (root / 'forward-paused.json').write_text('{}')
            with patch.dict(flow.os.environ, {'EDGE_REPOSITORY_VISIBILITY':'public'}), \
                 patch.object(flow.edge, 'STATE', root), patch.object(flow, 'DataPublisher', MagicMock()), \
                 patch.object(flow.edge, 'Observer') as observer, patch('builtins.print'):
                with self.assertRaisesRegex(RuntimeError, 'paused'):
                    flow.main()
                observer.assert_not_called()


if __name__ == '__main__': unittest.main()
