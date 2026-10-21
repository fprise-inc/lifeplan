// 帳票の入力（0009 の9）: 公式の帳票（Typst のパッケージ @lifeplan/report-core）に渡す、提示に必要な値だけの JSON。
// 正は schema/proposal-input.schema.json（版つき。いまは試験版 0.1.0）。ここは TypeScript から使うための写し。
//
// 入れないもの（0009 の9・0016 の2）: 宛名・氏名、FP のメモ、他の顧客、カスタム計算の印、世帯の内部 ID（構成員・物の ID）。
// 構成員は提示用の鍵（self・spouse・child1 …）と呼び方（ご主人・奥様・長男 …）だけで表す。
// 金額はすべて円の整数で、計算エンジンの出力（表のマス・要約・必要保障額）をそのまま写すか、年ごと・行ごとに足したもの。
// 帳票（Typst）の側は表示の書式（3桁区切り・万円への丸め・▲）だけを行い、計算し直さない。

import type { ChapterId } from "./chapters.ts";
import type { MoneyThreeModel } from "./moneyThree.ts";

/** 円（整数） */
export type Yen = number;

export const PROPOSAL_INPUT_FORMAT = "lifeplan.proposalInput";
export const PROPOSAL_INPUT_VERSION = "0.1.0";

export interface NamedAmount {
  label: string;
  amount: Yen;
}

/** 年の時点（年と、本人の年齢つきの呼び方） */
export interface YearPoint {
  year: number;
  /** 例: 「ご主人76歳（2059年）」 */
  label: string;
}

export interface Outcome {
  /** 目標の年の金融資産 */
  financialAtTarget: Yen;
  /** 資産が尽きる年（金融資産がはじめてマイナスになる年）。尽きなければ null */
  depletion: YearPoint | null;
  /** 表の期間の合計（エンジンの要約 summary.totals） */
  totals: { income: Yen; taxSi: Yen; expense: Yen; net: Yen };
}

export interface CfRow {
  kind: "group" | "value" | "total";
  key: string;
  label: string;
  /** basis.years と同じ並び。group の行は空 */
  cells: (Yen | null)[];
}

export interface CfTable {
  title: string;
  rows: CfRow[];
}

/** 年を行にした縦の表（年金・保険料・必要保障額など、年の数が多いもの） */
export interface YearTable {
  columns: string[];
  rows: { year: number; ages: string; cells: (Yen | null)[] }[];
}

export interface ProtectionView {
  /** 例: 「ご主人が亡くなった場合」 */
  title: string;
  sub: string;
  years: number[];
  need: Yen[];
  needWithAssets: Yen[];
  coverage: Yen[];
  /** 不足（金融資産を含む必要保障額が死亡保険金を上回る額）がいちばん大きい年 */
  maxShort: { year: number; amount: Yen } | null;
}

export interface ScenarioView {
  /** 例: 「ご主人が2031年4月に亡くなった場合」 */
  title: string;
  /** 金融資産の推移（basis.years と同じ並び） */
  withEvent: Yen[];
  withoutEvent: Yen[];
  depletion: YearPoint | null;
  /** 遺族年金（年ごと。受け取る年だけ） */
  survivorPension: { year: number; amount: Yen }[];
  survivorPensionTotal: Yen;
  /** 万一の場合と万一なしの差（表の期間の合計。行のまとまりごと） */
  breakdown: NamedAmount[];
  notices: string[];
}

/** バランスシートの行。item: 項目、sub: 金融資産の内訳、total: 合計 */
export interface SheetLine {
  label: string;
  kind: "item" | "sub" | "total";
  /** points と同じ並び */
  amounts: Yen[];
}

/** 全資産・全負債のバランスシート（年末の値。列は年の時点）。資産の合計＝負債の合計＋純資産 */
export interface BalanceSheetView {
  points: YearPoint[];
  /** 金融資産（内訳）・不動産・その他の資産・資産の合計 */
  assets: SheetLine[];
  /** 住宅ローン・その他の負債・預金の不足・負債の合計 */
  liabilities: SheetLine[];
  /** 純資産（不動産・その他の資産を含む） */
  netWorth: Yen[];
}

/** バランスシートの図の1つの箱（分け方のまとまり。例: すぐ使えるお金・住宅ローン・純資産） */
export interface BalanceFigureBox {
  key: string;
  label: string;
  amount: Yen;
}

/** バランスシートの図の1つの時点。資産の合計＝負債の合計＋純資産（純資産がマイナスなら negative に足りない分） */
export interface BalanceFigureColumn {
  point: YearPoint;
  /** 今の年（入力した値から出した事実）。先の年は見込み */
  fact: boolean;
  /** 上から: すぐ使えるお金・値動きのある運用・引き出せないお金・換金しにくい資産（0 の箱は入れない） */
  assets: BalanceFigureBox[];
  /** 上から: 住宅ローン・その他の負債（資金の不足を含む）・純資産（0 の箱は入れない） */
  liabilities: BalanceFigureBox[];
  /** 純資産のマイナス（0以上。資産の側の一番下に点線で置く） */
  negative: Yen;
  totalAssets: Yen;
  totalLiabilities: Yen;
  netWorth: Yen;
  /** 金融資産（すぐ使える・値動きあり・引き出せないの合計） */
  financial: Yen;
}

