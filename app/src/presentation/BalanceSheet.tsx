// その年のバランスシートの表（提示層の部品）: 左に資産（金融資産の内訳・不動産・その他の資産）、右に負債と純資産。
// 資産と負債の推移のグラフの下に出し、グラフで固定した年（固定していなければ既定の年）の値を見せる。受け取るのは提示用の値だけ（0016 の2）。
// 金額は年末の値。合計と純資産は円で足してから万円にする（項目ごとに丸めた値の和とは1万円ずれることがある）
import { man } from "./format.ts";
import type { BalanceChartModel, Yen } from "./model.ts";

export interface SheetLine {
  key: string;
  label: string;
  amount: Yen;
  /** 内訳（金融資産の中の預金など） */
  sub?: boolean;
}

export interface Sheet {
  assets: SheetLine[];
  totalAssets: Yen;
  liabilities: SheetLine[];
  totalLiabilities: Yen;
  netWorth: Yen;
}

/** 年の位置 i のバランスシート。0円の項目は出さない（金融資産・不動産・負債の合計の行は出す） */
export function sheetAt(b: BalanceChartModel, i: number): Sheet {
  const v = (x: { values: Yen[] }) => Math.max(0, x.values[i] ?? 0);
  const fin = b.assets.filter((x) => x.group === "financial");
  const finTotal = fin.reduce((s, x) => s + v(x), 0);
  const assets: SheetLine[] = [{ key: "financial", label: "金融資産", amount: finTotal }];
  for (const x of fin) if (v(x) > 0) assets.push({ key: x.key, label: x.label, amount: v(x), sub: true });
  for (const x of b.assets.filter((y) => y.group !== "financial")) if (v(x) > 0 || x.group === "realEstate") assets.push({ key: x.key, label: x.label, amount: v(x) });
  const totalAssets = b.assets.reduce((s, x) => s + v(x), 0);
  const liabilities: SheetLine[] = b.debts.filter((x) => v(x) > 0).map((x) => ({ key: x.key, label: x.label, amount: v(x) }));
  const short = Math.max(0, -(b.shortfall[i] ?? 0));
  if (short > 0) liabilities.push({ key: "short", label: "預金の不足", amount: short });
  const totalLiabilities = liabilities.reduce((s, x) => s + x.amount, 0);
  return { assets, totalAssets, liabilities, totalLiabilities, netWorth: totalAssets - totalLiabilities };
}

export interface BalanceSheetPane {
  /** 案の名前（例: プランB） */
  name: string;
  /** 見出しの札（例: 基準・選んだプラン）。1つだけ見せるときは null */
  tag: string | null;
  model: BalanceChartModel;
}

const Amount = ({ v }: { v: Yen }) => <td class={`num${v < 0 ? " neg" : ""}`}>{man(v)}</td>;

function Side({ title, lines, totalLabel, total, extra, cls, rows }: { title: string; lines: SheetLine[]; totalLabel: string; total: Yen; extra?: SheetLine[]; cls: string; rows: number }) {
  const used = Math.max(1, lines.length) + (extra ?? []).length;
  return (
    <table class={`bs-table ${cls}`}>
      <thead>
        <tr>
          <th scope="col" colSpan={2}>
            {title}
          </th>
        </tr>
      </thead>
      <tbody>
        {lines.map((x) => (
          <tr key={x.key} class={x.sub === true ? "bs-sub" : ""} data-bs-item={x.key}>
            <th scope="row">{x.label}</th>
            <Amount v={x.amount} />
          </tr>
        ))}
        {lines.length === 0 ? (
          <tr class="bs-none">
            <th scope="row">なし</th>
            <td class="num">0</td>
          </tr>
        ) : null}
        {Array.from({ length: Math.max(0, rows - used) }, (_, k) => (
          <tr key={`pad${k}`} class="bs-pad" aria-hidden="true">
            <td colSpan={2} />
          </tr>
        ))}
        {(extra ?? []).map((x) => (
          <tr key={x.key} class={`bs-${x.key}`} data-bs-item={x.key}>
            <th scope="row">{x.label}</th>
            <Amount v={x.amount} />
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr class="bs-total">
          <th scope="row">{totalLabel}</th>
          <Amount v={total} />
        </tr>
      </tfoot>
    </table>
  );
}

function SheetTable({ pane, index }: { pane: BalanceSheetPane; index: number }) {
  const s = sheetAt(pane.model, index);
  // 左右の合計の行の高さをそろえる（短い側に空の行を足す）
  const rows = Math.max(Math.max(1, s.assets.length), Math.max(1, s.liabilities.length) + 2);
  return (
    <div class="bs-pane" data-bs-plan={pane.name} aria-label={`${pane.name}のバランスシート（万円）`} role="group">
      {pane.tag !== null ? (
        <div class="bs-plan">
          <b>{pane.name}</b>
          <span class="side-tag">{pane.tag}</span>
        </div>
      ) : null}
      <div class="bs-cols">
        <Side title="資産" cls="bs-l" rows={rows} lines={s.assets} totalLabel="資産の合計" total={s.totalAssets} />
        <Side
          title="負債・純資産"
          cls="bs-r"
          rows={rows}
          lines={s.liabilities}
          extra={[
            { key: "liabilities", label: "負債の合計", amount: s.totalLiabilities },
            { key: "netWorth", label: "純資産", amount: s.netWorth },
          ]}
          totalLabel="負債と純資産の合計"
          total={s.totalLiabilities + s.netWorth}
        />
      </div>
    </div>
  );
}

export interface BalanceSheetProps {
  panes: BalanceSheetPane[];
  year: number;
  /** 年の札（例: 「2035年（ご主人45歳）」） */
  head: string;
  /** グラフで年を固定しているか（していなければ、変え方の案内を出す） */
  pinned: boolean;
}

/** その年のバランスシート（1つ、または左右に並べる表示では基準と選んだ案の2つ） */
export function BalanceSheet({ panes, year, head, pinned }: BalanceSheetProps) {
  const index = panes[0]?.model.years.indexOf(year) ?? -1;
  if (index < 0) return null;
  return (
    <section class="bs" aria-label={`${head}のバランスシート`} data-balance-sheet={year}>
      <div class="bs-h">
        <b>{head}のバランスシート</b>
        <span class="unit">（万円・年末）</span>
        <span class="bs-hint">{pinned ? "グラフで固定した年です" : "グラフで年をクリックすると、その年に変わります"}。純資産は不動産・その他の資産を含みます（万円未満を四捨五入するため、内訳の和と合計が合わないことがあります）</span>
      </div>
      <div class={`bs-grid${panes.length > 1 ? " two" : ""}`}>
        {panes.map((p) => (
          <SheetTable key={p.name + (p.tag ?? "")} pane={p} index={index} />
        ))}
      </div>
    </section>
  );
}
