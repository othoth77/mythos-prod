#!/usr/bin/env python3
"""MYTHOS -- mythos-hostops-daemon (root, socket-activated; HOSTOPS-2R)

ops/hostops/mythos-hostops-daemon.py -> installed as
/usr/local/sbin/mythos-hostops-daemon, run by systemd as root via
mythos-hostops.socket + mythos-hostops.service. It is the ONLY process
that invokes the root-owned helper /usr/local/sbin/mythos-hostops directly.

WHY THIS EXISTS (GitHub issue #130 / HOSTOPS-2R). mythos-ai-executor.service
runs with NoNewPrivileges=true -- load-bearing, never weakened. Under that
flag the kernel ignores the setuid bit on exec for every child of that
process, so `sudo` spawned from inside the executor could never actually
reach root, no matter what sudoers granted: the HOSTOPS-1 `sudo -n
mythos-hostops` boundary was silently non-functional in production. The fix
moves the privilege boundary out of the executor's process tree entirely:
this daemon is started directly by systemd (PID 1), never a child of the
hardened executor, so NoNewPrivileges on the executor does not apply to it
and is completely untouched. The executor reaches root-mediated state
purely by connecting to a local Unix socket, which needs no privilege at
all -- the socket's file permissions (root:mythos-hostops, 0660) are the
first gate, and this file's SO_PEERCRED check is the second, independent
one: identity comes exclusively from the kernel's report of the actual
connecting process's uid, never from anything the client sends in the
request body.

This file adds NO authorization of its own beyond that identity gate.
Allowlist lookup, READ-only class enforcement, per-argument validation and
the audit ledger all remain entirely inside /usr/local/sbin/mythos-hostops
(ops/hostops/mythos-hostops.js), invoked here with a FIXED argument array
and shell=False -- there is no shell, docker or systemctl call anywhere in
this file, and the helper is unmodified by HOSTOPS-2R.

Wire protocol (private, same-host AF_UNIX only; not a public API). One
newline-terminated JSON object each direction per connection, then the
daemon closes the connection:

  request   {"verb": str, "args": {str: str},
             "task_id": str|null, "othmode_task_id": str|null,
             "github_task_id": str|null}
  response  {"status": int, "stdout": str, "stderr": str}     -- helper ran
          | {"error": {"code": str, "message": str}}           -- it did not

Concurrency: one connection handled at a time (simple accept loop, bounded
per-connection timeout). This is a low-traffic, single-caller governed READ
path, not a public service; a hand-rolled loop is easier to audit in full
than a threaded server, and Restart=on-failure covers a crash.
"""
import json
import os
import pwd
import re
import socket
import struct
import subprocess
import sys
import time

# MYTHOS_HOSTOPS_DAEMON_HELPER is a dev/test-only override (mirrors the
# helper's own MYTHOS_HOSTOPS_HOME/_ALLOWLIST convention): the production
# systemd unit never sets it, so HELPER is always the real root-owned
# binary in production regardless of environment.
HELPER = os.environ.get('MYTHOS_HOSTOPS_DAEMON_HELPER') or '/usr/local/sbin/mythos-hostops'
SOCKET_PATH_DEFAULT = '/run/mythos-hostops/hostops.sock'
ALLOWED_USERNAMES = ('deploy', 'dagu')
EXEC_TIMEOUT_S = 12  # the helper's own EXEC_TIMEOUT_MS is 10000; small margin
CONN_TIMEOUT_S = EXEC_TIMEOUT_S + 5
MAX_REQUEST_BYTES = 8192
SAFE_ENV_PATH = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'

VERB_RE = re.compile(r'^[a-z][a-z.\-]{1,64}$')
FLAG_RE = re.compile(r'^[a-z][a-z-]{1,24}$')
TASK_ID_RE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$')
VALUE_MAX = 256
META_CHARS = set(';&|`$<>(){}[]\'"\\\t\r\n')


