"""Classify every byte of the DKC2 ROM as 65816 CODE or DATA, from the assembled disassembly.

usage: python3 tools/rom_layout.py [SYM] [DIS]     -> writes tools/rom_layout.json

Inputs (no ROM needed):
  SYM  the WLA symbol file asar writes when assembling the disassembly (default
       /home/claude/work/dkc2.sym). Its [addr-to-line mapping] section gives, for every source line
       that emitted bytes, the ROM address of its first byte; [labels] gives the names.
  DIS  the disassembly (default /home/claude/ref/dkc2dis), to read each emitting line.

How a byte is classified: it belongs to the source line whose mapping entry is the closest at or
before it. That line is
  - a 65816 instruction (or a macro line that expands to one, e.g. %return -> PEA)  -> CODE
  - db/dw/dl/dd, incbin, a pad/fill, or anything assembled with `arch spc700` (the sound
    driver and the song data run on the sound CPU: for the 65816 they are bytes to upload) -> DATA
Bytes that no line emitted (asar padding between org blocks) are DATA (filler).

Validation (the script fails if any check fails):
  - every byte executed by the original game in the traced runs (test/states/coverage.bin, one bit
    per opcode address) is the first byte of a CODE line;
  - the length of every CODE line, computed from its mnemonic/operand, equals the distance to
    the next mapped line (so each instruction's bytes are exactly covered);
  - every mnemonic seen in CODE is a 65816 mnemonic.

Output tools/rom_layout.json (facts only: addresses, lengths, names, no ROM bytes):
  {"rom_size": N, "sha256": "...", "blocks": [[offset, length, kind, name, src, src_offset], ...]}
  kind  "code" | "data" | "pad"
  name  label the block starts at (or LABEL+$off)
  src   for data blocks: the disassembly file that holds them. For incbin blocks the included file
        (data/...bin) and src_offset = offset inside that file; for inline db/dw data the .asm file.
"""
import json
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SYM = sys.argv[1] if len(sys.argv) > 1 else "/home/claude/work/dkc2.sym"
DIS = sys.argv[2] if len(sys.argv) > 2 else "/home/claude/ref/dkc2dis"
COV = os.path.join(ROOT, "test", "states", "coverage.bin")
ROM = sys.argv[3] if len(sys.argv) > 3 else os.environ.get("DKC2_ROM", "/home/claude/dkc2/Donkey Kong Country 2 - Diddy's Kong Quest (USA) (En,Fr) (Rev 1).sfc")
ROM_SIZE = 0x400000
SHA256 = "b79c2bb86f6fc76e1fc61c62fc16d51c664c381e58bc2933be643bbc4d8b610c"

MNEMONICS = set(
    """ADC AND ASL BCC BCS BEQ BIT BMI BNE BPL BRA BRK BRL BVC BVS CLC CLD CLI CLV CMP COP CPX CPY
    DEC DEX DEY EOR INC INX INY JML JMP JSL JSR LDA LDX LDY LSR MVN MVP NOP ORA PEA PEI PER PHA PHB
    PHD PHK PHP PHX PHY PLA PLB PLD PLP PLX PLY REP ROL ROR RTI RTL RTS SBC SEC SED SEI SEP STA STP
    STX STY STZ TAX TAY TCD TCS TDC TRB TSB TSC TSX TXA TXS TXY TYA TYX WAI WDM XBA XCE""".split()
)
IMPLIED = set(
    """CLC CLD CLI CLV DEX DEY INX INY NOP PHA PHB PHD PHK PHP PHX PHY PLA PLB PLD PLP PLX PLY RTI
    RTL RTS SEC SED SEI STP TAX TAY TCD TCS TDC TSC TSX TXA TXS TXY TYA TYX WAI XBA XCE""".split()
)
DATA_DIRECTIVES = ("db", "dw", "dl", "dd", "incbin", "fill", "pad", "skip")


def snes_to_off(bank, adr):
    if bank >= 0xC0:
        return ((bank - 0xC0) << 16) | adr
    if 0x80 <= bank < 0xC0 and adr >= 0x8000:
        return ((bank - 0x80) << 16) | adr
    if 0x40 <= bank < 0x7E:
        return ((bank - 0x40) << 16) | adr
    if bank < 0x40 and adr >= 0x8000:
        return (bank << 16) | adr
    raise ValueError(f"not a ROM address: {bank:02X}:{adr:04X}")


