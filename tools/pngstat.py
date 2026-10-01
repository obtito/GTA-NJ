#!/usr/bin/env python3
# pngstat.py — 纯 stdlib PNG 亮度/颜色统计（AI 读不了图，用数值代替目视验证）
# 用法: python pngstat.py <file.png> [--grid 8x6]
import struct, sys, zlib

def decode(path):
    data = open(path, 'rb').read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', 'not a png'
    pos, idat = 8, b''
    w = h = bd = ct = None
    while pos < len(data):
        ln = struct.unpack('>I', data[pos:pos + 4])[0]
        typ = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + ln]
        if typ == b'IHDR':
            w, h, bd, ct, comp, fl, il = struct.unpack('>IIBBBBB', chunk[:13])
            assert bd == 8 and il == 0, f'unsupported bd={bd} il={il}'
        elif typ == b'IDAT':
            idat += chunk
        pos += 12 + ln
    assert ct in (2, 6), f'unsupported color type {ct}'
    bpp = 3 if ct == 2 else 4
    raw = zlib.decompress(idat)
    stride = w * bpp
    out = bytearray(w * h * 3)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        f = raw[p]; p += 1
        line = bytearray(raw[p:p + stride]); p += stride
        if f == 1:
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i - bpp]) & 255
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                pp = a + b - c
                pa, pb, pc = abs(pp - a), abs(pp - b), abs(pp - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        row3 = y * w * 3
        if bpp == 3:
            out[row3:row3 + w * 3] = line
        else:
            for x in range(w):
                s = x * 4; d = row3 + x * 3
                out[d] = line[s]; out[d + 1] = line[s + 1]; out[d + 2] = line[s + 2]
        prev = line
    return w, h, bytes(out)

def main():
    path = sys.argv[1]
    gw, gh = 8, 6
    for a in sys.argv[2:]:
        if a.startswith('--grid='):
            gw, gh = map(int, a.split('=')[1].split('x'))
    w, h, px = decode(path)
    n = w * h
    lum_sum = 0.0
    bright = vbright = warm = orange = red = 0
    bx0, bx1, by0, by1 = w, 0, h, 0
    grid = [[0] * gw for _ in range(gh)]
    gcell_w, gcell_h = w / gw, h / gh
    for y in range(h):
        row = y * w * 3
        for x in range(w):
            i = row + x * 3
            r, g, b = px[i], px[i + 1], px[i + 2]
            lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255.0
            lum_sum += lum
            if lum > 0.35: bright += 1
            if lum > 0.60: vbright += 1
            if lum > 0.35:
                if x < bx0: bx0 = x
                if x > bx1: bx1 = x
                if y < by0: by0 = y
                if y > by1: by1 = y
            if r > 140 and r - b > 30 and g > 90 and lum > 0.3:
                warm += 1
                grid[min(gh - 1, int(y / gcell_h))][min(gw - 1, int(x / gcell_w))] += 1
            if r > 150 and 40 < g < 190 and b < 100:
                orange += 1
            if r > 150 and g < 90 and b < 90:
                red += 1
    print(f'file          : {path}')
    print(f'size          : {w}x{h}  pixels={n}')
    print(f'mean luminance: {lum_sum / n:.4f}')
    print(f'lum>0.35      : {bright:7d}  ({100.0 * bright / n:.3f}%)')
    print(f'lum>0.60      : {vbright:7d}  ({100.0 * vbright / n:.3f}%)')
    print(f'warm bright   : {warm:7d}  ({100.0 * warm / n:.3f}%)  <- 窗光（暖）')
    print(f'orange        : {orange:7d}  ({100.0 * orange / n:.3f}%)  <- 冠缘环/塔尖发光')
    print(f'red           : {red:7d}  ({100.0 * red / n:.3f}%)  <- 航空障碍灯')
    if bright:
        print(f'bright bbox   : x[{bx0},{bx1}] y[{by0},{by1}]  (image {w}x{h})')
    print(f'warm-pixel grid ({gw}x{gh}, 行=上->下):')
    for gy in range(gh):
        print('  ' + ' '.join(f'{grid[gy][gx]:6d}' for gx in range(gw)))

if __name__ == '__main__':
    main()
