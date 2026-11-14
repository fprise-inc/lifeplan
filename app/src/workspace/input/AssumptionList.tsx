// 前提と推定の一覧（前提条件のカードの下。0070）。中身は assumptionList.ts。行から前提条件の欄へ移れる。
// 「お客さまと確かめた」はプランごとの記録（直すと onAgree。値も状態も変えない）
import { Help } from "../../presentation/Help.tsx";
import { useState } from "preact/hooks";
import { fieldDomId } from "./FieldViews.tsx";
import type { WorkingHousehold } from "./household.ts";
import { agreedKey, assumptionRows, LIST_GROUP_LABELS, setAgreed, type ListGroup } from "./assumptionList.ts";

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function AssumptionList({ wh, planId, onAgree, onLevel }: { wh: WorkingHousehold; planId: string | null; onAgree: (f: (w: WorkingHousehold) => WorkingHousehold) => void; onLevel: (l: "simple" | "detail") => void }) {
  const [open, setOpen] = useState(false);
  const [only, setOnly] = useState<ListGroup | "all">("all");
  const rows = assumptionRows(wh);
  const agreed = wh.agreed?.[agreedKey(planId)] ?? {};
  const groups = Object.keys(LIST_GROUP_LABELS) as ListGroup[];
  const jump = (key: string, detail: boolean) => {
    if (detail) onLevel("detail");
    setTimeout(() => {
      const el = document.getElementById(fieldDomId(key));
      el?.focus({ preventScroll: true });
      el?.scrollIntoView({ block: "center" });
    }, 0);
  };
  return (
    <div class="ip-lineup ip-assume-list" data-assumption-list>
      <p>
        <b>前提と推定の一覧</b>
        <Help label="前提と推定の一覧">計算の前提・推定の根拠・万一の前提の一覧です。提案書・持ち帰り用のレポートの前提の一覧と同じ形です。</Help>
        <button type="button" class="link-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "閉じる" : `開く（${rows.length}行）`}
        </button>
      </p>
      {open ? (
        <>
          <p class="seg-g" role="group" aria-label="区分で絞る">
            {(["all", ...groups] as const).map((g) => (
              <button key={g} type="button" aria-pressed={only === g} onClick={() => setOnly(g)}>
                {g === "all" ? "全部" : LIST_GROUP_LABELS[g]}
              </button>
            ))}
          </p>
          <table>
            <thead>
              <tr>
                <th scope="col">区分</th>
                <th scope="col">項目</th>
                <th scope="col">値</th>
                <th scope="col">状態</th>
                <th scope="col">出典・根拠</th>
                <th scope="col" title="お客さまと確かめた" aria-label="お客さまと確かめた">
                  確かめた
                </th>
              </tr>
            </thead>
            <tbody>
              {rows
                .filter((r) => only === "all" || r.group === only)
                .map((r) => (
                  <tr key={r.id} data-assume-row={r.id}>
                    <td>{LIST_GROUP_LABELS[r.group]}</td>
                    <td>
                      {r.fieldKey !== null ? (
                        <button type="button" class="link-btn" onClick={() => jump(r.fieldKey as string, r.level === "detail")}>
                          {r.label}
                        </button>
                      ) : (
                        r.label
                      )}
                      {r.card !== null ? <span class="sub">（{r.card}）</span> : null}
                      {r.warn !== null ? <span class="sub warn">{r.warn}</span> : null}
                    </td>
                    <td>{r.value}</td>
                    <td>{r.state}</td>
                    <td>{r.source ?? "—"}</td>
                    <td>
                      <label>
                        <input type="checkbox" checked={agreed[r.id] !== undefined} onChange={(e) => onAgree((w) => setAgreed(w, planId, r.id, (e.currentTarget as HTMLInputElement).checked ? today() : null))} />
                        {agreed[r.id]?.on ?? ""}
                      </label>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </>
      ) : null}
    </div>
  );
}
