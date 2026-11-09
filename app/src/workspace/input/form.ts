// 入力の画面の定義の形（作業の層）。段階 → 区画 → まとまり（物1件など）→ 欄。
// 欄は「入力項目ID（0004・registry/items.yaml）・名前・単位・読み方・書き方」をまとめた定義で、画面の部品はこの定義だけを見て描く。
// 欄の読み方（get）と書き方（set）は世帯の要求（0008 の形）を直接読み書きする。書き方は元の値を変えず新しい世帯を返す
import type { Box, Household, Member, Timepoint } from "../../engine/types.ts";
import { ageAt } from "../levers.ts";
import { resolveTimepoint } from "../timepoint.ts";
import type { Estimate } from "./estimates.ts";
import { boxBasis, confirmedBox, estimatedBox, mutate, newId, type WorkingHousehold } from "./household.ts";
import { eventChoices, eventName, materializeEvent, pointsToCandidate, refsTo, whenPeople } from "./namedEvents.ts";
import { clampRate, rangeText, rateInRange } from "./rateRanges.ts";
import { pctFromRate, sameRate, type YenBasis, type YenUnit } from "./units.ts";
import { DEFAULT_WHEN_MODES, endBeforeStart, readWhen, sameWhen, type AgeMeans, type WhenCtx, type WhenEdge, type WhenMode } from "./when.ts";

export { resolveTimepoint };
import type { Address } from "../store/readings.ts";
import { dropStaleRows } from "./rows.ts";

export type Level = "simple" | "detail";
/** 欄の値。時点の欄（kind "when"）は時点の型（0003 の6）そのものも受ける（年月の文字は {at} として読む） */
export type Val = number | string | boolean | null | Timepoint;

export interface Option {
  value: string;
  label: string;
  /** 選ぶ欄の見出し（optgroup）。同じ見出しが続く選択肢を1つの見出しの下にまとめる。見出しの無い選択肢は見出しの外 */
  group?: string;
}

export interface FieldState {
  value: Val;
  /** 推定の値（0008 の2）なら根拠の文 */
  estimated?: string | null;
  /** 箱を持たない項目の仮の値なら理由 */
  assumed?: string | null;
  /** 欄の値は確定でも、合計に入れた内訳の一部が推定のとき、その根拠（例: 年収〔賞与込み〕の賞与。欄の名前の横に「推定」の印を出す。0077 の追記） */
  partEstimated?: string | null;
  /** 表示の値から元の形に戻せない（年齢・イベントで決めた時点を年月で見せているなど）。書き換えると年月の形になる */
  derived?: string | null;
  /** 欄の横に添える補助（年齢・和暦など） */
  hint?: string | null;
  /** 省略時の既定の値を見せている（書き戻すと省略に戻る） */
  implicit?: boolean;
  /** ほかの入力と合わないときの知らせ（例: 住宅ローンの借入額と購入の予定の価格−頭金） */
  warn?: string | null;
  /** 知らせから押せる直し方（確かめの一覧の行のボタン。押したときだけ直す。例: 表の最後の年を標準にする） */
  warnFix?: { label: string; run: (wh: WorkingHousehold) => WorkingHousehold } | null;
  /** 時点の欄（kind "when"）の、入れた形のままの時点と読み方 */
  when?: WhenState;
}

/** 時点の欄の状態（時点の部品が描くのに使う） */
export interface WhenState {
  /** 世帯に入っている形のままの時点（空は null） */
  raw: Timepoint | null;
  /** 読み取り・見せ方の文脈（人・出来事の一覧・入れ方） */
  ctx: WhenCtx;
  /** 欄の下に出す読み替えた形 */
  read: string;
  /** この欄が出来事そのものの時点（出来事が正本）。直すと出来事が動き、指している物も動く。at は出来事の時点（欄にはこれを見せる） */
  linked: { event: string; label: string; refs: number; at: Timepoint } | null;
}

/** 時点の部品で入れる欄の、読み書き（0038） */
export interface TimeView {
  when: WhenSpec;
  state: (wh: WorkingHousehold) => WhenState;
  /** 時点を書く。how "auto" は出来事が正本の欄なら出来事を動かし、"this" はこの欄だけ（出来事から切り離す。入れ方を選び直したとき） */
  setWhen: (wh: WorkingHousehold, tp: Timepoint | null, how: "auto" | "this") => WorkingHousehold;
}

/** 時点の欄の決まり（欄ごと。0038） */
export interface WhenSpec {
  defaultMode: WhenMode;
  modes: readonly WhenMode[];
  ageMeans: AgeMeans;
  /** 空（null）のときの意味（例: 「最後まで」） */
  nullText?: string;
  /** この欄が正本になる出来事の種類（子の独立 independence・入居 moveIn など）。出来事を指しているとき、直すと出来事を動かす */
  anchor?: string;
  /** 年月にして持つ欄（読む所が年月の形を前提にしている）。その理由（欄の下に出す） */
  monthOnly?: string;
  /** 年月の見せ方。birth は生年月の欄と同じ（「2048-04」と見せ、読みは「23歳（令和30年4月）」） */
  dateStyle?: "birth";
  /** 入れられない時点の理由（欄ごとの範囲など）。入れられれば null */
  check?: (wh: WorkingHousehold, tp: Timepoint | null) => string | null;
  /**
   * 使える入れ方だけで見せる（0101。例: 車の次の買い替えの時期は「今から」だけ）。ほかの形で入っている前の値（年齢・出来事から）は、同じ月の
   * 既定の入れ方で見せ、その旨を1行添える。直すと既定の入れ方の形で書く（出来事が正本の欄で出来事を指しているときは、出来事のほうを動かす）
   */
  strictModes?: boolean;
  /** 期間の端の欄か（読みの後ろの「まで」「から」。when.ts の edgeOf。省略は欄の決まりから） */
  edge?: WhenEdge;
  /** 年齢で選べる人: fixed はその欄の人だけ（人の選択を出さない。定年・働く最後など）、関数はその人を候補に出すか（今入っている人はいつも出す） */
  who?: WhoRule;
}

/** 時点の欄で年齢を選べる人の決まり */
export type WhoRule = "fixed" | ((m: Member, wh: WorkingHousehold) => boolean);

