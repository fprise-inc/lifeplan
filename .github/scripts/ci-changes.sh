#!/usr/bin/env bash
# ci.yml の changes のジョブ: どのジョブを流すかを決め、GITHUB_OUTPUT に書く（実行の分数を減らすため。0005 の追記 2026-10-28）。
# - 手で起動したとき（workflow_dispatch）と毎晩（schedule。その日に main が変わったときだけ）: すべて（macOS・Windows・速さの測定も）
# - それ以外は Linux だけで、前に確かめた木と今の木の違うファイルに関わるジョブだけ:
#   - pull_request の synchronize（push・main への合わせ直し）と main への push: 前の頭（before）の ci が成功していれば、
#     before と今の木（pull_request は main と合わせた木）の違い。合わせ直しなら、main から入った変更に関わるジョブだけになる
#   - それ以外（PR を開いたとき・前の実行が無いか成功していないとき）: pull_request は main との違い、push はすべて
#   - main への push で、取り込んだ PR の頭が取り込む前の main を含み、木が同じで、その頭の ci が成功していれば、何も流さない
#     （同じ木を PR で確かめ済み。squash で取り込むので、合わせ直してから取り込めば木が同じになる）
# - ファイルとジョブの対応は下の classify。docs/ と ci 以外のワークフローは何も流さない。分からないファイルはすべて流す
set -euo pipefail
out() { echo "$1=$2" >> "$GITHUB_OUTPUT"; echo "$1=$2"; }
ALL=(engine app report hearing statement xlsx host licenses_rust)
declare -A on=()
all() { for j in "${ALL[@]}"; do on[$j]=1; done; }
event="$EVENT_NAME"; run=true; heavy=false; files=""; mode=""

succeeded() { # $1 = 頭の sha。その sha の ci の実行に成功した物があるか
  [ -n "$1" ] && [ "$1" != "0000000000000000000000000000000000000000" ] || return 1
  n=$(gh api "repos/$REPO/actions/runs?head_sha=$1&per_page=50" --jq '[.workflow_runs[] | select(.name == "ci" and .conclusion == "success")] | length' 2>/dev/null || echo 0)
  [ "$n" -gt 0 ]
}
have() { git cat-file -e "$1^{commit}" 2>/dev/null || git fetch -q --depth=1 origin "$1" 2>/dev/null; }

case "$event" in
  workflow_dispatch) heavy=true; all; mode="手で起動（すべて）" ;;
  schedule)
    if [ -n "$(git log --since='24 hours ago' --oneline)" ]; then heavy=true; all; mode="毎晩（すべて）"; else run=false; mode="毎晩（main が変わっていない）"; fi ;;
  pull_request)
    if [ "$ACTION" = "synchronize" ] && have "$BEFORE" && succeeded "$BEFORE"; then
      files=$(git diff --name-only "$BEFORE" HEAD); mode="前の頭（${BEFORE:0:7}）からの違い"
    else
      files=$(git diff --name-only HEAD^1 HEAD); mode="main との違い"
    fi ;;
  push)
    pr_head=$(gh api "repos/$REPO/commits/$SHA/pulls" --jq '.[0].head.sha // empty' 2>/dev/null || true)
    if [ -n "$pr_head" ] && have "$pr_head" && git merge-base --is-ancestor HEAD^ "$pr_head" \
      && [ "$(git rev-parse "HEAD^{tree}")" = "$(git rev-parse "$pr_head^{tree}")" ] && succeeded "$pr_head"; then
      run=false; mode="PR の頭（${pr_head:0:7}）で同じ木を確かめ済み"
    elif have "$BEFORE" && succeeded "$BEFORE"; then
      files=$(git diff --name-only "$BEFORE" HEAD); mode="前の頭（${BEFORE:0:7}）からの違い"
    else
      all; mode="前の実行が無いか成功していない（すべて）"
    fi ;;
  *) all; mode="すべて" ;;
esac

classify() {
  case "$1" in
    docs/*|LICENSE|.github/workflows/secret-scan.yml|.github/workflows/app-bundle.yml|.gitignore) ;;
    # 速さの前の値（速さの計測は手で起動したときと毎晩だけ）
    engine/bench/*) ;;
    engine/*|sdk/*|registry/*|data/*) on[engine]=1; on[app]=1; on[report]=1; on[hearing]=1; on[host]=1 ;;
    app/src-tauri/Cargo.*|app/src-tauri/deny.toml) on[app]=1; on[licenses_rust]=1 ;;
    app/*) on[app]=1 ;;
    report/*) on[report]=1; on[app]=1 ;;
    hearing/*) on[hearing]=1; on[app]=1 ;;
    statement/*) on[statement]=1; on[app]=1 ;;
    xlsx/*) on[xlsx]=1; on[hearing]=1; on[statement]=1; on[app]=1 ;;
    crates/*|Cargo.toml|Cargo.lock|deny.toml) on[host]=1; on[report]=1; on[app]=1; on[licenses_rust]=1 ;;
    # 配布元の識別子の検査（app の check:distribution）は docs/ の外のすべてのファイルを読む
    *.md|LICENSES.md) on[app]=1 ;;
    *) all ;;
  esac
}
while IFS= read -r f; do [ -n "$f" ] && classify "$f"; done <<< "$files"

echo "判定: $mode"
[ -n "$files" ] && echo "違うファイル: $(echo "$files" | wc -l | tr -d ' ') 件" && echo "$files" | head -50
out run "$run"; out heavy "$heavy"
for j in "${ALL[@]}"; do out "$j" "$([ "$run" = true ] && [ -n "${on[$j]:-}" ] && echo true || echo false)"; done
# engine のジョブは、まとめた JS を使うジョブ（app・report・hearing・host）のためにも流す（テストは engine の変更のときだけ）
b=false; for j in engine app report hearing host; do [ "$run" = true ] && [ -n "${on[$j]:-}" ] && b=true; done
out engine_build "$b"
{ echo "### 流すジョブ"; echo; echo "判定: $mode"; echo; for j in "${ALL[@]}"; do echo "- $j: ${on[$j]:+流す}"; done; } >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
