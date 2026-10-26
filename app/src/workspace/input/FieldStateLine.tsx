// 専用の部品で描く欄（貯蓄・運用の口座の表など）に添える、値の状態の印と4つの操作（0041）と、プランを直しているときの「現状と違う」印（0043）。
// 欄の部品（FieldViews.tsx の Field）と同じ決まりで、状態は valueState.ts の fieldStatus で読み、操作は入力のパネルが渡す FieldStateOps で行う。
// 値の入れ方（数の欄・ボタン）は専用の部品のまま。ここは印と操作だけを描く
import { useContext, useState } from "preact/hooks";
import type { FieldDef } from "./form.ts";
import { FieldStateOps, PlanMarksContext } from "./FieldViews.tsx";
import type { WorkingHousehold } from "./household.ts";
import { availableOps, fieldStatus, OP_LABELS, STATUS_LABELS, type StateOp, type ValueStatus } from "./valueState.ts";

const STATUS_CLASS: Record<ValueStatus, string> = { estimated: "est", unknown: "unk", notApplicable: "na", confirmed: "", missing: "missing" };

/** 欄の状態（印を出す状態か）。操作が渡されていない画面では null */
export function useFieldStatus(f: FieldDef | undefined, wh: WorkingHousehold): ValueStatus | null {
  const ops = useContext(FieldStateOps);
  return ops === null || f === undefined ? null : fieldStatus(f, wh).status;
}

/** 状態の印（推定・わからない・該当なし・未入力）。確定なら何も出さない */
export function FieldStateBadge({ f, wh }: { f: FieldDef | undefined; wh: WorkingHousehold }) {
  const ops = useContext(FieldStateOps);
  if (ops === null || f === undefined) return null;
  const s = fieldStatus(f, wh);
  if (s.status === "confirmed") return null;
  return (
    <span class={`badge ${STATUS_CLASS[s.status]}`} title={s.basis ?? STATUS_LABELS[s.status]} data-state={s.status} data-state-of={f.key}>
      {s.status === "missing" ? "未入力" : STATUS_LABELS[s.status]}
    </span>
  );
}

/**
 * 根拠の1行・4つの操作・プランの印（欄の下に置く）。noBasis は、根拠を専用の部品が別に出しているとき。
 * compact は表の中（確定のほかの操作を「…」の後ろにたたむ）
 */
export function FieldStateLine({ f, wh, onEdit, noBasis, compact }: { f: FieldDef | undefined; wh: WorkingHousehold; onEdit: (w: WorkingHousehold) => void; noBasis?: boolean; compact?: boolean }) {
  const stateOps = useContext(FieldStateOps);
  const marks = useContext(PlanMarksContext);
  const [open, setOpen] = useState(false);
  if (f === undefined) return null;
  const s = stateOps !== null ? fieldStatus(f, wh) : null;
  // 押しても何も変わらない操作は出さない（推定の値を書く所が無い欄の「確定」など）
  const ops = stateOps !== null && s !== null ? availableOps(f, wh, s).filter((o) => o !== "confirm" || stateOps(wh, f, o) !== wh) : [];
  const mark = marks?.field(f, wh) ?? null;
  const run = (op: StateOp) => {
    if (stateOps === null) return;
    setOpen(false);
    onEdit(stateOps(wh, f, op));
  };
  const basis = noBasis === true ? null : s?.status === "estimated" && s.basis !== null ? `推定: ${s.basis}` : s?.status === "unknown" ? `わからない（代わりの値: ${s.basis ?? "推定"}）` : s?.status === "missing" ? (s.basis ?? STATUS_LABELS.missing) : null;
  if (basis === null && ops.length === 0 && mark === null) return null;
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
      {basis !== null ? <div class="fld-help est-basis">{basis}</div> : null}
      {ops.length > 0 ? (
        <div class="fld-ops" data-field-ops={f.key}>
          {ops.includes("confirm") ? (
            <button type="button" class="link-btn fld-confirm" onMouseDown={(e) => e.preventDefault()} onClick={() => run("confirm")} data-op="confirm">
              {OP_LABELS.confirm}
            </button>
          ) : null}
          {ops.some((o) => o !== "confirm") ? (
            <>
              <button
                type="button"
                class={`link-btn fld-more${compact === true ? " sv-more" : ""}`}
                aria-expanded={open}
                aria-label={`${f.label}: わからない・該当なしなど`}
                title="わからない・該当なしなど"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setOpen(!open)}
                data-op-menu
              >
                {open ? "閉じる" : compact === true ? "…" : "わからない・該当なしなど"}
              </button>
              {open
                ? ops
                    .filter((o) => o !== "confirm")
                    .map((o) => (
                      <button type="button" key={o} class="link-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => run(o)} data-op={o}>
                        {OP_LABELS[o]}
                      </button>
                    ))
                : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
