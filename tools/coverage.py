"""Map the execution coverage bitmap (test/states/coverage.bin) onto the disassembly.

usage: coverage.py summary            per-bank executed instruction counts
       coverage.py routines BANKFILE  per-label executed/total instructions in one bank file
       coverage.py json OUT           {label: [executed, total, file, line]} for all labels
"""
import json
import os
import re
import sys

DIS = "/home/claude/ref/dkc2dis"
COV = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "test", "states", "coverage.bin")
cov = open(COV, "rb").read()
addr_re = re.compile(r";\$([0-9A-Fa-f]{6})")
label_re = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*):")


def executed(a):
    o = ((a >> 16) & 0x3F) << 16 | (a & 0xFFFF)
    return (cov[o >> 3] >> (o & 7)) & 1


def scan(f):
    res = {}
    cur = None
    for i, raw in enumerate(open(os.path.join(DIS, f), encoding="latin-1")):
        m = label_re.match(raw)
        if m:
            cur = m.group(1)
            res.setdefault(cur, [0, 0, f, i + 1])
        m = addr_re.search(raw)
        if m and cur and raw.strip() and not raw.strip().startswith(";"):
            code = raw.split(";", 1)[0].strip()
            if not code or code.lower().startswith(("db ", "dw ", "dl ", "dd ")):
                continue
            a = int(m.group(1), 16)
            res[cur][1] += 1
            res[cur][0] += executed(a)
    return res


files = sorted(f for f in os.listdir(DIS) if f.startswith("bank_") and f.endswith(".asm"))
if sys.argv[1] == "summary":
    T = E = 0
    for f in files:
        r = scan(f)
        t = sum(v[1] for v in r.values())
        e = sum(v[0] for v in r.values())
        n = sum(1 for v in r.values() if v[0])
        if t:
            print(f"{f:18s} executed {e:6d} / {t:6d} instr   labels touched {n}")
        T += t
        E += e
    print("total", E, "/", T)
elif sys.argv[1] == "routines":
    r = scan(sys.argv[2])
    for k, (e, t, f, ln) in sorted(r.items(), key=lambda kv: kv[1][3]):
        if t:
            print(f"{ln:6d} {k:50s} {e:5d}/{t:5d}")
elif sys.argv[1] == "json":
    allr = {}
    for f in files:
        allr.update({k: v for k, v in scan(f).items() if v[1]})
    json.dump(allr, open(sys.argv[2], "w"))
