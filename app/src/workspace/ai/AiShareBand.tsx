// 共有中の帯（0015 の8）: AIに世帯を渡している間、入力・作業の画面の上に目立つ帯を出す（顧客番号・AIから見える仮名・残り時間・取り消し）。
// 顧客に見せる提示の層（src/presentation/）には出さない（0016 の2）。顧客と一緒に見ることのある画面（入力の画面のほか）では、
// どの世帯かが分かる顧客番号・仮名を出さず、件数と残り時間だけを出す（0015 の8）
import type { AiShareStatus } from "../../engine/host.ts";
import { remainingText } from "./model.ts";

export function AiShareBand({ shares, detailed, onStop, onOpen }: { shares: readonly AiShareStatus[]; detailed: boolean; onStop: (householdId: string) => void; onOpen: () => void }) {
  if (shares.length === 0) return null;
  if (!detailed)
    return (
      <div class="ai-band" role="status" data-ai-band="brief">
        <span class="ai-band-mark" aria-hidden="true" />
        <b>AIに渡しています（{shares.length}件）</b>
        <span>{remainingText(Math.min(...shares.map((s) => s.expiresInSec)))}</span>
        <button type="button" class="link-btn" onClick={onOpen} data-ai-band-open>
          AI接続口の設定
        </button>
      </div>
    );
  return (
    <div class="ai-band" role="status" data-ai-band>
      <span class="ai-band-mark" aria-hidden="true" />
      <b>AIに渡しています</b>
      {shares.map((s) => (
        <span key={s.shareId} class="ai-band-item">
          顧客番号 {s.customerNumber ?? "—"}（AIには「{s.alias}」）・{remainingText(s.expiresInSec)}
          <button type="button" class="btn danger" onClick={() => onStop(s.householdId)} data-ai-band-stop>
            取り消す
          </button>
        </span>
      ))}
      <button type="button" class="link-btn" onClick={onOpen} data-ai-band-open>
        AI接続口の設定
      </button>
    </div>
  );
}
