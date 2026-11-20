#!/usr/bin/env python3
"""The perf table (0296): PERF lines (scripts/perf.sh, scripts/device-perf.sh) as a Markdown table, one row a look × scene
(the median of repeats). `perf-table.py after.txt --base before.txt` adds each number's change against a baseline."""
import statistics
import sys

COLS = [("cpu50", "CPU p50 ms"), ("cpu95", "p95"), ("cpu99", "p99"), ("enc50", "encode p50"), ("main", "main ms/frame"),
        ("draws", "draws"), ("tris", "tris"), ("passes", "passes"), ("mem", "mem MB"), ("peak", "peak MB"), ("metal", "Metal MB"),
        ("launch", "launch→frame ms"), ("hz", "Hz asked"), ("fps", "fps"), ("gpu", "GPU ms*"),
        ("cpumax", "CPU max ms"), ("over", "frames > 8.3 ms")]
SCENES = ["title", "show", "wall", "lineup", "roam", "freedrive", "stream", "cycle", "sheet", "paused"]
LOOKS = ["real", "anime", "pixel"]


def read(path):
    cells = {}
    for line in open(path):
        if not line.startswith("PERF "):
            continue
        kv = dict(p.split("=", 1) for p in line.split()[1:] if "=" in p)
        if kv.get("failed"):
            cells.setdefault((kv["look"], kv["scene"]), [])
            continue
        if float(kv.get("interval", 0)) > 0:
            kv["fps"] = str(1000 / float(kv["interval"]))
        cells.setdefault((kv["look"], kv["scene"]), []).append(kv)
    out = {}
    for k, runs in cells.items():
        row = {}
        for c, _ in COLS:
            vals = [float(r[c]) for r in runs if c in r]
            row[c] = statistics.median(vals) if vals else None
        out[k] = row
    return out


def fmt(v, c):
    if v is None:
        return "–"
    return f"{v:.0f}" if c in ("draws", "tris", "mem", "peak", "metal", "launch", "hz", "fps", "over") else f"{v:.2f}"


def main():
    args = sys.argv[1:]
    base = None
    if "--base" in args:
        i = args.index("--base")
        base = read(args[i + 1])
        del args[i:i + 2]
    cur = read(args[0])
    head = ["look", "scene"] + [h for _, h in COLS]
    print("| " + " | ".join(head) + " |")
    print("|" + "---|" * len(head))
    for look in LOOKS:
        for scene in SCENES:
            if (look, scene) not in cur:
                continue
            row, b = cur[(look, scene)], (base or {}).get((look, scene))
            cells = []
            for c, _ in COLS:
                s = fmt(row[c], c)
                if b and b.get(c) and row[c] is not None and c not in ("launch", "gpu"):
                    d = (row[c] - b[c]) / b[c] * 100
                    s = f"{fmt(b[c], c)} → {s} ({d:+.0f}%)"
                cells.append(s)
            print(f"| {look} | {scene} | " + " | ".join(cells) + " |")
    print("\n*GPU ms: the simulator's GPU says nothing about a phone's; read it from a device run only.")


if __name__ == "__main__":
    main()
