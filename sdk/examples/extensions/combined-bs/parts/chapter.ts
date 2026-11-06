// 合算BS の提案書の章の材料（差し込み口 report.chapter。約束の版 1。0114 の5・6）。
// - 返した対は、帳票の入力の extensions["ext.official.combinedBs"] に入り、reports/chapter.typ が読む（金額は計算し直さず書式だけを当てる）
// - 値を作るのは combinedBs.ts の部品（アプリの見るもの view.ts と同じ）。ここは帳票の図の形（分け方のまとまりの箱）にするだけ
// - 会社の数字が無いとき・家計のバランスシートが無いときは null（章を載せない）
import { groupTotal, type BsGroup, type ExtInput, type Yen } from "@lifeplan/sdk";
import { COMBINED_KEY, combinedBs, hasCompanyAmounts, readCombinedInput, type CombinedColumn } from "./combinedBs.ts";

export interface FigureBox {
  key: string;
  label: string;
  amount: Yen;
}

export interface CombinedFigureColumn {
  name: string;
  /** 例: 「2026年末（今の年）」「試算表（2026年9月末）」 */
  sub: string;
  assets: FigureBox[];
  /** 負債と純資産（合算の1枚は純資産を「会社の財産」「個人の財産」に分ける） */
  liabilities: FigureBox[];
  /** 純資産のマイナス（0以上） */
  negative: Yen;
  totalAssets: Yen;
  totalLiabilities: Yen;
  netWorth: Yen;
}

/** 章の材料（reports/chapter.typ が読む形） */
export interface CombinedBsChapter {
  /** 会社の試算表の基準日の文（無ければ null） */
  asOf: string | null;
  /** 家計のバランスシートの年（今の年の年末） */
  householdYear: number;
  /** 経営者個人（家計）・会社・合算の3枚（共通の縮尺） */
  figure: { scale: Yen; columns: CombinedFigureColumn[] };
  /** 相殺した4つの組 */
  pairs: { label: string; ownerLabel: string; companyLabel: string; owner: Yen; company: Yen }[];
  /** 合算の純資産の内訳 */
  netWorth: { company: Yen; others: Yen; owner: Yen; total: Yen };
  /** 現預金 ÷ 毎月の固定の支出（総合・個人・会社）。months は小数第1位まで */
  indicators: { label: string; cash: Yen; monthly: Yen | null; months: number | null; text: string }[];
  /** 会社の段階の目安の1文（選んでいなければ null） */
  stage: { label: string; text: string } | null;
  /** 実力に直した額（FP が入れた項目だけ。used はその額で並べたか） */
  restated: { rows: { label: string; book: Yen | null; adjusted: Yen }[]; used: boolean };
  /** お知らせ（組の額が合わない・連帯保証の扱いなど） */
  notices: string[];
}

const SHORT: Record<BsGroup, string> = { liquid: "現預金", market: "値動きあり", locked: "引き出せない", illiquid: "そのほかの資産", mortgage: "住宅ローン", propertyLoan: "不動産のローン", debt: "借入金など" };

function fig(c: CombinedColumn, sub: string): CombinedFigureColumn {
  const box = (g: BsGroup) => ({ key: g, label: SHORT[g], amount: groupTotal(c, g) });
  const net = c.netParts !== undefined && c.netParts.length > 0 ? c.netParts.map((p) => ({ key: "netWorth", label: p.key === "netCompany" ? "会社の財産" : p.key === "netOwner" ? "個人の財産" : "ほかの株主", amount: p.amount })) : [{ key: "netWorth", label: "純資産", amount: Math.max(0, c.netWorth) }];
  return {
    name: c.name,
    sub,
    assets: (["liquid", "market", "locked", "illiquid"] as const).map(box).filter((b) => b.amount > 0),
    liabilities: [box("mortgage"), box("propertyLoan"), box("debt"), ...net].filter((b) => b.amount > 0),
    negative: Math.max(0, -c.netWorth),
    totalAssets: c.totalAssets,
    totalLiabilities: c.totalLiabilities,
    netWorth: c.netWorth,
  };
}

/** 章の材料を作る（材料が無ければ null） */
export function chapter(input: ExtInput): CombinedBsChapter | null {
  const c = readCombinedInput(input.values[COMBINED_KEY]);
  const h = input.balance?.now;
  if (c === null || h === undefined || !hasCompanyAmounts(c)) return null;
  const r = combinedBs(c, h);
  const columns = [fig(r.side[0], `${r.side[0].year}年末（今の年）`), fig(r.side[1], r.asOfLabel === null ? "試算表" : `試算表（${r.asOfLabel}）`), fig(r.combined, "相殺してから足した1枚")];
  return {
    asOf: r.asOfLabel,
    householdYear: r.side[0].year,
    figure: { scale: Math.max(1, ...columns.map((x) => Math.max(x.totalAssets, x.totalLiabilities + Math.max(0, x.netWorth)))), columns },
    pairs: r.pairs.map((p) => ({ label: p.label, ownerLabel: p.ownerLabel, companyLabel: p.companyLabel, owner: p.owner, company: p.company })),
    netWorth: r.netWorth,
    indicators: r.indicators.map((x) => ({ label: x.label, cash: x.cash, monthly: x.monthly, months: x.months, text: x.text })),
    stage: r.stage,
    restated: { rows: r.restated.rows.map((x) => ({ label: x.label, book: x.book, adjusted: x.adjusted })), used: r.restated.used },
    notices: r.notices,
  };
}
