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
  /** 例: 「ご本人95歳時点の金融資産（提案）」 */
  label: string;
  amount: Yen;
  /** 提案−現状 */
  diff: Yen;
  currentAmount: Yen;
  /** 例: 「ご本人76歳で不足」 */
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

/** 資産が尽きる年（グラフの「!」の段に出す。札の文はグラフの側で年と年齢から作る） */
export interface Depletion {
  series: "proposal" | "current";
  year: number;
}

/**
 * 年の目盛りの下の年齢の段（1人分）。夫婦の世帯は本人・配偶者の2段、単身の世帯は本人の1段（どの世帯でもこの形。表示の切り替えは無い）。
 * いない年（亡くなったあと・まだ生まれていない年）は null（その人の段を空ける）
 */
export interface AgeAxisRow {
  /** 段の頭に小さく書く呼び方（例: 「ご本人」「配偶者」） */
  label: string;
  ages: (number | null)[];
}

export interface ChartModel {
  years: number[];
  /** 本人の年齢（「!」の札の文などに使う） */
  ages: (number | null)[];
  /** x 軸の下に添える年齢の段（本人・配偶者） */
  axis: AgeAxisRow[];
  /** 年ごとの家族全員の年齢（例: 「ご本人64歳・配偶者62歳・第1子35歳」）。年を指したとき・固定したときの札に出す */
  family: string[];
  proposal: Yen[];
  current: Yen[];
  depletions: Depletion[];
  /**
   * 選んだプラン（proposal）・基準のプラン（current）の表が、この年（現状の表の年）より前に終わるとき、値のある年の数。
   * その後の年は値の無い年で、線と塗りをそこで終える（0 円として描かない）。省略は最後の年まで値がある
   */
  proposalEnds?: number;
  currentEnds?: number;
}

export interface YearDetail {
  year: number;
  members: string;
  income: Yen;
  expense: Yen;
  net: Yen;
  financial: Yen;
}

export type EventIcon = "学" | "独" | "退" | "年" | "家" | "親" | "不" | "！";

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
  | { kind: "value" | "total"; key: string; label: string; cells: TableCellModel[]; evidence: boolean; children?: TableChildRow[]; note?: string }
  /** 基準との差の行（選んだ案−基準。年間収支と金融資産残高の下）。参考の行（世帯のお金の流れに入らない差）にも使う */
  | { kind: "diff"; key: string; label: string; cells: (Yen | null)[]; note?: string };

/** 表の行を開くと出る子の行（行の左の「▸」。行の中身を物ごと・出どころごとに分けた額。根拠は出さない） */
export interface TableChildRow {
  key: string;
  label: string;
  cells: TableCellModel[];
}

export interface CashflowTableModel {
  title: string;
  years: number[];
  rows: TableRowModel[];
}

export interface GoalCard {
  category: string;
  priority: "必ず" | "できれば";
  title: string;
  when: string;
  amount: Yen | null;
  /** 準備できているか（null は未入力の「やりたいこと」のカード） */
  ready: boolean | null;
  /** 不足のときの文（例: 「2061年から資金が不足」） */
  shortNote: string | null;
  /** 夢プランの1件（0103）: 順位と、計算に入れているか（今の見方で）。額は amount（未入力は null） */
  dream?: { rank: number; included: boolean };
}