def resolve_allowed_uids(usernames=ALLOWED_USERNAMES):
    """uid -> username for every configured caller that actually exists.
    A missing system user (e.g. `dagu` not yet created) is skipped, never
    fatal -- it simply means that identity cannot connect yet."""
    uids = {}
    for name in usernames:
        try:
            uids[pwd.getpwnam(name).pw_uid] = name
        except KeyError:
            continue
    return uids


def resolve_caller(uid, allowed_uids):
    """Never trust a caller-supplied identity field -- there isn't one.
    `uid` must come from SO_PEERCRED. Root (the owner, direct or via the
    socket) is always trusted, matching the helper's own "root may call it
    directly" contract; deploy/dagu must resolve through the allowed set."""
    if uid == 0:
        return 'root'
    return allowed_uids.get(uid)


def get_peer_credentials(conn):
    # Linux SO_PEERCRED: struct ucred { pid_t pid; uid_t uid; gid_t gid; }
    # -- three C `int`s on every Linux architecture Mythos targets.
    raw = conn.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize('3i'))
    pid, uid, gid = struct.unpack('3i', raw)
    return {'pid': pid, 'uid': uid, 'gid': gid}


def validate_request(obj):
    """Defense in depth only -- the helper re-validates every verb and
    argument against the allowlist. This rejects obviously-malformed input
    before a subprocess is ever spawned and keeps build_argv() honest."""
    if not isinstance(obj, dict):
        return None, 'request must be a JSON object'
    unexpected = set(obj.keys()) - {'verb', 'args', 'task_id', 'othmode_task_id', 'github_task_id'}
    if unexpected:
        return None, 'unexpected field: ' + next(iter(unexpected))[:40]
    verb = obj.get('verb')
    if not isinstance(verb, str) or not VERB_RE.match(verb):
        return None, 'invalid verb'
    args = obj.get('args') if obj.get('args') is not None else {}
    if not isinstance(args, dict):
        return None, 'args must be an object'
    safe_args = {}
    for k, v in args.items():
        if not isinstance(k, str) or not FLAG_RE.match(k):
            return None, 'invalid argument name'
        if not isinstance(v, str) or len(v) > VALUE_MAX or any(c in META_CHARS for c in v):
            return None, 'invalid argument value'
        safe_args[k] = v
    ids = {}
    for field in ('task_id', 'othmode_task_id', 'github_task_id'):
        v = obj.get(field)
        if v is None:
            continue
        if not isinstance(v, str) or not TASK_ID_RE.match(v):
            return None, 'invalid ' + field
        ids[field] = v
    return {'verb': verb, 'args': safe_args, 'ids': ids}, None


def build_argv(req, helper=HELPER):
    """A FIXED argument array -- never a shell string. Flag order is
    deterministic (sorted) so behaviour never depends on client dict
    ordering; it has no security meaning since the helper accepts flags in
    any order."""
    argv = [helper, req['verb']]
    for k in sorted(req['args']):
        argv += ['--' + k, req['args'][k]]
    ids = req['ids']
    if ids.get('task_id'):
        argv += ['--task-id', ids['task_id']]
    if ids.get('othmode_task_id'):
        argv += ['--othmode-task', ids['othmode_task_id']]
    if ids.get('github_task_id'):
        argv += ['--github-task', ids['github_task_id']]
    return argv


def run_helper(req, caller_username, helper=HELPER, timeout=EXEC_TIMEOUT_S):
    """Invoke the helper directly: fixed argv, shell=False, a minimal
    fully-replaced environment (no leakage of this daemon's own env). Never
    raises -- every failure mode is reported the same way a spawnSync()
    failure was under HOSTOPS-1, so the executor's outcome mapping needs no
    new cases."""
    argv = build_argv(req, helper)
    env = {'PATH': SAFE_ENV_PATH}
    if caller_username != 'root':
        # SUDO_USER is the helper's existing caller-boundary signal (its
        # ALLOWED_SUDO_CALLERS check) -- reused as-is; nothing about the
        # helper changes. Root omits it, matching "root may call it
        # directly" (owner path, unchanged by HOSTOPS-2R).
        env['SUDO_USER'] = caller_username
    try:
        proc = subprocess.run(
            argv, shell=False, capture_output=True, timeout=timeout,
            env=env, encoding='utf-8', errors='replace'
        )
    except subprocess.TimeoutExpired:
        return {'error': {'code': 'ETIMEDOUT', 'message': 'the helper did not answer within ' + str(timeout) + 's'}}
    except FileNotFoundError:
        return {'error': {'code': 'ENOENT', 'message': 'helper binary not found: ' + helper}}
    except OSError as e:
        return {'error': {'code': 'EXEC_ERROR', 'message': str(e)}}
    return {'status': proc.returncode, 'stdout': proc.stdout, 'stderr': proc.stderr}


