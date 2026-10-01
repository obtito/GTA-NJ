# silhouette.py — 从实景照片提取紫峰塔身轮廓（每行的左右边缘），找出台阶位置
# 用法: python silhouette.py <image.jpg> [--x0 N] [--x1 N]
# 原理：塔是图中最高的连续暗色物体，背景是天空；逐行从左右两边向中间扫，
#       第一个「不像天空」的像素即塔身边缘。台阶 = 宽度突变处。
import sys
from PIL import Image

def main():
    path = sys.argv[1]
    x0, x1 = None, None
    for a in sys.argv[2:]:
        if a.startswith('--x0='): x0 = int(a.split('=')[1])
        if a.startswith('--x1='): x1 = int(a.split('=')[1])
    im = Image.open(path).convert('RGB')
    W, H = im.size
    px = im.load()
    x0 = x0 if x0 is not None else 0
    x1 = x1 if x1 is not None else W - 1

    def is_sky(x, y):
        r, g, b = px[x, y]
        # 天空：亮、偏暖或偏蓝、饱和低；塔身：明显更暗
        lum = (r * 0.299 + g * 0.587 + b * 0.114)
        return lum > 118

    rows = []
    for y in range(H):
        L = None
        for x in range(x0, (x0 + x1) // 2):
            if not is_sky(x, y):
                # 需连续 3 像素非天空，防抖
                if x + 2 < W and not is_sky(x + 1, y) and not is_sky(x + 2, y):
                    L = x
                    break
        R = None
        for x in range(x1, (x0 + x1) // 2, -1):
            if not is_sky(x, y):
                if x - 2 >= 0 and not is_sky(x - 1, y) and not is_sky(x - 2, y):
                    R = x
                    break
        if L is not None and R is not None and R - L > 4:
            rows.append((y, L, R))

    if not rows:
        print('no tower found'); return
    # 塔身主体 = 最长的连续段
    y_top = rows[0][0]
    print(f'image {W}x{H}, tower rows y[{y_top}..{rows[-1][0]}]')
    print('  y     L     R    W(px)   dW%')
    prev_w = None
    step_rows = []
    for (y, L, R) in rows:
        w = R - L
        dw = 0 if prev_w is None else (w - prev_w) / prev_w * 100
        mark = ''
        if prev_w is not None and abs(dw) > 6:
            mark = '  <== STEP'
            step_rows.append((y, dw))
        if y % 10 == 0 or mark:
            print(f'{y:5d} {L:5d} {R:5d} {w:7d} {dw:7.1f}{mark}')
        prev_w = w
    print('\n台阶汇总（宽度突变 >6% 的行）:')
    for (y, dw) in step_rows:
        frac = (y - y_top) / max(1, (rows[-1][0] - y_top))
        print(f'  y={y:5d}  dW={dw:+.1f}%   距塔顶 {frac * 100:.0f}%')

if __name__ == '__main__':
    main()
