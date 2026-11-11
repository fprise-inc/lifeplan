// 帳票の入力を組み立てる材料（ProposalBundle）: 計算の要求と、その正の計算の結果の組。
// 結果は本体の quickjs-ng で計算したもの（0005 の2。画面側の先出しの結果は渡さない）。形は表示の形（preview: 見出し・表・要約）でよい。
import type { OfficeRowNames } from "./rowNames.ts";
import type { ChildScholarship } from "./childScholarships.ts";
import type { EngineRequest } from "../../engine/src/engine/types.ts";
import type { ChapterId } from "./chapters.ts";
import type { ReportLayout } from "./input.ts";
import type { MoneyThreeSettings } from "./moneyThree.ts";
import type { SaleVariant } from "./rentalSale.ts";

export type { EngineRequest };

/** 表のマス（エンジンの出力 table の1件） */
export interface TableCell {
  row: string;
  year: number;
  amount: number;
  member?: string;
  object?: string;
}

export interface ProtectionYear {
  year: number;
  death: string;
  horizon: number;
  need: number;
  needWithAssets: number;
  coverage: number;
}

export interface ProtectionOutput {
  method: string;
  members: { member: string; survivor: string | null; years: ProtectionYear[] }[];
}

/** エンジンの要約の realEstate の1件（asset.realEstate の出力の properties の1件） */
export interface RealEstateDetail {
  object: string;
  owner: string;
  years: { year: number; land: number; building: number; value: number }[];
  income: { year: number; rent: number; expenses: number; depreciation: number; interest: number; landInterest: number; income: number }[];
  /** acquisitionCost・estimated・gain・term は譲渡所得の内訳（0081。エンジンの asset.realEstate の約束の版 1.1。無い版もある） */
  sale: { ym: string; value: number; price: number; costs: number; proceeds: number; acquisitionCost?: number; estimated?: boolean; gain?: number; term?: "long" | "short" } | null;
  /** 所得の区分（民泊・宿の雑所得・事業所得。無ければ不動産所得。0081） */
  incomeKind?: "miscellaneous" | "business";
  /** 事業的規模の目安に数える室数・棟数（0081） */
  units?: { rooms: number; houses: number };
}

/** エンジンの要約の realEstateAnalysis（asset.realEstateAnalysis の出力。形の正はエンジンの出力のスキーマ。0082） */
export interface RealEstateAnalysis {
  properties: RealEstateAnalysisProperty[];
  total: RealEstateAnalysisTotal[];
}

export interface RealEstateAnalysisAmounts {
  year: number;
  gross: number | null;
  rent: number;
  expenses: number;
  repairs: number;
  depreciation: number | null;
  interest: number | null;
  income: number | null;
  repayment: number;
  debtService: number;
  principal: number;
  cashBeforeTax: number;
  tax: number;
  cashAfterTax: number;
  loanBalance: number;
  value: number | null;
  /** 売ったときの手残りの目安（評価額−ローン残高。売却の費用・税は引かない） */
  equity: number | null;
  /** 年末の帳簿価額（取得価額＋取得時の諸費用−減価償却の累計。前の版のエンジンの結果には無い） */
  bookValue?: number | null;
  /** 含み益（評価額−帳簿価額。前の版のエンジンの結果には無い） */
  unrealizedGain?: number | null;
  grossYield: string | null;
  /** 今の家賃収入での表面利回り（今の実際の家賃収入で入れた物件だけ。0126。前の版のエンジンの結果には無い） */
  currentYield?: string | null;
  netYield: string | null;
  breakEven: string | null;
  repaymentRatio: string | null;
  dscr: string | null;
  ltv: string | null;
  ccr: string | null;
}

export interface RealEstateAnalysisYear extends RealEstateAnalysisAmounts {
  held: boolean;
  months: number;
  age: number | null;
  remainingLife: number | null;
  lodging?: { occupancy: string; nightly: number; days: number; sales: number };
}

