// 収益不動産のタブ（提示層の部品。物件ごと・年ごとの分析の数字）。受け取るのは RentalTabModel と手続きだけ（0016 の2・0082）。
// 配置（上から）: 見るもの（全体〔物件が2件以上〕と物件ごと）→ プランの帯（作業の層が渡す）→
// 物件: 見出しの1行 → 指標（選んだ年）→ 年ごとの表（行を押すとその年の指標）→ 売る年を変えた比べ。
// 全体: 物件ごとの1行と合計の行（選んだ年）→ 合計の年ごとの表。
// 欄の説明・式は「?」の中に入れ、画面には欄の名前・値・印・操作の名前だけを出す
import type { ComponentChildren } from "preact";
import { Help } from "./Help.tsx";
import type { RentalPropertyViewModel, RentalSaleModel, RentalTabModel, RentalTableModel, RentalTotalViewModel } from "./model.ts";

export interface RentalTabProps {
  model: RentalTabModel;
  /** プランの帯（作業の層の部品。結果のタブと同じ） */
  band: ComponentChildren;
  /** 見るものを選んだ（"total" か物件の鍵） */
  onView: (key: string) => void;
  /** 指標を見る年を選んだ（表の行を押した） */
  onYear: (year: number) => void;
}

/** 元金の返済が減価償却費を上回る年の印 */
export const DEAD_CROSS_MARK = "元金＞償却";

export function RentalTab({ model, band, onView, onYear }: RentalTabProps) {
  const v = model.view;
  return (
    <div class="rt-tab" data-rental-tab>
      {model.views.length > 1 ? (
        <div class="bs-views" role="group" aria-label="見るもの">
          <span class="k">見るもの</span>
          {model.views.map((x) => (
            <button type="button" key={x.key} class="bs-vbtn" aria-pressed={model.selected === x.key} onClick={() => onView(x.key)} data-rental-view={x.key}>
              {x.label}
            </button>
          ))}
        </div>
      ) : null}
      {band}
      {v === null ? (
        <section class="card">
          <p class="rt-empty">この計算の結果には、収益不動産の数字がありません。</p>
        </section>
      ) : v.kind === "total" ? (
        <TotalView view={v} onView={onView} onYear={onYear} provisional={model.provisional} />
      ) : (
        <PropertyView view={v} onYear={onYear} provisional={model.provisional} />
      )}
    </div>
  );
}