interface FieldBase {
  /** 世帯の中で一意の欄のキー（段階/物の ID/項目） */
  key: string;
  /** 入力項目ID（0004）。画面の側だけの値（呼び名など）は null */
  item: string | null;
  label: string;
  /** 公式の名前（事務所の名前を当てた欄だけ。「?」で公式の名前を見せる。カスタム層の名前の差し替え。0016 の 2026-11-02 の追記） */
  officialLabel?: string;
  /** 名前の左の小さなアイコン（fieldIcons.tsx の名前。飾りなので読み上げない） */
  icon?: string;
  level: Level;
  /**
   * 標準だけの欄（level は simple）。詳細の欄が見えているとき（詳細、または標準で「▸ 詳しく」を開いたとき）は出さず、同じまとまりの詳細の欄で入れる
   * （例: 年金の受け取り開始の「基礎・厚生とも」。詳細では老齢基礎年金・老齢厚生年金の別々の欄を代わりに出す。0066 の 2026-10-29 の追記）
   */
  simpleOnly?: boolean;
  /**
   * 標準だけの欄（simpleOnly）を「▸ 詳しく」で別の欄に入れ替えたときに、開いた所に出す短い1行（例: 「受け取り開始を、基礎と厚生に分けて出しています」。
   * 閉じると元に戻ることを添えて出す。0078 の 2026-10-29 の追記）
   */
  swapNote?: string;
  help?: string;
  /**
   * 灰色の入力例（例: 「例: 1985-04」）。欄ごとに持つ。空欄に意味のある欄（blankMeans）は「空欄＝○○」を先に使い、欄に収まらない例は使わない
   * （placeholder.ts。収まらない「空欄＝○○」は欄の下の「空欄なら: ○○」の1行に出す）
   */
  example?: string;
  /** 空欄の意味（例: 「最初から」「推定」）。空欄のとき、欄の中に「空欄＝○○」、収まらなければ欄の下に「空欄なら: ○○」 */
  blankMeans?: string;
  /** 円の欄の目安の上限（保存の期間の円の額）。超える額を打ったら「桁を確かめてください」を1回出す（書くのは止めない。units.ts の amountWarning） */
  typicalMax?: number;
  /**
   * 未入力の警告でも標準に上げない欄の、代わりに標準で入れる欄のキー（同じ値を入れる欄が標準にあるとき。例: 今の残高から入れた住宅ローンの
   * 控除の入居の年月は、標準の「借りた年月（入居の年月）」で入れる）。raiseFields の決まり（入力のパネル）が見る
   */
  missingShownBy?: string;
  /** 空にできる（空は「入れない」。推定の値があれば推定に戻る） */
  optional?: boolean;
  /** 物の形が変わる選択（年金の入れ方・働き方の種類など）。往復のテストでは別に確かめる */
  structural?: boolean;
  /** 空にすると推定の値に戻る（空は「入れない」ではない） */
  blankIsEstimate?: boolean;
  /**
   * 空欄のとき、エンジンが推定で使う値（iDeCo の受け取り方・受け取りを始める年齢・積立をやめる年齢など、空欄のまま推定で計算する欄）。
   * 「この値にする」「推定の値をまとめて使う」は、この値を書いて確定にする（0041 の追記）。書けない推定（「最後まで」など）は null
   */
  blankEstimate?: (wh: WorkingHousehold) => Val | null;
  /**
   * 推定の値でも、入力項目の状態・確かめの一覧・「推定の値をまとめて使う」に数えない欄（その理由）。学校の種類を選べば決まる統計の平均
   * （子ども・教育の段の学費・入学金・学校外の費用など）。欄の印「推定」と「この値にする」は今のまま出す（0062 の追記 2026-10-31）
   */
  quietEstimate?: string;
  /**
   * 値の状態の操作「書類で確かめる」（状態は unknown）を出す欄の、確かめる書類（例: 住民税の決定通知書）。書類から写す値で、書類を見るまで
   * 今の値（無ければ推定）を代わりに使う欄だけが持つ（住民税・退職金と企業年金の見込み額・年金の加入月数・今の住宅ローン・手術の額・今返している自動車ローン）。
   * 持たない欄には出さない（0041 の追記 2026-10-31）
   */
  docCheck?: string;
  /**
   * 確かめる書類の持ち主（構成員か物の ID）。書類のお願いの一覧（docRequests.ts）で、同じ書類を人・契約・ローンごとにまとめるのに使う。
   * 省略は欄の当て先の物（年金の記録・退職金・保険の契約・ローン・車）。当て先で決まらない欄（住民税）だけが持つ（0102）
   */
  docFor?: string;
  /** 見せるだけの欄（書き換えられない）。その理由 */
  readOnly?: string;
  /**
   * どのプランにも共通の欄（世帯で1つの値。プランを直している間に変えても、プランの差分にせず現状に書く。例: 表の最後の年）。
   * プランを直している間に欄の下に出す一言（0043 の追記 2026-11-05）
   */
  planShared?: string;
  /**
   * 読めた値でも、ほかの入力と合わず書けないときの理由（例: 今の残高から入れた住宅ローンで、完済の年月までに返せない毎月の返済額）。
   * 入力の画面は、理由を欄の下に出して書かない（「入れました」にしない）。set はその値を受けても世帯を変えない。0161
   */
  refuse?: (wh: WorkingHousehold, v: Val) => string | null;
  /** ほかの値もいっしょに変える欄（例: 働く最後の年齢は、退職後の生活費の節目・積立の終わりも合わせる）。その説明 */
  sideEffects?: string;
  /**
   * 時点の部品（0038）で入れる欄。kind "when" の欄（時点そのものの欄）と、年齢・年数の整数の欄（定年・働く最後・年金の受け取り開始・
   * 車を手放す年齢など。結果のタブで動かす項目は整数のまま）が持つ。入力の画面はこれがあれば時点の部品で描く
   */
  time?: TimeView;
  get: (wh: WorkingHousehold) => FieldState;
  /** 値を書く（打った・選んだ・ボタンで変えたとき）。同じ値なら世帯を変えない（状態も変えない。0035 の3・0041） */
  set: (wh: WorkingHousehold, v: Val) => WorkingHousehold;
  /** 同じ値の確かめをしない書き方（field() が付ける。値の状態の操作「推定に戻す」などが使う。valueState.ts） */
  write?: (wh: WorkingHousehold, v: Val) => WorkingHousehold;
  /** 値の箱（0008 の2）の欄の、箱そのものの読み書き（yenBox・rateBox が付ける。値の状態の操作が使う） */
  boxed?: { read: (wh: WorkingHousehold) => unknown; write: (wh: WorkingHousehold, box: Record<string, unknown> | undefined) => WorkingHousehold };
  /** 欄の当て先（0036 の2）。省くと 0.16 の欄のキーから読み替え表で引く（valueState.ts の fieldAddress） */
  address?: (wh: WorkingHousehold) => Address | null;
}

