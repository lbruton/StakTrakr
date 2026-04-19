#!/usr/bin/env python3
"""
Tool Tier Reminder Hook — StakTrakr

Intercepts Task tool calls using Explore or general-purpose agents and nudges
Claude to check CGC (structural) or Claude-Context (semantic) first.

Exit codes:
  0 = allow tool to proceed (always — soft nudge only, no blocking)
"""

import json
import sys

def main():
    try:
        input_data = json.loads(sys.stdin.read())
    except (json.JSONDecodeError, ValueError):
        sys.exit(0)

    tool_name = input_data.get("tool_name", "")
    tool_input = input_data.get("tool_input", {})

    if tool_name != "Task":
        sys.exit(0)

    subagent_type = tool_input.get("subagent_type", "")
    if subagent_type not in ("Explore", "general-purpose"):
        sys.exit(0)

    print(
        "[tier-check] Explore intercepted — did you try CGC (structural) or"
        " Claude-Context (semantic) first? Run those directly before delegating.",
        file=sys.stdout,
    )
    sys.exit(0)


if __name__ == "__main__":
    main()