def log_event(kind, detail):
    try:
        sys.stderr.write(json.dumps({'ts': time.time(), 'event': kind, 'detail': detail}) + '\n')
        sys.stderr.flush()
    except Exception:
        pass  # logging must never break the boundary


def _read_line(conn, max_bytes, timeout):
    conn.settimeout(timeout)
    buf = b''
    try:
        while b'\n' not in buf and len(buf) < max_bytes:
            chunk = conn.recv(4096)
            if not chunk:
                break
            buf += chunk
    except OSError:
        return None
    if not buf:
        return None
    return buf.split(b'\n', 1)[0].decode('utf-8', errors='replace')


def _respond(conn, obj):
    try:
        conn.sendall((json.dumps(obj) + '\n').encode('utf-8'))
    except OSError:
        pass


def handle_connection(conn, helper=HELPER, allowed_usernames=ALLOWED_USERNAMES):
    try:
        creds = get_peer_credentials(conn)
    except OSError as e:
        log_event('peercred_unavailable', {'error': str(e)})
        conn.close()
        return

    allowed_uids = resolve_allowed_uids(allowed_usernames)
    caller_username = resolve_caller(creds['uid'], allowed_uids)
    if caller_username is None:
        _respond(conn, {'error': {'code': 'HOSTOPS_CALLER_REFUSED', 'message': 'peer uid ' + str(creds['uid']) + ' is not authorized'}})
        log_event('caller_refused', creds)
        conn.close()
        return

    raw = _read_line(conn, MAX_REQUEST_BYTES, CONN_TIMEOUT_S)
    if raw is None:
        conn.close()
        return
    try:
        obj = json.loads(raw)
    except ValueError:
        _respond(conn, {'error': {'code': 'HOSTOPS_INPUT', 'message': 'malformed request'}})
        conn.close()
        return

    req, err = validate_request(obj)
    if err:
        _respond(conn, {'error': {'code': 'HOSTOPS_INPUT', 'message': err}})
        conn.close()
        return

    result = run_helper(req, caller_username, helper)
    _respond(conn, result)
    conn.close()


def get_listen_socket():
    """systemd socket activation (LISTEN_FDS/LISTEN_PID, fd 3) is the
    production path -- mythos-hostops.socket owns the bind, permissions and
    /run/mythos-hostops directory lifecycle. A direct bind is a dev/test
    fallback only, gated on MYTHOS_HOSTOPS_DAEMON_SOCKET so a stray manual
    run never silently shadows the production socket path."""
    listen_pid = os.environ.get('LISTEN_PID')
    listen_fds = int(os.environ.get('LISTEN_FDS', '0') or '0')
    if listen_pid == str(os.getpid()) and listen_fds >= 1:
        sock = socket.fromfd(3, socket.AF_UNIX, socket.SOCK_STREAM)
        sock.listen(64)
        return sock

    path = os.environ.get('MYTHOS_HOSTOPS_DAEMON_SOCKET') or SOCKET_PATH_DEFAULT
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.bind(path)
    os.chmod(path, 0o660)
    sock.listen(64)
    return sock


def main():
    sock = get_listen_socket()
    log_event('daemon_started', {'pid': os.getpid()})
    while True:
        try:
            conn, _ = sock.accept()
        except OSError as e:
            log_event('accept_error', {'error': str(e)})
            continue
        try:
            handle_connection(conn)
        except Exception as e:
            log_event('daemon_error', {'error': str(e)})
            try:
                conn.close()
            except OSError:
                pass


if __name__ == '__main__':
    main()
