// AI接続口（crates/lifeplan）の表示の設定の一覧（get_display_settings。0213）: 画面の見せ方だけを変える設定の、id・画面と同じ名前・効く所・
// 変える所・値の形・選べる値・既定を、画面の定数からそのまま作る（別の一覧を手で写さない。選べる種類・既定を変えると、接続口の一覧も一緒に変わる）。
// - まとめる道具（scripts/build-explain.ts）が JSON（crates/lifeplan/dist/display-catalog.json）にして、接続口がビルドの時に埋め込む
//   （アプリが起動していなくても、一覧と既定は返せる）。今の値の読み方は display.ts（画面と同じ読み方の関数）
// - 載せるのは、値も計算も変えない見せ方の設定だけ。計算の結果を変える設定（前提条件の標準値・必要保障額の数え方・介護の費用・
//   受け取る予定の相続の見込み・不動産の評価の割合・表の最後の年齢・FP顧問料の料金表・事務所の推定の値）、名前・ロゴ・色・見た目、
//   Web のヒアリングのひな形は載せない（OUT_OF_SCOPE）
// - どの設定でも隠せない物（入力が足りない・計算に入れていないの知らせと、確かめの注意）は NEVER_HIDDEN に書く
import { DEFAULT_OPEN_SCENE, DEFAULT_PREMISE_KINDS, OPEN_SCENES, PREMISE_KINDS, SCENE_KINDS } from "../workspace/contingency/premiseChoice.ts";
import { NOTICE_KINDS } from "../workspace/engineNotices.ts";
import { ALWAYS_SHOWN } from "../workspace/input/itemChoice.ts";
import { STAGE_ORDER } from "../workspace/input/stageOrder.ts";
import { LIVING_LABEL_MAX, LIVING_PARTS_MAX, LIVING_PARTS_MIN, STANDARD_LIVING_LAYOUT, STANDARD_LIVING_NAMES } from "../workspace/office/livingLayout.ts";
import { DEFAULT_LEVER_KINDS, LEVER_KINDS } from "../workspace/plans/leverChoice.ts";
import { BS_COLUMNS_MAX, BS_COLUMNS_MIN, BS_POINT_CHOICES, DEFAULT_BS_GUIDE, DEFAULT_BS_POINTS } from "../workspace/balanceTab.ts";
import { DEFAULT_MONEY_THREE, MONEY_THREE_MONTHS, MONEY_THREE_NAME_CHOICES, MONEY_THREE_YEARS } from "../workspace/moneyThree.ts";
import { AGE_OPTIONS, DEFAULT_BALANCE_SETTINGS, DEFAULT_DISPLAY_SETTINGS, LAYOUT_CHOICES, METRIC_CHOICES } from "../workspace/settings.ts";

export const DISPLAY_CATALOG_SCHEMA = "display-settings-reference@1.0";

/**
 * AI が変える案を出せる設定（propose_display_settings。0215・0213 の段C）: 事務所の既定値のうち見せ方だけの18件（入力・対策・万一のタブの7つと、
 * 結果のタブ・資産と負債のタブの表示の設定の事務所の既定値11件〔workspace/settings.ts の OFFICE_DISPLAY_IDS〕）。世帯だけの設定（この世帯で並べる時点・
 * 対策に足した項目）と読むだけの設定（合算BS）は入れない。並びは一覧の並び。これは事務所の既定値の案（渡された世帯ごとの案は下の
 * HOUSEHOLD_PROPOSABLE_DISPLAY_IDS）
 */
export const PROPOSABLE_DISPLAY_IDS = [
  "input.order",
  "input.items",
  "input.living",
  "result.levers",
  "result.metrics",
  "result.atAge",
  "result.layout",
  "result.invBreakdown",
  "result.invPeriods",
  "contingency.premises",
  "contingency.scenes",
  "contingency.openScene",
  "balance.health",
  "balance.guide",
  "balance.points",
  "balance.moneyThree.wording",
  "balance.moneyThree.months",
  "balance.moneyThree.years",
] as const;
export type ProposableDisplayId = (typeof PROPOSABLE_DISPLAY_IDS)[number];

