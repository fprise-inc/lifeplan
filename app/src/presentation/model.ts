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
  /** 基準の案と違うマス（差を表示しているときだけ付ける） */
  changed?: boolean;
}

export type TableRowModel =
  | { kind: "age"; key: string; label: string; ages: (number | null)[] }
  /** ライフイベント（年ごとのできごと。丸の漢字と説明。グラフの下の丸と同じ） */
  | { kind: "events"; key: string; label: string; events: EventChip[][] }
  | { kind: "group"; key: string; label: string }
  | { kind: "value" | "total"; key: string; label: string; cells: TableCellModel[]; evidence: boolean }
  /** 基準との差の行（選んだ案−基準。年間収支と金融資産残高の下） */
  | { kind: "diff"; key: string; label: string; cells: (Yen | null)[] };

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

/** 主画面の結論の1文（例: 「B案は100歳まで足ります」＋「A案（基準）は80歳で資産が尽きます」） */
export interface ResultVerdict {
  tone: "up" | "down" | "flat";
  parts: VerdictPart[];
  /** 2行目（基準の案のこと・表示の設定で選んだ数字）。無ければ空 */
  sub: VerdictPart[];
}

/** 線の呼び方（グラフ・表・1文）。例: 選んだ案「B案」・基準の案「A案」 */
export interface SeriesNames {
  selected: string;
  base: string;
  /** 選んだ案が基準の案と同じ（線は1本） */
  same: boolean;
}

/** 表示の設定で選んだ「○歳時点の金融資産」の印（グラフに縦の点線と2つの点） */
export interface AgeMark {
  year: number;
  /** 例: 「95歳」 */
  label: string;
}