export interface RealEstateAnalysisTotal extends RealEstateAnalysisAmounts {
  gross: number;
  depreciation: number;
  interest: number;
  income: number;
  value: number;
  equity: number;
}

export interface RealEstateAnalysisProperty {
  object: string;
  owner: string;
  acquisition: { total: number; costs: number; equity?: number } | null;
  builtYear: number | null;
  legalLife: number | null;
  depreciationEnd: { building: number | null; equipment: number | null };
  /** 売る・貸し終わるまでに減価償却が終わらないとき、貸し続けたら終わる年 */
  depreciationEndIfContinued?: { building: number | null; equipment: number | null };
  deadCross: number | null;
  lodging: boolean;
  /** 今の実際の家賃収入で入れた物件（満室の額が無いので、表面利回り・損益分岐の入居率は null。0126） */
  rentBy?: "actual";
  years: RealEstateAnalysisYear[];
  exit: { ym: string; price: number; costs: number; proceeds: number; loanPayoff: number; tax: number; net: number } | null;
}

export interface AdvisoryFeeSummary {
  total: number;
  byYear: { year: number; amount: number; cumulative: number }[];
  contracts: { object: string; member: string; total: number }[];
}

/** エンジンの結果のうち、帳票で使うところ（run・runBatch の結果。preview の形でも同じ欄がある） */
export interface EngineOutput {
  header: {
    baseMonth: string;
    endYear: number;
    data?: { packId: string; version: string; fictional?: boolean }[];
    notices?: { code: string; ids: string[] }[];
  };
  table: TableCell[];
  summary: {
    totals: { income: number; taxSi: number; expense: number; net: number };
    advisoryFee?: AdvisoryFeeSummary;
    /** 住まい以外の不動産の物件ごとの数字（エンジンの asset.realEstate の出力。持っていなければ無い） */
    realEstate?: RealEstateDetail[];
    /** 収益不動産の分析の数字（エンジンの asset.realEstateAnalysis の出力。持っていなければ無い。0082） */
    realEstateAnalysis?: RealEstateAnalysis;
    /** 子が返す貸与の奨学金（世帯の収支に入れない返済。持っていなければ無い。0104） */
    childScholarships?: ChildScholarship[];
  };
  protection?: ProtectionOutput;
}

export interface Run {
  request: EngineRequest;
  result: EngineOutput;
}

