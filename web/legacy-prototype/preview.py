"""Build a self-contained local preview; run from repository root or anywhere."""
from pathlib import Path
import json

web = Path(__file__).resolve().parent
root = web.parent
template = (web / "template.html").read_text(encoding="utf-8")
css = (web / "style.css").read_text(encoding="utf-8")
js = (web / "app.js").read_text(encoding="utf-8")
data = json.loads((web / "routes.example.json").read_text(encoding="utf-8"))
page = template.replace("<!--FUNROADS:CSS-->", "<style>\n" + css + "\n</style>")
page = page.replace("<!--FUNROADS:DATA-->", "<script>window.__FUNROADS__ = " + json.dumps(data, separators=(",", ":")) + ";</script>")
page = page.replace("<!--FUNROADS:JS-->", "<script>\n" + js + "\n</script>")
assert page.count("<!--FUNROADS:") == 0
out = root / "dist" / "demo.html"
out.parent.mkdir(exist_ok=True)
out.write_text(page, encoding="utf-8")
print(out)