export type FieldDef = FieldBase &
  (
    | { kind: "yen"; basis: YenBasis; unit?: YenUnit }
    | { kind: "int"; suffix?: string; min?: number; max?: number }
    // min・max はパーセントの値（0〜100% の割合の欄など。外の値は欄の下に理由を出して書かない）
    | { kind: "pct"; min?: number; max?: number }
    | { kind: "decimal"; suffix?: string }
    | { kind: "select"; options: Option[] }
    // ageInput: 生年月の欄。「38歳」「38」と打てば、生まれた年月を推定して仮の値（仮の印）で入れる（when.ts の birthFromAge）
    // earliest・latest: 入れられる年月の範囲（その月を含む。外の年月は欄の下に理由を出して書かない。生年月は今月まで・120歳まで。0162）
    | { kind: "ym"; ageInput?: boolean; earliest?: string; latest?: string }
    | { kind: "when" }
    | { kind: "bool" }
    | { kind: "text"; placeholder?: string }
  );

export interface ActionDef {
  key: string;
  label: string;
  level: Level;
  run: (wh: WorkingHousehold) => WorkingHousehold;
  danger?: boolean;
  /** 選んでいる状態を見せるボタン（目安の選択など。aria-pressed） */
  pressed?: boolean;
  /** ボタンに添える補足（ツールチップ） */
  title?: string;
  /** ボタンの横の「?」の中の説明（何が足されるか・どう計算するか。ボタンの名前には書かない。0077 の追記） */
  help?: string;
  /**
   * 1つの「＋」のボタンの中の選択肢にする（0040 の 2026-10-29 の追記。例: 「＋ 月額の変化」→「この年だけ」「この月から先」）。
   * 同じ key の選択肢が続くボタンは、key・label・help の1つのボタンにまとめて描き、押すと選択肢（それぞれの label）を並べる。選んだ物の run を実行する。
   * 欄の定義の上では、選択肢はそれぞれ1つのボタンのまま（足す処理・テスト・プランの包み直しは今のまま）
   */
  choice?: {
    key: string;
    label: string;
    help?: string;
    /**
     * 選択肢の一覧の見出し（2026-11-02 の 0055 の追記。例: 「＋ 保険契約を足す」の「死亡の保障」「病気・けが」）。選択肢のどれかが持てば、
     * 選択肢は横の並びでなく、見出しごとの一覧（同じ見出しの続いた物を1組）で描く
     */
    group?: string;
    /** 一覧の上の「よく使う」の組にも出す（見出しのある一覧のときだけ。足す処理は同じ1つの選択肢） */
    frequent?: boolean;
  };
  /**
   * ひな形の小さなボタン（chips のまとまりの中。0068 の追記 2026-10-31）。group はボタンを並べる1行の見出し、added はボタンの横の1行
   * （「入れた（2031年・80万円）」・押せない理由）、disabled は足す相手がいなくて押せないとき
   */
  chip?: { group: string; added?: string; disabled?: boolean };
}

/** まとまり（物1件、または区画の中の1組の欄） */
export interface GroupDef {
  key: string;
  title?: string;
  /** まとまりの説明（推定の根拠・注意など） */
  note?: string;
  /** 見出しの横に小さく出す要約（入れた結果の額など。例: 「4年で約420万円」）。見出しの名前ではないので、探して開く・確かめの一覧には使わない */
  summary?: string;
  level: Level;
  fields: FieldDef[];
  actions: ActionDef[];
  /**
   * 標準で「▸ 詳しく」を開いたときだけ出す欄（詳細では別の所に出す欄。例: 今の働き方の、働き方の期間の詳しい欄）。
   * 欄の一覧（allFields・確かめの一覧）には入れない（同じ欄は別のまとまりに載っている。0078 の追記）
   */
  openFields?: FieldDef[];
  /**
   * 標準のときだけ出す（詳細では、同じ値を別のまとまりの欄で入れる。例: 今の働き方は、詳細では働き方 1・2…のまとまりで入れる。0047 の追記）。
   * 欄の一覧（allFields）には入れたまま（標準の欄は確かめの一覧の行の当て先になる）
   */
  simpleOnly?: boolean;
  /**
   * 標準で「▸ 続きを見る」の代わりに出す文（頭の「▸」は付けない。0078 の追記 2026-11-01）。開くと出る欄の代表の2つ（「〇〇・〇〇を入れる」）か
   * 「〇〇などを入れる」の形にする。種類で開く欄が違う物（学校の段・保険・口座など）は、種類ごとに文を選ぶ。無ければ「続きを見る」のまま
   */
  moreLabel?: string;
  /** ひな形の小さなボタンの並び（ボタンの chip の group ごとに1行。title は並びの上の1行の案内。0068 の追記 2026-10-31） */
  chips?: boolean;
  /** ひな形のボタンを、ほかの「＋ 〇〇を足す」のボタンと同じ大きさで描く（小さな丸いボタンにしない。夢プランのひな形。0103 の追記 2026-11-01 の3） */
  chipsFull?: boolean;
  /**
   * 別のまとまり（group。同じ区画の中）の欄の並びの中に描く（0040 の 2026-10-29 の追記。例: 月額の変化は、行の額の近く〔見込みの欄の前〕に並べる）。
   * before の欄の前か after の欄の後に置き、どちらも見えていなければ欄の並びの最後に置く。見せ方だけで、欄の一覧（allFields）・確かめの一覧は今のまま
   */
  placeIn?: { group: string; before?: string; after?: string };
  /**
   * 説明の欄（readLines.ts の infoNote）。欄の代わりに、見出し（左に ⓘ・折りたためる）と説明の文を幅いっぱいに出す。
   * fold は折りたたみを覚えるキー。値を持たないので、欄の一覧（allFields）には何も入らない
   */
  info?: { title: string; text: string; fold: string };
  /**
   * 1件の物として、自分の枠に描く（キーが前のまとまりのキー＋「/」で始まっていても、その枠の中に入れない。FieldViews.tsx の entryParts）。
   * 1つずつ足して外せる物を、頭のまとまりと同じ並びに置くとき（子の進路の段・基本生活費の段階など）に付ける。続くまとまりも、前の枠には入れない
   */
  ownBox?: boolean;
  /**
   * キーの形は別でも、この物（まとまりのキー）の中のまとまりとして描く（FieldViews.tsx の entryParts。直後に続けて並べたときだけ）。
   * 欄のキーを変えずに、物の枠の中へ入れるときに使う（例: 配偶者の「夫婦の関係」）
   */
  partOf?: string;
  /**
   * キーの形は別でも、標準の「▸ 続きを見る」の単位として、この頭のまとまり（キー）に属させる（FieldViews.tsx の groupUnits）。
   * 欄のキー・まとまりのキーを変えずに、物の中の一部のまとまりだけを別の「▸」で開くときに使う（例: 収益不動産の売却・大きな修繕の予定）
   */
  unitOf?: string;
  /**
   * 物1件の中の中枠（欄の多い物を、題名のある区切りに分ける。例: 住宅ローンの「借入の内容」「金利」「返済」「繰上返済」「団体信用生命保険」「住宅ローン控除」）。
   * キーは物の頭のまとまりのキー＋「/」で始め、物の枠の中に描く（entryParts）。中枠は「▸ 詳しく」の単位にしない（物の頭の「▸ 詳しく」で、中枠の詳細の欄も開く）。
   * 枠は付けず、少し強い見出しと左の薄い線だけ（別の物を足したように見せない。0077 の追記）。中枠の中のまとまり（金利の段階など）は partOf で中枠に入れる
   */
  band?: boolean;
}

