"""Split each code bank into packages of roughly equal instruction counts at global-label boundaries.
Also reports executed instructions (coverage) per package. usage: split_banks.py BANKFILE N"""
import os, re, sys
DIS = "/home/claude/ref/dkc2dis"
sys.argv += []
f, n = sys.argv[1], int(sys.argv[2])
COV = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "test", "states", "coverage.bin")
cov = open(COV, "rb").read()
addr_re = re.compile(r";\$([0-9A-Fa-f]{6})")
label_re = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*):")
labels = []  # (line, name, instr, executed)
cur = None
for i, raw in enumerate(open(os.path.join(DIS, f), encoding="latin-1")):
    m = label_re.match(raw)
    if m:
        cur = [i + 1, m.group(1), 0, 0]
        labels.append(cur)
    m = addr_re.search(raw)
    if m and cur:
        code = raw.split(";", 1)[0].strip()
        if not code or code.lower().startswith(("db ", "dw ", "dl ", "dd ", ".")):
            if not code or not code.startswith("."):
                continue
        a = int(m.group(1), 16)
        o = ((a >> 16) & 0x3F) << 16 | (a & 0xFFFF)
        cur[2] += 1
        cur[3] += (cov[o >> 3] >> (o & 7)) & 1
total = sum(l[2] for l in labels)
target = total / n
acc = 0
start = labels[0]
pk = []
for idx, l in enumerate(labels):
    if acc >= target and len(pk) < n - 1:
        pk.append((start, labels[idx - 1], acc))
        start, acc = l, 0
    acc += l[2]
pk.append((start, labels[-1], acc))
for s, e, a in pk:
    ex = sum(l[3] for l in labels if s[0] <= l[0] <= e[0])
    print(f"lines {s[0]:6d}-{e[0]:6d}  {s[1]:45s} .. {e[1]:45s} instr={a:5d} executed={ex}")
