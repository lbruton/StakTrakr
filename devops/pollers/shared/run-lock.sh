#!/bin/bash
# StakTrakr poller run lock + stuck-run watchdog (STRK-255).
#
# Sourced by run-home.sh (home VM) and run-local.sh (Fly.io) to serialize poll
# runs without letting a wedged run freeze the pipeline indefinitely.
#
# Background: the previous guard was `[ -f "$LOCKFILE" ] && exit 0` plus a bare
# `touch`. It could not distinguish a healthy in-flight run from a hung one, and
# a run killed without its EXIT trap (OOM, SIGKILL, container stop) left the
# lock behind forever. On 2026-07-19 a Playwright stall on jmbullion froze
# retail data for ~3.5h while every tick logged "Previous run still active".
#
# The lockfile now holds "<pid> <start-epoch>", which supports three outcomes:
#   1. holder is alive and within budget  -> skip this tick (normal contention)
#   2. holder is gone                     -> stale lock, reclaim  (WATCHDOG)
#   3. holder is alive but over budget    -> kill tree, reclaim   (WATCHDOG)
#
# shellcheck shell=bash

# Path of the lock currently held by this shell; consumed by the EXIT trap.
RUN_LOCK_FILE=""

# Default budget (seconds) before a live holder is considered wedged. Callers
# should pass an explicit value sized to their cron interval; see acquire_run_lock.
RUN_LOCK_DEFAULT_MAX_SECONDS="${RUN_LOCK_DEFAULT_MAX_SECONDS:-3600}"

# Seconds to wait after SIGTERM before escalating to SIGKILL.
RUN_LOCK_KILL_GRACE_SECONDS="${RUN_LOCK_KILL_GRACE_SECONDS:-5}"

# _run_lock_log <message...>
#
# Emit a timestamped line matching the surrounding run-script log format so
# watchdog events are greppable in /data/logs/retail-poller.log without exec.
_run_lock_log() {
  echo "[$(date -u +%H:%M:%S)] $*"
}

# _run_lock_pid_alive <pid>
#
# Return 0 when the process exists and is signalable by this user. Signal 0
# performs the permission and existence check without delivering a signal.
_run_lock_pid_alive() {
  local pid="$1"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null
}

# _run_lock_children <pid>
#
# List the direct children of a pid. `pgrep` comes from procps, which is not
# installed in every poller image, so fall back to parsing `ps` rather than
# silently degrading to a parent-only kill.
_run_lock_children() {
  local pid="$1"
  if command -v pgrep >/dev/null 2>&1; then
    pgrep -P "$pid" 2>/dev/null || true
  else
    ps -eo pid=,ppid= 2>/dev/null | awk -v p="$pid" '$2 == p { print $1 }' || true
  fi
}

# _run_lock_collect_tree <pid>
#
# Print pid and every descendant, deepest first.
#
# The tree must be captured *before* any signal is sent: once the holding shell
# exits, its children are reparented to init and can no longer be found by
# walking down from the holder, so a second pass would miss exactly the
# long-lived Chromium process the kill exists to reap.
_run_lock_collect_tree() {
  local pid="$1"
  local child
  for child in $(_run_lock_children "$pid"); do
    _run_lock_collect_tree "$child"
  done
  echo "$pid"
}

# _run_lock_signal_pids <signal> <pid...>
#
# Send a signal to each pid, ignoring those that have already exited.
_run_lock_signal_pids() {
  local sig="$1"
  shift
  local pid
  for pid in "$@"; do
    kill "-$sig" "$pid" 2>/dev/null || true
  done
}

# _run_lock_survivors <pid...>
#
# Print the subset of pids that are still alive.
_run_lock_survivors() {
  local pid
  for pid in "$@"; do
    if _run_lock_pid_alive "$pid"; then
      echo "$pid"
    fi
  done
}

# _run_lock_release
#
# EXIT-trap handler. Removes only the lock this shell actually acquired, so a
# shell that skipped on contention never deletes the live holder's lock.
_run_lock_release() {
  if [ -n "$RUN_LOCK_FILE" ]; then
    rm -f "$RUN_LOCK_FILE"
    RUN_LOCK_FILE=""
  fi
}

# _run_lock_claim <lockfile>
#
# Atomically publish a lockfile already containing "<pid> <start-epoch>".
#
# The owner record is written to a private temp file first and then hard-linked
# into place. `ln` fails if the target exists, so the create-or-fail decision
# stays atomic, and — unlike a `noclobber` redirect — the lockfile is never
# observable in a zero-byte state. That window mattered: a redirect creates the
# file before `printf` fills it, so a competing tick could read an empty owner,
# classify a live lock as malformed, delete it, and run concurrently.
#
# Returns 0 when this shell now owns the lock, 1 when another shell won.
_run_lock_claim() {
  local lockfile="$1"
  local tmp="${lockfile}.$$.tmp"

  printf '%s %s\n' "$$" "$(date -u +%s)" >"$tmp" 2>/dev/null || return 1
  if ln "$tmp" "$lockfile" 2>/dev/null; then
    rm -f "$tmp"
    RUN_LOCK_FILE="$lockfile"
    trap _run_lock_release EXIT
    return 0
  fi
  rm -f "$tmp"
  return 1
}

