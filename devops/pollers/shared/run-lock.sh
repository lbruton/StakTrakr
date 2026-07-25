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

# _run_lock_kill_tree <pid> <signal>
#
# Signal a process and all of its descendants, children first, so a dying
# parent cannot spawn replacements before it goes. The poller's wedge is
# typically Chromium under node under bash, so killing only the recorded shell
# PID would orphan the browser and leak memory on the host.
_run_lock_kill_tree() {
  local pid="$1"
  local sig="$2"
  local child
  for child in $(pgrep -P "$pid" 2>/dev/null); do
    _run_lock_kill_tree "$child" "$sig"
  done
  kill "-$sig" "$pid" 2>/dev/null || true
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
# Atomically create the lockfile containing "<pid> <start-epoch>". `noclobber`
# makes the create-or-fail a single operation; the previous check-then-touch
# left a window where two ticks could both believe they held the lock.
#
# Returns 0 when this shell now owns the lock, 1 when another shell won.
_run_lock_claim() {
  local lockfile="$1"
  if (
    set -o noclobber
    printf '%s %s\n' "$$" "$(date -u +%s)" >"$lockfile"
  ) 2>/dev/null; then
    RUN_LOCK_FILE="$lockfile"
    trap _run_lock_release EXIT
    return 0
  fi
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

  _run_lock_log "WATCHDOG: run pid $holder_pid exceeded ${max_age}s budget (${age}s) — killing process tree"
  _run_lock_kill_tree "$holder_pid" TERM
  sleep "$RUN_LOCK_KILL_GRACE_SECONDS"
  if _run_lock_pid_alive "$holder_pid"; then
    _run_lock_log "WATCHDOG: pid $holder_pid survived SIGTERM — escalating to SIGKILL"
    _run_lock_kill_tree "$holder_pid" KILL
    sleep 1
  fi
  _run_lock_log "WATCHDOG: reclaimed $lockfile — proceeding with this run"
  _run_lock_force_claim "$lockfile"
  return $?
}
