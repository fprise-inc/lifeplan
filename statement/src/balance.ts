// 銀行の明細の残高の欄で、行ごとの金額を照らし合わせる（写真・スクショ・画像だけの PDF の文字認識の結果だけ。0221）。
// - 前の行の残高 − 出金 ＋ 入金 ＝ その行の残高 にならない行を「読み取りが不確か」にする（理由の短い文つき）
// - 最初の行（前の残高が無い）は照らし合わせない。「前月繰越」のような残高だけの行は、次の行の前の残高に使う
// - 残高の欄が空・読めない行は、次に残高のある行までまとめて照らし合わせる（同じ日の最後の行にだけ残高がある明細）
// - 残高だけを読み違えたとき（その行も次の行も合わないが、その行の残高を飛ばすと次の行が合う）は、金額は正しいので印を付けない
// - 並びが新しい順の明細は下から照らし合わせる。どちらの並びか、合う行の多い方で決め（同じなら使った日の並び）、決まらなければ照らし合わせない
// - 合わない行が合う行より2つ以上多い明細は、残高の欄の読み取りそのものが怪しいので照らし合わせない（誤って全部に印を付けない）
// 今の CSV・文字の入った PDF の取り込みには使わない（readStatement が文字認識の結果のときだけ呼ぶ）
import type { ColumnMapping, ReadRow, Table } from "./table.ts";
import { looseKey, nfkc } from "./text/normalize.ts";
import { parseAmount } from "./text/values.ts";

/** 残高の見出しの言葉（looseKey の形で比較する） */
const BALANCE_EXACT = ["残高", "差引残高", "お取引後残高", "取引後残高", "現在残高", "預金残高", "現在高", "残高円", "差引残高円"].map(looseKey);

/** 見出しの行の残高の欄（対応付けに使っている列は除く）。無ければ null */
export function balanceColumn(header: readonly string[], used: ReadonlySet<number>): number | null {
  const i = header.findIndex((c, j) => !used.has(j) && BALANCE_EXACT.includes(looseKey(c)));
  if (i >= 0) return i;
  const k = header.findIndex((c, j) => !used.has(j) && looseKey(c).includes(looseKey("残高")));
  return k >= 0 ? k : null;
}

/** 照らし合わせる1行（line が null は「前月繰越」のような残高だけの行。break は読めなかった明細の行で、続きを切る） */
interface Entry {
  readonly line: number | null;
  readonly amount: number;
  readonly balance: number | null;
  readonly date?: string;
  readonly break?: true;
}

const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;

interface Pass {
  readonly matches: number;
  readonly mismatches: number;
  readonly marks: Map<number, string>;
}

/** 古い順に並んだ行を照らし合わせる */
function pass(entries: readonly Entry[]): Pass {
  let prev: number | null = null;
  let pending: Entry[] = [];
  let matches = 0;
  let mismatches = 0;
  const marks = new Map<number, string>();
  const sum = (es: readonly Entry[]) => es.reduce((s, e) => s + e.amount, 0);
  for (let k = 0; k < entries.length; k++) {
    const e = entries[k] as Entry;
    if (e.break === true) {
      prev = e.balance;
      pending = [];
      continue;
    }
    if (e.balance === null) {
      if (prev !== null) pending.push(e);
      continue;
    }
    if (prev === null) {
      prev = e.balance;
      pending = [];
      continue;
    }
    const span = [...pending, e];
    const expected: number = prev - sum(span);
    if (expected === e.balance) {
      matches++;
      prev = e.balance;
      pending = [];
      continue;
    }
    // この行の残高だけを読み違えたか: この行の残高を飛ばして、次に残高のある行まで計算すると合う
    const ahead: Entry[] = [];
    let next: Entry | undefined;
    for (let j = k + 1; j < entries.length; j++) {
      const f = entries[j] as Entry;
      if (f.break === true) break;
      ahead.push(f);
      if (f.balance !== null) {
        next = f;
        break;
      }
    }
    if (next !== undefined && next.balance === expected - sum(ahead)) {
      pending = span;
      continue;
    }
    mismatches++;
    const why = `残高と合いません（前の残高 ${yen(prev)} から計算すると ${yen(expected)}、明細の残高は ${yen(e.balance)}）`;
    for (const s of span) if (s.line !== null) marks.set(s.line, why);
    prev = e.balance;
    pending = [];
  }
  return { matches, mismatches, marks };
}

/**
 * 銀行の明細の残高の欄で行ごとに照らし合わせ、合わない行（表の lines の番号）と理由の短い文を返す。
 * 残高の欄が無い（見出しの無い表・残高の見出しが無い）ときや、並びが決まらないときは空
 */
export function balanceCheck(table: Table, mapping: ColumnMapping, rows: readonly ReadRow[]): Map<number, string> {
  const none = new Map<number, string>();
  if (mapping.headerRow === null) return none;
  const header = table.cells[mapping.headerRow];
  if (header === undefined) return none;
  const used = new Set(Object.values(mapping.columns).filter((v): v is number => v !== undefined));
  const col = balanceColumn(header, used);
  if (col === null) return none;
  const byLine = new Map(rows.map((r) => [r.line, r]));
  const money = [mapping.columns.amount, mapping.columns.withdrawal, mapping.columns.deposit].filter((v): v is number => v !== undefined);
  const entries: Entry[] = [];
  for (let i = mapping.headerRow + 1; i < table.cells.length; i++) {
    const cells = table.cells[i] as readonly string[];
    const line = table.lines[i] ?? i + 1;
    const balance = parseAmount(nfkc(cells[col] ?? ""));
    const row = byLine.get(line);
    if (row !== undefined) {
      entries.push({ line, amount: row.amount, balance, date: row.date });
      continue;
    }
    const hasMoney = money.some((j) => parseAmount(nfkc(cells[j] ?? "")) !== null);
    // 残高だけの行（前月繰越など）は、次の行の前の残高に使う
    if (!hasMoney && balance !== null) entries.push({ line: null, amount: 0, balance });
    // 金額はあるが明細として読めなかった行（日付が読めないなど）は、続きを切る（その行の残高から照らし合わせ直す）
    else if (hasMoney) entries.push({ line: null, amount: 0, balance, break: true });
    // 見出しの繰り返し・空の行などは飛ばす
  }
  const asc = pass(entries);
  const desc = pass([...entries].reverse());
  let pick: Pass | null;
  if (asc.matches !== desc.matches) pick = asc.matches > desc.matches ? asc : desc;
  else {
    const dates = entries.flatMap((e) => (e.date !== undefined ? [e.date] : []));
    const first = dates[0];
    const last = dates[dates.length - 1];
    pick = first === undefined || last === undefined || first === last ? null : first < last ? asc : desc;
  }
  if (pick === null || pick.matches + 1 < pick.mismatches) return none;
  return pick.marks;
}