function PropertyView({ view, onYear, provisional }: { view: RentalPropertyViewModel; onYear: (y: number) => void; provisional: boolean }) {
  return (
    <>
      <section class="card rt-card" aria-labelledby="h-rt" data-rental-property={view.key}>
        <div class="bs-head">
          <h2 id="h-rt">{view.title}</h2>
          {provisional ? (
            <span class="provisional" title="指を離すと正式な計算に置き換わります">
              確定前
            </span>
          ) : null}
        </div>
        {view.facts.length > 0 ? <p class="rt-facts">{view.facts.join("・")}</p> : null}
        <h3 class="rt-h3">
          {view.year}年の指標
          <Help label="指標">
            <p>表の行を押すと、その年の指標になります。金額はその年に表に載る月の分で、率は年に直して出しています。</p>
          </Help>
        </h3>
        <dl class="rt-metrics" data-rental-metrics>
          {view.metrics.map((m) => (
            <div key={m.key} class="rt-metric" data-metric={m.key}>
              <dt>
                {m.label}
                <Help label={m.label}>
                  <p>{m.help}</p>
                </Help>
              </dt>
              <dd class="num">{m.value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section class="card rt-card" aria-labelledby="h-rt-years">
        <div class="bs-head">
          <h2 id="h-rt-years">年ごとの数字</h2>
          <span class="rt-unit">（万円）</span>
        </div>
        <YearTable table={view.table} selected={view.year} onYear={onYear} />
        {view.table.rows.some((r) => r.deadCross) ? (
          <p class="rt-legend" data-rental-legend>
            <span class="rt-mark">{DEAD_CROSS_MARK}</span> 元金の返済が減価償却費を上回る年
            <Help label="元金の返済が減価償却費を上回る年">
              <p>元金の返済は経費になりませんが、減価償却費は経費になります。元金の返済のほうが大きくなると、帳簿の上の所得より手元に残るお金が少なくなり、税の分だけ手残りが苦しくなりやすくなります。</p>
            </Help>
          </p>
        ) : null}
      </section>
      {view.sale !== null ? <SaleCompare sale={view.sale} /> : null}
    </>
  );
}

function SaleCompare({ sale }: { sale: RentalSaleModel }) {
  return (
    <section class="card rt-card" aria-labelledby="h-rt-sale" data-rental-sale>
      <div class="bs-head">
        <h2 id="h-rt-sale">
          売る年を変えた比べ
          <Help label="売る年を変えた比べ">
            <p>この物件の売る年だけを変えて、世帯全体を計算し直した数字です（ほかの入力は同じ）。今の予定の行は、このプランの結果そのものです。</p>
            <p>今の予定と違う年に売るときは、その年の評価額で売るとしています（売却の費用の割合と、売ったときにローンを返すかは今の予定のまま）。</p>
            <p>税引後の手取りは、売却価格−売却の費用−売ったときに返すローン−譲渡所得の税です。</p>
          </Help>
        </h2>
      </div>
      {sale.status === "loading" ? (
        <p class="loading">計算しています…</p>
      ) : sale.status === "error" ? (
        <p class="rt-empty">計算できませんでした。</p>
      ) : (
        <div class="rt-scroll">
          <table class="rt-table">
            <thead>
              <tr>
                <th scope="col">売る時期</th>
                <th scope="col" class="num">税引後の手取り</th>
                <th scope="col" class="num">{sale.endYear}年の金融資産</th>
                <th scope="col" class="num">今の予定との差</th>
                <th scope="col" class="num">{sale.endYear}年の評価額−ローン残高</th>
              </tr>
            </thead>
            <tbody>
              {sale.rows.map((r) => (
                <tr key={r.label} class={r.current ? "cur" : undefined} data-sale-row={r.current ? "current" : "other"}>
                  <th scope="row">{r.label}</th>
                  <td class="num">{r.net}</td>
                  <td class="num">{r.financialEnd}</td>
                  <td class="num">{r.diff}</td>
                  <td class="num">{r.equityEnd}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function TotalView({ view, onView, onYear, provisional }: { view: RentalTotalViewModel; onView: (k: string) => void; onYear: (y: number) => void; provisional: boolean }) {
  return (
    <>
      <section class="card rt-card" aria-labelledby="h-rt-total" data-rental-total>
        <div class="bs-head">
          <h2 id="h-rt-total">{view.year}年の物件ごとの数字</h2>
          {provisional ? (
            <span class="provisional" title="指を離すと正式な計算に置き換わります">
              確定前
            </span>
          ) : null}
          <Help label="物件ごとの数字">
            <p>下の表の行を押すと、その年の数字になります。物件名を押すと、その物件の指標と年ごとの数字を見られます。合計の率は、物件の年の額を足してから出しています。</p>
          </Help>
        </div>
        <div class="rt-scroll">
          <table class="rt-table">
            <thead>
              <tr>
                {view.columns.map((c, i) => (
                  <th key={c.key} scope="col" class={i >= 2 ? "num" : undefined}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.rows.map((r) => (
                <tr key={r.key} data-rental-row={r.key}>
                  <th scope="row">
                    <button type="button" class="link-btn" onClick={() => onView(r.key)}>
                      {r.cells[0]}
                    </button>
                  </th>
                  {r.cells.slice(1).map((c, i) => (
                    <td key={i} class={i >= 1 ? "num" : undefined}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr data-rental-sum>
                <th scope="row">{view.totalRow[0]}</th>
                {view.totalRow.slice(1).map((c, i) => (
                  <td key={i} class={i >= 1 ? "num" : undefined}>
                    {c}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
      <section class="card rt-card" aria-labelledby="h-rt-tyears">
        <div class="bs-head">
          <h2 id="h-rt-tyears">全物件の合計の年ごとの数字</h2>
          <span class="rt-unit">（万円）</span>
        </div>
        <YearTable table={view.table} selected={view.year} onYear={onYear} />
      </section>
    </>
  );
}

function YearTable({ table, selected, onYear }: { table: RentalTableModel; selected: number; onYear: (y: number) => void }) {
  return (
    <div class="rt-scroll rt-years">
      <table class="rt-table">
        <thead>
          <tr>
            {table.columns.map((c, i) => (
              <th key={c.key} scope="col" class={i > 0 ? "num" : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r) => (
            <tr key={r.year} class={r.year === selected ? "sel" : undefined} onClick={() => onYear(r.year)} data-year={r.year} data-dead-cross={r.deadCross ? "" : undefined}>
              <th scope="row">
                <button type="button" class="rt-year" aria-pressed={r.year === selected} onClick={(e) => (e.stopPropagation(), onYear(r.year))}>
                  {r.year}年
                </button>
                {r.deadCross ? <span class="rt-mark">{DEAD_CROSS_MARK}</span> : null}
              </th>
              {r.cells.map((c, i) => (
                <td key={i} class={r.negative[i] === true ? "num neg" : "num"}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