/** まとまりをその入れ方で出すか（標準は標準のまとまりだけ、詳細は標準だけのまとまりを除く全部） */
export const groupShown = (level: Level, g: Pick<GroupDef, "level" | "simpleOnly">): boolean => (level === "detail" ? g.simpleOnly !== true : g.level === "simple");

/** 標準だけのまとまり（simpleOnly）の欄か（確かめの一覧から詳細のパネルを開いたとき、標準に切り替えて移るため） */
export function inSimpleOnlyGroup(stage: StageDef, key: string): boolean {
  return stage.sections.some((s) => s.groups.some((g) => g.simpleOnly === true && g.fields.some((f) => f.key === key)));
}

export interface SectionDef {
  key: string;
  title: string;
  note?: string;
  /** 見出しの横に小さく出す要約（GroupDef の summary と同じ。例: 子の「12歳・小6・これからの教育費 約1,480万円」） */
  summary?: string;
  level: Level;
  groups: GroupDef[];
  actions: ActionDef[];
}

/** 段階（カード）の ID。fee は前提条件の中の欄のまとまり（カードにしない） */
export type StageId = "family" | "work" | "retirement" | "pension" | "living" | "education" | "housing" | "insurance" | "savings" | "rental" | "events" | "car" | "care" | "inheritance" | "fee" | "assumptions";

export interface StageDef {
  id: StageId;
  label: string;
  lead: string;
  sections: SectionDef[];
}

// ---- 値の比べ方 ----

export function sameVal(a: Val, b: Val, kind: FieldDef["kind"]): boolean {
  if (kind === "pct" || kind === "decimal") return sameRate(a as string | null, b as string | null);
  if ((a !== null && typeof a === "object") || (b !== null && typeof b === "object")) return sameWhen(a as Timepoint | null, b as Timepoint | null);
  return a === b;
}

/**
 * 欄を作る: 同じ値を入れ直しても世帯を変えない（推定の値と同じ値を書き戻しても確定にしない。確定は「この値にする」だけ。0035 の3・0041）。
 * 値を変えたら、その欄の仮の印を外し、値が変わった所の値の状態の行（書類待ち・該当なし・承認など）を外す（rows.ts の dropStaleRows）
 */
export function field(def: FieldDef): FieldDef {
  const raw = def.set;
  const write = (wh: WorkingHousehold, v: Val): WorkingHousehold => {
    const next = raw(wh, v);
    if (next === wh) return wh;
    // 仮の印を欄の get で見せている欄（plain など）は、書いたら印を外す。印を自分で付け外しする欄（車・借入額）は、その書き方に任せる
    const own = def.get(wh).assumed != null && next.assumed[def.key] === wh.assumed[def.key];
    const cleared = own ? { ...next, assumed: Object.fromEntries(Object.entries(next.assumed).filter(([k]) => k !== def.key)) } : next;
    return dropStaleRows(wh, cleared);
  };
  return {
    ...def,
    write,
    ...(def.kind === "pct" && (def.min !== undefined || def.max !== undefined) ? { get: outOfRangeNotice(def, write) } : {}),
    set: (wh, v) => {
      const cur = def.get(wh);
      // 時点の欄は、時点の形で渡されたら入っている形と比べる（年月の文字なら年月で比べる）。同じなら推定でも何も変えない（0041）
      const now = def.kind === "when" && typeof v === "object" ? (cur.when?.raw ?? null) : cur.value;
      if (sameVal(now, v, def.kind)) return wh;
      return write(wh, v);
    },
  };
}

/**
 * 割合の欄の範囲の外の値（古い世帯・取り込んだ世帯に入っていた値）の知らせ（0098）。値は変えずに計算し、欄の下と確かめの一覧に
 * 範囲を出して、押したときだけ範囲の端にする。ほかの知らせより先に出す（範囲の外の値は計算が止まることがあるため）
 */
function outOfRangeNotice(def: FieldDef & { kind: "pct" }, write: (wh: WorkingHousehold, v: Val) => WorkingHousehold): (wh: WorkingHousehold) => FieldState {
  return (wh) => {
    const st = def.get(wh);
    const v = st.value;
    if (typeof v !== "string" || rateInRange(v, def)) return st;
    const to = clampRate(v, def);
    return {
      ...st,
      warn: `範囲（${rangeText(def)}）の外の値（${pctFromRate(v)}%）が入っています。今はこの値のまま計算しています（大きすぎる値では計算が止まります）。${rangeText(def)}の範囲で入れ直してください`,
      warnFix: { label: `${pctFromRate(to)}%にする`, run: (w) => write(w, to) },
    };
  };
}

// ---- 入れ子の値の読み書き ----

type Obj = Record<string, unknown>;

export function getPath(o: unknown, path: readonly string[]): unknown {
  let cur = o;
  for (const p of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Obj)[p];
  }
  return cur;
}

