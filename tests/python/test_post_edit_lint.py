"""
Tests for .claude/hooks/post-edit-lint.py

Tests run_cmd() and main() by patching subprocess and sys.stdin/stdout.
"""

import importlib.util
import json
import os
import sys
import tempfile
import unittest
from io import StringIO
from pathlib import Path
from unittest.mock import MagicMock, call, patch

# ---------------------------------------------------------------------------
# Load the module under test from its actual location
# ---------------------------------------------------------------------------
HOOK_PATH = os.path.join(
    os.path.dirname(__file__), "../../.claude/hooks/post-edit-lint.py"
)
spec = importlib.util.spec_from_file_location("post_edit_lint", HOOK_PATH)
post_edit_lint = importlib.util.module_from_spec(spec)
spec.loader.exec_module(post_edit_lint)

run_cmd = post_edit_lint.run_cmd
main = post_edit_lint.main


# ---------------------------------------------------------------------------
# run_cmd tests
# ---------------------------------------------------------------------------


class TestRunCmd(unittest.TestCase):

    def _make_result(self, returncode, stdout="", stderr=""):
        result = MagicMock()
        result.returncode = returncode
        result.stdout = stdout
        result.stderr = stderr
        return result

    @patch("subprocess.run")
    def test_success_returns_zero_and_output(self, mock_run):
        """Successful command returns (0, output)."""
        mock_run.return_value = self._make_result(0, stdout="ok")
        rc, out = run_cmd(["echo", "ok"])
        self.assertEqual(rc, 0)
        self.assertEqual(out, "ok")

    @patch("subprocess.run")
    def test_failure_returns_nonzero_and_stderr(self, mock_run):
        """Failed command returns (nonzero, stderr)."""
        mock_run.return_value = self._make_result(1, stderr="error message")
        rc, out = run_cmd(["node", "--check", "bad.js"])
        self.assertEqual(rc, 1)
        self.assertEqual(out, "error message")

    @patch("subprocess.run")
    def test_stderr_preferred_over_stdout(self, mock_run):
        """stderr is returned when both stderr and stdout are non-empty."""
        mock_run.return_value = self._make_result(1, stdout="stdout text", stderr="stderr text")
        _, out = run_cmd(["cmd"])
        self.assertEqual(out, "stderr text")

    @patch("subprocess.run")
    def test_stdout_used_when_stderr_empty(self, mock_run):
        """stdout is used when stderr is empty."""
        mock_run.return_value = self._make_result(0, stdout="stdout only", stderr="")
        _, out = run_cmd(["cmd"])
        self.assertEqual(out, "stdout only")

    @patch("subprocess.run")
    def test_output_capped_at_ten_lines(self, mock_run):
        """Output is truncated to at most 10 lines."""
        many_lines = "\n".join(f"line{i}" for i in range(20))
        mock_run.return_value = self._make_result(1, stderr=many_lines)
        _, out = run_cmd(["cmd"])
        self.assertEqual(len(out.split("\n")), 10)
        self.assertEqual(out.split("\n")[0], "line0")
        self.assertEqual(out.split("\n")[9], "line9")

    @patch("subprocess.run")
    def test_exactly_ten_lines_not_truncated(self, mock_run):
        """Exactly 10 lines passes through unchanged."""
        ten_lines = "\n".join(f"line{i}" for i in range(10))
        mock_run.return_value = self._make_result(0, stdout=ten_lines)
        _, out = run_cmd(["cmd"])
        self.assertEqual(len(out.split("\n")), 10)

    @patch("subprocess.run", side_effect=FileNotFoundError)
    def test_file_not_found_returns_zero_empty(self, _mock_run):
        """Missing executable returns (0, '') without raising."""
        rc, out = run_cmd(["nonexistent-binary"])
        self.assertEqual(rc, 0)
        self.assertEqual(out, "")

    @patch("subprocess.run", side_effect=__import__("subprocess").TimeoutExpired("cmd", 15))
    def test_timeout_returns_zero_empty(self, _mock_run):
        """Timed-out command returns (0, '') without raising."""
        rc, out = run_cmd(["slow-cmd"], timeout=1)
        self.assertEqual(rc, 0)
        self.assertEqual(out, "")

    @patch("subprocess.run")
    def test_passes_timeout_to_subprocess(self, mock_run):
        """Custom timeout is forwarded to subprocess.run."""
        mock_run.return_value = self._make_result(0, stdout="ok")
        run_cmd(["echo"], timeout=5)
        _, kwargs = mock_run.call_args
        self.assertEqual(kwargs["timeout"], 5)

    @patch("subprocess.run")
    def test_runs_in_project_dir(self, mock_run):
        """Command is run with cwd set to PROJECT_DIR."""
        mock_run.return_value = self._make_result(0, stdout="ok")
        run_cmd(["echo"])
        _, kwargs = mock_run.call_args
        self.assertEqual(kwargs["cwd"], post_edit_lint.PROJECT_DIR)

    @patch("subprocess.run")
    def test_empty_output_returns_empty_string(self, mock_run):
        """Both stdout and stderr empty returns empty string output."""
        mock_run.return_value = self._make_result(0, stdout="", stderr="")
        _, out = run_cmd(["cmd"])
        self.assertEqual(out, "")


