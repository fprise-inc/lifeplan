// AIから、表示の設定の案が届いている帯（0215・0213 の段B の後半。接続口の propose_display_settings）。事務所の既定値の案は事務所の既定値の画面の
// いちばん上に、渡された世帯ごとの案はその世帯の結果のタブ（プランの帯の下）に承認待ちで出る。設定は FP が画面で設定ごとに「今 → 案」を確かめて
// 「反映する」を押したときだけ変わる。ここでは、どこに案が届いているか（事務所の既定値・開いている世帯・ほかの世帯）と件数、開くボタンだけを出す。
// 顧客と一緒に見ることのある画面（入力の画面のほか）では、ほかの世帯の顧客番号・仮名を出さず、件数だけを出す（共有中の帯と同じ。0015 の8）
import type { AiDisplayPendingHousehold } from "../../engine/host.ts";
import { PopIcon } from "../../presentation/icons.tsx";

export interface AiDisplayCandidateBandProps {
  /** 事務所の既定値の案の数（事務所の既定値の画面を開いているときは0） */
  office: number;
  /** 世帯ごとの案の届いている世帯 */
  households: readonly AiDisplayPendingHousehold[];
  /** 開いている世帯の内部ID（無ければ null） */
  openedId: string | null;
  /** 顧客番号と仮名を出してよい画面か（入力の画面・世帯を開いていないとき） */
  detailed: boolean;
  /** 開いている世帯の案を今見ている（結果のタブで案の区画が出ている）か。見ているときは、その世帯の分を帯に出さない */
  openedShown: boolean;
  onOpenOffice: () => void;
  onShowOpened: () => void;
  onOpenHousehold: (householdId: string) => void;
}

export function AiDisplayCandidateBand({ office, households, openedId, detailed, openedShown, onOpenOffice, onShowOpened, onOpenHousehold }: AiDisplayCandidateBandProps) {
  const opened = households.find((h) => h.householdId === openedId);
  const others = households.filter((h) => h.householdId !== openedId);
  const showOpened = opened !== undefined && !openedShown;
  if (office <= 0 && !showOpened && others.length === 0) return null;
  const otherCount = others.reduce((n, h) => n + h.count, 0);
  return (
    <div class="ai-code-band" role="status" data-ai-display-band>
      <b>AIから、表示の設定の案が届いています</b>
      <span class="pl-sub">確かめて「反映する」を押すまで、設定は変わりません</span>
      {office > 0 ? (
        <span class="ai-band-item" data-ai-display-band-office>
          事務所の既定値（{office}件）
          <button type="button" class="link-btn" onClick={onOpenOffice} data-ai-display-band-open>
            事務所の既定値で確かめる
            <PopIcon />
          </button>
        </span>
      ) : null}
      {showOpened ? (
        <span class="ai-band-item" data-ai-display-band-opened>
          開いている世帯（{opened.count}件）
          <button type="button" class="link-btn" onClick={onShowOpened} data-ai-display-band-show>
            結果のタブで確かめる
          </button>
        </span>
      ) : null}
      {detailed
        ? others.map((h) => (
            <span key={h.householdId} class="ai-band-item" data-ai-display-band-household={h.householdId}>
              顧客番号 {h.customerNumber ?? "—"}（AIには「{h.alias}」）の世帯（{h.count}件）
              <button type="button" class="link-btn" onClick={() => onOpenHousehold(h.householdId)} data-ai-display-band-open-household={h.householdId}>
                この世帯を開く
              </button>
            </span>
          ))
        : null}
      {others.length > 0 && !detailed ? (
        <span class="ai-band-item" data-ai-display-band-others>
          ほかの世帯（{others.length}世帯・{otherCount}件。どの世帯かは入力のタブのこの帯に出します）
        </span>
      ) : null}
    </div>
  );
}
