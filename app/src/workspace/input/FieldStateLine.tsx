// 専用の部品で描く欄（貯蓄・運用の口座の表など）に添える、値の状態の印と4つの操作（0041）と、プランを直しているときの「現状と違う」印（0043）。
// 欄の部品（FieldViews.tsx の Field）と同じ決まりで、状態は valueState.ts の fieldStatus で読み、操作は入力のパネルが渡す FieldStateOps で行う。
// 値の入れ方（数の欄・ボタン）は専用の部品のまま。ここは印と操作だけを描く
import { useContext } from "preact/hooks";
import type { FieldDef } from "./form.ts";
import { FieldStateOps, FillButton, PlanMarksContext, StateMark, StateOpLinks } from "./FieldViews.tsx";
import type { WorkingHousehold } from "./household.ts";
import { availableOps, fieldStatus, STATUS_LABELS, type StateOp, type ValueStatus } from "./valueState.ts";

/** 欄の状態（印を出す状態か）。操作が渡されていない画面では null */
export function useFieldStatus(f: FieldDef | undefined, wh: WorkingHousehold): ValueStatus | null {
  const ops = useContext(FieldStateOps);
  return ops === null || f === undefined ? null : fieldStatus(f, wh).status;
}

/** 状態の印（推定・書類待ち・該当なし・未入力）。確定なら何も出さない。根拠は印を押すと開く（0077） */
export function FieldStateBadge({ f, wh }: { f: FieldDef | undefined; wh: WorkingHousehold }) {
  const ops = useContext(FieldStateOps);
  if (ops === null || f === undefined) return null;
  const s = fieldStatus(f, wh);
  if (s.status === "confirmed") return null;
  return <StateMark status={s.status} basis={s.status === "notApplicable" ? null : s.basis} text={s.status === "missing" ? "未入力" : STATUS_LABELS[s.status]} label={f.label} fieldKey={f.key} doc={f.docCheck} />;
}

/**
 * 4つの操作・プランの印（欄の下に置く）。根拠は状態の印（FieldStateBadge）を押すと開く（0077。前は欄の下に1行で出していた）。
 * noBasis は前の形の名残（根拠を専用の部品が別に出しているとき）。compact は表の中（並びを詰める）。
 * ほかの操作は、その欄で意味のある物だけを直接押せるリンクで並べる（欄の部品と同じ StateOpLinks。0041 の 2026-10-29 の追記。前は表の中では「…」の後ろにたたんでいた）
 */
export function FieldStateLine({ f, wh, onEdit, compact }: { f: FieldDef | undefined; wh: WorkingHousehold; onEdit: (w: WorkingHousehold) => void; noBasis?: boolean; compact?: boolean }) {
  const stateOps = useContext(FieldStateOps);
  const marks = useContext(PlanMarksContext);
  if (f === undefined) return null;
  const s = stateOps !== null ? fieldStatus(f, wh) : null;
  // 押しても何も変わらない操作は出さない（推定の値を書く所が無い欄の「確定」など）
  const ops = stateOps !== null && s !== null ? availableOps(f, wh, s).filter((o) => o !== "confirm" || stateOps(wh, f, o) !== wh) : [];
  const mark = marks?.field(f, wh) ?? null;
  const run = (op: StateOp) => {
    if (stateOps === null) return;
    onEdit(stateOps(wh, f, op));
  };
  if (ops.length === 0 && mark === null) return null;
  return (
    <div class={`sv-state${compact === true ? " compact" : ""}`} data-state-line={f.key}>
      {marks !== null && mark !== null ? (
        <div class={`fld-plan ${mark.kind}`} data-plan-mark={mark.kind}>
          <span>
            {mark.kind === "base" ? `土台（${mark.planName ?? "プラン"}）で変更・` : mark.kind === "lever" ? "結果のタブの対策で変わっています・" : ""}現状: {mark.current}
          </span>
          {mark.kind !== "lever" ? (
            <button type="button" class="link-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => marks.revert(f, wh)} data-plan-revert>
              ↺ 現状に戻す
            </button>
          ) : null}
        </div>
      ) : null}
      {/* 推定の値をそのまま入れる（値の状態の操作の確定と同じ。欄の部品と同じボタン。0041 の追記）は、ほかの操作のリンクの前 */}
      <StateOpLinks f={f} ops={ops} run={run} lead={ops.includes("confirm") && s !== null ? <FillButton label={f.label} status={s.status} onFill={() => run("confirm")} /> : null} />
    </div>
  );
}