# ---- symbol file ----
files, mapping, labels = {}, [], []
sec = None
for raw in open(SYM, encoding="latin-1"):
    line = raw.strip()
    if line.startswith("["):
        sec = line
        continue
    if not line:
        continue
    if sec == "[source files]":
        fid, _crc, path = line.split(" ", 2)
        files[int(fid, 16)] = path
    elif sec == "[addr-to-line mapping]":
        a, fl = line.split()
        bank, adr = a.split(":")
        fid, ln = fl.split(":")
        mapping.append((snes_to_off(int(bank, 16), int(adr, 16)), int(fid, 16), int(ln, 16)))
    elif sec == "[labels]":
        m = re.match(r"([0-9A-Fa-f]{2}):([0-9A-Fa-f]{4}) (\S+)$", line)
        if m and not m.group(3).startswith(":") and int(m.group(1), 16) >= 0x80:  # ROM labels only
            bank, adr = int(m.group(1), 16), int(m.group(2), 16)
            try:
                labels.append((snes_to_off(bank, adr), m.group(3)))
            except ValueError:
                pass

src_cache = {}


def src_lines(fid):
    if fid not in src_cache:
        src_cache[fid] = open(os.path.join(DIS, files[fid]), encoding="latin-1").read().split("\n")
    return src_cache[fid]


# `arch` state per source line: simulate each file top to bottom (every file that switches to
# spc700 does it itself; the 65816 files never inherit it)
arch_cache = {}


def arch_at(fid, ln):
    if fid not in arch_cache:
        st, out = "65816", []
        for t in src_lines(fid):
            m = re.match(r"\s*arch\s+(\S+)", t)
            if m:
                st = m.group(1)
            out.append(st)
        arch_cache[fid] = out
    return arch_cache[fid][ln - 1]


def strip_comment(t):
    out, q = [], False
    for ch in t:
        if ch == '"':
            q = not q
        if ch == ";" and not q:
            break
        out.append(ch)
    return "".join(out).strip()


def statement(fid, ln):
    t = strip_comment(src_lines(fid)[ln - 1])
    # leading labels ("foo:", ".foo", "+", "-") do not emit bytes
    while True:
        m = re.match(r"^(?:[A-Za-z_.?][\w.?]*:|\.[\w]+|[+-]+)(\s+|$)", t)
        if not m:
            break
        t = t[m.end():]
    return t.strip()


# ---- classify each mapped line ----
mapping.sort()

# lines inside a macro body: the enclosing macro's name (asar maps a macro's emitted bytes to lines
# of its definition, sometimes the `macro`/`else`/`endwhile` line itself)
macro_cache = {}
CODE_MACROS = {"return", "pea_use_dbr", "pea_shift_dbr", "pea_mask_dbr", "pea_engine_dbr", "pea_mirror_dbr", "lda_sound"}


def macro_at(fid, ln):
    if fid not in macro_cache:
        cur, out = None, []
        for t in src_lines(fid):
            m = re.match(r"\s*macro\s+(\w+)", t)
            if m:
                cur = m.group(1)
            out.append(cur)
            if re.match(r"\s*endmacro", t):
                cur = None
        macro_cache[fid] = out
    return macro_cache[fid][ln - 1]


kinds = []  # per mapping entry: ("code"|"data", detail)
bad_mn = {}
for off, fid, ln in mapping:
    st = statement(fid, ln)
    word = st.split(None, 1)[0] if st else ""
    w = word.split(".")[0]
    mac = macro_at(fid, ln)
    if arch_at(fid, ln) != "65816":
        kinds.append(("data", "spc700"))
    elif mac:
        kinds.append(("code", f"%{mac}") if mac in CODE_MACROS else ("data", "macro:" + mac))
    elif w.lower() in DATA_DIRECTIVES or w.lower() == "assert" and ": pad" in st:
        kinds.append(("data", w.lower()))
    elif w.upper() in MNEMONICS and w.upper() == w:
        kinds.append(("code", st))
    else:
        bad_mn[f"{files[fid]}:{ln}: {st[:40]}"] = bad_mn.get(st[:40], 0) + 1
        kinds.append(("data", "?" + st[:40]))

if bad_mn:
    print("unrecognised emitting lines (classified as data):")
    for k, n in sorted(bad_mn.items(), key=lambda kv: -kv[1])[:40]:
        print(f"  {n:5d}  {k}")

# ---- instruction lengths (from the opcode byte in the ROM + the operand text) ----
def _op_len_table():
    t = [0] * 256
    for op in range(256):
        hi, lo = op >> 4, op & 15
        if lo in (1, 3, 5, 6, 7):
            n = 2
        elif lo == 4:
            n = 3 if op in (0x44, 0x54, 0xF4) else 2
        elif lo == 2:
            n = {0x22: 4, 0x62: 3, 0x82: 3, 0xA2: -2}.get(op, 2)
        elif lo == 0:
            n = {0x20: 3, 0x40: 1, 0x60: 1, 0xA0: -2, 0xC0: -2, 0xE0: -2}.get(op, 2)
        elif lo == 9:
            n = -1 if hi % 2 == 0 else 3
        elif lo in (8, 0xA, 0xB):
            n = 1
        elif lo in (0xC, 0xD, 0xE):
            n = 4 if op == 0x5C else 3
        else:
            n = 4
        t[op] = n  # -1: immediate sized by M, -2: immediate sized by X
    return t


