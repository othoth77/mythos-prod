#!/usr/bin/env python3
"""Host memory telemetry for the MYTHOS VPS — read-only.

WHY. On 2026-08-31 this host suffered 519 global OOM kills in two hours. The
victims were 20-40 MB production services (idauto-api, mythos-command-center,
ssangyong-storefront, gnome-keyring, pulseaudio); the causes were the large
unbounded consumers. Nothing recorded memory over time, so the incident could
only be reconstructed afterwards from kernel messages.

This samples every 120s and appends one line to memwatch.log. It never writes
anything but its own log, and holds no state between samples.
"""
import os, time, datetime, glob

OUT = "/opt/mythos-memwatch"
LOG = os.path.join(OUT, "memwatch.log")
INTERVAL = 120
ROTATE_BYTES = 8 * 1024 * 1024


def meminfo():
    d = {}
    with open("/proc/meminfo") as f:
        for line in f:
            k, _, v = line.partition(":")
            d[k] = int(v.split()[0])          # kB
    return d


def psi():
    try:
        with open("/proc/pressure/memory") as f:
            for line in f:
                if line.startswith("some"):
                    return float(line.split("avg60=")[1].split()[0])
    except Exception:
        pass
    return -1.0


def top_rss(n=5):
    out = []
    for p in glob.glob("/proc/[0-9]*"):
        try:
            with open(p + "/status") as f:
                name = rss = None
                for line in f:
                    if line.startswith("Name:"):
                        name = line.split()[1]
                    elif line.startswith("VmRSS:"):
                        rss = int(line.split()[1]); break
            if rss:
                out.append((rss, name))
        except Exception:
            continue
    out.sort(reverse=True)
    return out[:n]


def cgroup_top(n=4):
    out = []
    for f in glob.glob("/sys/fs/cgroup/**/memory.current", recursive=True):
        try:
            v = int(open(f).read().strip())
        except Exception:
            continue
        d = f[len("/sys/fs/cgroup/"):-len("/memory.current")]
        # only leaf-ish service/scope cgroups, skip aggregate slices
        if v > 100 * 1024 * 1024 and (d.endswith(".service") or d.endswith(".scope")):
            out.append((v, d))
    out.sort(reverse=True)
    return out[:n]


def limits(warn_ratio=0.8):
    """Cgroups with a hard memory.max (added 2026-09-18 OOM hardening).

    Always reports the root agent-session slice (user-0.slice); any other
    capped cgroup appears only when it is >= 80 % of its cap or has recorded
    an OOM kill, so a healthy line stays short. Docker scopes show as
    docker-<id12>. Appended AFTER the fixed prefix that Guardian and the
    Resource Guard parse, so their regexes are unaffected.
    """
    out = []
    for f in glob.glob("/sys/fs/cgroup/**/memory.max", recursive=True):
        try:
            raw = open(f).read().strip()
            if raw == "max":
                continue
            mx = int(raw)
            d = os.path.dirname(f)
            cur = int(open(d + "/memory.current").read().strip())
            oom = 0
            for line in open(d + "/memory.events"):
                if line.startswith("oom_kill "):
                    oom = int(line.split()[1])
        except Exception:
            continue
        name = os.path.basename(d)
        if name.startswith("docker-"):
            name = name[:19]
        if name != "user-0.slice" and cur < warn_ratio * mx and oom == 0:
            continue
        out.append(f"{name}:{cur//1048576}M/{mx//1048576}M" + (f":oom{oom}" if oom else ""))
    return " ".join(sorted(out))


def oom_count():
    """Cumulative OOM kills seen by the kernel, via cgroup counters."""
    total = 0
    for f in glob.glob("/sys/fs/cgroup/memory.events") + \
             glob.glob("/sys/fs/cgroup/*/memory.events"):
        try:
            for line in open(f):
                if line.startswith("oom_kill "):
                    total += int(line.split()[1])
        except Exception:
            continue
    return total


def rotate():
    try:
        if os.path.getsize(LOG) > ROTATE_BYTES:
            os.replace(LOG, LOG + ".1")
    except FileNotFoundError:
        pass
    except Exception:
        pass


def sample():
    m = meminfo()
    total = m["MemTotal"] // 1024
    avail = m["MemAvailable"] // 1024
    swt = m["SwapTotal"] // 1024
    swf = m["SwapFree"] // 1024
    swused = swt - swf
    procs = " ".join(f"{n}:{r//1024}M" for r, n in top_rss())
    cgs = " ".join(f"{d.split('/')[-1]}:{v//1048576}M" for v, d in cgroup_top())
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    rotate()
    with open(LOG, "a") as f:
        f.write(f"{stamp} avail={avail}M/{total}M swap={swused}M/{swt}M "
                f"psi60={psi():.2f} oom_kills={oom_count()} | top {procs} | cg {cgs} | lim {limits()}\n")
        f.flush()


def main():
    while True:
        try:
            sample()
        except Exception as exc:
            with open(LOG, "a") as f:
                f.write(f"ERROR {type(exc).__name__}: {exc}\n")
        time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
