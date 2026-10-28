// 収益不動産の項目の上の「物件の一覧」（読むだけ。0079）。中身は stages/rental.ts の rentalOverview（入力から出せる数字だけ）
import { Help } from "../../presentation/Help.tsx";
import type { WorkingHousehold } from "./household.ts";
import { rentalOverview } from "./stages/rental.ts";

const man = (yen: number) => `${Math.round(yen / 10000).toLocaleString("ja-JP")}万円`;
const yen = (v: number) => `${v.toLocaleString("ja-JP")}円`;

export function RentalOverview({ wh }: { wh: WorkingHousehold }) {
  const ov = rentalOverview(wh);
  if (ov === null) return null;
  return (
    <section class="in-section ip-rental" aria-label="物件の一覧" data-rental-overview>
      <h3>
        物件の一覧
        <Help label="物件の一覧">
          <p>読むだけです。入れた値から出しています。</p>
          <p>ローン残高は、今の残高を入れていればその値、入れていなければ借入額と最初の金利・返済の期間から出した今の月の目安です（金利の段階・繰上返済・ボーナス返済は入れていません）。月の収入は、家賃と共益費・駐車場などの月の収入から空室を見込む割合を引いた後の額です（礼金・更新料は入れていません）。民泊・宿は月の売上です。</p>
        </Help>
      </h3>
      <table>
        <thead>
          <tr>
            <th scope="col">物件名</th>
            <th scope="col">種類</th>
            <th scope="col" class="num">評価額</th>
            <th scope="col" class="num">ローン残高</th>
            <th scope="col" class="num">月の収入（空室を見込んだ後）</th>
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
          </tr>
        </tfoot>
      </table>
    </section>
  );
}
