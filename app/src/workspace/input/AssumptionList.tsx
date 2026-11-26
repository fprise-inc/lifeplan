// 前提と推定の一覧（前提条件の入力項目の下。0070・0260）。中身は assumptionList.ts。読むだけで、行から前提条件の欄へ移れる。
// 区分は見出しの行（列にしない）、状態は欄と同じ印（事務所の既定値どおりは印なし）、出典は短く。前の「確かめた」の列はなくした（0260）
import { Help } from "../../presentation/Help.tsx";
import { useState } from "preact/hooks";
import { fieldDomId } from "./FieldViews.tsx";
import type { WorkingHousehold } from "./household.ts";
import { assumptionRows, LIST_GROUP_LABELS, ROW_TONE_TEXT, type AssumptionRow, type ListGroup } from "./assumptionList.ts";

/** 状態の印（欄の印と同じ見た目。事務所の既定値どおりは出さない） */
function StateMark({ r }: { r: AssumptionRow }) {
  if (r.tone === null) return null;
  if (r.tone === "plain") return <span class="as-state">{r.state}</span>;
  return (
    <span class={`fld-premise ${r.tone}`} data-assume-state={r.tone}>
      {ROW_TONE_TEXT[r.tone]}
    </span>
  );
}

export function AssumptionList({ wh, onLevel }: { wh: WorkingHousehold; onLevel: (l: "simple" | "detail") => void }) {
  const [open, setOpen] = useState(false);
  const [only, setOnly] = useState<ListGroup | "all">("all");
  const rows = assumptionRows(wh);
  const groups = (Object.keys(LIST_GROUP_LABELS) as ListGroup[]).filter((g) => rows.some((r) => r.group === g));
  const jump = (key: string, detail: boolean) => {
    if (detail) onLevel("detail");
    setTimeout(() => {
      const el = document.getElementById(fieldDomId(key));
      el?.focus({ preventScroll: true });
      el?.scrollIntoView({ block: "center" });
    }, 0);
  };
  const shown = groups.filter((g) => only === "all" || g === only);
  return (
    <div class="ip-lineup ip-assume-list" data-assumption-list>
      <p class="as-head">
        <b>前提と推定の一覧</b>
        <Help label="前提と推定の一覧">
          <p>計算の前提・推定の根拠・万一の前提の一覧です。提案書・持ち帰り用のレポートの前提の一覧と同じ形です。</p>
          <p>状態の印は欄と同じです（印の無い行は事務所の既定値どおり。「この世帯だけ」はこの世帯だけ変えた値、「既定値が変わりました」は事務所の既定値が後で変わった値）。出典の「事務所の既定値」は、事務所の既定値の画面で決めた値です（決めていなければ提供元の既定の値で、事務所の既定値の画面で変えられます）。</p>
          <p>事務所の既定値どおりの資産の種類と耐用年数は、1行にまとめています。</p>
        </Help>
        <button type="button" class="link-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "閉じる" : `開く（${rows.length}行）`}
        </button>
      </p>
      {open ? (
        <>
          <p class="seg-g" role="group" aria-label="区分で絞る">
            {(["all", ...groups] as const).map((g) => (
              <button key={g} type="button" aria-pressed={only === g} onClick={() => setOnly(g)}>
                {g === "all" ? `全部（${rows.length}）` : LIST_GROUP_LABELS[g]}
              </button>
            ))}
          </p>
          <table>
            <thead>
              <tr>
                <th scope="col">項目</th>
                <th scope="col">値</th>
                <th scope="col">状態</th>
                <th scope="col">出典・根拠</th>
              </tr>
            </thead>
            {shown.map((g) => (
              <tbody key={g} data-assume-group={g}>
                <tr class="as-group">
                  <th scope="colgroup" colSpan={4}>
                    {LIST_GROUP_LABELS[g]}
                  </th>
                </tr>
                {rows
                  .filter((r) => r.group === g)
                  .map((r) => (
                    <tr key={r.id} data-assume-row={r.id}>
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
                      <td>
                        <StateMark r={r} />
                      </td>
                      <td class="as-src">{r.source ?? "—"}</td>
                    </tr>
                  ))}
              </tbody>
            ))}
          </table>
        </>
      ) : null}
    </div>
  );
}
