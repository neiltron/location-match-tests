from pathlib import Path
import json, math
from PIL import Image, ImageDraw, ImageFont
import pandas as pd
from jinja2 import Template

IMAGES_DIR = Path("images")
CLUSTERS_JSON = Path("outputs/verified_graph/clusters.json")  # from verify_and_cluster.py
VIS_DIR = Path("outputs/vis"); VIS_DIR.mkdir(parents=True, exist_ok=True)

TILE = 160          # px per thumb
MAX_TILES = 64      # max images per montage (e.g., 8x8)
GRID_W = 8          # columns

# Try to load a system font; fallback to default if not available
def _font(sz=18):
    try:
        return ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Unicode.ttf", sz)
    except:
        return ImageFont.load_default()

def make_contact_sheet(img_paths, out_path, title):
    n = min(len(img_paths), MAX_TILES)
    cols, rows = GRID_W, math.ceil(n/GRID_W)
    W, H = cols*TILE, rows*TILE + 36
    sheet = Image.new("RGB", (W, H), (245,245,245))
    draw = ImageDraw.Draw(sheet)
    draw.text((8, 8), title, fill=(30,30,30), font=_font(20))

    for i, p in enumerate(img_paths[:n]):
        r, c = divmod(i, cols)
        x, y = c*TILE, 36 + r*TILE
        try:
            im = Image.open(IMAGES_DIR/p).convert("RGB")
            im.thumbnail((TILE, TILE))
            # center in tile
            tmp = Image.new("RGB", (TILE, TILE), (230,230,230))
            off = ((TILE-im.width)//2, (TILE-im.height)//2)
            tmp.paste(im, off)
            sheet.paste(tmp, (x, y))
        except Exception as e:
            # gray placeholder on failure
            ImageDraw.Draw(sheet).rectangle([x, y, x+TILE-1, y+TILE-1], fill=(200,200,200))
    sheet.save(out_path, quality=90)

def main():
    data = json.loads(CLUSTERS_JSON.read_text())
    clusters = data["clusters"]
    records = []
    for cid, imgs in enumerate(sorted(clusters, key=len, reverse=True), start=1):
        out = VIS_DIR / f"cluster_{cid:04d}.jpg"
        make_contact_sheet(imgs, out, f"Cluster {cid}  •  {len(imgs)} images")
        records.append({"cluster_id": cid, "size": len(imgs), "montage": out.name})
    df = pd.DataFrame(records).sort_values("size", ascending=False)
    df.to_csv(VIS_DIR/"clusters_summary.csv", index=False)

    # lightweight index.html
    tpl = Template("""
<!doctype html><meta charset="utf-8">
<title>Clusters</title>
<style>
  body{font-family:ui-sans-serif,system-ui,-apple-system; margin:24px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(380px,1fr));gap:20px}
  .card{background:#fff;border-radius:12px;box-shadow:0 1px 4px rgba(0,0,0,.08);padding:12px}
  .meta{display:flex;justify-content:space-between;color:#555;margin:6px 4px 10px}
  img{width:100%;height:auto;border-radius:8px}
</style>
<h1>Image Clusters</h1>
<p>Total clusters: {{n}}. Showing montages (top {{max_tiles}} imgs/cluster).</p>
<div class="grid">
{% for r in rows %}
  <div class="card">
    <div class="meta"><div>Cluster {{r.cluster_id}}</div><div>{{r.size}} images</div></div>
    <a href="{{r.montage}}"><img loading="lazy" src="{{r.montage}}"></a>
  </div>
{% endfor %}
</div>
""")
    (VIS_DIR/"index.html").write_text(tpl.render(rows=df.to_dict("records"), n=len(df), max_tiles=MAX_TILES))

if __name__ == "__main__":
    main()

