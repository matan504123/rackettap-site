#!/bin/bash
# Renders every fixture at every viewport with headless Chrome -> PNGs. Needs python3 with Pillow
# (PIL_PY overrides the interpreter; default ~/wink-art-venv/bin/python). Usage: tournament/dev/shoot.sh [fixture-regex]
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"
OUT="${OUT:-/tmp/pt-shots/tournament}"; mkdir -p "$OUT"
PIL_PY="${PIL_PY:-$HOME/wink-art-venv/bin/python}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$HERE/build.sh"
FIX=(empty mid mid-standings mid-sheet mid-sheet-filled finished finished-standings hostile hostile-standings hostile-sheet swap swap-sheet setup missing)
VPS=(375x1500 768x1300 1280x1000)
PORT=$(python3 -c 'import socket;s=socket.socket();s.bind(("",0));print(s.getsockname()[1])')
python3 -m http.server $PORT --bind 127.0.0.1 -d "$ROOT" >/dev/null 2>&1 &
trap 'pkill -f "http.server $PORT" 2>/dev/null' EXIT
sleep 1
[ -z "$1" ] && rm -f "$OUT"/*.png
for f in "${FIX[@]}"; do
  [[ -n "$1" && ! "$f" =~ $1 ]] && continue
  for v in "${VPS[@]}"; do
    W=${v%x*}; H=${v#*x}
    "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
      --user-data-dir="$OUT/.prof-$f-$v" --virtual-time-budget=4000 \
      --window-size=$((W<600?600:W)),$((H<600?600:H)) --screenshot="$OUT/$f-$v.png" \
      "http://localhost:$PORT/tournament/dev/frame.html?f=$f&w=$W&h=$H" >/dev/null 2>&1
    "$PIL_PY" -c "import sys;from PIL import Image;p=sys.argv[1];Image.open(p).crop((0,0,int(sys.argv[2]),int(sys.argv[3]))).save(p)" "$OUT/$f-$v.png" $W $H
    rm -rf "$OUT/.prof-$f-$v"
  done
done
echo "done: $(ls "$OUT"/*.png | wc -l) shots in $OUT"