# _run_lock_force_claim <lockfile>
#
# Replace a lock that has been judged stale. Not atomic against a competing
# watchdog, which is acceptable: both would be reclaiming the same dead holder,
# and cron ticks for a given poller are an hour (home) or 15 minutes (Fly) apart.
_run_lock_force_claim() {
  local lockfile="$1"
  rm -f "$lockfile"
  _run_lock_claim "$lockfile"
}

# acquire_run_lock <lockfile> [max_run_seconds]
#
# Acquire the poller run lock, reclaiming it from a dead or overrunning holder.
#
# max_run_seconds should exceed one cron interval so a normally-slow run is
# never killed by the very next tick — the watchdog is meant to fire on the
# second consecutive contended tick, not the first.
#
# Returns 0 when the caller should proceed with the run, 1 when it should skip.
acquire_run_lock() {
  local lockfile="$1"
  local max_age="${2:-$RUN_LOCK_DEFAULT_MAX_SECONDS}"

  # A non-numeric budget (typo'd RETAIL_RUN_MAX_SECONDS, unexpanded variable)
  # would make the `-lt` comparison below emit "integer expression expected" and
  # return non-zero, aborting the whole tick under `set -e`. Fall back to the
  # default rather than letting a config typo stop the poller.
  case "$max_age" in
    "" | *[!0-9]*)
      _run_lock_log "WATCHDOG: ignoring non-numeric run budget '$max_age' — using ${RUN_LOCK_DEFAULT_MAX_SECONDS}s"
      max_age="$RUN_LOCK_DEFAULT_MAX_SECONDS"
      ;;
    0)
      _run_lock_log "WATCHDOG: ignoring zero run budget — using ${RUN_LOCK_DEFAULT_MAX_SECONDS}s"
      max_age="$RUN_LOCK_DEFAULT_MAX_SECONDS"
      ;;
  esac

  if _run_lock_claim "$lockfile"; then
    return 0
  fi

  local holder_pid=""
  local holder_epoch=""
  read -r holder_pid holder_epoch <"$lockfile" 2>/dev/null || true

  # A lockfile with no parseable PID predates this helper (bare `touch`) or was
  # truncated by an unclean shutdown. Either way nothing owns it.
  case "$holder_pid" in
    "" | *[!0-9]*)
      _run_lock_log "WATCHDOG: stale lock at $lockfile (no owner recorded) — reclaiming"
      _run_lock_force_claim "$lockfile"
      return $?
      ;;
  esac

  if ! _run_lock_pid_alive "$holder_pid"; then
    _run_lock_log "WATCHDOG: stale lock at $lockfile (pid $holder_pid is gone) — reclaiming"
    _run_lock_force_claim "$lockfile"
    return $?
  fi

  local now
  now="$(date -u +%s)"
  local age=0
  case "$holder_epoch" in
    "" | *[!0-9]*) age="$max_age" ;;
    *) age=$((now - holder_epoch)) ;;
  esac

  if [ "$age" -lt "$max_age" ]; then
    _run_lock_log "Previous run still active, skipping (pid $holder_pid, ${age}s elapsed)"
    return 1
  fi

  # Snapshot the whole tree up front. The holding shell usually dies on the
  # first SIGTERM, which reparents its children to init — after that they can no
  # longer be reached by walking down from the holder, and the wedged Chromium
  # (the process actually worth reaping) would survive as an orphan.
  local tree
  tree="$(_run_lock_collect_tree "$holder_pid")"
  # shellcheck disable=SC2086 # word splitting is intended: one pid per line
  set -- $tree

  _run_lock_log "WATCHDOG: run pid $holder_pid exceeded ${max_age}s budget (${age}s) — killing process tree ($# pid(s): $*)"
  _run_lock_signal_pids TERM "$@"
  sleep "$RUN_LOCK_KILL_GRACE_SECONDS"

  local survivors
  survivors="$(_run_lock_survivors "$@")"
  if [ -n "$survivors" ]; then
    # shellcheck disable=SC2086 # word splitting is intended: one pid per line
    set -- $survivors
    _run_lock_log "WATCHDOG: $# pid(s) survived SIGTERM ($*) — escalating to SIGKILL"
    _run_lock_signal_pids KILL "$@"
    sleep 1
  fi

  _run_lock_log "WATCHDOG: reclaimed $lockfile — proceeding with this run"
  _run_lock_force_claim "$lockfile"
  return $?
}