export interface ProposalBundle {
  document: { title?: string; issuedOn: string; preparedBy?: string | null };
  /** 現状 */
  current: Run;
  /** 提案（打ち手を当てたもの。FP顧問料を含む） */
  proposal: Run;
  /** 目標の年を決める本人の年齢（省略は表の最後の年） */
  targetAge?: number;
  /** FP顧問料を除いた提案（「顧問料を除くと」の比較。0008 の FP顧問料） */
  proposalWithoutFee?: Run;
  /** 夢プランの夢を全部外した提案（ご家族の夢の章の要約の1文。計算に入れた夢があるときだけ。0103） */
  proposalWithoutDreams?: Run;
  /** 打ち手を1件ずつ足していった順の計算（運用の前提の変更を除いた効果を出すため）。最後は提案と同じになるのが普通 */
  steps?: { label: string; investment?: boolean; run: Run }[];
  /** 運用の前提の変更だけを除いた提案（無ければ steps から読む） */
  excludingInvestment?: Run;
  /** 変更点の説明（打ち手の一覧。画面の打ち手のパネルが作る文） */
  changes?: { label: string; current: string; proposal: string }[];
  /** 万一の想定（提案に万一を1件重ねた計算。万一なしは提案） */
  contingencies?: { title: string; run: Run }[];
  /** 必要保障額の推移（提案に input.protection を付けた計算） */
  protection?: Run;
  /** 年金の受け取り開始の比較（繰下げ。提案の世帯で、受け取り開始だけを変えた計算） */
  deferral?: { memberKey: string; options: { startAge: number; run: Run }[] };
  /** 案の比較のページ（現状と帯の案。基準の列の番号。主画面の比較の表と同じ） */
  comparison?: { base: number; plans: { letter: string; name: string; run: Run }[] };
  /** 載せる章（省略はすべて。chapters.ts） */
  chapters?: ChapterId[];
  /** お金の3つの分け方の何か月分・何年先まで・呼び方（資産と負債のタブの表示の設定。省略は既定。0032） */
  moneyThree?: MoneyThreeSettings;
  /**
   * 事務所の名前（カスタム層の名前の差し替えで FP が承認した、表の行の名前。0016 の 2026-11-02 の追記）。表の行と、同じ名前の内訳に当てる。
   * 省略は公式の名前。事務所の名前である印は帳票に出さない
   */
  names?: OfficeRowNames;
  /** 帳票の組み方（紙の向き・キャッシュフロー表の載せ方。省略は標準） */
  layout?: ReportLayout;
  /**
   * 入力に推定・仮の値（統計の平均などで補った値）が残っているか（アプリの画面が入力の欄から決める）。
   * 計算の要求の中の推定の値の箱（state: "estimated"）は、これが無くても読む。どの欄が推定かは帳票に渡さない（FP 向けの画面だけで示す）
   */
  estimated?: boolean;
  /**
   * バランスシートの図の時点（2〜4つ。0027）: 画面の「資産と負債」のタブで並べている時点を、提案のプランの年に解いたもの（年の順でなくてよい）。
   * name は時点の候補の名前（「今」「退職の年」「75歳」「ローン完済」など）。年を直に選んだ時点は null。
   * 省略は「今・退職の年・75歳」（無い時点は10年後で埋める）。年の抜粋の表も、この時点と目標の年を必ず入れる
   */
  balancePoints?: { year: number; name: string | null }[];
  /**
   * 提案書の拡張の章の材料（0114 の6）: 章の id（ext.<作成者>.<名前>）→ 束の関数（差し込み口 report.chapter）が返した対。
   * 作業の層が、有効な束の章を FP が選んだときだけ作る（合算BS は ext.official.combinedBs）。そのまま帳票の入力の extensions に入る
   */
  extensions?: Record<string, Record<string, unknown>>;
  /**
   * 見本の世帯でだけ載せた拡張の章の id（0197）: アプリの見本の世帯で、機能を有効にするコードが無くても見本として載せた章。
   * 帳票が章の見出しの下に「見本」の印を付ける。そのまま帳票の入力の extensionSamples に入る（extensions に材料のある章だけ）
   */
  extensionSamples?: string[];
  /** 資産運用の計画（0026）: 画面が入力から作る文（入れ方・取り崩しの条件・運用の期間）と、相場が下がった場合の計算（提案に型を重ねたもの） */
  investment?: InvestmentMaterial;
  /**
   * 収益不動産の売る年を変えた比較（0082）: 提案の物件ごとに、rentalSale.ts の saleVariants の案と、その案の計算（今の予定の案は提案の計算）。
   * 収益不動産のまとめの章を載せるときだけ。無ければ比較を載せない
   */
  rentalSale?: { object: string; variants: { variant: SaleVariant; run: Run }[] }[];
}

/** 資産運用の計画の材料（画面の作業の層が作る。金額は計算の結果から帳票の側で読む） */
export interface InvestmentMaterial {
  /** 入れ方（合計・口座・資産配分） */
  method: string;
  /** 例: 「65歳から毎月17万円ずつ取り崩す場合」 */
  condition: string;
  periods: {
    accumText: string;
    holdText: string;
    holdSub: string;
    wdText: string;
    wdSub: string;
    /** 据え置き始める年（積立をやめた次の年）と、取り崩しを始める年（予定が無ければ null） */
    accumEnd: number | null;
    wdStart: number | null;
    /** 積立額が変わる年と、その期間の額の札 */
    steps: { year: number; label: string }[];
    /** 積立をやめる年が空欄（退職の年まで・推定） */
    estimated: boolean;
  };
  /** 資産の内訳を見る年 */
  donutYear: number;
  /** 相場が下がった場合（提案に型を重ねた計算） */
  stress?: { label: string; run: Run }[];
}
