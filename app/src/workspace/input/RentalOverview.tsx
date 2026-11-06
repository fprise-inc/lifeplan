// 収益不動産の項目の上の「物件の一覧」（読むだけ。0079）。中身は stages/rental.ts の rentalOverview（入力から出せる数字だけ）と、
// 計算の結果の分析の数字の表の最初の年の表面利回り・実質利回り・月の手残り（税引前）（rentalTab.ts の rentalFigures。0082）。
// 分析の数字は入力のパネルが世帯の今の要求を1回求めて渡す（求めている間・計算の道が無いときは「—」）
import { Help } from "../../presentation/Help.tsx";
import type { rentalFigures } from "../rentalTab.ts";
import type { WorkingHousehold } from "./household.ts";
import { rentalOverview } from "./stages/rental.ts";

/** 分析の数字（null は計算の道が無いか数字が無い、"loading" は求めている間） */
export type RentalOverviewFigures = ReturnType<typeof rentalFigures> | "loading";

const man = (yen: number) => `${Math.round(yen / 10000).toLocaleString("ja-JP")}万円`;
const yen = (v: number) => `${v < 0 ? "▲" : ""}${Math.abs(v).toLocaleString("ja-JP")}円`;

export function RentalOverview({ wh, figures = null }: { wh: WorkingHousehold; figures?: RentalOverviewFigures }) {
  const ov = rentalOverview(wh);
  if (ov === null) return null;
  const f = figures === "loading" ? null : figures;
  const fig = (id: string) => f?.byObject.get(id) ?? null;
  const monthly = (v: number | null | undefined) => (v === null || v === undefined ? "—" : yen(v));
  return (
    <section class="in-section ip-rental" aria-label="物件の一覧" data-rental-overview>
      <h3>
        物件の一覧
        <Help label="物件の一覧">
          <p>読むだけです。入れた値から出しています。</p>
          <p>
            表面利回り・実質利回り・月の手残り（税引前）は、計算の結果の{f !== null ? `${f.year}年` : "表の最初の年"}の数字です（結果の「収益不動産」のタブと同じ）。合計の利回りは、物件の年の額を足してから出しています。
          </p>
          <p>ローン残高は、入れた今の残高か、借入額・最初の金利・返済の期間からの今の月の推定です（金利の段階・繰上返済・ボーナス返済は除く）。月の収入は、満室時の家賃などから空室率を引いた額です（今の実際の家賃収入で入れた物件は、その額のまま。礼金・更新料は除く。民泊・宿は月の売上）。</p>
        </Help>
      </h3>
      {figures === "loading" ? <p class="ip-rental-status">計算しています…</p> : null}
      <table aria-busy={figures === "loading"}>
        <thead>
          <tr>
            <th scope="col">物件名</th>
            <th scope="col">種類</th>
            <th scope="col" class="num">評価額</th>
            <th scope="col" class="num">ローン残高</th>
            <th scope="col" class="num">月の収入（空室率を引いた後）</th>
            <th scope="col" class="num">表面利回り</th>
            <th scope="col" class="num">実質利回り</th>
            <th scope="col" class="num">月の手残り（税引前）</th>
          </tr>
        </thead>
        <tbody>
          {ov.rows.map((r) => (
            <tr key={r.id} data-rental-row={r.id}>
              <th scope="row">{r.name}</th>
              <td>{r.kind ?? "—"}</td>
              <td class="num">{man(r.value)}</td>
              <td class="num">{r.loan > 0 ? man(r.loan) : "—"}</td>
              <td class="num">{yen(r.income)}</td>
              <td class="num" data-rental-gross>{fig(r.id)?.grossYield ?? "—"}</td>
              <td class="num">{fig(r.id)?.netYield ?? "—"}</td>
              <td class="num">{monthly(fig(r.id)?.monthly)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr data-rental-total>
            <th scope="row">合計（{ov.rows.length}件）</th>
            <td />
            <td class="num">{man(ov.total.value)}</td>
            <td class="num">{ov.total.loan > 0 ? man(ov.total.loan) : "—"}</td>
            <td class="num">{yen(ov.total.income)}</td>
            <td class="num">{f?.total.grossYield ?? "—"}</td>
            <td class="num">{f?.total.netYield ?? "—"}</td>
            <td class="num">{monthly(f?.total.monthly)}</td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}
