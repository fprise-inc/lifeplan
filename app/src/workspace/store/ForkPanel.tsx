// 分岐を選ぶ画面（中央のパネル。0011 の7・0023 の7）:
// - 保存しようとしたら、ほかの人（ほかの PC）が先に保存していた: 相手の内容を残す／こちらの内容で上書きする／両方を残す（こちらのプランを足す）
// - 同期サービスの衝突の写しがある: 写しを今の内容にする／写しを片付ける
// どれを選んでも、選ばなかったほうはこの PC の中に暗号化したまま残る
import { useEffect, useRef } from "preact/hooks";
import type { ForkInfo } from "../../engine/host.ts";
import { shortDate } from "./HouseholdPanel.tsx";

export type ForkChoiceUi = "theirs" | "ours" | "both";

export interface ForkPanelProps {
  customerNo: string;
  info: ForkInfo | null;
  busy: boolean;
  error: string | null;
  onChoose: (c: ForkChoiceUi) => void;
  onSyncCopies: (adopt: boolean) => void;
  onClose: () => void;
}

export function ForkPanel(p: ForkPanelProps) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => panel.current?.focus({ preventScroll: true }), []);
  const who = p.info?.theirsBy != null ? `${p.info.theirsBy}さん` : "ほかのPC";
  const when = p.info?.theirsSavedAt != null ? shortDate(p.info.theirsSavedAt) : "";
  return (
    <>
      <div class="scrim" aria-hidden="true" />
      <div ref={panel} class="rk-panel fork-panel" role="dialog" aria-modal="true" aria-labelledby="fork-title" tabIndex={-1} data-fork-panel>
        <h2 id="fork-title">世帯 {p.customerNo} が分岐しました</h2>
        {p.info === null ? <p>読み込んでいます…</p> : null}
        {p.info?.savedConflict === true ? (
          <>
            <p>
              この世帯を開いている間に、<b>{who}</b>が先に保存していました{when !== "" ? `（${when}）` : ""}。上書きはせず、いまの内容はこのPCの中に別に残してあります。どちらを残すか選んでください。
            </p>
            <div class="fork-choices">
              <button type="button" class="btn" disabled={p.busy} onClick={() => p.onChoose("theirs")} data-fork-choice="theirs">
                <b>{who}の内容を残す</b>
                <span>こちらの変更は使いません（このPCの中に残ります）</span>
              </button>
              <button type="button" class="btn" disabled={p.busy} onClick={() => p.onChoose("both")} data-fork-choice="both">
                <b>両方を残す</b>
                <span>{who}の内容に、こちらにだけあるプランを足します（入力の違いは混ぜません）</span>
              </button>
              <button type="button" class="btn" disabled={p.busy} onClick={() => p.onChoose("ours")} data-fork-choice="ours">
                <b>こちらの内容で上書きする</b>
                <span>{who}の内容は、このPCの中に残します</span>
              </button>
            </div>
          </>
        ) : null}
        {p.info !== null && p.info.syncCopies > 0 ? (
          <>
            <h3>同期サービスの衝突の写し（{p.info.syncCopies}）</h3>
            <p class="pl-sub">同期サービスが、同じ世帯の別の保存を別名のファイルとして残しています。</p>
            <div class="rk-row">
              <button type="button" class="btn" disabled={p.busy} onClick={() => p.onSyncCopies(true)} data-fork-sync="adopt">
                写しを今の内容にする
              </button>
              <button type="button" class="btn" disabled={p.busy} onClick={() => p.onSyncCopies(false)} data-fork-sync="dismiss">
                写しを片付ける
              </button>
            </div>
          </>
        ) : null}
        <p class="pl-sub">どれを選んでも、選ばなかったほうはこのPCの中に暗号化したまま残ります。</p>
        {p.error !== null ? (
          <p class="hh-err" role="alert">
            {p.error}
          </p>
        ) : null}
        {p.info !== null && !p.info.savedConflict ? (
          <div class="rk-foot">
            <button type="button" class="btn" onClick={p.onClose}>
              閉じる
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}