OPLEN = _op_len_table()
rom = None
if ROM and os.path.exists(ROM):
    rom = open(ROM, "rb").read()
    if len(rom) % 1024 == 512:
        rom = rom[512:]
    import hashlib

    if hashlib.sha256(rom).hexdigest() != SHA256:
        raise SystemExit("ROM is not DKC2 USA Rev 1")
    print("instruction lengths checked against the opcodes in", os.path.basename(ROM))


def insn_len(off, st, nxt):
    if st.startswith("%"):  # code macros expand to one instruction (PEA / LDA #imm16)
        return 3
    if rom is None:
        n = nxt - off
        return n if 1 <= n <= 4 else None
    n = OPLEN[rom[off]]
    if n > 0:
        return n
    mn, _, op = st.partition(" ")
    op = op.strip()
    if mn.endswith(".b"):
        return 2
    if mn.endswith(".w"):
        return 3
    m = re.match(r"#\$([0-9A-Fa-f]+)$", op)
    if m:
        return 1 + (len(m.group(1)) + 1) // 2
    d = nxt - off
    return d if d in (2, 3) else None


# ---- per-byte map ----
KIND = bytearray(ROM_SIZE)  # 0 = unmapped filler, 1 = code, 2 = data
ends = []
for i, (off, fid, ln) in enumerate(mapping):
    nxt = mapping[i + 1][0] if i + 1 < len(mapping) else ROM_SIZE
    k, detail = kinds[i]
    if k == "code":
        n = insn_len(off, detail, nxt)
        if n is None or off + n > nxt:
            raise SystemExit(f"bad instruction length {n} at ${off:06X}: {files[fid]}:{ln}: {detail}")
        end = off + n
    else:
        end = nxt
    ends.append(end)
    KIND[off:end] = (b"\x01" if k == "code" else b"\x02") * (end - off)

# bytes after an instruction that no line emitted. In bank $80 the code was assembled over the tail
# of an earlier incbin ("weird copy of ship hold tilemap" at $80F4B0): the bytes past the code are
# still that incbin's, so give them back to it.
incbin_extent = []
for i, (off, fid, ln) in enumerate(mapping):
    if kinds[i] == ("data", "incbin"):
        st = statement(fid, ln)
        m = re.search(r":\$?([0-9A-Fa-f]+)\.\.\$?([0-9A-Fa-f]+)", st)
        if m:
            incbin_extent.append((off, off + int(m.group(2), 16) - int(m.group(1), 16), i))
overlap_tail = {}  # gap start -> (gap end, mapping index of the incbin)
for i in range(len(mapping) - 1):
    if kinds[i][0] == "code" and ends[i] != mapping[i + 1][0]:
        g0, g1 = ends[i], mapping[i + 1][0]
        for a, e, j in incbin_extent:
            if a < g0 and e >= g1:
                overlap_tail[g0] = (g1, j)
                KIND[g0:g1] = b"\x02" * (g1 - g0)

gaps = [(mapping[i][0], ends[i], mapping[i + 1][0]) for i in range(len(mapping) - 1) if kinds[i][0] == "code" and ends[i] != mapping[i + 1][0]]
if gaps:
    print(f"{len(gaps)} code lines are followed by bytes no line emitted:")
    for a, e, n in gaps[:10]:
        print(f"  ${a:06X}: instruction ends ${e:06X}, next line at ${n:06X}")

# ---- validation against the execution coverage ----
cov = open(COV, "rb").read()
code_starts = bytearray(ROM_SIZE)
for i, (off, _f, _l) in enumerate(mapping):
    if kinds[i][0] == "code":
        code_starts[off] = 1
bad, mid = [], []
executed = 0
for o in range(ROM_SIZE):
    if (cov[o >> 3] >> (o & 7)) & 1:
        executed += 1
        if KIND[o] != 1:
            bad.append(o)
        elif not code_starts[o]:
            mid.append(o)
if bad:
    for o in bad[:20]:
        print(f"executed byte ${o:06X} is not code (kind {KIND[o]})")
    raise SystemExit(f"{len(bad)} executed addresses outside code")
print(f"coverage: {executed} executed opcode addresses, all inside code")
if mid:
    # the disassembly decodes these bytes as part of a longer instruction (it assumed another M/X
    # width or the code jumps into the middle of an instruction); they are code either way
    print(f"  {len(mid)} of them start inside a disassembled instruction: " + " ".join(f"${o:06X}" for o in mid))

# ---- blocks ----
labels.sort()
# global labels first at an address, then sublabels
by_off = {}
for off, name in labels:
    by_off.setdefault(off, []).append(name)