export interface GoalsModel {
  needTotal: number;
  needReady: number;
  cards: GoalCard[];
  /** 夢のひとことの要約（「夢をすべて入れても100歳まで足ります」など。夢が無い・計算中は null。0103） */
  dreamLine: string | null;
  /** 子が返す貸与の奨学金の書き添え（世帯の収支に入れていない返済。子ごとに1文。無ければ空。0104） */
  childRepaid?: string[];
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
  /** 基準の案の線（年間収支）。収支のグラフに点線で重ねる */
  baseLines: { net: Yen[] };
  /** 基準の案の積み上げと年のイベント（グラフを左右に並べる表示で、基準の案の側に使う） */
  baseCharts: BaseCharts;
  /** 本人の呼び方（例: ご本人）。グラフの年の札に使う */
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

/** 基準の案の収支の積み上げと、年のイベント */
export interface BaseCharts {
  flows: FlowChartModel;
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
  /** 例: 「ご本人が亡くなった場合」 */
  title: string;
  /** 例: 「配偶者の平均余命（2071年）までの資金」 */
  sub: string;
  years: number[];
  /** 亡くなる人の年齢（各年12月末） */
  ages: (number | null)[];
  /** x 軸の下に添える年齢の段（本人・配偶者） */
  axis: AgeAxisRow[];
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
  /** 気づき（保険が切れる年と、その年の不足。0055・0071 の追記） */
  insights: ProtectionInsightModel[];
}

/** 必要保障額の推移の気づき（例: 「2045年に定期保険 1（ご本人）が切れ、その年の不足は1,200万円」） */
export interface ProtectionInsightModel {
  year: number;
  text: string;
}

/** 内訳の行の中の契約ごとの額（大きな病気の場面の保険金・給付金。0055・0071 の追記） */
export interface BenefitDetailModel {
  /** 例: 「医療保険 1（ご本人）」 */
  label: string;
  /** 給付ごとの額（例: 「入院 20日 20万円」「手術 1回 10万円」。画面では「＋」でつなぐ） */
  parts: string[];
  firstYear: Yen;
  total: Yen;
}

export interface BreakdownRowModel {
  label: string;
  /** 万一の翌年の額（万一なしとの差） */
  firstYear: Yen;
  /** 累計（万一なしとの差） */
  total: Yen;
  group: "income" | "expense" | "net";
  /** 契約ごとの内訳（大きな病気の場面の保険金・給付金だけ） */
  details?: BenefitDetailModel[];
}

export interface ScenarioModel {
  /** 例: 「ご本人が2027年に亡くなった場合」 */
  title: string;
  /** グラフの年齢の人の呼び方（例: 「ご本人」。chart.ages はこの人の年齢） */
  who: string;
  headline: Headline;
  verdict: Verdict;
  /** proposal＝万一の場合、current＝万一なし */
  chart: ChartModel;
  /** note は表の下の一文（大きな病気の場面の保険金・給付金の数え方。無ければ null） */
  breakdown: { firstYearLabel: string; totalLabel: string; rows: BreakdownRowModel[]; note?: string | null };
  /** 障害年金の65歳からの組み合わせの一文（障害の想定だけ） */
  choice: string | null;
  notices: string[];
}

/** 万一の画面の場面の帯のカード（主画面の案の帯と同じ見た目） */
export interface ScenarioCardModel {
  /** 画面の鍵（death:self など。物の ID を含まない） */
  key: string;
  /** 例: 「ご本人の死亡」 */
  label: string;
  /** カードの名前（例: 「ご本人が亡くなったら」） */
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
  /** 読み上げ（例: 「2031年（ご本人42歳）に起きた場合、2045年に資産が不足」） */
  label: string;
}

/** 年ごとの結果の帯 */
export interface YearStripModel {
  /** 年齢の人の呼び方（例: 「ご本人」） */
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

// ---- 主画面のグラフの切り替え（収支の推移）----

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
  /** 全部のプランを色分けで重ねる表示の色の番号（0: 現状、1〜5。プランごとに決まっていて、基準や帯の並びを変えても変わらない） */
  colorIndex: number;
}

/**
 * 全部の案を色分けで重ねる表示の1本（帯の順。現状を含め最大6本）。案の名前と数字だけ（物の ID・メモは含まない）。
 * key は帯のカードと同じ提示用の鍵（A・B…の文字）
 */
export interface PlanLineModel {
  key: string;
  /** 例: 「プランB」 */
  name: string;
  /** 例: 「65歳まで働く」 */
  title: string;
  base: boolean;
  selected: boolean;
  /** 線の色の番号（帯のカードの colorIndex と同じ） */
  colorIndex: number;
  /** 金融資産（計算中は null） */
  financial: Yen[] | null;
  /** 年間収支 */
  net: Yen[] | null;
  /**
   * このプランの表が、グラフの年（現状の表の年）より前に終わるとき、値のある年の数（financial・net の先頭からこの数まで）。
   * その後の年は値の無い年で、線をそこで終える（0 円として描かない）。省略は最後の年まで値がある
   */
  ends?: number;
  /** 資産が尽きる年の番号（使えるお金で払えなくなる年。workspace/present.ts の depletionYear。-1 は尽きない）。省略は金融資産がはじめてマイナスになる年（0179） */
  short?: number;
}

export interface PlanBandModel {
  cards: PlanCardModel[];
  /** 基準の案の選択肢 */
  baseOptions: { key: string; label: string }[];
  base: string;
  /** 「＋ この案を元に作る」の下の小さな文（例: 「B案を写して動かす」） */
  addNote: string;
}

// ---- 資産運用（0026）: 資産の推移のグラフに重ねるもの ----

/** 運用の期間の帯（積み立てる・据え置く・取り崩す）。位置は years の番号 */
export interface InvestBandModel {
  /** 積み立てる帯の終わり（この番号の年から据え置く。積立が無ければ 0） */
  accumEnd: number;
  /** 取り崩しを始める年の番号（取り崩しの予定が無ければ null） */
  wdStart: number | null;
  /** 積立をやめる年齢（本人）と、取り崩しを始める年齢 */
  stopAge: number;
  wdAge: number | null;
  /** 積立をやめる年が空欄（退職の年まで・推定） */
  estimated: boolean;
  /** 積立額が変わる年（番号）と、その期間の額の札（例: 「月7.7万」） */
  steps: { at: number; label: string }[];
  /** 帯の文字（例: 「積み立てる 45〜59歳」「据え置く」「60〜64歳」「取り崩す」「65歳〜 月17万円」） */
  accumText: string;
  holdText: string;
  holdSub: string;
  wdText: string;
  wdSub: string;
  /** 帯の切れ目を動かせる年齢の範囲 */
  minAge: number;
  maxAge: number;
}

/** 相場が下がった場合の線1本 */
export interface StressLineModel {
  key: "drop" | "low" | "minus1";
  /** 例: 「退職の直後に株などが3割下がる」 */
  label: string;
  /** 金融資産（計算中は null） */
  values: Yen[] | null;
  /** 例: 「89歳まで持つ」 */
  lasts: string;
}

export interface InvestChartModel {
  /** 口座の内訳（選んだプラン。下から 預金・まだ分けていない・iDeCo/DC・NISA・課税口座など）。合計の入れ方のときは null */
  breakdown: StackSeries[] | null;
  band: InvestBandModel | null;
  stress: StressLineModel[] | null;
  /** 表示の設定（口座の内訳・運用の期間の帯）と、一時的に外した相場の線 */
  view: { breakdown: boolean; band: boolean; stressHidden: readonly string[] };
}

// ---- 資産と負債のタブ（家計のバランスシート）----

/** 資産の4つの分け方（すぐ使える・値動きあり・引き出せない・換金しにくい）と、負債の2つ（住宅ローン・その他の負債） */
export type BsGroupKey = "liquid" | "market" | "locked" | "illiquid" | "mortgage" | "propertyLoan" | "debt";

/** 箱の中の項目（例: 預金・NISA・持ち家（土地・建物）・資金の不足）。key は提示用の鍵（物の ID を含まない） */
export interface BsLineModel {
  key: string;
  label: string;
  group: BsGroupKey;
  amount: Yen;
}

/** 推移のつまみの上の札・この年の出来事の種類 */
export type BsMarkKind = "retire" | "pension" | "loan" | "short" | "neg" | "other";

/** その年の年末のバランスシート（1つのプラン） */
export interface BsYearModel {
  year: number;
  /** 本人の年齢 */
  age: number | null;
  /** 例: 「ご本人45歳・配偶者43歳」 */
  members: string;
  /** 今の年（入力した値から出した事実）。先の年は見込み */
  fact: boolean;
  /** 0 より大きい項目（分け方の順） */
  lines: BsLineModel[];
  totalAssets: Yen;
  /** 負債の合計（資金の不足を含む） */
  totalLiabilities: Yen;
  /** 資産の合計−負債の合計 */
  netWorth: Yen;
  /** 金融資産（すぐ使える・値動きあり・引き出せないの合計） */
  financial: Yen;
  /** 資金の不足（金融資産が尽きた後の足りない分。負債の側に積む） */
  shortfall: Yen;
  /** その年の生活費（年額。家計の体力の目安の「何か月分」に使う） */
  living: Yen;
  /** living のうち車の費用（燃料・駐車場など、生活費の行に入る車の分。年額。「基本生活費 月30万円＋車 月3万円」と分けて見せる。任意） */
  livingCar?: Yen;
  /** その年のローンの返済（年額。住宅ローン・車のローン・奨学金・ほかのローン。家賃収入で返す住まい以外の不動産のローンは除く。
   * 家計の体力の目安の分母を「生活費＋ローン返済」にしたときに使う。0105） */
  loanPay: Yen;
  /** 会社の借入の連帯保証の額（役員として働く人の今の額。今の年だけ。先の年と保証の無い世帯は 0。負債の合計には入れない。0105） */
  guarantee: Yen;
  /** 純資産の箱の中の内訳（任意。会社と合わせたバランスシートの1枚の「会社の財産」「個人の財産」など。どれも0以上で、合計は純資産。0107） */
  netParts?: { key: string; label: string; amount: Yen }[];
  /** この年の出来事（例: 退職・住宅ローン完済） */
  events: { kind: BsMarkKind; text: string }[];
  /** 箱を押したときの説明（分け方ごと・純資産・純資産のマイナス） */
  notes: Partial<Record<BsGroupKey | "netWorth" | "neg", string>>;
}

/** 1つのプランのバランスシート（今の年から表の最後の年まで） */
export interface BsPlanModel {
  /** 帯の文字（提示用の鍵） */
  key: string;
  letter: string;
  /** 例: 「プランB」 */
  name: string;
  /** 例: 「65歳まで働く」 */
  title: string;
  base: boolean;
  years: BsYearModel[];
  /** 推移の年の目盛りの下に添える年齢の段（本人・配偶者。years と同じ並び） */
  axis: AgeAxisRow[];
  /** つまみの上の札（退職・ローン完済・資金が不足・純資産マイナス）。index は years の番号 */
  marks: { index: number; kind: BsMarkKind; label: string }[];
  /** 主な年へ（今・10年後・退職の年・75歳）。範囲の外は入れない */
  jumps: { key: "now" | "ten" | "retire" | "age75"; label: string; index: number }[];
  /** 時点を並べるときの候補（今・5年後・…・子の独立・ローン完済・退職の年・65歳 …）。この世帯・このプランで範囲の中にあるものだけ */
  points: BsPointModel[];
  /** 帯の小さな状態（例: 「86歳で資金が不足」） */
  status: { text: string; ok: boolean };
}

/**
 * 時点を並べるときの時点の候補の鍵。年齢は本人の年齢。
 * now: 今／y5・y10・y20: ○年後／childIndep: 子の独立（一番下の子が世帯から抜ける年）／loanEnd: 住宅ローンの完済の年／
 * retire: 退職の年／pension: 年金の受け取りが始まる年／age65 … age90: 本人がその年齢の年
 */
export type BsPointKey = "now" | "y5" | "y10" | "y20" | "childIndep" | "loanEnd" | "retire" | "pension" | "age65" | "age70" | "age75" | "age80" | "age85" | "age90";

/** 時点の候補（このプランで解いた年）。index は years の番号 */
export interface BsPointModel {
  key: BsPointKey;
  /** 例: 「退職の年」「75歳」 */
  label: string;
  index: number;
}

/** 並べる時点の1つ: 候補の鍵（プランごとに年を解く。退職の年を動かすと付いてくる）か、決まった年 */
export type BsColumn = { point: BsPointKey } | { year: number };

/** 家計の体力の目安の「何か月分」の分母（living 生活費・livingLoan 生活費＋ローン返済。0105） */
export type BsGuideBasis = "living" | "livingLoan";

/** 家計の体力の目安の幅（事務所の設定。FP が変えられる） */
export interface BsGuide {
  /** 「何か月分」の分母。省略は世帯から決める（役員として働く人のいる世帯は生活費＋ローン返済、ほかは生活費。BalanceTabModel.guideBasis） */
  basis?: BsGuideBasis;
  /** すぐ使えるお金が生活費の何か月分か（下限・上限） */
  months: [number, number];
  /** 資産のうち値動きのある資産の割合（%。下限・上限） */
  risk: [number, number];
  /** 負債の重さ（負債 ÷ 資産。%）の目安の上限（未満） */
  debt: number;
}

/** 前回と比べる: 控えで見込んでいた今と、今の実際 */
export interface BsPrevModel {
  key: string;
  /** 例: 「2025年10月の控え（手動）」 */
  label: string;
  /** 例: 「1年前」 */
  ago: string;
  /** 控えで見込んでいた今のバランスシート（出せないときは null と理由） */
  expected: BsYearModel | null;
  reason: string | null;
  actual: BsYearModel;
  /** 差の1文 */
  summary: VerdictPart[];
  /** 差の大きい項目（例: 「預金が見込みより130万円少ない」） */
  items: string[];
}

/**
 * カスタマイズで足す見るもの（例: 合算BS）の差し込み口。カスタム層の計算部品が値を出し、画面は同じ図の部品で並べて描く（0027）。
 * 今は公式の画面からは作らない。何も足していなければ、タブの上の「見るもの」の切り替えは行ごと出さない
 */
/** 見るものの1枚（名前と、BsYearModel の形の BS。sub は名前の下の小さな説明） */
export interface BsCustomColumn {
  name: string;
  sub?: string;
  at: BsYearModel;
}

/** 見るものの欄（宣言型。値は文字で持ち、作業の層へ返す。0107。後でカスタム層の入力欄 fields/ に移せる形） */
export interface BsCustomField {
  id: string;
  label: string;
  /** yen: 万円の数（negative なら「−」も入る）・month: 年月（YYYY-MM）・choice: 選ぶ・check: 印 */
  kind: "yen" | "month" | "choice" | "check";
  value: string;
  unit?: string;
  help?: string;
  placeholder?: string;
  negative?: boolean;
  options?: { value: string; label: string }[];
}

/** 図の下に並べる表・文（宣言型） */
export interface BsCustomSection {
  key: string;
  title: string;
  note?: string;
  table?: { head: string[]; rows: { cells: string[]; tone?: "total" | "muted" }[] };
  lines?: string[];
  field?: BsCustomField;
}

/**
 * カスタマイズで足す見るもの（0027 の8。例: 会社と合わせたバランスシート）。columns だけなら同じ図の部品で共通の縮尺で並べる。
 * steps・sections・form・notices は任意（0107 で足した。値を作るのは作業の層の部品で、画面は受け取ったものを出すだけ）
 */
export interface BsCustomViewModel {
  key: string;
  /** 例: 「合算BS」 */
  label: string;
  /** 並べる図（例: 会社・経営者個人（家計）・合算）。共通の縮尺で描く */
  columns: BsCustomColumn[];
  note: string;
  /** 見出しの下の説明の1文（任意） */
  lead?: string;
  /** 段を切り替えて見せる（任意。例: ①並べる・②相殺・③合算）。あれば columns の代わりに選んだ段の図を出す */
  steps?: { key: string; label: string; columns: BsCustomColumn[]; note: string }[];
  /** 共通の縮尺（任意。段をまたいでそろえる。無ければ並べる図から） */
  scale?: Yen;
  /** 分け方の名前の置き換え（任意。会社の科目を並べるときなど） */
  groups?: Partial<Record<BsGroupKey, { name: string; short: string }>>;
  /** お知らせ（任意。落ち着いた文） */
  notices?: string[];
  /** 図の下の表・文（任意） */
  sections?: BsCustomSection[];
  /** 入力欄（任意。open は最初から開いておくか） */
  form?: { title: string; note: string; open: boolean; groups: { title: string; note?: string; fields: BsCustomField[] }[] };
  /** 入力が足りず図を出せないときの文（任意。あれば図の代わりに出す） */
  empty?: string;
}

export interface BalanceTabModel {
  /** 本人の呼び方（例: ご本人） */
  who: string;
  /** 分け方の名前と短い名前 */
  groups: Record<BsGroupKey, { name: string; short: string }>;
  /** 帯の順（現状を含む）。計算が済んだプランだけ */
  plans: BsPlanModel[];
  selected: string;
  base: string;
  guide: BsGuide;
  /** 分母を選んでいないときの分母（役員として働く人のいる世帯は生活費＋ローン返済、ほかは生活費。0105） */
  guideBasis: BsGuideBasis;
  /** 時点を並べるときの既定の時点（事務所の設定。2〜4つ） */
  pointDefaults: BsPointKey[];
  /** この世帯で選んだ並べる時点（2〜4つ）。null は既定のまま */
  columns: BsColumn[] | null;
  /** 既定の時点の候補（選ぶ画面の順。世帯によっては無い時点もある） */
  pointChoices: readonly { key: BsPointKey; label: string; note: string }[];
  /** 控え（新しい順）。空なら「前回と比べる」を出さない */
  prevChoices: { key: string; label: string }[];
  prev: { status: "idle" | "loading" | "ready"; model: BsPrevModel | null };
  /** カスタマイズで足した見るもの（今は空。空なら「見るもの」の切り替えを出さない） */
  customViews: BsCustomViewModel[];
  /** 見られなくなった見るものの知らせ（任意。例: 機能を有効にするコードの期限が切れた。0110）。落ち着いた1文で、図の上に出す */
  hiddenNote?: string;
  provisional: boolean;
}

// ---- お金の3つの分け方（説明用の図。0032）----
// 形は提案書と共用の部品（report/src/moneyThree.ts）が決める（アプリの区画・持ち帰り用のレポート・提案書で同じ並び・同じ言葉にするため）
export type { MoneyThreeBox, MoneyThreeItem, MoneyThreeKey, MoneyThreeModel, MoneyThreePlace, MoneyThreeRow, MoneyThreeSettings, MoneyThreeWording } from "../../../report/src/moneyThree.ts";

// ---- 収益不動産のタブ（物件ごと・年ごとの分析の数字。0082）----
// 値はすべて作業の層（workspace/rentalTab.ts）が書式まで当てた文字にして渡す。提示層は並べるだけ

/** 指標の1つ（例: 表面利回り 5.4%）。help は「?」の中の説明 */
export interface RentalMetricModel {
  key: string;
  label: string;
  value: string;
  help: string;
}

/** 年ごとの表（列と行。金額は万円の文字） */
export interface RentalTableModel {
  columns: { key: string; label: string }[];
  rows: { year: number; cells: string[]; deadCross: boolean; negative: boolean[] }[];
}

/**
 * 年ごとの手残りとローン残高のグラフ（年は下の年ごとの表と同じ。0128）。金額は円。
 * 手残りは棒（税引前・税引後）、ローン残高は線（右の目盛り）。events は物件の売却・大きな修繕の「不」の印（結果のタブの出来事と同じ文）
 */
export interface RentalChartModel {
  years: number[];
  /** 年の目盛りの下の年齢の段（結果のタブのグラフと同じ） */
  axis: AgeAxisRow[];
  /** 年を指したときの札の見出しの家族の年齢 */
  family: string[];
  before: Yen[];
  after: Yen[];
  /** ローン残高（ローンの無い物件・全物件でローンが無いときは null。線と右の目盛りを出さない） */
  loan: Yen[] | null;
  /** 年を指したときの札の金額（下の表と同じ書き方の万円の文字。「▲」つき） */
  text: { before: string[]; after: string[]; loan: string[] };
  events: EventChip[];
}

/** 売る年を変えた比べの1行 */
export interface RentalSaleRowModel {
  /** 売り方の鍵（この売り方でプランを作るときに渡す） */
  key: string;
  label: string;
  current: boolean;
  net: string;
  financialEnd: string;
  diff: string;
  equityEnd: string;
}

/** 売る年を変えた比べ（null は比べる売り方が無い） */
export type RentalSaleModel = { status: "loading" } | { status: "ready"; endYear: number; rows: RentalSaleRowModel[] } | { status: "error" };

/** 物件1件の見るもの */
export interface RentalPropertyViewModel {
  kind: "property";
  key: string;
  /** 見出し（物件名（種類）） */
  title: string;
  /** 見出しの1行の事実（名義・構造・築年・取得） */
  facts: string[];
  /** 指標を見る年 */
  year: number;
  metrics: RentalMetricModel[];
  chart: RentalChartModel;
  table: RentalTableModel;
  /** 元金の返済が減価償却費を上回る最初の年（表に印を付ける） */
  deadCross: number | null;
  sale: RentalSaleModel | null;
}

/** 全体（物件が2件以上のとき） */
export interface RentalTotalViewModel {
  kind: "total";
  key: "total";
  year: number;
  /** 物件ごとの1行と合計の行（列は columns） */
  columns: { key: string; label: string }[];
  rows: { key: string; cells: string[] }[];
  totalRow: string[];
  chart: RentalChartModel;
  table: RentalTableModel;
}

export interface RentalTabModel {
  /** 見るもの（全体と物件ごと。物件が1件なら全体は無い） */
  views: { key: string; label: string }[];
  selected: string;
  /** 選んだ見るもの（数字が無ければ null） */
  view: RentalPropertyViewModel | RentalTotalViewModel | null;
  provisional: boolean;
}
