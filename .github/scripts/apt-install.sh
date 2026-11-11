#!/usr/bin/env bash
# Ubuntu の実行機に apt で包みを入れる（Tauri が Linux で使うライブラリ・valgrind）。
# 使い方: .github/scripts/apt-install.sh 包み...
#
# 実行機から Ubuntu の置き場（azure.archive.ubuntu.com・archive.ubuntu.com・security.ubuntu.com）の名前が
# 引けなくなると、apt-get は包みごとに3つの置き場で20秒ずつ待ち、install が2時間近く止まる（2026-11-11 に起きた。
# 同じ実行機から packages.microsoft.com や npm・GitHub は引けていた）。その手当て:
# - 先に置き場の名前が引けるかを確かめ、引けなければ公開の DNS を足して引き直す
#   （包みの中身は apt が置き場の署名で確かめるので、名前の引き先を変えても入る物は変わらない）
# - 取得の時間切れと再試行を付け、1回目は索引が1つでも取れなければ update を失敗にする
#   （取れない索引のまま install に進み、取れない包みを1つずつ待つことをしない）
# - 1回の試しの update・install に時間の上限を付け、落ちたら1回だけやり直す。2回目は前と同じく、
#   取れない索引があっても先に進む（Ubuntu の外の置き場だけが一時的に落ちているときに止めない）
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
  update_opts=(--error-on=any)
  if [ "$attempt" -gt 1 ]; then
    update_opts=()
    # 前の試しが install の途中で時間切れになったときのため、途中の設定を済ませておく
    sudo dpkg --configure -a || true
  fi
  if sudo timeout --kill-after=10 90 apt-get update "${update_opts[@]}" "${apt_opts[@]}" \
    && sudo timeout --kill-after=10 180 apt-get install -y --no-install-recommends "${apt_opts[@]}" "$@"; then
    echo "::endgroup::"
    exit 0
  fi
  echo "::endgroup::"
  echo "::warning::apt の試し ${attempt}/2 が失敗した（時間切れを含む）"
  [ "$attempt" -lt 2 ] && sleep 10
done

echo "::error::apt で包みを入れられなかった: $*"
exit 1
