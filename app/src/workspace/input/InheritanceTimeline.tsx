// 相続・贈与の入力項目の下の「一次と二次の相続税の推移」（読むだけ。0251）。相続税も試算する夫婦の世帯で、先に亡くなる人がその年に亡くなったら、
// 一次・二次・合計の相続税がいくらかを年ごとに並べ、選んだ年で分け方（入れた分け方・法定相続分どおり・配偶者が全部・配偶者は取得する土地だけ）を比較する。
// 中身は inheritanceLine.ts の timelineView。表示だけで、お金の流れには入れない
import { useState } from "preact/hooks";
import { Help } from "../../presentation/Help.tsx";
import type { PreviewResult } from "../../engine/types.ts";
import type { WorkingHousehold } from "./household.ts";
import { manText } from "./items.ts";
import { cheapestAt, timelineView, timelineYears } from "./inheritanceLine.ts";

const man = (yen: number) => (yen <= 0 ? "0円" : `約${manText(yen)}万円`);

export function InheritanceTimeline({ wh, result }: { wh: WorkingHousehold; result: PreviewResult | null }) {
  const view = timelineView(wh, result);
  const [all, setAll] = useState(false);
  const [year, setYear] = useState<number | null>(null);
  if (view === null) return null;
  const rows = timelineYears(view.rows, all);
  const years = view.rows.map((r) => r.year);
  const at = year !== null && years.includes(year) ? year : (years[0] as number);
  const best = cheapestAt(view, at);
  return (
    <div class="ip-lineup ip-timeline" role="note" data-inheritance-timeline>
      <p>
        <b>一次と二次の相続税の推移</b>
        <Help label="一次と二次の相続税の推移">
          <ul>
            {view.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
            <li>表示だけです。お金の流れには入れていません。分け方は上の「遺産の分け方」で入れ、プランごとに変えて比較することもできます</li>
          </ul>
        </Help>
      </p>
      <p class="sub">
        {view.lead}・{view.entered}
      </p>
      <table data-timeline-rows>
        <thead>
          <tr>
            <th scope="col">先に亡くなる年</th>
            <th scope="col">一次</th>
            <th scope="col">二次</th>
            <th scope="col">合計</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.year} data-timeline-year={r.year}>
              <td>{r.year}年</td>
              <td>{man(r.primary)}</td>
              <td>
                {man(r.secondary)}
                {r.successiveCredit > 0 ? <span class="sub">（相次相続控除 −{manText(r.successiveCredit)}万円）</span> : null}
              </td>
              <td>{man(r.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {view.rows.length > rows.length || all ? (
        <button type="button" class="link-btn" onClick={() => setAll(!all)} data-timeline-all>
          {all ? "5年ごとに戻す" : "毎年を見る"}
        </button>
      ) : null}
      <p class="who">
        分け方の比較（
        <select aria-label="先に亡くなる年" value={String(at)} onChange={(e) => setYear(Number((e.currentTarget as HTMLSelectElement).value))} data-timeline-year-select>
          {years.map((y) => (
            <option key={y} value={String(y)}>
              {y}年
            </option>
          ))}
        </select>
        に先に亡くなったら）
      </p>
      <table data-timeline-compare>
        <thead>
          <tr>
            <th scope="col">分け方</th>
            <th scope="col">一次</th>
            <th scope="col">二次</th>
            <th scope="col">合計</th>
          </tr>
        </thead>
        <tbody>
          {view.series.map((s) => {
            const r = s.rows.find((x) => x.year === at);
            if (r === undefined) return null;
            return (
              <tr key={s.key} data-timeline-series={s.key}>
                <td>{s.label}</td>
                <td>{man(r.primary)}</td>
                <td>{man(r.secondary)}</td>
                <td>{man(r.total)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {best !== null && view.series.length > 1 ? (
        <p class="sub" data-timeline-best>
          {at}年に先に亡くなったときの合計がいちばん少ないのは「{best.label}」（{man(best.total)}）です。分け方は相続の後の暮らしと財産の使い方でも決まるので、目安として見てください
        </p>
      ) : null}
    </div>
  );
}
