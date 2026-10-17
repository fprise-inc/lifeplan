// 根拠のパネル（0006 の7）: 数字を押すと、内訳・式・使った制度の値（値・出典・制度データの版・適用の開始）を出す。
// 別の窓や画面の中央の重なりにはせず、画面の右の端の引き出しに出す（グラフや表を覆わない。広い画面では本文を左に寄せる）
import { useEffect, useRef } from "preact/hooks";
import { yen } from "./format.ts";
import type { EvidenceView } from "./model.ts";

export type EvidenceState = { status: "loading"; title: string } | { status: "ready"; view: EvidenceView } | { status: "error"; title: string; code: string };

export function EvidencePanel({ state, onClose }: { state: EvidenceState; onClose: () => void }) {
  const ref = useRef<HTMLElement>(null);
  // 開いたら引き出しの閉じるボタンに移り、閉じたら元の場所（押した数字）に戻る
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>(".ev-close")?.focus({ preventScroll: true });
    return () => back?.focus({ preventScroll: true });
  }, []);
  const title = state.status === "ready" ? state.view.title : state.title;
  return (
    <aside
      ref={ref}
      class="drawer evidence"
      aria-labelledby="ev-title"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div class="ev">
        <div class="ev-head">
          <div>
            <span class="ev-kicker">根拠</span>
            <h2 id="ev-title">
              {title} {state.status === "ready" ? <span class="ev-total num">{yen(state.view.total)}</span> : null}
            </h2>
            {state.status === "ready" ? <div class="ev-sub">{state.view.context}</div> : null}
          </div>
          <button type="button" class="ev-close" onClick={onClose}>
            閉じる ×
          </button>
        </div>
        {state.status === "loading" ? <p class="ev-wait">根拠の記録を計算しています…</p> : null}
        {state.status === "error" ? <p class="ev-wait">根拠を出せませんでした（{state.code}）</p> : null}
        {state.status === "ready" ? (
          <div class="ev-body">
            <section>
              <h3>内訳（この年の額）</h3>
              <table>
                <tbody>
                  {state.view.breakdown.map((b, i) => (
                    <tr key={i}>
                      <th>{b.label}</th>
                      <td class="num">{yen(b.amount)}</td>
                    </tr>
                  ))}
                  <tr class="tot">
                    <th>合計</th>
                    <td class="num">{yen(state.view.total)}</td>
                  </tr>
                </tbody>
              </table>
              {state.view.note !== null ? <p class="ev-note">{state.view.note}</p> : null}
            </section>
            <section>
              <h3>式</h3>
              <ol class="ev-formula">
                {state.view.formulas.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ol>
            </section>
            <section class="ev-params">
              <h3>使った制度の値</h3>
              {state.view.params.length === 0 ? (
                <p class="ev-note">この数字は制度の値を使わずに、入力した値から計算しています。</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>項目</th>
                      <th>値</th>
                      <th>出典</th>
                      <th>制度データの版・適用</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.view.params.map((p, i) => (
                      <tr key={i}>
                        <th>{p.label}</th>
                        <td class="num">{p.value}</td>
                        <td>{p.source}</td>
                        <td>
                          {p.version}
                          <br />
                          {p.appliesFrom !== "" ? `${p.appliesFrom.slice(0, 7).replace("-", "年")}月〜` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
