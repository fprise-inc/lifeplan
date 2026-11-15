// AIから、表示の設定の候補が届いている帯（0215。接続口の propose_display_settings）。候補は事務所の既定値のいちばん上に承認待ちで出る。
// 設定は FP が画面で設定ごとに「今 → 候補」を確かめて「反映する」を押したときだけ変わる。ここでは件数と、開くボタンだけを出す
import { PopIcon } from "../../presentation/icons.tsx";

export function AiDisplayCandidateBand({ count, onOpen }: { count: number; onOpen: () => void }) {
  if (count <= 0) return null;
  return (
    <div class="ai-code-band" role="status" data-ai-display-band>
      <b>AIから、表示の設定の候補が届いています（{count}件）</b>
      <span class="pl-sub">確かめて「反映する」を押すまで、設定は変わりません</span>
      <button type="button" class="link-btn" onClick={onOpen} data-ai-display-band-open>
        事務所の既定値で確かめる
        <PopIcon />
      </button>
    </div>
  );
}