/**
 * AI が渡された世帯ごとに案を出せる設定（propose_display_settings の share_id。0213 の段B の後半）: 一覧で世帯ごとの値を持つ設定（scope が household・
 * both）のうち、対策に足した項目（result.addedItems。鍵に物の ID が入る）を除いた13件。この世帯で並べる時点（balance.columns）は候補の鍵と決まった年
 * だけの値（物の ID を含まない）なので入れる。本体の受け口の並び（ai_share::display_proposals::HOUSEHOLD_PROPOSABLE_IDS）と同じ（接続口のテストで確かめる）
 */
export const HOUSEHOLD_PROPOSABLE_DISPLAY_IDS = [
  "input.items",
  "result.metrics",
  "result.atAge",
  "result.layout",
  "result.invBreakdown",
  "result.invPeriods",
  "balance.health",
  "balance.guide",
  "balance.points",
  "balance.columns",
  "balance.moneyThree.wording",
  "balance.moneyThree.months",
  "balance.moneyThree.years",
] as const;
export type HouseholdProposableDisplayId = (typeof HOUSEHOLD_PROPOSABLE_DISPLAY_IDS)[number];

/** 選べる値の1つ（value は事務所データ・世帯ファイルに書く値。label は画面と同じ言葉） */
export interface DisplayChoice {
  value: string | number | boolean | null;
  label: string;
  /** 画面の見出し（対策の「資産運用」など・万一の場面） */
  group?: string;
  note?: string;
  /** いつも出す（外せない）入力項目 */
  fixed?: boolean;
}

/**
 * 値の形:
 * - kinds: 選べる値の中から選んだ物の並び（並びは選べる値の順）。min・max は選ぶ数
 * - order: 選べる値の全部の並べ替え
 * - itemChoice: 出さない入力項目（hidden）と、詳細で開く入力項目（levels）
 * - livingLayout: 基本生活費の内訳の行の並び（rowKinds の3種類の行）
 * - choice: 1つ選ぶ・boolean: 出す／出さない・integer: 整数（min〜max）
 * - guide: 家計の体力の目安の幅（fields の4つ）・columns: 並べる時点（候補の鍵か決まった年）・itemKeys: 対策に足した項目の鍵
 */
export type DisplayValueType = "kinds" | "order" | "itemChoice" | "livingLayout" | "choice" | "boolean" | "integer" | "guide" | "columns" | "itemKeys";

export interface DisplaySetting {
  /** 変えない id（画面の区画.設定。一度出した id は別の意味に使い回さない） */
  id: string;
  /** 画面と同じ名前 */
  label: string;
  /** どこで決めるか: office（事務所の既定値。どの世帯にも効く）・household（世帯ごと。世帯ファイルに残る）・both（事務所の既定と世帯ごとの両方） */
  scope: "office" | "household" | "both";
  /** 効く画面 */
  screen: string;
  /** アプリのどこで変えるか（画面と区画の名前） */
  change: { office?: string; household?: string };
  /** どこに書くか（事務所データ・世帯ファイルの本文の欄） */
  stored: { office?: string; household?: string };
  /**
   * 事務所の既定値の効き方: live（どの世帯にもすぐ効く。作った世帯も）・newHouseholds（新しく作る世帯に写すだけ。作った世帯は世帯の値のまま）・
   * followers（事務所の既定値に従う世帯にすぐ効く。その世帯で値を変えた設定と、前からある世帯〔印の無い世帯〕は世帯の値のまま。0213 の段C）
   */
  officeEffect?: "live" | "newHouseholds" | "followers";
  /** お客さまに渡す物に出るか（提案書の PDF・持ち帰り用のレポート） */
  reaches: { proposal: boolean; takeaway: boolean; note?: string };
  type: DisplayValueType;
  choices?: DisplayChoice[];
  min?: number;
  max?: number;
  /** 値の形の補い（guide の欄・livingLayout の行の種類と上限など） */
  shape?: Record<string, unknown>;
  /** 既定（何も選んでいないとき） */
  default: unknown;
  /** 読むだけ（この一覧で変える候補を出す対象にしない） */
  readOnly?: boolean;
  /** AI が変える案を出せる（propose_display_settings。事務所の既定値の見せ方だけの設定。0215） */
  proposable?: boolean;
  /** AI が渡された世帯ごとの案を出せる（propose_display_settings の share_id。世帯ごとの値。0213 の段B の後半） */
  householdProposable?: boolean;
  note?: string;
}

