// 事務所の既定値の画面「入力の画面」（0261）: 入力のホームの入力項目の並び・新しい世帯で出す入力項目と開いたときの入れ方（0083）・
// 基本生活費の内訳の並べ方（0109）・ご本人と配偶者の介護の費用（0059）・受け取る予定の相続・贈与の見込み（0073）。
// AI からの Web のヒアリングのひな形の案（0222）も、この画面のいちばん上に出す
import type { ComponentChildren } from "preact";
import { STAGE_ORDER } from "../input/stages/index.ts";
import type { Level, StageId } from "../input/form.ts";
import { ALWAYS_SHOWN, isHiddenIn, levelIn, withLevel, withShown } from "../input/itemChoice.ts";
import { LivingLayoutEditor } from "./LivingLayoutEditor.tsx";
import { OfficeGroup, OfficeSection, SegField } from "./OfficeFields.tsx";
import { layoutOf, withLivingDraft, type OfficeSettings } from "./settings.ts";

export interface InputPageProps {
  s: OfficeSettings;
  onS: (f: (s: OfficeSettings) => OfficeSettings) => void;
  /** AI からのヒアリングのひな形の案（あれば、いちばん上） */
  proposals?: ComponentChildren;
}

export function InputPage({ s, onS, proposals }: InputPageProps) {
  const layout = layoutOf(s);
  const order = [...layout.order, ...STAGE_ORDER.map((x) => x.id).filter((id) => !layout.order.includes(id))];
  const label = (id: StageId) => STAGE_ORDER.find((x) => x.id === id)?.label ?? id;
  const move = (i: number, d: -1 | 1) => {
    const next = [...order];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j] as StageId, next[i] as StageId];
    onS((x) => ({ ...x, layout: { order: next } }));
  };
  const setShown = (id: StageId, on: boolean) => onS((x) => ({ ...x, items: withShown(x.items, id, on) }));
  const setLevel = (id: StageId, l: Level) => onS((x) => ({ ...x, items: withLevel(x.items, id, l) }));
  return (
    <>
      {proposals}
      <OfficeSection id="os-cards" title="入力のホームの入力項目の並び" lead="どの世帯の入力のホームにもすぐ効きます。">
        <OfficeGroup>
          <ol class="os-cards">
            {order.map((id, i) => (
              <li key={id} data-office-card={id}>
                <span class="os-name">{label(id)}</span>
                <button type="button" class="link-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`${label(id)}を上へ`} data-office-up={id}>
                  ↑
                </button>
                <button type="button" class="link-btn" disabled={i === order.length - 1} onClick={() => move(i, 1)} aria-label={`${label(id)}を下へ`}>
                  ↓
                </button>
              </li>
            ))}
          </ol>
          <p class="os-acts">
            <button type="button" class="link-btn" onClick={() => onS((x) => ({ ...x, layout: null }))} data-office-layout-reset>
              既定の並びに戻す
            </button>
          </p>
        </OfficeGroup>
      </OfficeSection>
      <OfficeSection
        id="os-items"
        title="新しい世帯で出す入力項目と、開いたときの入れ方"
        help="新しく作る世帯に写します（作った世帯は、入力のホームの「入力項目を選ぶ」で世帯ごとに直せます。そこから、その世帯の選び方を事務所の既定にもできます）。出さない入力項目も、値が入ればホームに出ます。"
        lead="新しく作る世帯に写します。"
        data={{ "data-office-items": "" }}
      >
        <OfficeGroup>
          <ol class="os-cards os-items">
            {order.map((id) => {
              const always = ALWAYS_SHOWN.includes(id);
              const lv = levelIn(s.items, id) ?? "simple";
              return (
                <li key={id} data-office-item={id}>
                  <label class="os-show">
                    <input type="checkbox" checked={always || !isHiddenIn(s.items, id)} disabled={always} onChange={(e) => setShown(id, (e.currentTarget as HTMLInputElement).checked)} data-office-show={id} {...(always ? { title: "いつも出します" } : {})} />
                    <span class="os-name">{label(id)}</span>
                  </label>
                  <span class="level-switch mini" role="group" aria-label={`${label(id)}を開いたときの入れ方`}>
                    <button type="button" class={lv === "simple" ? "on" : ""} aria-pressed={lv === "simple"} onClick={() => setLevel(id, "simple")} data-office-level={`${id}:simple`}>
                      標準
                    </button>
                    <button type="button" class={lv === "detail" ? "on" : ""} aria-pressed={lv === "detail"} onClick={() => setLevel(id, "detail")} data-office-level={`${id}:detail`}>
                      詳細
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
          <p class="os-acts">
            <button type="button" class="link-btn" onClick={() => onS((x) => ({ ...x, items: {} }))} data-office-items-reset>
              既定に戻す（全部出す・全部「標準」で開く）
            </button>
          </p>
        </OfficeGroup>
      </OfficeSection>
      {/* 基本生活費の内訳の並べ方（0109。LivingLayoutEditor.tsx） */}
      <LivingLayoutEditor value={s.living} onChange={(l) => onS((x) => withLivingDraft(x, l))} />
      <OfficeSection id="os-care" title="ご本人・配偶者の介護の費用" lead="新しく作る世帯での入れ方です。">
        <OfficeGroup>
          <div class="os-fields">
            <SegField
              name="care"
              label="新しい世帯で"
              value={s.care.selfAndSpouse}
              options={[
                { value: "warn", label: "自動では入れない（既定）", data: { "data-office-care": "warn" } },
                { value: "fill", label: "最初から推定で入れる", data: { "data-office-care": "fill" } },
              ]}
              onPick={(v) => onS((x) => ({ ...x, care: { selfAndSpouse: v } }))}
              help="自動では入れないときは「未入力」にして、「推定で入れる」の1押しを出します。最初から推定で入れるときは、新しい世帯で最初から推定で入れます。"
              note={s.care.selfAndSpouse === "warn" ? "「未入力」にして「推定で入れる」の1押しを出します" : "新しい世帯では最初から推定で入れます"}
            />
          </div>
        </OfficeGroup>
      </OfficeSection>
      <OfficeSection id="os-inherit" title="受け取る予定の相続・贈与の見込み" lead="受け取る予定の行を足したときの見込みの既定です。">
        <OfficeGroup>
          <div class="os-fields">
            <SegField
              name="inherit"
              label="見込み"
              value={s.inheritLikelihood}
              options={[
                { value: "likely", label: "確実（既定）", data: { "data-office-inherit": "likely" } },
                { value: "uncertain", label: "不確実", data: { "data-office-inherit": "uncertain" } },
              ]}
              onPick={(v) => onS((x) => ({ ...x, inheritLikelihood: v }))}
              help="確実は計算に入れます（既定）。不確実は、足した行を計算に入れません（結果の画面の「夢と予定」でチェックを入れると比較できます。相続で受け継ぐ借金も同じ）。"
              note={s.inheritLikelihood === "likely" ? "足した行を計算に入れます" : "足した行を計算に入れません（「夢と予定」で比較できます）"}
            />
          </div>
        </OfficeGroup>
      </OfficeSection>
    </>
  );
}