export interface BalanceFigure {
  /** 共通の縮尺（いちばん高い時点の高さに当たる額） */
  scale: Yen;
  /** 時点（年の順。1〜4つ。ふつうは2〜4つ） */
  columns: BalanceFigureColumn[];
}

/** 案の比較のページ（主画面の「比較の表」と同じ数字。列は現状と案、差はいつも「その案−基準」） */
export interface Comparison {
  /** 目標の年（本人の目標の年齢の年） */
  target: YearPoint;
  /** 基準の列（0 から） */
  base: number;
  columns: { letter: string; name: string }[];
  rows: {
    key: "target" | "depletion" | "takeHome" | "expense" | "min" | "loan";
    label: string;
    /** yen: 円、year: 年（null は「尽きない」） */
    unit: "yen" | "year";
    /** 列と同じ並び */
    values: (number | null)[];
    /** その額の年（min の行だけ。ほかは空） */
    years: (number | null)[];
    /** 基準との差（基準の列と、比べられないときは null） */
    diffs: (number | null)[];
  }[];
}

/** 紙の向き: 縦にそろえる・横にそろえる・年ごとの表だけ横（以前の形） */
export type Orientation = "portrait" | "landscape" | "mixed";
/** キャッシュフロー表の載せ方: 主要な行・全年／全部の行・5年ごとと主なできごとの年／全部の行・全年 */
export type CashflowLayout = "summary" | "excerpt" | "full";

/** 帳票の組み方（表示の設定。金額ではない） */
export interface ReportLayout {
  orientation: Orientation;
  cashflow: CashflowLayout;
}

/** 標準の組み方: 1冊を縦にそろえ（印刷して綴じる・両面印刷で裏が逆さにならない）、キャッシュフロー表は要約（ページが少ない） */
export const DEFAULT_LAYOUT: ReportLayout = { orientation: "portrait", cashflow: "summary" };

