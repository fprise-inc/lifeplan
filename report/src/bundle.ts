// 帳票の入力を組み立てる材料（ProposalBundle）: 計算の要求と、その正の計算の結果の組。
// 結果は本体の quickjs-ng で計算したもの（0005 の2。画面側の先出しの結果は渡さない）。形は表示の形（preview: 見出し・表・要約）でよい。
import type { EngineRequest } from "../../engine/src/engine/types.ts";
import type { ChapterId } from "./chapters.ts";
import type { ReportLayout } from "./input.ts";

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
  /** 資産運用の計画（0026）: 画面が入力から作る文（入れ方・取り崩しの条件・運用の期間）と、相場が下がった場合の計算（提案に型を重ねたもの） */
  investment?: InvestmentMaterial;
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
