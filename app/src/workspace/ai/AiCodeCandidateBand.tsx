// AIから、機能を有効にするコードの候補が届いている帯（0015 の追記の2段目）。候補は事務所の既定値のいちばん下に承認待ちで出る。
// コードは FP が画面で入れる前と後を確かめて押したときだけ入る。ここでは件数と、開くボタンだけを出す（コードの中身は出さない）
import { PopIcon } from "../../presentation/icons.tsx";

export function AiCodeCandidateBand({ count, onOpen }: { count: number; onOpen: () => void }) {
  if (count <= 0) return null;
  return (
    <div class="ai-code-band" role="status" data-ai-code-band>
      <b>AIから、機能を有効にするコードの候補が届いています（{count}件）</b>
      <span class="pl-sub">確かめて押すまで、コードは入りません</span>
      <button type="button" class="link-btn" onClick={onOpen} data-ai-code-band-open>
        事務所の既定値で確かめる
        <PopIcon />
      </button>
    </div>
  );
}