/** 値を置く。undefined は消し、空になった入れ物も消す */
export function setPath(o: Obj, path: readonly string[], value: unknown): void {
  const [head, ...rest] = path;
  if (head === undefined) return;
  if (rest.length === 0) {
    if (value === undefined) delete o[head];
    else o[head] = value;
    return;
  }
  let child = o[head];
  if (child === null || typeof child !== "object") {
    if (value === undefined) return;
    child = {};
    o[head] = child;
  }
  setPath(child as Obj, rest, value);
  if (value === undefined && Object.keys(child as Obj).length === 0) delete o[head];
}

/** 世帯の中の物（1件）を探す関数。書くときは複製した世帯で同じ関数を使う */
export type Finder = (h: Household, wh: WorkingHousehold) => Obj | undefined;

/** 値の箱の欄の、箱そのものの読み書き（値の状態の操作が使う）。箱を消すときは undefined */
function boxAccess(find: Finder, path: readonly string[], ensure?: (h: Household, wh: WorkingHousehold) => Obj): NonNullable<FieldBase["boxed"]> {
  return {
    read: (wh) => getPath(find(wh.request.input.household, wh), path),
    write: (wh, box) =>
      mutate(wh, (h, req) => {
        const w2 = { ...wh, request: req };
        const target = find(h, w2) ?? (box !== undefined ? ensure?.(h, w2) : undefined);
        if (target === undefined) return;
        setPath(target, path, box === undefined ? undefined : structuredClone(box));
      }),
  };
}

/** 値の箱（0008 の2）の円の欄 */
export function yenBox(o: {
  key: string;
  item: string;
  label: string;
  level: Level;
  basis: YenBasis;
  unit?: YenUnit;
  help?: string;
  find: Finder;
  path: readonly string[];
  /** 物が無いときに作る（無ければ書けない） */
  ensure?: (h: Household, wh: WorkingHousehold) => Obj;
  /** 空にしたときの推定の値 */
  estimate?: (h: Household, wh: WorkingHousehold) => Estimate | null;
  optional?: boolean;
  /** 欄の横に添える補助（目安など） */
  hint?: (wh: WorkingHousehold) => string | null;
  /** 灰色の入力例（FieldDef.example） */
  example?: string;
  /** 目安の上限（FieldDef.typicalMax。保存の期間の円の額） */
  typicalMax?: number;
}): FieldDef {
  return field({
    key: o.key,
    item: o.item,
    label: o.label,
    level: o.level,
    kind: "yen",
    basis: o.basis,
    ...(o.unit !== undefined ? { unit: o.unit } : {}),
    ...(o.help !== undefined ? { help: o.help } : {}),
    ...(o.example !== undefined ? { example: o.example } : {}),
    ...(o.typicalMax !== undefined ? { typicalMax: o.typicalMax } : {}),
    optional: o.optional === true || o.estimate !== undefined,
    ...(o.estimate !== undefined ? { blankIsEstimate: true } : {}),
    get: (wh) => {
      const box = getPath(o.find(wh.request.input.household, wh), o.path) as Box<number> | undefined;
      const value = box?.value ?? (box?.state === "unknown" ? ((box as { substitute?: Box<number> }).substitute?.value ?? null) : null);
      return { value, estimated: boxBasis(box) ?? (box?.state === "unknown" ? "書類待ち（代わりの値）" : null), ...(o.hint !== undefined ? { hint: o.hint(wh) } : {}) };
    },
    boxed: boxAccess(o.find, o.path, o.ensure),
    set: (wh, v) =>
      mutate(wh, (h, req) => {
        const w2 = { ...wh, request: req };
        const target = o.find(h, w2) ?? o.ensure?.(h, w2);
        if (target === undefined) return;
        if (v === null) {
          const est = o.estimate?.(h, wh) ?? null;
          setPath(target, o.path, est !== null ? estimatedBox(est.value, est.basis) : undefined);
        } else setPath(target, o.path, confirmedBox(Number(v)));
      }),
  });
}

/** 値の箱（0008 の2）の率の欄（百分率で見せる） */
export function rateBox(o: { key: string; item: string; label: string; level: Level; help?: string; find: Finder; path: readonly string[]; optional?: boolean; min?: number; max?: number }): FieldDef {
  return field({
    key: o.key,
    item: o.item,
    label: o.label,
    level: o.level,
    kind: "pct",
    ...(o.min !== undefined ? { min: o.min } : {}),
    ...(o.max !== undefined ? { max: o.max } : {}),
    ...(o.help !== undefined ? { help: o.help } : {}),
    ...(o.optional === true ? { optional: true } : {}),
    get: (wh) => {
      const box = getPath(o.find(wh.request.input.household, wh), o.path) as { value?: string; state?: string; estimate?: { basis?: string }; substitute?: { value?: string } } | undefined;
      if (box?.state === "unknown") return { value: box.substitute?.value ?? null, estimated: "書類待ち（代わりの値）" };
      return { value: box?.value ?? null, estimated: box?.state === "estimated" ? (box.estimate?.basis ?? "推定") : null };
    },
    boxed: boxAccess(o.find, o.path),
    set: (wh, v) =>
      mutate(wh, (h, req) => {
        const target = o.find(h, { ...wh, request: req });
        if (target === undefined) return;
        setPath(target, o.path, v === null ? undefined : { value: String(v), state: "confirmed", origin: { kind: "manual" } });
      }),
  });
}