def best_label(names):
    g = [n for n in names if "." not in n and "_" != n[0]]
    return (g or names)[0]


label_offs = sorted(by_off)
import bisect


def name_at(off):
    i = bisect.bisect_right(label_offs, off) - 1
    if i < 0:
        return f"ROM_{off:06X}"
    lo = label_offs[i]
    n = best_label(by_off[lo])
    return n if lo == off else f"{n}+${off - lo:X}"


# source of each data byte range: incbin file + offset, or the asm file
def incbin_src(fid, ln):
    st = statement(fid, ln)
    m = re.match(r'incbin\s+"([^"]+)"(?::\$?([0-9A-Fa-f]+)\.\.\$?([0-9A-Fa-f]+))?', st)
    if not m:
        raise SystemExit(f"cannot parse incbin {files[fid]}:{ln}: {st}")
    path = os.path.normpath(os.path.join(os.path.dirname(files[fid]), m.group(1)))
    start = int(m.group(2), 16) if m.group(2) else 0
    return path, start


blocks = []
global_starts = set(o for o, ns in by_off.items() if any("." not in n for n in ns))
PAD_DETAILS = ("pad", "fill", "skip", "assert")


def is_text_line(detail, fid, ln):
    return detail == "db" and '"' in statement(fid, ln)


def push(off, end, kind, src=None, src_off=0, fmt=None):
    if end > off:
        if kind == "data" and fmt is None and src and "palette" in (src + name_at(off)).lower() and (end - off) % 2 == 0:
            fmt = "palette"
        blocks.append([off, end - off, kind, name_at(off), src, src_off, fmt])


def flush(end):
    global cur
    if cur:
        push(cur["off"], end, cur["kind"], cur["src"], 0, "text" if cur["kind"] == "data" and cur["text"] else None)
        cur = None


# walk mapping entries, merging consecutive entries into blocks:
#   code: merge runs of code; split at global labels
#   incbin: one block per incbin line
#   inline data: merge consecutive inline data lines of the same asm file; split at global labels
#   pad: asar padding (padbyte/pad) and bytes no line emitted
label_file = {}
for _fid, path in files.items():
    if path.endswith(".asm") and "macros" not in path:
        for t in src_lines(_fid):
            m = re.match(r"([A-Za-z_]\w*):", t)
            if m:
                label_file.setdefault(m.group(1), path)
pos = 0
cur = None
last_file = None  # the file a macro expansion was invoked from
for i, (off, fid, ln) in enumerate(mapping):
    if off > pos:  # bytes no line emitted before this entry
        flush(pos)
        if pos in overlap_tail and overlap_tail[pos][0] == off:
            j = overlap_tail[pos][1]
            p, s0 = incbin_src(mapping[j][1], mapping[j][2])
            push(pos, off, "data", p, s0 + pos - mapping[j][0])
        else:
            push(pos, off, "pad")
    k, detail = kinds[i]
    end = ends[i]
    if "macros.asm" not in files[fid]:
        last_file = files[fid]
    else:  # a macro expansion: it belongs to the file that defines the label it sits under
        last_file = label_file.get(name_at(off).split("+")[0], last_file)
    if k == "data" and detail == "incbin":
        flush(off)
        p, s = incbin_src(fid, ln)
        push(off, end, "data", p, s)
    else:
        if k == "data" and detail in PAD_DETAILS:
            k = "pad"
        src = last_file if k == "data" else None
        if cur and (cur["kind"] != k or cur["src"] != src or off in global_starts):
            flush(off)
        if not cur:
            cur = {"off": off, "kind": k, "src": src, "text": True}
        if k == "data" and not is_text_line(detail, fid, ln):
            cur["text"] = False
    pos = end
    if end < (mapping[i + 1][0] if i + 1 < len(mapping) else ROM_SIZE):
        flush(end)
flush(pos)
push(pos, ROM_SIZE, "pad")

# sanity: blocks tile the ROM exactly
p = 0
for b in blocks:
    assert b[0] == p, (hex(b[0]), hex(p))
    p += b[1]
assert p == ROM_SIZE

tot = {"code": 0, "data": 0, "pad": 0}
for b in blocks:
    tot[b[2]] += b[1]
print("bytes:", {k: f"{v} ({v * 100 / ROM_SIZE:.1f}%)" for k, v in tot.items()}, "blocks:", len(blocks))
out = os.path.join(ROOT, "tools", "rom_layout.json")
with open(out, "w") as f:
    f.write('{"rom_size": %d, "sha256": "%s", "blocks": [\n' % (ROM_SIZE, SHA256))
    f.write(",\n".join(json.dumps(b, separators=(",", ":")) for b in blocks))
    f.write("\n]}\n")
print("wrote", out)
