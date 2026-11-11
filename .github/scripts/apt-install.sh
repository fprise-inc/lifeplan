#!/usr/bin/env bash
# Ubuntu の実行機に apt で包みを入れる（Tauri が Linux で使うライブラリ・valgrind）。
# 使い方: .github/scripts/apt-install.sh 包み...
#
# 実行機から Ubuntu の置き場（azure.archive.ubuntu.com・archive.ubuntu.com・security.ubuntu.com）の名前が
# 引けなくなると、apt-get update は警告だけで成功を返し、古い索引のまま install に進む。install は包みごとに
# 3つの置き場で20秒ずつ待って2時間近く止まるか、古い索引の版が置き場に無く 404 で落ちる（2026-11-11 に起きた。
# 同じ実行機から packages.microsoft.com や npm・GitHub は引けていた）。その手当て:
# - 先に置き場の名前が引けるかを確かめ、引けなければ公開の DNS を足して引き直す
#   （包みの中身は apt が置き場の署名で確かめるので、名前の引き先を変えても入る物は変わらない）
# - update と install は Ubuntu の置き場だけを使う（実行環境が足している別の置き場の索引は要らず、
#   そこが落ちていても止めない）。Ubuntu の置き場の設定が見つからなければ、すべての置き場を使う
# - update は索引が1つでも取れなければ失敗にする（--error-on=any）。古い索引のまま install に進まない
# - 取得の時間切れと再試行を付け、1回の試しの update・install に時間の上限を付けて、落ちたら1回だけやり直す
# 手順の側でも timeout-minutes を付ける（この手順が止まっても、ジョブを長く待たせない）
set -uo pipefail

if [ "$#" -eq 0 ]; then
  echo "入れる包みを指定してください" >&2
  exit 2
fi

hosts=(azure.archive.ubuntu.com archive.ubuntu.com security.ubuntu.com)
apt_opts=(
  -o Acquire::Retries=3
  -o Acquire::http::Timeout=30
  -o Acquire::https::Timeout=30
  -o DPkg::Lock::Timeout=60
)

# Ubuntu の置き場の設定（ubuntu.com か、実行環境の置き場の一覧 apt-mirrors.txt を指すもの）だけを集めた置き場の設定
src_dir=$(mktemp -d)
n=0
for f in /etc/apt/sources.list /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources; do
  [ -f "$f" ] || continue
  if /usr/bin/grep -Eqs '^[^#]*(ubuntu\.com|apt-mirrors\.txt)' "$f"; then
    base=$(basename "$f")
    [ "$base" = sources.list ] && base=ubuntu-main.list
    cp "$f" "$src_dir/$base"
    echo "使う置き場の設定: $f"
    n=$((n + 1))
  else
    echo "使わない置き場の設定: $f"
  fi
done
if [ "$n" -gt 0 ]; then
  empty_list=$(mktemp --suffix=.list)
  apt_opts+=(-o "Dir::Etc::SourceList=$empty_list" -o "Dir::Etc::SourceParts=$src_dir")
else
  echo "::warning::Ubuntu の置き場の設定が見つからないため、すべての置き場を使う"
fi
[ -f /etc/apt/apt-mirrors.txt ] && echo "置き場の一覧（/etc/apt/apt-mirrors.txt）:" && sed 's/^/  /' /etc/apt/apt-mirrors.txt

resolves_all() {
  local h ok=0
  for h in "${hosts[@]}"; do
    if timeout 15 getent ahosts "$h" > /dev/null 2>&1; then
      echo "名前を引けた: $h"
    else
      echo "名前を引けない: $h"
      ok=1
    fi
  done
  return "$ok"
}

if ! resolves_all; then
  echo "::warning::Ubuntu の置き場の名前を実行機の DNS で引けないため、公開の DNS（1.1.1.1・8.8.8.8）を足して引き直す"
  sudo mkdir -p /etc/systemd/resolved.conf.d
  printf '[Resolve]\nDNS=1.1.1.1 8.8.8.8 2606:4700:4700::1111 2001:4860:4860::8888\n' \
    | sudo tee /etc/systemd/resolved.conf.d/90-ci-public-dns.conf > /dev/null
  sudo systemctl restart systemd-resolved
  sleep 2
  if ! resolves_all; then
    echo "::warning::公開の DNS を足しても Ubuntu の置き場の名前を引けない（このまま apt を試す）"
    resolvectl status 2>&1 | sed -n '1,40p' || true
  fi
fi

for attempt in 1 2; do
  echo "::group::apt の試し ${attempt}/2"
  if [ "$attempt" -gt 1 ]; then
    # 前の試しが install の途中で時間切れになったときのため、途中の設定を済ませておく
    sudo dpkg --configure -a || true
  fi
  if ! sudo timeout --kill-after=10 90 apt-get update --error-on=any "${apt_opts[@]}"; then
    echo "::endgroup::"
    echo "::warning::apt の試し ${attempt}/2: update が失敗した（索引が取れない・時間切れ）"
  elif ! sudo timeout --kill-after=10 180 apt-get install -y --no-install-recommends "${apt_opts[@]}" "$@"; then
    echo "::endgroup::"
    echo "::warning::apt の試し ${attempt}/2: install が失敗した（包みが取れない・時間切れ）"
  else
    echo "::endgroup::"
    exit 0
  fi
  [ "$attempt" -lt 2 ] && sleep 15
done

echo "::error::apt で包みを入れられなかった: $*"
exit 1
