import os
import runpy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from dotenv import load_dotenv


API_PATH = Path(__file__).resolve().parents[1] / "api.py"


class AIConfigTests(unittest.TestCase):
    def load_config(self, env_path, inherited_backend):
        def load_test_env(path, **kwargs):
            self.assertEqual(Path(path), API_PATH.parent / ".env")
            return load_dotenv(env_path, **kwargs)

        with patch.dict(os.environ, {"AI_BACKEND": inherited_backend}):
            with patch("dotenv.load_dotenv", side_effect=load_test_env):
                return runpy.run_path(str(API_PATH))["AI_BACKEND"]

    def test_dotenv_overrides_inherited_backend(self):
        with tempfile.TemporaryDirectory() as directory:
            env_path = Path(directory) / ".env"
            env_path.write_text("AI_BACKEND=copilot\n", encoding="utf-8")
            self.assertEqual(self.load_config(env_path, "azure"), "copilot")

    def test_missing_dotenv_preserves_inherited_backend(self):
        with tempfile.TemporaryDirectory() as directory:
            env_path = Path(directory) / ".env"
            self.assertEqual(self.load_config(env_path, "azure"), "azure")


if __name__ == "__main__":
    unittest.main()
