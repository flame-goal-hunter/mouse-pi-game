#!/usr/bin/env bash
# Publish the game (the www/ folder) to GitHub Pages.
#
# One-time setup:
#   1. Create an EMPTY repository on github.com (public — Pages is free only for public repos).
#   2. git remote add origin https://github.com/<user>/<repo>.git
#   3. git push -u origin network_mode          # or whichever branch holds the game
#   4. Run this script.
#   5. On GitHub: Settings -> Pages -> Source = "Deploy from a branch", Branch = gh-pages, folder = / (root).
#
# After that, every new release is just: tools/deploy_pages.sh
set -euo pipefail
cd "$(dirname "$0")/.."

git remote get-url origin >/dev/null 2>&1 || { echo "No 'origin' remote yet — see the setup steps at the top of this file."; exit 1; }
[ -f www/index.html ] || { echo "www/index.html not found"; exit 1; }

touch www/.nojekyll                      # serve the files as-is, no Jekyll processing
git add www/.nojekyll >/dev/null 2>&1 || true
git diff --cached --quiet || git commit -m "chore(web): .nojekyll for GitHub Pages" >/dev/null

branch="$(git rev-parse --abbrev-ref HEAD)"
echo "Publishing www/ from '$branch' to gh-pages…"
git subtree push --prefix www origin gh-pages

url_base="$(git remote get-url origin | sed -E 's#(git@|https://)github.com[:/]##; s#\.git$##')"
user="${url_base%%/*}"; repo="${url_base##*/}"
echo
echo "Done. The game will be at:"
echo "   https://${user}.github.io/${repo}/"
echo "Share that link — Chrome on Android will offer 'Установить приложение'."
