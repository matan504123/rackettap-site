#!/bin/bash
# Renders every fixture at every viewport with headless Chrome -> PNGs + contact sheet.
# Needs python3 + Pillow (crops the screenshot to the exact viewport). Usage: live/dev/shoot.sh [fixture-regex]
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
OUT=/private/tmp/claude-503/live-shots; mkdir -p "$OUT"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$HERE/build.sh"
FIX=(serve-named serve-unnamed padel-mid padel-final-tb tennis-final-5 starpoint deciding-tb deciding-final badminton pickleball-s2 americano unnamed longnames longnames-final paused ended pickleball-sideout)
VPS=(320x568 375x667 390x844 430x932 844x390 932x430 1024x768 1366x1024 1440x900 1920x1080)
PORT=$(python3 -c 'import socket;s=socket.socket();s.bind(("",0));print(s.getsockname()[1])')
python3 -m http.server $PORT --bind 127.0.0.1 -d "$ROOT" >/dev/null 2>&1 &
trap 'pkill -f "http.server $PORT" 2>/dev/null' EXIT
sleep 1
if [ -z "$1" ]; then rm -f "$OUT"/*.png; fi
jobs_file=$(mktemp)
for f in "${FIX[@]}"; do
  [[ -n "$1" && ! "$f" =~ $1 ]] && continue
  for v in "${VPS[@]}"; do
    echo "$f $v" >> "$jobs_file"
  done
done
shoot() { f=$1; v=$2; W=${v%x*}; H=${v#*x}
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --user-data-dir="/private/tmp/claude-503/chrome-prof-$f-$v" --virtual-time-budget=3000 \
    --window-size=$((W<600?600:W)),$((H<600?600:H)) --screenshot="$OUT/$f-$v.png" "http://localhost:$PORT/live/dev/frame.html?f=$f&w=$W&h=$H" >/dev/null 2>&1
  python3 -c "import sys;from PIL import Image;p=sys.argv[1];Image.open(p).crop((0,0,int(sys.argv[2]),int(sys.argv[3]))).save(p)" "$OUT/$f-$v.png" $W $H
  rm -rf "/private/tmp/claude-503/chrome-prof-$f-$v"; }
export -f shoot; export CHROME OUT PORT
xargs -P 4 -L 1 bash -c 'shoot $0 $1' < "$jobs_file"
rm -f "$jobs_file"
# contact sheet
{ echo '<!doctype html><meta charset=utf-8><title>live shots</title><style>body{background:#222;color:#fff;font:13px sans-serif}h2{margin:24px 8px 4px}div.row{display:flex;gap:10px;align-items:flex-start;padding:8px;overflow-x:auto}figure{margin:0}figcaption{font-size:11px}img{border:1px solid #555;display:block;height:300px}</style>'
  for f in "${FIX[@]}"; do ls "$OUT/$f-"*.png >/dev/null 2>&1 || continue
    echo "<h2>$f</h2><div class=row>"
    for v in "${VPS[@]}"; do [ -f "$OUT/$f-$v.png" ] && echo "<figure><img src=\"$f-$v.png\"><figcaption>$v</figcaption></figure>"; done
    echo "</div>"; done; } > "$OUT/contact-sheet.html"
echo "done: $OUT/contact-sheet.html ($(ls "$OUT"/*.png | wc -l) shots)"
