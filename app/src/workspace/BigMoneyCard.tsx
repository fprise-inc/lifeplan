// 結果の画面の区画「これからの大きなお金」（結果のグラフのすぐ下。0044・0103 の追記 2026-11-12）。前のグラフの上の切り替え（RowsViewBar）と
// 「ご家族の夢」の区画（GoalCards）を1つにまとめた。値は bigMoney.ts の bigMoneyOf。入れ外しは見方の切り替えで、保存しない（App.tsx の putRowsView）。
// 行の key は物の ID を含むので、提示層（presentation/）でなく作業の層に置く（0016 の2）
import { Help } from "../presentation/Help.tsx";
import type { BigMoneyModel, BigMoneyPick } from "./bigMoney.ts";

/** 区画「これからの大きなお金」の「?」の説明（0044・0103 の追記 2026-11-12） */
export const BIG_MONEY_HELP = [
  "「確実な分だけ」は、見込みが「不確実」の入るお金・出るお金・子への援助と、夢プランの夢を外して、並べた全部のプランを計算し直します。",
  "行の左のチェックで、1件ずつ入れたり外したりもできます（チェックの入っている物を計算に入れます）。見込みが「不確実」の受け取る相続・贈与と相続で受け継ぐ借金、「最初から計算に入れない」にした夢は、ふだんも外れています。ここでチェックを入れると、入れた場合を見られます。",
  "右の数字は、払った年（受け取った年）の終わりの金融資産です。何年ごと・毎年の物は、いちばん少ない年（資金が不足する年があればその年）の額と年です。計算に入れている物だけに出します。",
  "どれも見方の切り替えで、保存はしません。プランに残すときは、入力の画面で見込みや夢の「最初から計算に入れる」を直してください（受け取る相続・贈与と相続で受け継ぐ借金は「この行を計算に入れる」）。",
];

export interface BigMoneyCardProps {
  model: BigMoneyModel;
  /** 子が返す貸与の奨学金の書き添え（PresentationModel の childRepaid） */
  notes: readonly string[];
  /** 「すべて入れる」（false）・「確実な分だけ」（true）を選んだ */
  onMode?: (certainOnly: boolean) => void;
  /** 1件を入れる（true）・外す（false） */
  onPick?: (pick: BigMoneyPick, include: boolean) => void;
}

/**
 * 区画「これからの大きなお金」（結果のグラフのすぐ下）: 頭は「すべて入れる｜確実な分だけ」の切り替えと一行の結論だけ（説明は「?」の中）。
 * 中身は「ご家族の夢」「支払いの予定」「受け取りの予定」のまとまりで、1件1行（名前・時期・金額・払った後〔受け取った後〕の金融資産）。
 * 不確実な物と夢は行の左にチェック、確実な物は行の右に小さく「確実」、不確実な物は「不確実」。計算に入れていない行は薄くする。
 * 並べる物が無ければ区画を出さない（子が返す奨学金の書き添えだけがあれば、それだけを出す）
 */
export function BigMoneyCard({ model, notes: noteTexts, onMode, onPick }: BigMoneyCardProps) {
  const notes = noteTexts.map((t, i) => (
    <p class="bm-note" key={`c${i}`} data-child-repaid>
      {t}
    </p>
  ));
  if (model.groups.length === 0) return notes.length > 0 ? <div class="bm-notes">{notes}</div> : null;
  const toggles = model.certainOnly || model.groups.some((g) => g.rows.some((r) => r.pick !== null));
  return (
    <section class="card big-money" aria-label="これからの大きなお金" data-big-money>
      <div class="card-h">
        <h2>これからの大きなお金</h2>
        {toggles ? (
          <span class="bm-mode">
            <span class="seg-g" role="group" aria-label="計算に入れる物">
              <button type="button" aria-pressed={!model.certainOnly} onClick={() => onMode?.(false)} data-view-mode="all">
                すべて入れる
              </button>
              <button type="button" aria-pressed={model.certainOnly} onClick={() => onMode?.(true)} data-view-mode="certain">
                確実な分だけ
              </button>
            </span>
            <Help label="計算に入れる物" id="big-money">
              {BIG_MONEY_HELP.map((t, i) => (
                <p key={i}>{t}</p>
              ))}
            </Help>
          </span>
        ) : null}
      </div>
      {model.line !== null ? (
        <p class="bm-line" data-big-money-line>
          {model.line}
        </p>
      ) : null}
      <table class="bm-table">
        {model.groups.map((g) => (
          <tbody key={g.key} data-bm-group={g.key}>
            <tr class="bm-gh">
              <th scope="colgroup" colSpan={4}>
                {g.title}
              </th>
              <th scope="col" class="bm-after-h">
                {g.afterLabel}
              </th>
              <th aria-hidden="true" />
            </tr>
            {g.rows.map((r) => {
              const id = `bm-${r.key}`;
              return (
                <tr class={`bm-row${r.included ? "" : " off"}`} key={r.key} data-bm-row={r.key} data-included={r.included ? "1" : "0"}>
                  <td class="bm-check">
                    {r.pick !== null ? <input type="checkbox" id={id} checked={r.included} onChange={(e) => onPick?.(r.pick as BigMoneyPick, (e.currentTarget as HTMLInputElement).checked)} aria-label={`${r.name}を計算に入れる`} /> : null}
                  </td>
                  <td class="bm-name">{r.pick !== null ? <label for={id}>{r.name}</label> : r.name}</td>
                  <td class="bm-when">{r.when}</td>
                  <td class="bm-amt num">{r.amount}</td>
                  <td class={`bm-after num${r.short ? " short" : ""}`} data-bm-after={r.short ? "short" : r.after === null ? "none" : "ok"}>
                    {r.after ?? "—"}
                  </td>
                  <td class="bm-tag">{r.tag !== null ? <span class={`bm-t${r.tag === "確実" ? " sure" : ""}`}>{r.tag}</span> : null}</td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
      {notes}
    </section>
  );
}
