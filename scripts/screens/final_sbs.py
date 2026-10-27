import sys
from PIL import Image
# usage: final_sbs.py live.png mine.png out.png
live, mine, out = sys.argv[1:4]
L = Image.open(live).convert("RGB")
if L.size != (1280, 800):
    L = L.resize((1280, round(L.height * 1280 / L.width)), Image.LANCZOS)
L = L.crop((0, 58, 1280, 58 + 742))
M = Image.open(mine).convert("RGB").crop((0, 0, 1280, 742))
im = Image.new("RGB", (1280 * 2 + 8, 742), (200, 30, 30))
im.paste(L, (0, 0)); im.paste(M, (1288, 0))
im.save(out, optimize=True)
