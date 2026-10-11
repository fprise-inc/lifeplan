// 提示層が受け取れる値（PresentationModel。0016 の2）。
// 作業の層（src/workspace/present.ts）が、許可した項目だけを選んで作る別の型。
// 次を含まない: FPのメモ、他の顧客の情報、カスタム計算の印と内部記録、取り下げなどFP向けの注記、AIへの共有の状態、
// 根拠の記録のうちFP向けの部分（部品の指紋など）、世帯の物の ID。
// 提示層の部品（src/presentation/）は、作業の層・エンジン・本体の命令を読み込めない（lint で止める）。

/** 円（整数） */
export type Yen = number;

export interface MemberChip {
  label: string;
  age: number;
}

export interface Headline {
  /** 例: 「ご主人95歳時点の金融資産（提案）」 */
  label: string;
  amount: Yen;
  /** 提案−現状 */
  diff: Yen;
  currentAmount: Yen;
  /** 例: 「ご主人76歳で不足」 */
  currentNote: string | null;
}

export interface VerdictPart {
  text: string;
  strong?: boolean;
}

export interface Verdict {
  tone: "up" | "down" | "flat";
  parts: VerdictPart[];
}

export interface Depletion {
  series: "proposal" | "current";
  year: number;
  label: string;
}

export interface ChartModel {
  years: number[];
  /** x 軸の下に添える年齢（本人） */
  ages: (number | null)[];
  proposal: Yen[];
  current: Yen[];
  depletions: Depletion[];
}

export interface YearDetail {
  year: number;
  members: string;
  income: Yen;
  expense: Yen;
  net: Yen;
  financial: Yen;
}

export type EventIcon = "学" | "独" | "退" | "年" | "家" | "！";

export interface EventChip {
  year: number;
  icon: EventIcon;
  text: string;
  short: boolean;
}

export interface TableCellModel {
  amount: Yen | null;
  /** 不足（金融資産がマイナス） */
  short?: boolean;
}

export type TableRowModel =
  | { kind: "age"; key: string; label: string; ages: (number | null)[] }
  | { kind: "events"; key: string; label: string; icons: EventIcon[][] }
  | { kind: "group"; key: string; label: string }
  | { kind: "value" | "total"; key: string; label: string; cells: TableCellModel[]; evidence: boolean };

export interface CashflowTableModel {
  title: string;
  years: number[];
  rows: TableRowModel[];
}

export interface GoalCard {
  category: string;
  priority: "必要" | "希望" | "夢";
  title: string;
  when: string;
  amount: Yen | null;
  /** 準備できているか（null は未入力の「夢」） */
  ready: boolean | null;
  /** 不足のときの文（例: 「2061年から資金が不足」） */
  shortNote: string | null;
}

export interface GoalsModel {
  needTotal: number;
  needReady: number;
  cards: GoalCard[];
}

export interface PresentationModel {
  members: MemberChip[];
  /** 例: 「2026年10月時点」 */
  asOf: string;
  headline: Headline;
  verdict: Verdict;
  chart: ChartModel;
  selectedYear: number;
  yearDetail: YearDetail | null;
  events: EventChip[];
  table: CashflowTableModel;
  goals: GoalsModel;
  /** FP顧問料を対策で ON/OFF しているときの一文（顧問料の契約が無ければ null） */
  fee: FeeLine | null;
  /** 数字が確定前（画面側の先出し）か。0005 の5: 控えめに示す */
  provisional: boolean;
}

/** 根拠の表示（0006 の7）に出す値。根拠の記録から、顧客に見せてよい項目だけを選んだもの */
export interface EvidenceView {
  title: string;
  total: Yen;
  context: string;
  breakdown: { label: string; amount: Yen }[];
  formulas: string[];
  params: { label: string; value: string; source: string; version: string; appliesFrom: string }[];
  note: string | null;
}

/** FP顧問料の ON/OFF（主画面の対策）の一文。顧客に見せてよい項目だけ（料金表の写しの印などは含めない） */
export interface FeeLine {
  on: boolean;
  parts: VerdictPart[];
}

// ---- 万一の想定の画面（6.3）----

/** 必要保障額の推移（構成員1人。「この年に亡くなったら」） */
export interface ProtectionChartModel {
  /** 提示用の鍵（self・spouse） */
  key: string;
  /** 例: 「ご主人が亡くなった場合」 */
  title: string;
  /** 例: 「奥様の平均余命（2071年）までの資金」 */
  sub: string;
  years: number[];
  /** 亡くなる人の年齢（各年12月末） */
  ages: (number | null)[];
  /** 金融資産を含まない必要保障額 */
  need: Yen[];
  /** 金融資産を含む（差し引いた）必要保障額 */
  needWithAssets: Yen[];
  /** 加入中の死亡保険金 */
  coverage: Yen[];
  /** 不足（金融資産を含む額が死亡保険金を上回る）がいちばん大きい年。無ければ null */
  maxShort: { year: number; amount: Yen } | null;
  /** 2028年4月以後に亡くなる年の遺族年金は見直し前の制度で計算している（その最初の年） */
  reformFrom: number | null;
}

export interface BreakdownRowModel {
  label: string;
  /** 万一の翌年の額（万一なしとの差） */
  firstYear: Yen;
  /** 累計（万一なしとの差） */
  total: Yen;
  group: "income" | "expense" | "net";
}

export interface ScenarioModel {
  /** 例: 「ご主人が2027年に亡くなった場合」 */
  title: string;
  headline: Headline;
  verdict: Verdict;
  /** proposal＝万一の場合、current＝万一なし */
  chart: ChartModel;
  breakdown: { firstYearLabel: string; totalLabel: string; rows: BreakdownRowModel[] };
  /** 障害年金の65歳からの組み合わせの一文（障害の想定だけ） */
  choice: string | null;
  notices: string[];
}

export interface ContingencyModel {
  protection: { status: "loading" | "ready" | "error"; charts: ProtectionChartModel[]; error: string | null; ms: number | null };
  scenarios: { key: string; label: string }[];
  selected: string;
  year: number;
  yearOptions: { value: number; label: string }[];
  scenario: { status: "loading" | "ready" | "error"; model: ScenarioModel | null; error: string | null; stale: boolean };
}