/** 箱でない値（数・文字・真偽・選択）の欄 */
export function plain(o: {
  key: string;
  item: string | null;
  label: string;
  level: Level;
  kind: "int" | "pct" | "decimal" | "select" | "ym" | "bool" | "text" | "yen";
  basis?: YenBasis;
  /** 円の欄の既定の単位（省略は万円。保険料・入院日額など小さい額は円） */
  unit?: YenUnit;
  options?: Option[];
  suffix?: string;
  min?: number;
  max?: number;
  help?: string;
  find: Finder;
  path: readonly string[];
  ensure?: (h: Household, wh: WorkingHousehold) => Obj;
  optional?: boolean;
  structural?: boolean;
  /** 空の値（undefined）のときに見せる値（省略時の既定） */
  fallback?: Val;
  hint?: (v: Val, wh: WorkingHousehold) => string | null;
  /** 値を書いた後の始末（関連する値の調整） */
  after?: (h: Household, target: Obj, v: Val, wh: WorkingHousehold) => void;
  /** 灰色の入力例（FieldDef.example） */
  example?: string;
  /** 空欄の意味（FieldDef.blankMeans） */
  blankMeans?: string;
  /** 円の欄の目安の上限（FieldDef.typicalMax） */
  typicalMax?: number;
  /** 年月の欄で年齢も受け付ける（生年月の欄。FieldDef の ym の ageInput） */
  ageInput?: boolean;
  /** 年月の欄の入れられる範囲（FieldDef の ym の earliest・latest） */
  earliest?: string;
  latest?: string;
}): FieldDef {
  const kindPart: Record<string, unknown> = { kind: o.kind };
  if (o.kind === "ym" && o.ageInput === true) kindPart.ageInput = true;
  if (o.kind === "ym" && o.earliest !== undefined) kindPart.earliest = o.earliest;
  if (o.kind === "ym" && o.latest !== undefined) kindPart.latest = o.latest;
  if (o.kind === "yen") kindPart.basis = o.basis ?? "once";
  if (o.kind === "yen" && o.unit !== undefined) kindPart.unit = o.unit;
  if (o.kind === "select") kindPart.options = o.options ?? [];
  if (o.suffix !== undefined) kindPart.suffix = o.suffix;
  if (o.min !== undefined) kindPart.min = o.min;
  if (o.max !== undefined) kindPart.max = o.max;
  return field({
    key: o.key,
    item: o.item,
    label: o.label,
    level: o.level,
    ...(o.help !== undefined ? { help: o.help } : {}),
    ...(o.example !== undefined ? { example: o.example } : {}),
    ...(o.blankMeans !== undefined ? { blankMeans: o.blankMeans } : {}),
    ...(o.typicalMax !== undefined ? { typicalMax: o.typicalMax } : {}),
    ...(o.optional === true ? { optional: true } : {}),
    ...(o.structural === true ? { structural: true } : {}),
    ...(kindPart as { kind: "int" }),
    get: (wh) => {
      const raw = getPath(o.find(wh.request.input.household, wh), o.path);
      const value = (raw === undefined || raw === null ? (o.fallback ?? null) : raw) as Val;
      return { value, hint: o.hint?.(value, wh) ?? null, assumed: wh.assumed[o.key] ?? null, ...(o.fallback !== undefined && (raw === undefined || raw === null || raw === o.fallback) ? { implicit: true } : {}) };
    },
    set: (wh, v) =>
      mutate(wh, (h, req) => {
        const w2 = { ...wh, request: req };
        const target = o.find(h, w2) ?? o.ensure?.(h, w2);
        if (target === undefined) return;
        const none = v === null || (v === "" && o.optional === true) || (o.fallback !== undefined && v === o.fallback);
        setPath(target, o.path, none ? undefined : v);
        o.after?.(h, target, v, wh);
      }),
  });
}

// ---- 時点（0003 の6）・時点の部品（0038）----

/** 欄の値を時点にする（年月の文字は {at}。読めなければ undefined） */
export function toTimepoint(v: Val): Timepoint | null | undefined {
  if (v === null || v === "") return null;
  if (typeof v === "object") return v;
  if (typeof v === "string" && /^\d{4}-\d{2}$/.test(v)) return { at: v };
  return undefined;
}

/** 時点の欄の読み取りの文脈（人・出来事の一覧・既定の入れ方） */
export function whenContext(wh: WorkingHousehold, spec: WhenSpec, o: { person?: string | null; optional?: boolean; start?: Timepoint | null; current?: Timepoint | null; excludeEvent?: string }): WhenCtx {
  const h = wh.request.input.household;
  // 出来事の一覧は欄に合わせて絞る: 欄そのものと始まりの時点を元にする物（住み終わりの欄の、その住まいの入居）と、始まりより前の物は出さない
  const choice = {
    ...(o.excludeEvent !== undefined ? { exclude: o.excludeEvent } : {}),
    own: [o.current, o.start],
    ...(o.start != null ? { notBefore: resolveTimepoint(h, o.start) } : {}),
    ...(o.current?.event !== undefined ? { keep: o.current.event } : {}),
  };
  // 年齢で選べる人を欄の決まりで絞る（今入っている人・欄の人はいつも残す。持てない人を候補に出さない）
  const keep = new Set([o.person ?? null, o.current?.memberAge?.member ?? null]);
  const rule = spec.who;
  const all = whenPeople(wh);
  const people =
    rule === undefined
      ? all
      : all.filter((p) => {
          if (keep.has(p.id)) return true;
          if (rule === "fixed") return false;
          const m = h.members.find((x) => x.id === p.id);
          return m !== undefined && rule(m, wh);
        });
  return {
    h,
    baseMonth: wh.request.input.baseMonth,
    people,
    person: o.person ?? null,
    events: spec.modes.includes("event") ? eventChoices(wh, choice) : [],
    modes: spec.modes,
    defaultMode: spec.defaultMode,
    ageMeans: spec.ageMeans,
    ...(spec.dateStyle !== undefined ? { dateStyle: spec.dateStyle } : {}),
    optional: o.optional === true,
    ...(o.start !== undefined ? { start: o.start } : {}),
    ...(o.current !== undefined ? { current: o.current } : {}),
    ...(spec.edge !== undefined ? { edge: spec.edge } : {}),
    ...(rule === "fixed" && o.person != null ? { personFixed: true } : {}),
  };
}

/** 出来事が正本の欄の、今指している出来事（ずらしの無い出来事の形で、種類が欄の正本の種類と同じとき） */
function linkedEvent(h: Household, spec: WhenSpec, t: Timepoint | null | undefined) {
  if (spec.anchor === undefined || t?.event === undefined || (t.offset?.years ?? 0) * 12 + (t.offset?.months ?? 0) !== 0) return undefined;
  const e = (h.events ?? []).find((x) => x.id === t.event);
  return e !== undefined && e.kind === spec.anchor ? e : undefined;
}