# ---------------------------------------------------------------------------
# main() tests
# ---------------------------------------------------------------------------


class TestMain(unittest.TestCase):

    def _run_main(self, input_json):
        """Run main() with given dict as stdin JSON, capture stdout, return exit code."""
        with patch("sys.stdin", StringIO(json.dumps(input_json))), \
             patch("sys.stdout", new_callable=StringIO) as mock_stdout:
            try:
                main()
                return 0, mock_stdout.getvalue()
            except SystemExit as e:
                return e.code, mock_stdout.getvalue()

    def test_invalid_json_exits_zero(self):
        """Malformed JSON on stdin exits 0 silently."""
        with patch("sys.stdin", StringIO("{not valid json")):
            with self.assertRaises(SystemExit) as cm:
                main()
        self.assertEqual(cm.exception.code, 0)

    def test_empty_input_exits_zero(self):
        """Empty stdin exits 0 silently."""
        with patch("sys.stdin", StringIO("")):
            with self.assertRaises(SystemExit) as cm:
                main()
        self.assertEqual(cm.exception.code, 0)

    def test_non_edit_write_tool_exits_zero(self):
        """Non-Edit/Write tool names exit 0 with no output."""
        for tool in ("Read", "Bash", "Task", ""):
            code, out = self._run_main({"tool_name": tool, "tool_input": {}})
            self.assertEqual(code, 0, f"Expected exit 0 for tool '{tool}'")
            self.assertEqual(out, "", f"Expected no output for tool '{tool}'")

    def test_nonexistent_file_exits_zero(self):
        """Edit tool with nonexistent file path exits 0 silently."""
        code, out = self._run_main({
            "tool_name": "Edit",
            "tool_input": {"file_path": "/nonexistent/path/file.js"},
        })
        self.assertEqual(code, 0)
        self.assertEqual(out, "")

    def test_missing_file_path_exits_zero(self):
        """Edit tool with no file_path exits 0 silently."""
        code, out = self._run_main({
            "tool_name": "Edit",
            "tool_input": {},
        })
        self.assertEqual(code, 0)
        self.assertEqual(out, "")

    def test_js_file_clean_no_output(self):
        """Clean .js file produces no lint output."""
        with tempfile.NamedTemporaryFile(suffix=".js", delete=False) as f:
            f.write(b"const x = 1;\n")
            js_path = f.name
        try:
            with patch.object(post_edit_lint, "run_cmd", return_value=(0, "")) as mock_rc:
                code, out = self._run_main({
                    "tool_name": "Edit",
                    "tool_input": {"file_path": js_path},
                })
            self.assertEqual(code, 0)
            self.assertEqual(out, "")
        finally:
            os.unlink(js_path)

    def test_js_file_syntax_error_prints_message(self):
        """Syntax error in .js file prints SYNTAX ERROR message."""
        with tempfile.NamedTemporaryFile(suffix=".js", delete=False) as f:
            f.write(b"const x = ;\n")
            js_path = f.name
        try:
            def fake_run_cmd(cmd, timeout=15):
                if "--check" in cmd:
                    return (1, "SyntaxError: Unexpected token ';'")
                return (0, "")

            with patch.object(post_edit_lint, "run_cmd", side_effect=fake_run_cmd):
                code, out = self._run_main({
                    "tool_name": "Edit",
                    "tool_input": {"file_path": js_path},
                })
            self.assertEqual(code, 0)
            self.assertIn("[lint]", out)
            self.assertIn("SYNTAX ERROR", out)
            self.assertIn(os.path.basename(js_path), out)
        finally:
            os.unlink(js_path)

    def test_js_file_eslint_error_prints_message(self):
        """ESLint failure for .js file prints ESLint message."""
        with tempfile.NamedTemporaryFile(suffix=".js", delete=False) as f:
            f.write(b"var x = 1;\n")
            js_path = f.name
        try:
            def fake_run_cmd(cmd, timeout=15):
                if "--check" in cmd:
                    return (0, "")
                if "eslint" in " ".join(cmd):
                    return (1, "no-var error on line 1")
                return (0, "")

            with patch.object(post_edit_lint, "run_cmd", side_effect=fake_run_cmd):
                code, out = self._run_main({
                    "tool_name": "Edit",
                    "tool_input": {"file_path": js_path},
                })
            self.assertEqual(code, 0)
            self.assertIn("[lint]", out)
            self.assertIn("ESLint", out)
        finally:
            os.unlink(js_path)

    def test_js_file_eslint_error_empty_output_not_shown(self):
        """ESLint failure with empty output is not shown (rc!=0 but out=='')."""
        with tempfile.NamedTemporaryFile(suffix=".js", delete=False) as f:
            f.write(b"var x = 1;\n")
            js_path = f.name
        try:
            def fake_run_cmd(cmd, timeout=15):
                if "--check" in cmd:
                    return (0, "")
                if "eslint" in " ".join(cmd):
                    return (1, "")  # rc!=0 but no output
                return (0, "")

            with patch.object(post_edit_lint, "run_cmd", side_effect=fake_run_cmd):
                code, out = self._run_main({
                    "tool_name": "Edit",
                    "tool_input": {"file_path": js_path},
                })
            self.assertEqual(code, 0)
            self.assertEqual(out, "")
        finally:
            os.unlink(js_path)

    def test_md_file_clean_no_output(self):
        """Clean .md file produces no lint output."""
        with tempfile.NamedTemporaryFile(suffix=".md", delete=False) as f:
            f.write(b"# Hello\n")
            md_path = f.name
        try:
            with patch.object(post_edit_lint, "run_cmd", return_value=(0, "")) as mock_rc:
                code, out = self._run_main({
                    "tool_name": "Write",
                    "tool_input": {"file_path": md_path},
                })
            self.assertEqual(code, 0)
            self.assertEqual(out, "")
        finally:
            os.unlink(md_path)

    def test_md_file_lint_error_prints_message(self):
        """Markdownlint error for .md file prints message."""
        with tempfile.NamedTemporaryFile(suffix=".md", delete=False) as f:
            f.write(b"# Hello\n\nsome text\n")
            md_path = f.name
        try:
            with patch.object(post_edit_lint, "run_cmd", return_value=(1, "MD013/line-length")):
                code, out = self._run_main({
                    "tool_name": "Edit",
                    "tool_input": {"file_path": md_path},
                })
            self.assertEqual(code, 0)
            self.assertIn("[lint]", out)
            self.assertIn("Markdownlint", out)
        finally:
            os.unlink(md_path)

    def test_md_file_lint_error_empty_output_not_shown(self):
        """Markdownlint failure with empty output is suppressed."""
        with tempfile.NamedTemporaryFile(suffix=".md", delete=False) as f:
            f.write(b"# Hello\n")
            md_path = f.name
        try:
            with patch.object(post_edit_lint, "run_cmd", return_value=(1, "")):
                code, out = self._run_main({
                    "tool_name": "Edit",
                    "tool_input": {"file_path": md_path},
                })
            self.assertEqual(code, 0)
            self.assertEqual(out, "")
        finally:
            os.unlink(md_path)

    def test_json_file_valid_no_output(self):
        """Valid .json file produces no lint output."""
        with tempfile.NamedTemporaryFile(suffix=".json", mode="w", delete=False) as f:
            json.dump({"key": "value"}, f)
            json_path = f.name
        try:
            code, out = self._run_main({
                "tool_name": "Write",
                "tool_input": {"file_path": json_path},
            })
            self.assertEqual(code, 0)
            self.assertEqual(out, "")
        finally:
            os.unlink(json_path)

    def test_json_file_invalid_prints_message(self):
        """Invalid .json file prints JSON SYNTAX ERROR message."""
        with tempfile.NamedTemporaryFile(suffix=".json", mode="w", delete=False) as f:
            f.write("{invalid json here")
            json_path = f.name
        try:
            code, out = self._run_main({
                "tool_name": "Write",
                "tool_input": {"file_path": json_path},
            })
            self.assertEqual(code, 0)
            self.assertIn("[lint]", out)
            self.assertIn("JSON SYNTAX ERROR", out)
            self.assertIn(os.path.basename(json_path), out)
        finally:
            os.unlink(json_path)

    def test_unrecognized_extension_no_output(self):
        """File with unrecognized extension (.py, .css, .html) produces no output."""
        for suffix in (".py", ".css", ".html", ".ts"):
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
                f.write(b"content")
                path = f.name
            try:
                code, out = self._run_main({
                    "tool_name": "Edit",
                    "tool_input": {"file_path": path},
                })
                self.assertEqual(code, 0, f"Expected exit 0 for {suffix}")
                self.assertEqual(out, "", f"Expected no output for {suffix}")
            finally:
                os.unlink(path)

    def test_write_tool_also_triggers_lint(self):
        """Write tool name also triggers lint (same as Edit)."""
        with tempfile.NamedTemporaryFile(suffix=".json", mode="w", delete=False) as f:
            f.write("{broken")
            json_path = f.name
        try:
            code, out = self._run_main({
                "tool_name": "Write",
                "tool_input": {"file_path": json_path},
            })
            self.assertEqual(code, 0)
            self.assertIn("JSON SYNTAX ERROR", out)
        finally:
            os.unlink(json_path)

    def test_multiple_errors_all_shown(self):
        """Multiple lint errors are all included in output."""
        with tempfile.NamedTemporaryFile(suffix=".js", delete=False) as f:
            f.write(b"const x = ;\n")
            js_path = f.name
        try:
            def fake_run_cmd(cmd, timeout=15):
                if "--check" in cmd:
                    return (1, "SyntaxError on line 1")
                if "eslint" in " ".join(cmd):
                    return (1, "no-var error")
                return (0, "")

            with patch.object(post_edit_lint, "run_cmd", side_effect=fake_run_cmd):
                code, out = self._run_main({
                    "tool_name": "Edit",
                    "tool_input": {"file_path": js_path},
                })
            # Both errors should appear
            self.assertIn("SYNTAX ERROR", out)
            self.assertIn("ESLint", out)
        finally:
            os.unlink(js_path)

    def test_js_lint_uses_correct_commands(self):
        """JS linting invokes node --check and npx eslint with correct args."""
        with tempfile.NamedTemporaryFile(suffix=".js", delete=False) as f:
            f.write(b"const x = 1;\n")
            js_path = f.name
        try:
            calls_made = []

            def recording_run_cmd(cmd, timeout=15):
                calls_made.append(cmd)
                return (0, "")

            with patch.object(post_edit_lint, "run_cmd", side_effect=recording_run_cmd):
                self._run_main({
                    "tool_name": "Edit",
                    "tool_input": {"file_path": js_path},
                })

            # Should have called node --check and npx eslint
            self.assertTrue(any("--check" in str(c) for c in calls_made))
            self.assertTrue(any("eslint" in str(c) for c in calls_made))
        finally:
            os.unlink(js_path)

    def test_md_lint_uses_markdownlint_with_config(self):
        """MD linting invokes npx markdownlint with --config .markdownlint.json."""
        with tempfile.NamedTemporaryFile(suffix=".md", delete=False) as f:
            f.write(b"# Hello\n")
            md_path = f.name
        try:
            calls_made = []

            def recording_run_cmd(cmd, timeout=15):
                calls_made.append(cmd)
                return (0, "")

            with patch.object(post_edit_lint, "run_cmd", side_effect=recording_run_cmd):
                self._run_main({
                    "tool_name": "Edit",
                    "tool_input": {"file_path": md_path},
                })

            self.assertEqual(len(calls_made), 1)
            cmd = calls_made[0]
            self.assertIn("markdownlint", " ".join(cmd))
            self.assertIn("--config", cmd)
            self.assertIn(".markdownlint.json", cmd)
        finally:
            os.unlink(md_path)

    def test_always_exits_zero(self):
        """main() always exits with code 0 regardless of lint results."""
        with tempfile.NamedTemporaryFile(suffix=".json", mode="w", delete=False) as f:
            f.write("{bad")
            json_path = f.name
        try:
            code, _ = self._run_main({
                "tool_name": "Edit",
                "tool_input": {"file_path": json_path},
            })
            self.assertEqual(code, 0)
        finally:
            os.unlink(json_path)


if __name__ == "__main__":
    unittest.main()