export interface DisplayCatalog {
  schema: string;
  summary: { settings: number; office: number; household: number; both: number };
  settings: DisplaySetting[];
  /** どの設定でも隠せない物 */
  neverHidden: string[];
  /** この一覧に入れていない物（計算の結果を変える設定など） */
  outOfScope: string[];
  /** まだ載せていない、作っている途中の設定 */
  pending: { id: string; label: string; note: string }[];
}

const OFFICE = "世帯の一覧の「事務所の既定値」";
/** 結果のタブ・資産と負債のタブの表示の設定の事務所の既定値の区画（0213 の段C） */
const OFFICE_DISPLAY = `${OFFICE}の区画「結果のタブ・資産と負債のタブの表示の設定」`;
/** 事務所の既定値を持てる表示の設定の、世帯の値の補い */
const FOLLOW_NOTE = "事務所の既定値に従う世帯（新しく作る世帯）は事務所の既定値を読みます。その世帯で値を変えると、その世帯だけの値になります（表示の設定に「この世帯だけ」と「事務所の既定値に戻す」）。前からある世帯は、その世帯の値のままです";
/** 比較の仕方の世帯の値の補い（比較の仕方は表示の設定に印を出さない。0213 の段C） */
const LAYOUT_FOLLOW_NOTE = "事務所の既定値に従う世帯（新しく作る世帯）は事務所の既定値を読みます。その世帯で値を変えると、その世帯だけの値になります（比較の仕方は、表示の設定に「この世帯だけ」の印と「事務所の既定値に戻す」を出しません）。前からある世帯は、その世帯の値のままです";
const RESULT_SETTINGS = "結果のタブのグラフの右上の「表示の設定」";
const BALANCE_SETTINGS = "資産と負債のタブの図の見出しの右の「表示の設定」";
const NO_OUTPUT = { proposal: false, takeaway: false } as const;

/** 家計の体力の目安の「何か月分」の分母（資産と負債のタブの表示の設定の言葉） */
export const GUIDE_BASIS_CHOICES = [
  { value: "living", label: "生活費の何か月分" },
  { value: "livingLoan", label: "生活費＋ローン返済の何か月分" },
] as const;

const stageChoices = (): DisplayChoice[] => STAGE_ORDER.map((s) => ({ value: s.id, label: s.label, ...(ALWAYS_SHOWN.includes(s.id) ? { fixed: true, note: "いつも出します（外せません）" } : {}) }));

/** 結果のタブの表示の設定の欄 → 一覧の id（DisplaySettings の欄すべて。欄を足したら一覧にも足す。テストで確かめる） */
export const RESULT_SETTING_IDS: Readonly<Record<keyof typeof DEFAULT_DISPLAY_SETTINGS, string>> = {
  metrics: "result.metrics",
  atAge: "result.atAge",
  layout: "result.layout",
  invBreakdown: "result.invBreakdown",
  invPeriods: "result.invPeriods",
};

/** 資産と負債のタブの表示の設定の欄 → 一覧の id（BalanceSettings の欄すべて。moneyThree は3つの id） */
export const BALANCE_SETTING_IDS: Readonly<Record<keyof typeof DEFAULT_BALANCE_SETTINGS, readonly string[]>> = {
  health: ["balance.health"],
  guide: ["balance.guide"],
  points: ["balance.points"],
  columns: ["balance.columns"],
  moneyThree: ["balance.moneyThree.wording", "balance.moneyThree.months", "balance.moneyThree.years"],
};