/** 時点の部品の欄の決まり（timepointField・timeView に共通） */
export interface WhenOptions {
  /** 年齢で入れるときの既定の人（年齢を添える構成員） */
  ageOf?: (h: Household) => Member | undefined;
  optional?: boolean;
  /** 空（null）のときの意味（例: 「最後まで」） */
  nullText?: string;
  /** 既定の入れ方（既定: 人がいれば年齢、いなければ年月） */
  mode?: WhenMode;
  /** 使える入れ方（既定: 4つとも） */
  modes?: readonly WhenMode[];
  /** 「60歳」がどの月か（既定 reach）。働く最後のような「○歳まで」の欄は before、年金の受け取り開始は after */
  ageMeans?: AgeMeans;
  anchor?: string;
  monthOnly?: string;
  /** 年月の形の読みの言い方（欄の人そのものの日付で、生年月の欄と同じ「23歳（令和30年4月）」にする欄は birth。欄の表記はどの欄も「2041-06」） */
  dateStyle?: "birth";
  check?: (wh: WorkingHousehold, tp: Timepoint | null) => string | null;
  /** 使える入れ方だけで見せる（ほかの形の前の値は既定の入れ方に直して見せる。WhenSpec.strictModes） */
  strictModes?: boolean;
  /** 空のときに、読み替えた形の代わりに見せる省略のときの時点（例: 年金の受け取り開始は65歳になった翌月） */
  fallback?: (h: Household) => Timepoint | null;
  /** 期間の端の欄か（読みの後ろの「まで」「から」。WhenSpec.edge） */
  edge?: WhenEdge;
  /** 年齢で選べる人（WhenSpec.who） */
  who?: WhoRule;
}

const specOf = (o: WhenOptions): WhenSpec => ({
  defaultMode: o.mode ?? (o.ageOf !== undefined ? "age" : "ym"),
  modes: o.modes ?? DEFAULT_WHEN_MODES,
  ageMeans: o.ageMeans ?? "reach",
  ...(o.nullText !== undefined ? { nullText: o.nullText } : {}),
  ...(o.anchor !== undefined ? { anchor: o.anchor } : {}),
  ...(o.monthOnly !== undefined ? { monthOnly: o.monthOnly } : {}),
  ...(o.dateStyle !== undefined ? { dateStyle: o.dateStyle } : {}),
  ...(o.check !== undefined ? { check: o.check } : {}),
  ...(o.strictModes === true ? { strictModes: true } : {}),
  ...(o.edge !== undefined ? { edge: o.edge } : {}),
  ...(o.who !== undefined ? { who: o.who } : {}),
});

/**
 * 時点の部品の読み書きを作る（0038）。read は欄に入っている形のままの時点、write はその時点を欄に書く（出来事のことは知らなくてよい）。
 * 出来事が正本の欄で出来事を指しているときに年月・年齢を入れたら出来事のほうを動かし、まだ出来事でない物を選んだら出来事にしてから書く
 */
export function timeView(o: WhenOptions & { read: (wh: WorkingHousehold) => Timepoint | null; write: (wh: WorkingHousehold, tp: Timepoint | null) => WorkingHousehold; start?: (wh: WorkingHousehold) => Timepoint | null | undefined }): TimeView {
  const spec = specOf(o);
  const state = (wh: WorkingHousehold): WhenState => {
    const h = wh.request.input.household;
    const t = o.read(wh);
    const start = o.start?.(wh);
    const ctx = whenContext(wh, spec, { person: o.ageOf?.(h)?.id ?? null, optional: o.optional === true, current: t, ...(start !== undefined ? { start } : {}) });
    const ev = linkedEvent(h, spec, t);
    // 出来事から選べない欄（「今から」だけの欄など）でも、指している出来事の名前を出す
    const linked = ev === undefined ? null : { event: ev.id, label: ctx.events.find((e) => e.id === ev.id)?.label ?? eventName(wh, ev), refs: refsTo(h, ev.id), at: ev.at };
    const fb = t === null ? (o.fallback?.(h) ?? null) : null;
    const read = fb !== null ? `${o.nullText ?? "空欄"}: ${readWhen(fb, ctx)}` : linked !== null ? readWhen(linked.at, { ...ctx, current: linked.at }) : readWhen(t, ctx, o.nullText);
    return { raw: t, ctx, read, linked };
  };
  const setWhen = (wh: WorkingHousehold, tp: Timepoint | null, how: "auto" | "this"): WorkingHousehold => {
    const h0 = wh.request.input.household;
    const cur = o.read(wh);
    let want = tp;
    if (want !== null && o.monthOnly !== undefined && want.at === undefined && !pointsToCandidate(want)) {
      const ym = resolveTimepoint(h0, want);
      if (ym === null) return wh;
      want = { at: ym };
    }
    // 出来事が正本の欄: 出来事を指したまま年月・年齢を入れたら、出来事のほうを動かす（指している物が全部動く）
    const ev = how === "auto" && want !== null && want.event === undefined ? linkedEvent(h0, spec, cur) : undefined;
    if (ev !== undefined && want !== null) {
      if (sameWhen(ev.at, want)) return wh;
      const next = want;
      return mutate(wh, (h) => {
        const e = (h.events ?? []).find((x) => x.id === ev.id);
        if (e !== undefined) e.at = structuredClone(next);
      });
    }
    // 同じ時点を入れ直しても世帯を変えない
    if (!pointsToCandidate(want) && sameWhen(cur, want)) return wh;
    // まだ出来事でない物（子の独立など）を選んだら、出来事にしてから指す
    if (want !== null && pointsToCandidate(want)) {
      let made: Timepoint | null = null;
      const w1 = mutate(wh, (h) => {
        made = materializeEvent(h, want as Timepoint, newId);
      });
      if (made === null) return wh;
      return o.write(w1, made);
    }
    return o.write(wh, want === null ? null : structuredClone(want));
  };
  return { when: spec, state, setWhen };
}

/**
 * 時点の欄（0038 の時点の部品）。どの「いつ」の欄も同じ部品で入れる: 年月・人の年齢・出来事から・今から。
 * 書く値はエンジンの時点の型のまま（年齢・出来事で入れた時点は年齢・出来事で持つ。今からは年月にする）。
 * 欄の値（value）は年月に解いた "YYYY-MM"（ほかの読み手のため）、入っている形のままの時点は when.raw
 */
