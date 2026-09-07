import unittest
import urllib.request
from scripts.prepare_type_g import ArtifactRedirectHandler


class ArtifactRedirectTests(unittest.TestCase):
    def test_signed_storage_does_not_receive_github_token(self):
        source = urllib.request.Request("https://api.github.com/repos/example/repo/actions/artifacts/1/zip", headers={"Authorization": "Bearer test-token"})
        target = ArtifactRedirectHandler().redirect_request(source, None, 302, "Found", {}, "https://example.blob.core.windows.net/file?sig=test")
        self.assertFalse(target.has_header("Authorization"))
        self.assertIn("sig=test", target.full_url)

    def test_same_host_preserves_authentication(self):
        source = urllib.request.Request("https://api.github.com/old", headers={"Authorization": "Bearer test-token"})
        target = ArtifactRedirectHandler().redirect_request(source, None, 302, "Found", {}, "https://api.github.com/new")
        self.assertEqual(target.get_header("Authorization"), "Bearer test-token")