export function buildDisplayCatalog(): DisplayCatalog {
  const settings: DisplaySetting[] = [
    {
      id: "input.order",
      label: "入力のホームの入力項目の並び",
      scope: "office",
      screen: "入力のタブの入力のホーム（入力項目の並び）",
      change: { office: `${OFFICE}の区画「入力のホームの入力項目の並び」（↑↓で並べ替える。「既定の並びに戻す」）` },
      stored: { office: "defaults.layout.order" },
      officeEffect: "live",
      proposable: true,
      reaches: NO_OUTPUT,
      type: "order",
      choices: STAGE_ORDER.map((s) => ({ value: s.id, label: s.label })),
      default: STAGE_ORDER.map((s) => s.id),
      note: "並べ替えるだけで、出す・出さないは「新しい世帯で出す入力項目と、開いたときの入れ方」で決めます",
    },
    {
      id: "input.items",
      label: "新しい世帯で出す入力項目と、開いたときの入れ方",
      scope: "both",
      screen: "入力のタブの入力のホーム（出す入力項目）と、入力項目を開いたときの入れ方（標準／詳細）",
      change: {
        office: `${OFFICE}の区画「新しい世帯で出す入力項目と、開いたときの入れ方」（「既定に戻す」で全部出す・全部「標準」）`,
        household: "入力のタブの入力のホームの「入力項目を選ぶ ▾」（その一覧の下の「この選び方を事務所の既定にする」「事務所の既定にそろえる」も）",
      },
      stored: { office: "defaults.items", household: "household.itemChoice" },
      officeEffect: "newHouseholds",
      proposable: true,
      reaches: NO_OUTPUT,
      type: "itemChoice",
      choices: stageChoices(),
      shape: { hidden: "出さない入力項目の並び（choices の value）", levels: { detail: "詳細", simple: "標準（書かない）" } },
      default: { hidden: [], levels: {} },
      note: "出さない入力項目でも、値が入っていれば出します。出さなくても計算は変わりません（推定か「無し」で計算）。事務所の既定は新しく作る世帯に写し、作った世帯は世帯ごとの選び方のままです",
    },
    {
      id: "input.living",
      label: "基本生活費の内訳の並べ方",
      scope: "office",
      screen: "入力のタブの「基本生活費」の内訳（月額）の行",
      change: { office: `${OFFICE}の区画「基本生活費の内訳の並べ方」` },
      stored: { office: "defaults.living" },
      officeEffect: "live",
      proposable: true,
      reaches: NO_OUTPUT,
      type: "livingLayout",
      choices: Object.entries(STANDARD_LIVING_NAMES).map(([value, label]) => ({ value, label })),
      shape: {
        rowKinds: {
          one: "1つの内訳（名前を変えられる）: {kind: \"one\", category, label?}",
          group: "まとめた行（2つ以上の内訳）: {kind: \"group\", label, categories}",
          split: `分けた行（1つの内訳を${LIVING_PARTS_MIN}〜${LIVING_PARTS_MAX}の行に）: {kind: "split", category, label?, parts: [{label, share?}]}（share は整数の%。どの行にもあって合計100のときだけ使う。無ければ等分）`,
        },
        labelMax: LIVING_LABEL_MAX,
        hiddenRule: "どの行にも無い内訳は隠す（隠した内訳はその他の行に入れる）。その他は隠せず、分けられない",
      },
      default: STANDARD_LIVING_LAYOUT,
      note: "並べ方を変えただけでは、世帯の値も結果も変わりません（計算はいつも10の内訳）",
    },
    {
      id: "result.levers",
      label: "対策に最初から出す項目",
      scope: "office",
      screen: "結果のタブの対策",
      change: { office: `${OFFICE}の区画「対策に最初から出す項目」（見出しごとのチェック。「既定に戻す」）` },
      stored: { office: "defaults.levers（既定の組み合わせとの違いだけ: shown＝足した種類・hidden＝外した種類）" },
      officeEffect: "live",
      proposable: true,
      reaches: NO_OUTPUT,
      type: "kinds",
      choices: LEVER_KINDS.map((k) => ({ value: k.kind, label: k.label, group: k.group === "よく使う" ? "よく使う項目" : k.group, ...("note" in k ? { note: k.note } : {}) })),
      default: [...DEFAULT_LEVER_KINDS],
      note: "最初から出さない項目も、対策の「＋ 動かす項目を追加」でその場で足せます。外した項目も、選んだプランで値を変えていれば出ます（FP顧問料は除く）。ローン・口座ごとの項目は、その世帯の当てはまる物すべてに出ます",
    },
    {
      id: "result.addedItems",
      label: "対策に足した項目",
      scope: "household",
      screen: "結果のタブの対策",
      change: { household: "結果のタブの対策の「＋ 動かす項目を追加」で足し、項目の「外す」で外す" },
      stored: { household: "workspace.shownItems" },
      reaches: NO_OUTPUT,
      type: "itemKeys",
      default: [],
      note: "動かす項目の鍵の並び（足した順）。ローン・口座などの鍵には物の ID が入ります（渡された世帯では共有ごとの仮の ID）。読むだけです（物の ID を含むので、AI からは変えられません）",
    },
    {
      id: "result.metrics",
      label: "出す数字",
      scope: "both",
      screen: "結果のタブのプランの帯・結論の2行目・グラフの印",
      change: { office: OFFICE_DISPLAY, household: `${RESULT_SETTINGS}のチェック` },
      stored: { office: "defaults.display.result.metrics", household: "display.result.metrics（display.followOffice に id があれば事務所の既定値に従う）" },
      officeEffect: "followers",
      proposable: true,
      reaches: { proposal: false, takeaway: false, note: "お客さまと一緒に見る結果のタブに出ます" },
      type: "kinds",
      choices: METRIC_CHOICES.map((c) => ({ value: c.key, label: c.label, note: c.note })),
      default: [...DEFAULT_DISPLAY_SETTINGS.metrics],
      note: `既定では何も足しません。「FP顧問料の一文」は顧問料の契約がある世帯で選べます。${FOLLOW_NOTE}`,
    },
    {
      id: "result.atAge",
      label: "「○歳時点の金融資産」の年齢",
      scope: "both",
      screen: "結果のタブの「○歳時点の金融資産」と、提案書・持ち帰り用のレポートの目標の年齢",
      change: { office: OFFICE_DISPLAY, household: `${RESULT_SETTINGS}の「○歳時点の金融資産」の年齢` },
      stored: { office: "defaults.display.result.atAge", household: "display.result.atAge（display.followOffice に id があれば事務所の既定値に従う）" },
      officeEffect: "followers",
      proposable: true,
      reaches: { proposal: true, takeaway: true, note: "提案書の目標の年齢・持ち帰り用のレポートの「○歳時点」" },
      type: "integer",
      choices: AGE_OPTIONS.map((a) => ({ value: a, label: `${a}歳` })),
      default: DEFAULT_DISPLAY_SETTINGS.atAge,
      note: `画面では、本人の表の最初の年の年齢より前の年齢は選べません。${FOLLOW_NOTE}`,
    },
    {
      id: "result.layout",
      label: "比較の仕方",
      scope: "both",
      screen: "結果のタブのグラフ",
      change: { office: OFFICE_DISPLAY, household: `${RESULT_SETTINGS}の「比較の仕方」` },
      stored: { office: "defaults.display.result.layout", household: "display.result.layout（display.followOffice に id があれば事務所の既定値に従う）" },
      officeEffect: "followers",
      proposable: true,
      reaches: NO_OUTPUT,
      type: "choice",
      choices: LAYOUT_CHOICES.map((c) => ({ value: c.key, label: c.label, note: c.note })),
      default: DEFAULT_DISPLAY_SETTINGS.layout,
      note: LAYOUT_FOLLOW_NOTE,
    },
    {
      id: "result.invBreakdown",
      label: "口座の内訳を表示",
      scope: "both",
      screen: "結果のタブの資産の推移のグラフ（口座ごとの積み上げと、グラフの下の資産の内訳）",
      change: { office: OFFICE_DISPLAY, household: "結果のタブの資産の推移のグラフの上の「□ 口座の内訳を表示」" },
      stored: { office: "defaults.display.result.invBreakdown", household: "display.result.invBreakdown（display.followOffice に id があれば事務所の既定値に従う）" },
      officeEffect: "followers",
      proposable: true,
      reaches: NO_OUTPUT,
      type: "boolean",
      choices: [
        { value: true, label: "表示する" },
        { value: false, label: "表示しない" },
      ],
      default: DEFAULT_DISPLAY_SETTINGS.invBreakdown,
      note: FOLLOW_NOTE,
    },
    {
      id: "result.invPeriods",
      label: "運用の期間を表示",
      scope: "both",
      screen: "結果のタブの資産の推移のグラフの上の運用の期間の帯",
      change: { office: OFFICE_DISPLAY, household: "結果のタブの資産の推移のグラフの上の「□ 運用の期間を表示」" },
      stored: { office: "defaults.display.result.invPeriods", household: "display.result.invPeriods（display.followOffice に id があれば事務所の既定値に従う）" },
      officeEffect: "followers",
      proposable: true,
      reaches: NO_OUTPUT,
      type: "choice",
      choices: [
        { value: null, label: "取り崩しの予定があるときだけ表示する" },
        { value: true, label: "表示する" },
        { value: false, label: "表示しない" },
      ],
      default: DEFAULT_DISPLAY_SETTINGS.invPeriods,
      note: FOLLOW_NOTE,
    },
    {
      id: "contingency.premises",
      label: "想定の前提に最初から出す項目",
      scope: "office",
      screen: "万一のときのタブの想定の前提（選んでいる場面の項目だけ）",
      change: { office: `${OFFICE}の区画「万一のときのタブ」の「想定の前提に最初から出す項目」（場面ごとのチェック。「場面と項目を既定に戻す」）` },
      stored: { office: "defaults.premises（既定の組み合わせとの違いだけ: shown・hidden）" },
      officeEffect: "live",
      proposable: true,
      reaches: NO_OUTPUT,
      type: "kinds",
      choices: PREMISE_KINDS.map((k) => ({ value: k.kind, label: k.label, group: SCENE_KINDS.find((s) => s.kind === k.scene)?.label ?? k.scene, ...("note" in k ? { note: k.note } : {}) })),
      default: [...DEFAULT_PREMISE_KINDS],
      note: "最初から出さない項目も「＋ 動かす項目を追加」でその場で足せます。値を変えた項目は、最初から出さない項目でも出ます",
    },
    {
      id: "contingency.scenes",
      label: "場面の帯に並べる場面",
      scope: "office",
      screen: "万一のときのタブの場面の帯",
      change: { office: `${OFFICE}の区画「万一のときのタブ」の「場面の帯に並べる場面」` },
      stored: { office: "defaults.scenes.hidden（並べない種類）" },
      officeEffect: "live",
      proposable: true,
      reaches: NO_OUTPUT,
      type: "kinds",
      min: 1,
      choices: SCENE_KINDS.map((k) => ({ value: k.kind, label: k.label })),
      default: SCENE_KINDS.map((k) => k.kind),
      note: "1つは並べます",
    },
    {
      id: "contingency.openScene",
      label: "開いたときに選んでおく場面",
      scope: "office",
      screen: "万一のときのタブを開いたとき",
      change: { office: `${OFFICE}の区画「万一のときのタブ」の「開いたときに選んでおく場面」` },
      stored: { office: "defaults.scenes.open" },
      officeEffect: "live",
      proposable: true,
      reaches: NO_OUTPUT,
      type: "choice",
      choices: OPEN_SCENES.map((s) => ({ value: s.key, label: s.label })),
      default: DEFAULT_OPEN_SCENE,
      note: "その世帯で最後に見た場面があれば、そちらを出します。世帯に無い場面・並べない場面のときは、並べる場面の最初です",
    },
    {
      id: "balance.health",
      label: "家計の体力の目安を表示する",
      scope: "both",
      screen: "資産と負債のタブの家計の体力の目安（1年ずつ見るときの図の下の区画）",
      change: { office: OFFICE_DISPLAY, household: `${BALANCE_SETTINGS}の「家計の体力の目安」の「家計の体力の目安を表示する」` },
      stored: { office: "defaults.display.balance.health", household: "display.balance.health（display.followOffice に id があれば事務所の既定値に従う）" },
      officeEffect: "followers",
      proposable: true,
      reaches: { proposal: false, takeaway: false, note: "提案書・持ち帰り用のレポートには、もともと家計の体力の目安を載せていない" },
      type: "boolean",
      choices: [
        { value: true, label: "表示する" },
        { value: false, label: "表示しない" },
      ],
      default: DEFAULT_BALANCE_SETTINGS.health,
      note: `表示しないと、区画ごと出しません（目安の幅の欄も出しません）。値も計算の結果も変わりません。${FOLLOW_NOTE}`,
    },
    {
      id: "balance.guide",
      label: "家計の体力の目安の幅",
      scope: "both",
      screen: "資産と負債のタブの家計の体力の目安",
      change: { office: OFFICE_DISPLAY, household: `${BALANCE_SETTINGS}の「家計の体力の目安の幅」（目安の「目安の幅を変える（表示の設定）」からも開く）` },
      stored: { office: "defaults.display.balance.guide", household: "display.balance.guide（display.followOffice に id があれば事務所の既定値に従う）" },
      officeEffect: "followers",
      proposable: true,
      reaches: NO_OUTPUT,
      type: "guide",
      shape: {
        basis: { choices: GUIDE_BASIS_CHOICES, note: "書かなければ世帯から決める（役員として働く方のいる世帯は生活費＋ローン返済、ほかは生活費）" },
        months: { label: "すぐ使えるお金（か月分。下限・上限）", min: 0, max: 120 },
        risk: { label: "値動きのある資産（%。下限・上限）", min: 0, max: 100 },
        debt: { label: "負債の重さ（%未満。上限）", min: 1, max: 100 },
      },
      default: DEFAULT_BS_GUIDE,
      note: `根拠のある公的な基準ではなく、説明の目安です。${FOLLOW_NOTE}`,
    },
    {
      id: "balance.points",
      label: "「時点を並べる」の既定",
      scope: "both",
      screen: "資産と負債のタブの「時点を並べる」（見出しを変えていない世帯）",
      change: { office: OFFICE_DISPLAY, household: `${BALANCE_SETTINGS}の「「時点を並べる」の既定」` },
      stored: { office: "defaults.display.balance.points", household: "display.balance.points（display.followOffice に id があれば事務所の既定値に従う）" },
      officeEffect: "followers",
      proposable: true,
      reaches: { proposal: true, takeaway: false, note: "提案書のバランスシートの図も同じ時点" },
      type: "kinds",
      min: BS_COLUMNS_MIN,
      max: BS_COLUMNS_MAX,
      choices: BS_POINT_CHOICES.map((c) => ({ value: c.key, label: c.label, ...(c.note !== "" ? { note: c.note } : {}) })),
      default: [...DEFAULT_BS_POINTS],
      note: FOLLOW_NOTE,
    },
    {
      id: "balance.columns",
      label: "この世帯で並べる時点",
      scope: "household",
      screen: "資産と負債のタブの「時点を並べる」",
      change: { household: "資産と負債のタブの「時点を並べる」の各時点の見出し" },
      stored: { household: "display.balance.columns" },
      reaches: { proposal: true, takeaway: false, note: "提案書のバランスシートの図も同じ時点" },
      type: "columns",
      min: BS_COLUMNS_MIN,
      max: BS_COLUMNS_MAX,
      choices: BS_POINT_CHOICES.map((c) => ({ value: c.key, label: c.label })),
      shape: { column: "{point: 候補の鍵（choices の value）} か {year: 決まった年}" },
      default: DEFAULT_BALANCE_SETTINGS.columns,
      note: "世帯ごとだけの設定です（事務所の既定にはしません）。null は「「時点を並べる」の既定」のまま",
    },
    {
      id: "balance.moneyThree.wording",
      label: "お金の3つの分け方の呼び方",
      scope: "both",
      screen: "資産と負債のタブの「お金の3つの分け方」",
      change: { office: OFFICE_DISPLAY, household: `${BALANCE_SETTINGS}の「お金の3つの分け方の呼び方」` },
      stored: { office: "defaults.display.balance.moneyThree.wording", household: "display.balance.moneyThree.wording（display.followOffice に id があれば事務所の既定値に従う）" },
      officeEffect: "followers",
      proposable: true,
      reaches: { proposal: true, takeaway: true },
      type: "choice",
      choices: MONEY_THREE_NAME_CHOICES.map((c) => ({ value: c.key, label: c.names.join("・"), note: c.note })),
      default: DEFAULT_MONEY_THREE.wording,
      note: FOLLOW_NOTE,
    },
    {
      id: "balance.moneyThree.months",
      label: "お金の3つの分け方の「何か月分」（使うお金）",
      scope: "both",
      screen: "資産と負債のタブの「お金の3つの分け方」",
      change: { office: OFFICE_DISPLAY, household: "資産と負債のタブの「お金の3つの分け方」の「何か月分」の欄" },
      stored: { office: "defaults.display.balance.moneyThree.months", household: "display.balance.moneyThree.months（display.followOffice に id があれば事務所の既定値に従う）" },
      officeEffect: "followers",
      proposable: true,
      reaches: { proposal: true, takeaway: true },
      type: "integer",
      min: MONEY_THREE_MONTHS.min,
      max: MONEY_THREE_MONTHS.max,
      default: DEFAULT_MONEY_THREE.months,
      note: `分け方の説明の図の境目で、計算の結果は変わりません。${FOLLOW_NOTE}`,
    },
    {
      id: "balance.moneyThree.years",
      label: "お金の3つの分け方の「何年先まで」（貯めるお金）",
      scope: "both",
      screen: "資産と負債のタブの「お金の3つの分け方」",
      change: { office: OFFICE_DISPLAY, household: "資産と負債のタブの「お金の3つの分け方」の「何年先まで」の欄" },
      stored: { office: "defaults.display.balance.moneyThree.years", household: "display.balance.moneyThree.years（display.followOffice に id があれば事務所の既定値に従う）" },
      officeEffect: "followers",
      proposable: true,
      reaches: { proposal: true, takeaway: true },
      type: "integer",
      min: MONEY_THREE_YEARS.min,
      max: MONEY_THREE_YEARS.max,
      default: DEFAULT_MONEY_THREE.years,
      note: `分け方の説明の図の境目で、計算の結果は変わりません。${FOLLOW_NOTE}`,
    },
    {
      id: "features.combinedBs",
      label: "合算BS（経営者個人と会社のバランスシート）を使う",
      scope: "office",
      screen: "資産と負債のタブの見るもの「合算BS」（役員として働く人のいる世帯だけ）と、提案書の章",
      change: { office: `${OFFICE}の区画「法人経営者向けの機能」（機能を有効にするコードが入っているときだけ出る）` },
      stored: { office: "defaults.features.combinedBs" },
      officeEffect: "live",
      reaches: { proposal: true, takeaway: false, note: "提案書の合算BS の章" },
      type: "boolean",
      choices: [
        { value: true, label: "使う" },
        { value: false, label: "使わない" },
      ],
      default: false,
      readOnly: true,
      note: "読むだけです。使うには、提供元から受け取った「機能を有効にするコード」を入れておく必要があります（コードが入っていなければ、この設定は画面に出ず効きません）",
    },
  ];
  // 渡された世帯ごとの案を出せる設定の印（並びは HOUSEHOLD_PROPOSABLE_DISPLAY_IDS の1か所）
  for (const s of settings) if ((HOUSEHOLD_PROPOSABLE_DISPLAY_IDS as readonly string[]).includes(s.id)) s.householdProposable = true;
  const count = (s: DisplaySetting["scope"]) => settings.filter((x) => x.scope === s).length;
  const short = (id: string) => NOTICE_KINDS.find((k) => k.id === id)?.short ?? id;
  return {
    schema: DISPLAY_CATALOG_SCHEMA,
    summary: { settings: settings.length, office: count("office"), household: count("household"), both: count("both") },
    settings,
    neverHidden: [
      `結果のタブの計算のお知らせの「${short("input")}」「${short("missing")}」（どの設定でも隠せません。カスタム層の説明の文でも消せません）`,
      "入力のタブの確かめの一覧の確かめの注意（範囲の外の値・ほかの入力と合わない値など）",
      "値の入っている入力項目・入力の欄（出さない設定でも出します）",
    ],
    outOfScope: [
      "計算の結果を変える設定（前提条件の標準値・必要保障額の数え方・本人と配偶者の介護の費用・受け取る予定の相続と贈与の見込み・相続税の目安の不動産の評価の割合・表の最後の年の年齢・FP顧問料の料金表・事務所の推定の値）",
      "名前・ロゴ・色・見た目",
      "Web のヒアリングのひな形と話題",
      "画面の文と名前（カスタム層の settings/texts.json・settings/terms.json。list_custom_texts）と、入力の欄の隠す・並べ替え（settings/fields.json。list_custom_texts の file: fields）",
    ],
    pending: [],
  };
}
