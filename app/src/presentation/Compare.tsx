// 案の比較の表（提示層の部品）: 主画面の「比較の表を見る」で、画面の中に開く（別の窓は出さない）。
// 列＝現状（A）と帯に並べた案（最大5つ）、行＝主な数字。案の列には基準の案との差を添える。基準の列は「基準」の札と灰の背景で示す（色だけで区別しない）。
// 受け取るのは CompareTableModel だけ（案の名前・数字。物の ID・差分・メモは受け取らない。0016 の2）
import type { ComponentChildren } from "preact";
import { CloseX, useEscClose } from "./CloseX.tsx";
import type { CompareTableModel } from "./model.ts";

/** 比較の表の枠（結果のタブの帯の下に開く。右上の × と Esc で閉じる。0239） */
export function CompareCard({ title, note, onClose, children }: { title: string; note: string; onClose: () => void; children?: ComponentChildren }) {
  useEscClose(onClose);
  return (
    <section class="card compare-card" aria-label="プランの比較" data-compare>
      <div class="card-h">
        <h2>{title}</h2>
        <span class="aside">{note}</span>
        <CloseX onClose={onClose} what="プランの比較" />
      </div>
      {children}
    </section>
  );
}

export function CompareTable({ model }: { model: CompareTableModel }) {
  return (
    <div class="cmp-table-wrap">
      <table class="cmp-table" data-compare-table>
        <thead>
          <tr>
            <th scope="col" class="stub">
              主な数字
            </th>
            {model.columns.map((c, i) => (
              <th scope="col" key={i} class={c.base === true ? "is-base" : ""}>
                <span class="cmp-name">{c.name}</span>
                {c.base === true ? <span class="p-tag base">基準</span> : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {model.rows.map((r) => (
            <tr key={r.key}>
              <th scope="row" class="stub">
                {r.label}
              </th>
              {r.cells.map((c, i) => (
                <td key={i} class={c.bad ? "bad" : ""}>
                  <span class="v">{c.text}</span>
                  {c.bad ? <span class="bad-tag">注意</span> : null}
                  {c.diff !== null ? (
                    <span class="d">
                      {model.diffLabel} {c.diff}
                    </span>
                  ) : null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