export interface PresentationModel {
  members: MemberChip[];
  /** 例: 「2026年10月時点」 */
  asOf: string;
  headline: Headline;
  verdict: Verdict;
  /** 主画面の結論の1文（選んだ案と基準の案） */
  result: ResultVerdict;
  names: SeriesNames;
  /** proposal＝選んだ案、current＝基準の案 */
  chart: ChartModel;
  /** 収支の推移（選んだ案） */
  flows: FlowChartModel;
  /** 資産と負債の推移（選んだ案） */
  balance: BalanceChartModel;
  /** 基準の案の線（年間収支・純資産）。収支・資産と負債のグラフに点線で重ねる */
  baseLines: { net: Yen[]; netWorth: Yen[] };
  /** 基準の案の積み上げと年のイベント（グラフを左右に並べる表示で、基準の案の側に使う） */
  baseCharts: BaseCharts;
  /** 本人の呼び方（例: ご主人）。グラフの年の札に使う */
  who: string;
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

/** 基準の案の収支・資産と負債の積み上げと、年のイベント */
export interface BaseCharts {
  flows: FlowChartModel;
  balance: BalanceChartModel;
  events: EventChip[];
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
  /** グラフの年齢の人の呼び方（例: 「ご主人」。chart.ages はこの人の年齢） */
  who: string;
  headline: Headline;
  verdict: Verdict;
  /** proposal＝万一の場合、current＝万一なし */
  chart: ChartModel;
  breakdown: { firstYearLabel: string; totalLabel: string; rows: BreakdownRowModel[] };
  /** 障害年金の65歳からの組み合わせの一文（障害の想定だけ） */
  choice: string | null;
  notices: string[];
}

/** 万一の画面の場面の帯のカード（主画面の案の帯と同じ見た目） */
export interface ScenarioCardModel {
  /** 画面の鍵（death:self など。物の ID を含まない） */
  key: string;
  /** 例: 「ご主人の死亡」 */
  label: string;
  /** カードの名前（例: 「ご主人が亡くなったら」） */
  title: string;
  /** 小さな状態の札（例: 「保障の不足 最大5,482万円」）。tone の wait は灰の札 */
  status: string;
  tone: "ok" | "ng" | "wait";
  /** 計算中（短い計算では「計算しています」を出さないため、札を空けておく） */
  loading: boolean;
  /** その人が亡くなった場合の必要保障額の推移のグラフの鍵（ProtectionChartModel.key。無ければ null） */
  protection: string | null;
}

/** 年ごとの結果の帯の1マス（その年に起きた場合） */
export interface YearCellModel {
  year: number;
  /** 対象の人のその年の年齢 */
  age: number | null;
  /** ok: 最後まで足りる／short: 途中で不足／pending: 計算中／error: 計算できない */
  state: "ok" | "short" | "pending" | "error";
  /** 資産が尽きる年（short のとき） */
  shortYear: number | null;
  /** 先出し（確定前）の結果か */
  provisional: boolean;
  /** 読み上げ（例: 「2031年（ご主人42歳）に起きた場合、2045年に資産が不足」） */
  label: string;
}

/** 年ごとの結果の帯 */
export interface YearStripModel {
  /** 年齢の人の呼び方（例: 「ご主人」） */
  who: string;
  cells: YearCellModel[];
  /** 全体の一言（例: 「2027〜2050年のどの年に起きても、最後まで資産は足ります」） */
  summary: string;
  tone: "ok" | "short" | "wait";
  done: number;
  total: number;
  /** 前提を動かしている途中（帯は指を離してから計算し直す） */
  stale: boolean;
}

export interface ContingencyModel {
  protection: { status: "loading" | "ready" | "error"; charts: ProtectionChartModel[]; error: string | null; ms: number | null };
  scenarios: ScenarioCardModel[];
  selected: string;
  year: number;
  /** 年ごとの結果の帯（起きる年を1年ずつ選ぶ） */
  strip: YearStripModel;
  scenario: { status: "loading" | "ready" | "error"; model: ScenarioModel | null; error: string | null; stale: boolean };
}

// ---- 主画面のグラフの切り替え（収支の推移・資産と負債の推移）----

/** 積み上げの1つの系列（例: 給与・生活費）。pattern は色だけに頼らないための塗りの模様の名前 */
export interface StackSeries {
  key: string;
  label: string;
  values: Yen[];
}

/** 収支の推移: 年ごとの収入（上に積む）と支出（下に積む）。赤字（年間収支がマイナス）の年は「▲」で示す */
export interface FlowChartModel {
  title: string;
  years: number[];
  ages: (number | null)[];
  income: StackSeries[];
  expense: StackSeries[];
  /** 年間収支（収入−支出−税・社会保険料） */
  net: Yen[];
}

/** 資産と負債の推移: 資産（上に積む）と負債（下に積む）、純資産（資産−負債）の線 */
export interface BalanceChartModel {
  title: string;
  years: number[];
  ages: (number | null)[];
  assets: StackSeries[];
  debts: StackSeries[];
  /** 預金の不足（金融資産のマイナス。赤の斜線で下に積む） */
  shortfall: Yen[];
  netWorth: Yen[];
}

// ---- 案の比較 ----

export interface CompareCell {
  text: string;
  /** 基準の案との差（例: 「+1,200万円」）。基準の列は null */
  diff: string | null;
  /** 悪いほう（不足・減る）に目立たせる */
  bad: boolean;
}

export interface CompareTableModel {
  /** 差の見出し（例: 「基準（A案）より」） */
  diffLabel: string;
  columns: { name: string; style: number; base?: boolean }[];
  rows: { key: string; label: string; cells: CompareCell[] }[];
}

// ---- 説明モード（面談で、グラフを1段ずつ積み上げて見せる）----

export type ExplainStepKey = "income" | "pension" | "expense" | "education" | "housing" | "assets";

export interface ExplainStep {
  key: ExplainStepKey;
  title: string;
  /** 短い説明の一文（数字は計算の結果から作る） */
  sentence: VerdictPart[];
}

export interface ExplainModel {
  title: string;
  years: number[];
  ages: (number | null)[];
  /** 給与・退職金などの収入（年金を除く） */
  work: Yen[];
  pension: Yen[];
  /** 生活費・税と社会保険料・保険料など（教育・住宅を除く支出） */
  living: Yen[];
  education: Yen[];
  housing: Yen[];
  financial: Yen[];
  steps: ExplainStep[];
}

// ---- 主画面の案の帯 ----

/** 案の帯のカード1枚。key は提示用の鍵（A・B…の文字。物の ID は含まない） */
export interface PlanCardModel {
  key: string;
  /** 例: 「B」 */
  letter: string;
  name: string;
  /** 資産が足りなくなる年齢（足りれば null）。計算中は undefined */
  shortAge: number | null | undefined;
  /** 例: 「100歳まで足りる」「80歳で不足」「計算しています」 */
  status: string;
  base: boolean;
  shown: boolean;
  /** 保存していない変更がある */
  modified: boolean;
  /** 表示の設定で選んだ数字（既定では出さない） */
  metrics: { label: string; text: string; neg: boolean }[];
}

export interface PlanBandModel {
  cards: PlanCardModel[];
  /** 基準の案の選択肢 */
  baseOptions: { key: string; label: string }[];
  base: string;
  /** 「＋ この案を元に作る」の下の小さな文（例: 「B案を写して動かす」） */
  addNote: string;
}
