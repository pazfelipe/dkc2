"""Static reference graph of the DKC2 disassembly.

Nodes are global labels; an edge A->B means code or data under label A references label B
(JSR/JSL/JMP/JML/branches, `dw/dl label` table entries, `#label` immediates, %return(label)).

usage:
  callgraph.py summary
  callgraph.py closure ROOT[,ROOT...] [--cut TABLE[,TABLE...]] [--json OUT]
"""
import json
import os
import re
import sys
from collections import defaultdict

DIS = "/home/claude/ref/dkc2dis"
SYM = "/home/claude/work/dkc2.sym"

TERMINAL = {"RTS", "RTL", "RTI", "JMP", "JML", "BRA", "BRL", "STP", "DATA"}
label_re = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*):")
ident_re = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


def load_sym_addrs():
    addrs = {}
    sec = None
    for line in open(SYM, encoding="latin-1"):
        line = line.strip()
        if line.startswith("["):
            sec = line
            continue
        if sec != "[labels]":
            continue
        m = re.match(r"([0-9A-Fa-f]{2}):([0-9A-Fa-f]{4}) (\S+)$", line)
        if m:
            addrs.setdefault(m.group(3), (int(m.group(1), 16) << 16) | int(m.group(2), 16))
    return addrs


def parse():
    addrs = load_sym_addrs()
    code_labels = {k for k, v in addrs.items() if (v >> 16) >= 0x80}
    nodes = {}  # name -> dict(file, line_start, line_end, kind)
    edges = defaultdict(set)
    files = sorted(f for f in os.listdir(DIS) if f.startswith("bank_") and f.endswith(".asm"))
    for f in files:
        cur = None
        lines = open(os.path.join(DIS, f), encoding="latin-1").read().split("\n")
        for i, raw in enumerate(lines):
            line = raw.split(";", 1)[0]
            m = label_re.match(line)
            if m:
                name = m.group(1)
                if cur:
                    nodes[cur]["end"] = i
                    if nodes[cur].get("last_op") not in TERMINAL and nodes[cur]["code"]:
                        edges[cur].add(name)  # fallthrough into the next label
                cur = name
                nodes[name] = dict(file=f, start=i + 1, end=len(lines), asm_lines=0, code=False)
                line = line[m.end():]
            if cur is None:
                continue
            s = line.strip()
            if not s or s.startswith("."):
                # sublabel definition lines like ".foo" or ".foo:"
                s2 = s.split(":", 1)[1].strip() if ":" in s else ""
                if not s2:
                    continue
                s = s2
            nodes[cur]["asm_lines"] += 1
            tok = s.split(None, 1)
            op = tok[0].upper()
            rest = tok[1] if len(tok) > 1 else ""
            if re.match(r"^[A-Z]{3}(\.[bwl])?$", op):
                nodes[cur]["code"] = True
                nodes[cur]["last_op"] = op.split(".")[0]
            elif op.upper() in ("DW", "DL", "DB", "DD"):
                nodes[cur]["last_op"] = "DATA"
            if op.startswith("%RETURN") or op.startswith("%"):
                rest = s
            for idt in ident_re.findall(rest):
                if idt in code_labels and idt != cur:
                    edges[cur].add(idt)
    return nodes, edges, addrs


def closure(roots, cut, nodes, edges):
    seen = set()
    stack = list(roots)
    while stack:
        n = stack.pop()
        if n in seen or n not in nodes:
            continue
        seen.add(n)
        if n in cut:
            continue
        stack.extend(edges.get(n, ()))
    return seen


if __name__ == "__main__":
    nodes, edges, addrs = parse()
    cmd = sys.argv[1]
    if cmd == "summary":
        by = defaultdict(int)
        for n, d in nodes.items():
            if d["code"]:
                by[d["file"]] += d["asm_lines"]
        for f, c in sorted(by.items()):
            print(f, c)
    elif cmd == "closure":
        roots = sys.argv[2].split(",")
        cut = set()
        out = None
        args = sys.argv[3:]
        while args:
            a = args.pop(0)
            if a == "--cut":
                cut |= set(args.pop(0).split(","))
            elif a == "--json":
                out = args.pop(0)
        s = closure(roots, cut, nodes, edges)
        by = defaultdict(lambda: [0, 0])
        for n in s:
            d = nodes[n]
            if d["code"]:
                by[d["file"]][0] += 1
                by[d["file"]][1] += d["asm_lines"]
        tot = 0
        for f, (c, l) in sorted(by.items()):
            print(f"{f:20s} routines={c:5d} asm_lines={l:6d}")
            tot += l
        print("total asm lines", tot, "labels", len(s))
        if out:
            json.dump(sorted(s), open(out, "w"), indent=0)
    elif cmd == "refs":
        n = sys.argv[2]
        print("out:", sorted(edges.get(n, ())))
        print("in:", sorted(k for k, v in edges.items() if n in v))
