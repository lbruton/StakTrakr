"""
Tests for .claude/hooks/tool-tier-reminder.py

Tests main() by patching sys.stdin/stdout.
"""

import importlib.util
import json
import os
import sys
import unittest
from io import StringIO
from unittest.mock import patch

# ---------------------------------------------------------------------------
# Load the module under test from its actual location
# ---------------------------------------------------------------------------
HOOK_PATH = os.path.join(
    os.path.dirname(__file__), "../../.claude/hooks/tool-tier-reminder.py"
)
spec = importlib.util.spec_from_file_location("tool_tier_reminder", HOOK_PATH)
tool_tier_reminder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tool_tier_reminder)

main = tool_tier_reminder.main


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------


def run_main(input_json):
    """Run main() with dict serialized as stdin JSON. Returns (exit_code, stdout)."""
    with patch("sys.stdin", StringIO(json.dumps(input_json))), \
         patch("sys.stdout", new_callable=StringIO) as mock_stdout:
        try:
            main()
            return 0, mock_stdout.getvalue()
        except SystemExit as e:
            return e.code, mock_stdout.getvalue()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestToolTierReminderMain(unittest.TestCase):

    # --- Invalid / edge-case inputs ---

    def test_invalid_json_exits_zero_no_output(self):
        """Malformed JSON stdin exits 0 with no output."""
        with patch("sys.stdin", StringIO("{not json")), \
             patch("sys.stdout", new_callable=StringIO) as mock_stdout:
            with self.assertRaises(SystemExit) as cm:
                main()
        self.assertEqual(cm.exception.code, 0)
        self.assertEqual(mock_stdout.getvalue(), "")

    def test_empty_string_input_exits_zero(self):
        """Empty string stdin exits 0 with no output."""
        with patch("sys.stdin", StringIO("")), \
             patch("sys.stdout", new_callable=StringIO) as mock_stdout:
            with self.assertRaises(SystemExit) as cm:
                main()
        self.assertEqual(cm.exception.code, 0)
        self.assertEqual(mock_stdout.getvalue(), "")

    def test_empty_object_input_exits_zero(self):
        """Empty JSON object exits 0 with no output (tool_name defaults to '')."""
        code, out = run_main({})
        self.assertEqual(code, 0)
        self.assertEqual(out, "")

    # --- Non-Task tool names ---

    def test_read_tool_exits_zero_no_output(self):
        """Read tool name exits 0 with no output."""
        code, out = run_main({"tool_name": "Read", "tool_input": {}})
        self.assertEqual(code, 0)
        self.assertEqual(out, "")

    def test_bash_tool_exits_zero_no_output(self):
        """Bash tool name exits 0 with no output."""
        code, out = run_main({"tool_name": "Bash", "tool_input": {}})
        self.assertEqual(code, 0)
        self.assertEqual(out, "")

    def test_edit_tool_exits_zero_no_output(self):
        """Edit tool name exits 0 with no output."""
        code, out = run_main({"tool_name": "Edit", "tool_input": {}})
        self.assertEqual(code, 0)
        self.assertEqual(out, "")

    def test_grep_tool_exits_zero_no_output(self):
        """Grep tool name exits 0 with no output."""
        code, out = run_main({"tool_name": "Grep", "tool_input": {}})
        self.assertEqual(code, 0)
        self.assertEqual(out, "")

    def test_empty_tool_name_exits_zero(self):
        """Empty tool_name exits 0 with no output."""
        code, out = run_main({"tool_name": "", "tool_input": {}})
        self.assertEqual(code, 0)
        self.assertEqual(out, "")

    # --- Task tool with non-intercepted subagent types ---

    def test_task_tool_bash_subagent_exits_zero_no_output(self):
        """Task tool with 'Bash' subagent exits 0 with no output."""
        code, out = run_main({
            "tool_name": "Task",
            "tool_input": {"subagent_type": "Bash"},
        })
        self.assertEqual(code, 0)
        self.assertEqual(out, "")

    def test_task_tool_plan_subagent_exits_zero_no_output(self):
        """Task tool with 'Plan' subagent exits 0 with no output."""
        code, out = run_main({
            "tool_name": "Task",
            "tool_input": {"subagent_type": "Plan"},
        })
        self.assertEqual(code, 0)
        self.assertEqual(out, "")

    def test_task_tool_empty_subagent_exits_zero(self):
        """Task tool with empty subagent_type exits 0 with no output."""
        code, out = run_main({
            "tool_name": "Task",
            "tool_input": {"subagent_type": ""},
        })
        self.assertEqual(code, 0)
        self.assertEqual(out, "")

    def test_task_tool_missing_subagent_type_exits_zero(self):
        """Task tool with no subagent_type key exits 0 with no output."""
        code, out = run_main({
            "tool_name": "Task",
            "tool_input": {},
        })
        self.assertEqual(code, 0)
        self.assertEqual(out, "")

    def test_task_tool_no_tool_input_key_exits_zero(self):
        """Task tool with no tool_input key at all exits 0 with no output."""
        code, out = run_main({"tool_name": "Task"})
        self.assertEqual(code, 0)
        self.assertEqual(out, "")

    # --- Task tool with intercepted subagent types ---

    def test_task_explore_agent_prints_tier_check_message(self):
        """Task tool with 'Explore' subagent prints [tier-check] message."""
        code, out = run_main({
            "tool_name": "Task",
            "tool_input": {"subagent_type": "Explore"},
        })
        self.assertEqual(code, 0)
        self.assertIn("[tier-check]", out)

    def test_task_general_purpose_agent_prints_tier_check_message(self):
        """Task tool with 'general-purpose' subagent prints [tier-check] message."""
        code, out = run_main({
            "tool_name": "Task",
            "tool_input": {"subagent_type": "general-purpose"},
        })
        self.assertEqual(code, 0)
        self.assertIn("[tier-check]", out)

    def test_explore_message_mentions_cgc(self):
        """Explore intercept message mentions CGC structural check."""
        code, out = run_main({
            "tool_name": "Task",
            "tool_input": {"subagent_type": "Explore"},
        })
        self.assertIn("CGC", out)

    def test_explore_message_mentions_claude_context(self):
        """Explore intercept message mentions Claude-Context semantic check."""
        code, out = run_main({
            "tool_name": "Task",
            "tool_input": {"subagent_type": "Explore"},
        })
        self.assertIn("Claude-Context", out)

    def test_explore_message_contains_delegating_nudge(self):
        """Explore intercept message tells user to run tools before delegating."""
        code, out = run_main({
            "tool_name": "Task",
            "tool_input": {"subagent_type": "Explore"},
        })
        self.assertIn("delegating", out)

    def test_general_purpose_message_matches_explore_message(self):
        """general-purpose intercept outputs the same message as Explore."""
        _, explore_out = run_main({
            "tool_name": "Task",
            "tool_input": {"subagent_type": "Explore"},
        })
        _, gp_out = run_main({
            "tool_name": "Task",
            "tool_input": {"subagent_type": "general-purpose"},
        })
        self.assertEqual(explore_out, gp_out)

    # --- Always exits zero ---

    def test_always_exits_zero_for_explore(self):
        """Hook always exits 0 even when printing a nudge message (non-blocking)."""
        code, _ = run_main({
            "tool_name": "Task",
            "tool_input": {"subagent_type": "Explore"},
        })
        self.assertEqual(code, 0)

    def test_always_exits_zero_for_general_purpose(self):
        """Hook always exits 0 for general-purpose (non-blocking)."""
        code, _ = run_main({
            "tool_name": "Task",
            "tool_input": {"subagent_type": "general-purpose"},
        })
        self.assertEqual(code, 0)

    # --- Case sensitivity ---

    def test_subagent_type_is_case_sensitive_explore_lowercase(self):
        """'explore' (lowercase) is NOT intercepted — match is case-sensitive."""
        code, out = run_main({
            "tool_name": "Task",
            "tool_input": {"subagent_type": "explore"},
        })
        self.assertEqual(out, "")

    def test_subagent_type_is_case_sensitive_task_lowercase(self):
        """'task' tool (lowercase) is NOT intercepted — tool_name match is case-sensitive."""
        code, out = run_main({
            "tool_name": "task",
            "tool_input": {"subagent_type": "Explore"},
        })
        self.assertEqual(out, "")

    # --- Regression: message goes to stdout, not stderr ---

    def test_message_goes_to_stdout(self):
        """Tier-check message is written to stdout (not stderr)."""
        with patch("sys.stdin", StringIO(json.dumps({
            "tool_name": "Task",
            "tool_input": {"subagent_type": "Explore"},
        }))), \
             patch("sys.stdout", new_callable=StringIO) as mock_stdout, \
             patch("sys.stderr", new_callable=StringIO) as mock_stderr:
            try:
                main()
            except SystemExit:
                pass
        self.assertIn("[tier-check]", mock_stdout.getvalue())
        self.assertEqual(mock_stderr.getvalue(), "")


if __name__ == "__main__":
    unittest.main()