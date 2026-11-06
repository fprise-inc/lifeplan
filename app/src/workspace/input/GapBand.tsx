// 入っていない物（未入力〔0円で計算中〕の物）の帯（入力のパネルの部品。0041 の追記 2026-11-06）。
// 1件を1行にまとめる: 「上のお子さんの教育費: 未入力（0円） [推定で入れる] [該当なし（教育費なし）]」と、その下に小さく「推定で入れる中身: …」。
// パネルの上の固定の場所には置かない（下の欄の見える高さを取らない）。パネルの本文の頭か、物の区画の頭に置く（区画の頭に置くときは、その区画の物だけを渡す）
import type { WorkingHousehold } from "./household.ts";
import type { Gap } from "./fill.ts";
import { FILL_GAP_LABEL, fillAllLabel } from "./checkRows.ts";

export interface GapBandProps {
  gaps: readonly Gap[];
  /** 世帯（推定で入れる・該当なしを当てる元） */
  wh: WorkingHousehold;
  onEdit: (next: WorkingHousehold) => void;
  /** まだ何も入れていない入力項目（赤くせず、操作だけを控えめに） */
  quiet?: boolean;
  /** 2件以上を推定で入れられるときの「この項目の入っていない所を推定で入れる」（省くと出さない） */
  onFillAll?: () => void;
}

export function GapBand({ gaps, wh, onEdit, quiet = false, onFillAll }: GapBandProps) {
  if (gaps.length === 0) return null;
  const fillable = gaps.filter((g) => g.fill !== undefined).length;
  return (
    <div class={`ip-gaps${quiet ? " quiet" : ""}`} role="note" data-gaps={quiet ? "quiet" : "alert"}>
      <ul>
        {gaps.map((g) => (
          <li key={g.id} data-gap={g.id}>
            <span {...(quiet ? {} : { title: g.note })}>
              {g.label}
              {quiet ? "" : ": 未入力（0円）"}
            </span>
            {g.fill !== undefined ? (
              <button type="button" class="link-btn" onClick={() => onEdit(g.fill?.(wh) ?? wh)} {...(g.basis !== undefined ? { title: `推定: ${g.basis}` } : {})} data-gap-fill>
                {FILL_GAP_LABEL}
              </button>
            ) : null}
            {g.none !== undefined ? (
              <button type="button" class="link-btn" onClick={() => onEdit(g.none?.(wh) ?? wh)} data-gap-none>
                該当なし{g.noneLabel !== undefined ? `（${g.noneLabel}）` : ""}
              </button>
            ) : null}
            {/* ほかの入れ方の案内（持ち家なら住まい・ローンで など）は、その入力項目を開いている所では要らないので、確かめの一覧の行だけに出す */}
            {g.what !== undefined ? (
              <small class="ip-gap-what" data-gap-what>
                推定で入れる中身: {g.what}
              </small>
            ) : null}
          </li>
        ))}
      </ul>
      {onFillAll !== undefined && fillable > 1 ? (
        <button type="button" class="link-btn" onClick={onFillAll} data-gap-fill-card>
          {fillAllLabel(fillable, "この項目")}
        </button>
      ) : null}
    </div>
  );
}
