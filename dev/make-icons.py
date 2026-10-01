#!/usr/bin/env python3
"""Generates assets/icon.png (1024), icon-mac.png, icon.icns, icon.ico and assets/linux-icons/*.png.
No Python dependencies; the .icns and the resized PNGs use the macOS tools sips and iconutil.
Run on a Mac:  python3 dev/make-icons.py"""
import os, shutil, struct, subprocess, tempfile, zlib

BG, ACCENT, SOFT = (0x12, 0x30, 0x1f), (0x3d, 0xdc, 0x84), (0xa9, 0xc9, 0xb6)

def in_rect(x, y, x0, y0, x1, y1): return x0 <= x <= x1 and y0 <= y <= y1

def in_tri(x, y, a, b, c):
    def s(p, q, r): return (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1])
    p = (x, y); d1, d2, d3 = s(p, a, b), s(p, b, c), s(p, c, a)
    return not ((d1 < 0 or d2 < 0 or d3 < 0) and (d1 > 0 or d2 > 0 or d3 > 0))

def color_at(x, y, rr=0.2):
    cx = min(max(x, rr), 1 - rr); cy = min(max(y, rr), 1 - rr)
    if (x - cx) ** 2 + (y - cy) ** 2 > rr * rr: return None
    col = BG
    # a 3 x 3 grid of cells (the editable table); the middle one is the cell being edited
    for r in range(3):
        for c in range(3):
            x0, y0 = .20 + c * .21, .20 + r * .21
            if in_rect(x, y, x0, y0, x0 + .18, y0 + .18): col = ACCENT if (r, c) == (1, 1) else SOFT
    return col

def png(size, ss=2):
    rows = []
    for py in range(size):
        row = bytearray()
        for px in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(ss):
                for sx in range(ss):
                    c = color_at((px + (sx + .5) / ss) / size, (py + (sy + .5) / ss) / size)
                    if c:
                        acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]; acc[3] += 255
            n = ss * ss; a = acc[3] // n
            row += bytes([acc[0] // n, acc[1] // n, acc[2] // n, a]) if a else b"\0\0\0\0"
        rows.append(b"\x00" + bytes(row))
    def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(b"".join(rows), 9)) + chunk(b"IEND", b"")

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets")
os.makedirs(os.path.join(root, "linux-icons"), exist_ok=True)
master = os.path.join(root, "icon.png")
open(master, "wb").write(png(1024))
shutil.copy(master, os.path.join(root, "icon-mac.png"))

def resized(size, dest):
    subprocess.run(["sips", "-z", str(size), str(size), master, "--out", dest], check=True, stdout=subprocess.DEVNULL)

for s in (16, 32, 48, 64, 128, 256, 512):
    resized(s, os.path.join(root, "linux-icons", "%dx%d.png" % (s, s)))

with tempfile.TemporaryDirectory() as tmp:                 # .icns through iconutil
    iconset = os.path.join(tmp, "icon.iconset"); os.makedirs(iconset)
    for base in (16, 32, 128, 256, 512):
        resized(base, os.path.join(iconset, "icon_%dx%d.png" % (base, base)))
        resized(base * 2, os.path.join(iconset, "icon_%dx%d@2x.png" % (base, base)))
    subprocess.run(["iconutil", "-c", "icns", iconset, "-o", os.path.join(root, "icon.icns")], check=True)

sizes = (16, 32, 48, 64, 128, 256)                         # .ico: PNG images inside the container
images = [open(os.path.join(root, "linux-icons", "%dx%d.png" % (s, s)), "rb").read() for s in sizes]
head = struct.pack("<HHH", 0, 1, len(sizes)); offset = 6 + 16 * len(sizes); entries = b""
for s, data in zip(sizes, images):
    entries += struct.pack("<BBBBHHII", 0 if s == 256 else s, 0 if s == 256 else s, 0, 0, 1, 32, len(data), offset)
    offset += len(data)
open(os.path.join(root, "icon.ico"), "wb").write(head + entries + b"".join(images))
print("icons written")
