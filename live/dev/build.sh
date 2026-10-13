#!/bin/bash
# Builds live/dev/page.html (gitignored): the production page with the Apple CDN
# script swapped for the stub + fixtures. Production index.html is untouched.
cd "$(dirname "$0")"
sed -e 's#<script src="https://cdn.apple-cloudkit.com/ck/2/cloudkit.js"></script>#<script src="fixtures.js"></script><script src="cloudkit-stub.js"></script>#' \
    -e 's#<script src="live.js">#<script src="../live.js">#' \
    -e 's#src="../icon.png"#src="../../icon.png"#' \
    -e 's#href="../"#href="../../"#' ../index.html > page.html
grep -q cloudkit-stub page.html || { echo "stub swap failed"; exit 1; }