export function timepointField(
  o: WhenOptions & {
    key: string;
    item: string;
    label: string;
    level: Level;
    find: Finder;
    path: readonly string[];
    help?: string;
    /** 空にしたら欄ごと消す（null を書かない項目） */
    absentWhenEmpty?: boolean;
    after?: (h: Household, target: Obj, v: Val, wh: WorkingHousehold) => void;
    /** 終わりの欄: 同じ物の中の始まりの時点の場所（「10年間」で入れられる） */
    startPath?: readonly string[];
    /** ほかの入力と合わないときの知らせ */
    warn?: (wh: WorkingHousehold) => string | null;
    /** 灰色の入力例（FieldDef.example。省略は入れ方ごとの例。年齢は物差しの人で変える） */
    example?: string;
  },
): FieldDef {
  const read = (wh: WorkingHousehold) => (getPath(o.find(wh.request.input.household, wh), o.path) as Timepoint | null | undefined) ?? null;
  const startOf = (wh: WorkingHousehold) => (o.startPath === undefined ? undefined : ((getPath(o.find(wh.request.input.household, wh), o.startPath) as Timepoint | null | undefined) ?? null));
  const time = timeView({
    ...o,
    read,
    write: (wh, tp) =>
      mutate(wh, (h, req) => {
        const target = o.find(h, { ...wh, request: req });
        if (target === undefined) return;
        setPath(target, o.path, tp === null ? (o.optional === true && o.absentWhenEmpty !== true ? null : undefined) : tp);
        o.after?.(h, target, tp, wh);
      }),
    ...(o.startPath !== undefined ? { start: (wh: WorkingHousehold) => startOf(wh) ?? null } : {}),
  });
  return field({
    key: o.key,
    item: o.item,
    label: o.label,
    level: o.level,
    kind: "when",
    time,
    ...(o.help !== undefined ? { help: o.help } : {}),
    ...(o.example !== undefined ? { example: o.example } : {}),
    ...(o.optional === true ? { optional: true } : {}),
    get: (wh) => {
      const h = wh.request.input.household;
      const t = read(wh);
      const ym = resolveTimepoint(h, t ?? o.fallback?.(h));
      const who = o.ageOf?.(h);
      // 終わりの欄: 入っている終わりが始まりより前なら知らせる（打った値は読み取りで止める。0162）
      const warn = o.warn?.(wh) ?? (o.startPath !== undefined ? endBeforeStart({ h, start: startOf(wh) }, t, false) : null);
      return {
        value: ym,
        hint: ym === null ? (o.nullText ?? null) : who !== undefined ? `${ageAt(who, ym)}歳` : null,
        when: time.state(wh),
        ...(t === null && o.optional === true ? { implicit: true } : {}),
        ...(o.warn !== undefined || warn !== null ? { warn } : {}),
      };
    },
    set: (wh, v) => {
      const tp = toTimepoint(v);
      return tp === undefined ? wh : time.setWhen(wh, tp, "auto");
    },
  });
}

/**
 * 欄の書き込み（打つ・選ぶ・時点の部品・値の状態の操作）の後に、世帯を整える関数を通す。時点の欄は画面が time.setWhen で書く（set を通らない）ので、
 * set を上書きしてほかの欄をついてこさせる欄は、これで set と time.setWhen の両方を包む（片方だけだと、画面のキー入力で連動が抜ける）
 */
export function afterWrite(f: FieldDef, tidy: (before: WorkingHousehold, after: WorkingHousehold) => WorkingHousehold): FieldDef {
  const wrap = (w: WorkingHousehold, next: WorkingHousehold) => (next === w ? next : tidy(w, next));
  const time = f.time;
  return {
    ...f,
    set: (w, v) => wrap(w, f.set(w, v)),
    ...(f.write !== undefined ? { write: (w: WorkingHousehold, v: Parameters<NonNullable<FieldDef["write"]>>[1]) => wrap(w, (f.write as NonNullable<FieldDef["write"]>)(w, v)) } : {}),
    ...(f.boxed !== undefined ? { boxed: { ...f.boxed, write: (w: WorkingHousehold, b: Record<string, unknown> | undefined) => wrap(w, (f.boxed as NonNullable<FieldDef["boxed"]>).write(w, b)) } } : {}),
    ...(time !== undefined ? { time: { ...time, setWhen: (w: WorkingHousehold, tp: Timepoint | null, how: "auto" | "this") => wrap(w, time.setWhen(w, tp, how)) } } : {}),
  } as FieldDef;
}

/** 配列の中から ID で物を探す Finder */
export function byId(list: (h: Household) => unknown[] | undefined, id: string): Finder {
  return (h) => (list(h) ?? []).find((x) => (x as Obj).id === id) as Obj | undefined;
}

export function removeAction(key: string, label: string, level: Level, run: (h: Household, wh: WorkingHousehold) => WorkingHousehold | void): ActionDef {
  return {
    key,
    label,
    level,
    danger: true,
    run: (wh) => {
      let out: WorkingHousehold | null = null;
      const next = mutate(wh, (h) => {
        const r = run(h, wh);
        if (r) out = r;
      });
      return out ?? next;
    },
  };
}

/**
 * 未入力の警告の欄を、入るまで標準に出す（どの入力項目にも同じ決まり。2026-11-06 の利用者の判断）: raised の欄（未入力〔0円で計算している〕の
 * 詳細の欄）を標準にし、詳細のまとまり・区画の中にあれば、そのまとまり・区画も標準にする（ほかの詳細の欄は今のまま「▸」の中・詳細）。
 * 名義と持分が「持分の無い人がいる」ときだけ標準に上がるのと同じ形。どの欄を上げるかは画面の側（入力のパネル）が決める（開いている間は、
 * 入れた後も下げない。入れた途端に欄が消えると、打った所を見失うため。次に開いたときは元の標準・詳細）
 */
export function raiseFields(stage: StageDef, raised: ReadonlySet<string>): StageDef {
  if (raised.size === 0) return stage;
  const up = (f: FieldDef): FieldDef => (raised.has(f.key) && f.level === "detail" ? { ...f, level: "simple" } : f);
  const sections = stage.sections.map((s) => {
    const groups = s.groups.map((g) => {
      const fields = g.fields.map(up);
      if (fields.every((f, i) => f === g.fields[i])) return g;
      // 詳細のまとまりを上げたときは、物の中の中枠にする（見出しのあるまとまりが物の頭になって「▸」が2つ並ばないように。ほかの詳細の欄は物の頭の「▸」で開く）
      return { ...g, fields, ...(g.level === "detail" && g.simpleOnly !== true ? { level: "simple" as const, band: true } : {}) };
    });
    if (groups.every((g, i) => g === s.groups[i])) return s;
    return { ...s, groups, level: "simple" as const };
  });
  return { ...stage, sections };
}

/** 段階の全部の欄（テスト・数え上げ用） */
export function allFields(stage: StageDef): FieldDef[] {
  return stage.sections.flatMap((s) => s.groups.flatMap((g) => g.fields));
}