export interface ProposalInput {
  format: typeof PROPOSAL_INPUT_FORMAT;
  version: typeof PROPOSAL_INPUT_VERSION;
  document: {
    title: string;
    /** 作成日（YYYY-MM-DD） */
    issuedOn: string;
    /** 担当（FP・事務所の表示名。任意）。提供元の名前は入れない（0009） */
    preparedBy: string | null;
  };
  basis: {
    /** 計算基準月（YYYY-MM。0003） */
    baseMonth: string;
    /** 例: 「2026年10月」 */
    baseMonthLabel: string;
    /** 表に出す年（計算基準月が年の途中なら翌年から） */
    years: number[];
  };
  members: { key: string; label: string; ageAtBase: number; ages: (number | null)[] }[];
  assumptions: {
    rates: { label: string; value: string }[];
    dataSet: { label: string; version: string; fictional: boolean }[];
    /** 遺族の生活費の割合（万一の想定・必要保障額を載せるときだけ） */
    survivor: { beforeIndependence: string; afterIndependence: string; noChildren: string; source: "input" | "default" } | null;
    /** 遺族年金を見直し前の制度で計算している旨を書くか */
    survivorReform: boolean;
    /** FP顧問料（提案に入っているときだけ。単発と継続。0008 の FP顧問料） */
    advisoryFee: {
      contracts: { label: string; oneTime: { month: string; amount: Yen }[]; recurring: { amount: Yen; per: "year" | "month"; from: string; to: string | null; revision: string | null } | null }[];
      /** 累計（エンジンの summary.advisoryFee.total） */
      total: Yen;
      firstYear: number | null;
      lastYear: number | null;
    } | null;
    /** 計算方法の注記（個人が払うFP顧問料は所得から差し引かない、など） */
    notes: string[];
  };
  summary: {
    target: YearPoint;
    current: Outcome;
    proposal: Outcome;
    /** 目標の年の金融資産の差（提案−現状） */
    diffAtTarget: Yen;
    /** 資産が不足する年のずれ（提案−現状の年数。どちらかが不足しなければ null） */
    depletionShift: number | null;
  };
  basics: {
    year: number;
    income: NamedAmount[];
    expense: NamedAmount[];
    net: Yen;
    /** 資産・負債の時点（計算基準年の年末） */
    balanceYear: number;
    /** 計算基準年の年末のバランスシート（現状。1列） */
    balance: BalanceSheetView;
  };
  events: { year: number; ages: string; items: string[] }[];
  cashflow: { current: CfTable; proposal: CfTable };
  assets: { current: Yen[]; proposal: Yen[] };
  /** 資産と負債の推移（キャッシュフロー表の章の続き。章を外したときは null） */
  balanceSheet: {
    /** バランスシートの図（提案。アプリの「資産と負債」のタブで並べている時点（2〜4つ。既定は今・退職の年・75歳）。同じ分け方・共通の縮尺） */
    figure: BalanceFigure;
    /** 年の抜粋の提案のバランスシート（図の時点と目標の年。5列に満たなければ10年後も。既定の図なら今・10年後・退職の年・75歳・目標の年） */
    proposal: BalanceSheetView;
    /** 同じ時点の現状の純資産 */
    currentNetWorth: Yen[];
    /** 純資産の推移（basis.years と同じ並び） */
    netWorth: { current: Yen[]; proposal: Yen[] };
  } | null;
  education: { years: number[]; rows: { label: string; amounts: Yen[]; total: Yen }[]; total: Yen[]; grandTotal: Yen } | null;
  housingLoan: {
    years: number[];
    balance: Yen[];
    repayment: Yen[];
    compare: { label: string; payoff: YearPoint | null; totalRepayment: Yen }[];
    /** 現状と提案で返済の総額が変わるときの差（提案−現状。繰上返済などの効果） */
    effect: Yen | null;
  } | null;
  retirement: {
    pensions: { label: string; start: YearPoint | null; annual: Yen | null; total: Yen }[];
    table: YearTable;
    /** 退職の年の金融資産（現状・提案） */
    atRetirement: { label: string; current: Yen; proposal: Yen }[];
    /** 本人の退職の後（翌年から表の最後まで）の収入・支出の合計（提案） */
    afterRetirement: { from: number; income: Yen; spending: Yen; gap: Yen } | null;
    deferral: { label: string; options: { label: string; annual: Yen | null; totalToTarget: Yen; financialAtTarget: Yen }[] } | null;
  } | null;
  contingency: { scenarios: ScenarioView[]; protection: ProtectionView[] } | null;
  insurance: {
    contracts: { label: string; insured: string; premium: string; benefits: string[]; status: "継続" | "新規" | "解約" }[];
    table: YearTable;
    total: { current: Yen; proposal: Yen };
  } | null;
  changes: {
    metrics: { label: string; unit: "yen" | "year"; current: number | null; proposal: number | null; diff: number | null }[];
    items: { label: string; current: string; proposal: string }[];
    fee: {
      total: Yen;
      /** 目標の年までの累計 */
      totalToTarget: Yen;
      /** 顧問料を払った後の提案と現状の、目標の年の金融資産の差 */
      diffAtTarget: Yen;
      /** 顧問料を除いた提案と現状の差（顧問料なしの提案の計算があるときだけ） */
      diffWithoutFee: Yen | null;
    } | null;
    steps: { label: string; investment: boolean; effect: Yen; cumulative: Yen }[] | null;
    /** 運用の前提の変更を除いた効果（目標の年の金融資産の差） */
    excludingInvestment: Yen | null;
  };
  /** 帳票の組み方（省略は DEFAULT_LAYOUT） */
  layout?: ReportLayout;
  /** 載せる章（帳票の並び。省略はすべての章。外せない章は必ず入る。chapters.ts） */
  chapters?: ChapterId[];
  /** 案の比較のページ（省略・null は載せない） */
  comparison?: Comparison | null;
  /** 資産運用の計画（0026。省略・null は載せない） */
  investment?: InvestmentView | null;
  /** 相場が下がった場合（0026。省略・null は載せない） */
  marketDrop?: MarketDropView | null;
  /** お金の3つの分け方（説明用の図。提案のプランの今の時点。アプリの区画と同じ値・同じ言葉。0032。省略・null は載せない） */
  moneyThree?: MoneyThreeModel | null;
}

/** 内訳の1つ（色つき） */
export interface ColoredAmount {
  label: string;
  amount: Yen;
  color: string;
}

/** 資産運用の計画: 運用の期間の図・口座ごとの推移・資産の内訳（現状と提案を同じ年で） */
export interface InvestmentView {
  method: string;
  condition: string;
  /** 例: 「86歳まで持つ」 */
  lasts: { current: string; proposal: string };
  periods: {
    accumText: string;
    holdText: string;
    holdSub: string;
    wdText: string;
    wdSub: string;
    accumEnd: number | null;
    wdStart: number | null;
    steps: { year: number; label: string }[];
    estimated: boolean;
  };
  /** 口座ごとの年末の残高（提案。basis.years と同じ並び。下から積む順） */
  accounts: { label: string; color: string; values: Yen[] }[];
  donut: { year: number; label: string; current: ColoredAmount[]; proposal: ColoredAmount[] };
}

/** 相場が下がった場合: 提案の金融資産と、型ごとの線 */
export interface MarketDropView {
  proposal: Yen[];
  lasts: string;
  lines: { label: string; lasts: string; values: Yen[] }[];
}
