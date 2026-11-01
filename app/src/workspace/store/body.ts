// 世帯ファイルの本文（0011 の2）を、画面の側の状態から組み立てる・読み取る。暗号化とファイルの読み書きは本体（0013・0016 の1）。
// 本文の区画（形式の版 0.50。β公開まではこの 0.x の形で、版を上げるときは本体の一方向の変換の段を足す。0011 の5）。
// 0.17 から（0035・0036）: 差分は当て先で、仮の印は物の値の状態の欄で、贈与者は世帯の外の家族の構成員で書き、並びの要素は ID を持つ。
// 0.18 から（0040）: 段階と例外の年（周期的な支出・家賃・修繕費・固定資産税・不動産の家賃と経費・器の利回り・資産配分）と、働き方の期間ごとの
// 伸び（給与・事業所得の年率）。足すだけの形（本体の変換の段は版だけを書き換える）
// 画面の中は 0.16 と同じ形のまま使い、ここで読み書きするときに format017.ts で直す（入力画面を作り直すまで）
// - meta: 形式名・形式の版・保存日時・アプリの版・表示用の顧客番号、誰が直したか（保存した人・改訂の履歴・出てくるメンバーの表示名。本体が入れる。0023 の6）
// - household: 現状の世帯（計算の要求と、画面の側の値: 呼び名・定年後の予定・FP用のメモとその行ごとの書いた人・万一の想定の前提・足した項目など）。
//   0.9 から: 教育の目標の保育所の段の保育の時間・自治体の水準の割合と、給食費の選び方（0029。保育所の段の空の月額は収入から自動で計算する読み方）
//   0.11 から: 前提の黒字のうち貯まる割合（surplusSaving）と、まとめた金融資産の器の運用しない分（uninvested。0031）。
//   0.12 から: 生活防衛資金（0.11 の前提 emergencyReserve）をなくした（本体の変換の段で捨てる。控えの中身は残り、計算するときに外す。0031 の追記）
//   0.19 から: 世帯の外の家族のお金 members[].wallet（預金・生活費・年金・一時の入金。0042。任意）
//   0.20 から: お金の行（0044。入るお金の行 incomeFlows、出るお金の行に足した月額・種類・相手・払う人・優先度・あげる贈与、口座の間の移し替えの
//   入れ物 transfers、相続で受け継ぐ借金の元の借り手・見込み・基本の計算に入れる。どれも任意）
//   0.21 から: 住まい・ローンのカード（0052・0053。住まいの建て方 style・譲渡所得の税の額 sale.tax・負債の名前 label と種類の細目 subtype、
//   画面の側のローンの入れ方の区分 loanEntry。どれも任意）
//   0.22 から: 退職金・企業年金のカード（0057。退職給付の名前 label と学歴 education。どれも任意。計算には使わない）
//   0.23 から: 子ども・教育のカード（0062。教育の目標の学校外の費用の入れ方 outOfSchoolMode・塾・習い事の行の種類 lessons[].kind。どれも任意）
//   0.24 から: 相続・贈与のカード（0060・0061。計算の要求の入力の、相続税の目安の設定 inheritanceTax〔時点を入れない〕と遺したい額 legacy。どれも任意）
//   0.25 から: 保険のカード（0054・0055。保険の種類の細目 subtype・名前 label、保障の行の被保険者 insured・入院の1回の限度日数 maxDays・
//   給付の種類 threeMajorLump、円の目安の形 simple.estimate、万一の前提の病気の想定 contingency.illness の disease・hospitalDays・surgeries。どれも任意）
//   0.26 から: 車のカード（0069。車の維持費の入れ方 cars[].upkeepMode と内訳の名前つきの行 cars[].upkeepOther。どれも任意）
//   0.27 から: 前提条件と万一のタブの前提（0070・0071。万一の前提 contingency の子の独立とみなす年齢・業務上の死亡・必要保障額の出し方 protection・
//   働き方を変える時点 work.<人>.from・復帰の後の働き方・収入が減る incomeDrop・下げる資産と戻り方・重ねる印 stackMarket、前提と推定の一覧の
//   確かめた記録 agreed。どれも任意。万一の前提のプランごとの上書きは、向き先 {plan: "contingency"} の差分）
//   0.28 から: 年金のカード（0066・0067。入るお金の行の受給中の遺族年金・障害年金の種類 incomeFlows[].pensionType と、画面の側の
//   年金の入れ方を切り替えたときに残した前の記録 pensionKept。どれも任意）
//   0.29 から: 確かめの一覧の「次回確かめる」の印 recheck（0072。行の ID・付けたときのカードと見出し・付けた日。任意。印が無ければ欄を作らない）
//   0.30 から: 年金の記録が無い人（推計の区分）の受け取り開始 members[].pensionClaim（0078。基礎・厚生の受給を始める時点。任意。計算に使う）
//   0.31 から: 収益不動産の物件を見分ける欄 accounts[].property の name・kind・location・share・tenure・units・area・memo（0079。どれも任意で表示用。計算には使わない）
//   0.32 から: 収益不動産のお金の欄 accounts[].property の acquisition（内訳 parts・建物附属設備の耐用年数 equipmentLife・諸費用 costs・自己資金 equity）・
//   rental（共益費 commonFee・駐車場 parking・その他 otherMonthly・礼金と更新料 keyMoney）・expenses.items（経費の費目）・repairs（大きな修繕）・
//   lodging（民泊・宿の営業の形と売上）（0080。どれも任意）
//   0.33 から: 税と出口の欄 accounts[].property の sale.repayLoan（売ったときにローンを返す）・lodging.incomeKind（民泊・宿の所得の区分）と、
//   members[].taxReturn（申告の仕方と青色申告特別控除の区分）（0081。どれも任意）
//   0.34 から: 画面の側の入力項目の選び方 itemChoice（0083。入力のホームに出さない入力項目 hidden と、開いたときの入れ方 levels〔詳細の項目だけ〕。
//   任意。決めていなければ欄を作らない。計算には使わない）
//   0.35 から: 確かめの注意の「確認した」の印 noticeAcks（0041・0055。注意の ID・確認したときの中身〔注意を作った物の ID〕・確認した日。
//   任意。印が無ければ欄を作らない。計算には使わない）
//   0.36 から: 万一の前提の、就業不能・収入が減るの場面の配偶者の働き方 contingency.partnerWork（0085。場面の種類 → 構成員の ID → 働き方。
//   任意。計算に使う。プランごとの上書きは入力項目ID contingencyPremise.partnerWork の差分）
//   0.37 から: 入るお金の行の表の行に「雑所得」incomeFlows[].row = cf.income.other.miscellaneous（0086。選べる値を足すだけ。計算に使う）
//   0.38 から: 給与からの推定のままの標準報酬月額の置き換え口は書かない（空欄なら給与から毎年9月に決め直す。0047 の追記 2026-10-29 の2）。
//   本体の 0.37 → 0.38 の変換の段が前の推定を外し、開いたときの知らせ smrBlank を足す
//   0.39 から: 教育の目標の段の、給食費の選び方 schoolLunch・部活動などの費用 clubAnnual・保育所の段の保育料とは別にかかるお金 extraAnnual
//   （0062・0029 の追記 2026-10-30。どれも任意。計算に使う）
//   0.40 から: 教育の目標の留学 abroad（0088。段・学年・留学の形・1回の額・万一のときの扱い。任意。計算に使う）
//   0.41 から: 教育の段の種類に大学院 graduateMaster・graduateDoctor、公立・私立にインターナショナルスクール international（0089。選べる値を足すだけ）
//   0.42 から: 教育の段の種類に高専 kosen・専門職大学院 graduateProfessional、系統に法科大学院 law（0090。選べる値を足すだけ）
//   0.43 から: 基本生活費の内訳に通信費 communication・交通費 transit・こづかいと交際費 pocketAndSocial・その他 other（0100。選べる値を足すだけ。
//   前の版の交通・通信 transport・その他の消費 otherConsumption は書き換えない）。本体の 0.42 → 0.43 の変換の段が基本生活費の「わからない」を推定にし、
//   開いたときの知らせ livingUnknown を足す
//   0.44 から: 値の状態の「わからない」（unknown）を「書類で確かめる」にし、書類で確かめる欄（住民税・退職金と企業年金の見込み額・年金の加入月数・
//   今の住宅ローン・手術の額・自動車ローン）だけに残した（0041 の追記 2026-10-31。形は変えない）。本体の 0.43 → 0.44 の変換の段が、ほかの欄の
//   unknown を推定にし、開いたときの知らせ unknownEstimated を足す
//   0.45 から: 車の買い替え cars[].purchase.replace（買い替え続ける・この1台だけ・○歳まで）と、リース・長期レンタル cars[].lease（種類・月額・
//   借り始め・契約の年数・月額に含む物。リースの車は purchase を持たない）（0101。足すだけ。本体の変換の段は版だけを書き換える）
//   0.46 から: 夢プランを出るお金の行の種類 dream と行の dream（順位 rank・計算に入れるか include・ひとことメモ note）で、
//   子への援助 goals[].education.gifts[] の優先度 priority（必ず・できれば）を持つ（0103。足すだけ。本体の変換の段は版だけを書き換える）
//   0.47 から: 子の貸与の奨学金に返すのは誰か goals[].education.scholarships[].repaidBy（子が返す・世帯で返す。省略は子）、ほかのローンの種類
//   scholarshipFree（第一種・無利子）、時点の年齢の規則 schoolYearJanuary（子の成人式の行は子の年齢の時点）を持つ（0104。本体の変換の段は、
//   前の奨学金を世帯で返すにし、子が1人に決まる成人式の行をその子の年齢の時点に置き直す）
//   0.48 から: 役員として働く人の家計の側の欄（その他の資産の細目 accounts[].subtype の自社株〔出資額〕・会社への貸付金、ローンの細目
//   debts[].subtype の会社からの借入金 companyLoan、構成員の会社の借入の連帯保証の額 members[].companyGuarantee）と、家計の体力の目安の分母
//   display.balance.guide.basis（生活費・生活費＋ローン返済。省略は世帯から決める）を持つ（0105。足すだけ。本体の変換の段は版だけを書き換える）
//   0.49 から: 子の貸与の奨学金の種類 goals[].education.scholarships[].type（第一種 first・第二種 second。省略は第二種。表示と利率の目安の元だけ）を
//   持つ（0104 の追記 2026-11-01。足すだけ。本体の変換の段は版だけを書き換える。前の奨学金は入っている利率のまま第二種として読む）
//   0.50 から: 会社と合わせたバランスシート（法人経営者向けの機能）の入力 household.companyBs（会社の今のバランスシートの科目・基準日・毎月の
//   固定の支出・会社の段階・実力に直した額。計算の要求の外。入れていなければ欄を持たない。0107。足すだけ。本体の変換の段は版だけを書き換える）
//   （0.46 のまま。0041 の追記 2026-11-01）: 「書類で確かめる」は今の自動車ローン（kind car の負債）の欄に出し、これから買う車のローン
//   （cars[].valueStates の car.loan/…）には出さない。前に付けた所は読むときに推定にし、開いたときの知らせ carLoanEstimated を足す（形は変えない）
// - proposals: 案（数に上限なし。0008 の5）。案の名前は `title` に入れる（0012 の禁止語の検査に当たらない名前）
// - hearing: ヒアリングの依頼・取り込み・同意の下書きの記録（0018。取り込みの記録・同意の記録への分け方は後の版）
// - workspace: 案の帯の並び・基準の案・選んだ案・対策に足した項目・出発点にした見本
// - display: 表示の設定（世帯ごと。タブごとの区画に分ける。0.8 から）:
//   - display.result: 結果のタブ（出す数字・○歳時点の年齢・グラフの比べ方・資産の推移の口座の内訳と運用の期間の帯）
//   - display.balance: 資産と負債のタブ（家計の体力の目安の幅 guide・時点を並べるときの既定の時点 points・この世帯で選んだ時点 columns、
//     0.13 から お金の3つの分け方 moneyThree（何か月分 months・何年先まで years・呼び方 wording。0032））
//   0.7 までは display の直下に平らに置いていた（bsGuide・bsPoints・bsColumns と、なくした「操作中はグラフを上に表示」の dock）。
//   本体の変換の段（0.7 → 0.8）が区画へ移す。画面の側も、区画の無い本文は直下の値から読む
// - snapshots: 控え（0009 の2。PDF を書き出した時点・FP が残した時点の写し。0.3 から。控えが無ければ区画を作らない）。
//   0.10 から: 持ち帰り用のレポートを書き出した時点の写し（きっかけ takeaway と、載せたプラン・パスワードの有無だけの記録 takeaway。0030）
// - statements: 明細の取り込みの記録（0034。0.14 から。取り込んでいない世帯は区画を作らない）。元のファイルは持たず、指紋・読み手・
//   列の対応付け・期間・番号を消した後の行と FP が決めたこと・世帯の決まり・働き方・候補を取り込んだ記録だけ。読むときは statement/ の
//   readLog で形を確かめる（形の合わないものは捨てる）。0.15 から: 前もってお客さまに印を付けてもらう確認シートの依頼の記録 requests
//   （依頼番号・書き出した日時・書き出したファイルの指紋・シートの番号 → 行の対応・取り込んだ記録）。0.16 から: 店ごとにまとめた
//   シートの1行は、同じ番号に複数の行を対応させる
// - extDefinitions / ext: 拡張領域（0011 の4。読んだものをそのまま書き戻し、失わない）
//   公式の項目 ext.official.livingParts: 基本生活費の内訳を分けた行の額（0109。input/livingParts.ts。作業中の世帯の livingParts と行き来する。
//   形式の版は上げない。知らないアプリも拡張領域のまま書き戻す）
// 保存しないもの: 提案書の宛名（0012 の2。出力のときだけ）、保存していない案の変更（「案として保存」「上書き」で保存する）、
// 画面の一時的な状態（開いているタブ・パネル・文字の大きさなど）
import type { EngineRequest } from "../../engine/types.ts";
import { emptyPlan } from "../contingency/planData.ts";
import type { HearingLog } from "../hearing/sheet.ts";
import { withElementIds, withoutPlainMarks, type WorkingHousehold } from "../input/household.ts";
import { withoutFutureCarLoanDocs } from "../input/carLoanDocs.ts";
import { withLegacyAllowanceNotice } from "../input/livingAllowance.ts";
import { withLegacyPetNotice } from "../input/petTemplate.ts";
import { extWithParts, LIVING_PARTS_EXT, partsToSave, readLivingParts } from "../input/livingParts.ts";
import { CURRENT } from "../plans/band.ts";
import type { Proposal } from "../plans/plans.ts";
import { readSnapshots, type Snapshot } from "../snapshots/snapshots.ts";
import { readRecheck } from "../input/recheck.ts";
import { readNoticeAcks } from "../input/noticeAck.ts";
import { isEmptyChoice, readItemChoice } from "../input/itemChoice.ts";
import { readBsColumns, readBsGuide, readBsPoints } from "../balanceTab.ts";
import { readMoneyThree } from "../moneyThree.ts";
import { readCombinedInput } from "../../../../report/src/index.ts";
import { readLog, type StatementLog } from "../../../../statement/src/index.ts";
import { fromStoredBody, OUTSIDE_KEPT, toStoredBody } from "./format017.ts";
import { DEFAULT_DISPLAY_SETTINGS, LAYOUT_CHOICES, METRIC_CHOICES, type BalanceSettings, type DisplaySettings, type MetricKey } from "../settings.ts";

/** 本文の形式の版（本体の household-store の migrate::CURRENT と同じ） */
export const BODY_FORMAT_VERSION = "0.50";

type StoredProposal = Omit<Proposal, "name"> & { title: string };

/** 表示の設定（タブごとの区画。0.8 から） */
export interface StoredDisplay {
  result: DisplaySettings;
  balance: BalanceSettings;
}

export interface SavedWorkspace {
  /** 出発点にした見本の世帯（目盛り・既定の値に使う）。空から作った世帯は null */
  template: string | null;
  band: string[];
  base: string;
  selected: string;
  shownItems: string[];
}

export interface HouseholdBody {
  meta?: Record<string, unknown>;
  household: Omit<WorkingHousehold, "proposals" | "hearing" | "snapshots" | "statements">;
  proposals: StoredProposal[];
  hearing: HearingLog | null;
  /** 控え（0.3 から。無ければ区画ごと省く） */
  snapshots?: Snapshot[];
  /** 明細の取り込みの記録（0.14 から。取り込んでいなければ区画ごと省く。0034） */
  statements?: StatementLog;
  workspace: SavedWorkspace;
  display: StoredDisplay;
  extDefinitions: Record<string, unknown>;
  ext: Record<string, unknown>;
}

/** 画面の側の状態（本文の中身） */
export interface BodyState {
  wh: WorkingHousehold;
  workspace: SavedWorkspace;
  display: StoredDisplay;
  /** 読んだ拡張領域（書き戻すため）。outside は贈与者に戻した世帯の外の家族の元の構成員（format017.ts の OUTSIDE_KEPT） */
  carry: { extDefinitions: Record<string, unknown>; ext: Record<string, unknown>; outside?: Record<string, unknown> };
}

export const EMPTY_CARRY: BodyState["carry"] = { extDefinitions: {}, ext: {} };

export function bodyObject(s: BodyState): HouseholdBody {
  const { proposals, hearing, snapshots, statements, livingParts: _parts, ...household } = s.wh;
  void _parts;
  // 内訳を分けた行の額は拡張領域に（0109。合計が今の額と同じ物だけ）
  const extra = extWithParts(s.carry, partsToSave(s.wh));
  return toStoredBody({
    household,
    proposals: proposals.map(({ name, ...p }) => ({ ...p, title: name })),
    hearing: hearing ?? null,
    ...(snapshots !== undefined && snapshots.length > 0 ? { snapshots } : {}),
    ...(statements !== undefined && hasStatements(statements) ? { statements } : {}),
    workspace: s.workspace,
    display: s.display,
    extDefinitions: extra.extDefinitions,
    ext: extra.ext,
    ...(s.carry.outside !== undefined && Object.keys(s.carry.outside).length > 0 ? { [OUTSIDE_KEPT]: s.carry.outside } : {}),
  } as unknown as Record<string, unknown>) as unknown as HouseholdBody;
}

/** 明細の取り込みの記録に、残す中身があるか（空の記録は区画を作らない） */
function hasStatements(l: StatementLog): boolean {
  return l.accounts.length > 0 || l.imports.length > 0 || l.rules.length > 0 || l.applied.length > 0 || Object.keys(l.styles ?? {}).length > 0 || (l.requests ?? []).length > 0;
}

/** 本文の JSON（本体の store_create・store_save に渡す） */
export function bodyOf(s: BodyState): string {
  return JSON.stringify(bodyObject(s));
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** 本文の JSON から画面の側の状態へ（形の合わない本文は E_BODY_SHAPE） */
export function fromBody(json: string): BodyState {
  const raw = JSON.parse(json) as unknown;
  if (!isObj(raw) || !isObj(raw.household) || !isObj(raw.household.request)) throw new Error("E_BODY_SHAPE");
  const b = fromStoredBody(raw);
  if (!isObj(b.household) || !isObj(b.household.request)) throw new Error("E_BODY_SHAPE");
  const { snapshots: _inHousehold, statements: _st, ...h } = b.household as unknown as Partial<WorkingHousehold> & { request: EngineRequest };
  void _inHousehold;
  void _st;
  const proposals: Proposal[] = (Array.isArray(b.proposals) ? (b.proposals as StoredProposal[]) : []).map(({ title, ...p }) => ({ ...p, name: title }));
  // 推定と呼ばない欄（性別）に前の版の画面で付けた仮の印は、読むときに外す（値はそのまま。household.ts の withoutPlainMarks）。
  // これから買う車のローンに付けた「書類で確かめる」は、読むときに推定にする（値はそのまま。carLoanDocs.ts。0041 の追記 2026-11-01）。
  // 内訳の仕送り（前の内訳）に値があれば、ほかの入力項目に移すよう知らせる（値はそのまま。livingAllowance.ts。0106）。
  // 前の「＋ 項目を追加」のペットの行があれば、えさ・用品と病気・けがの入れ先を知らせる（行はそのまま。petTemplate.ts。0106 の追記）
  const wh: WorkingHousehold = withLegacyPetNotice(withLegacyAllowanceNotice(withoutFutureCarLoanDocs(withoutPlainMarks({
    labelsByMember: {},
    postRetirement: {},
    memo: [],
    assumed: {},
    addedItems: [],
    confirmed: [],
    contingency: emptyPlan(),
    ...h,
    // 並びの要素に ID を振る（ID の無い古いデータは場所から決まった ID。0035 の5）
    request: withElementIds(h.request),
    proposals,
    ...(isObj(b.hearing) ? { hearing: b.hearing as unknown as HearingLog } : {}),
  }))));
  // 次回確かめるの印（0.29 から）: 形の合わない行は捨て、空なら欄を持たない
  const recheck = readRecheck(wh.recheck);
  if (recheck.length > 0) wh.recheck = recheck;
  else delete wh.recheck;
  // 確かめの注意の「確認した」の印（0.35 から）: 形の合わない行は捨て、空なら欄を持たない
  const acks = readNoticeAcks(wh.noticeAcks);
  if (acks.length > 0) wh.noticeAcks = acks;
  else delete wh.noticeAcks;
  // 入力項目の選び方（0.34 から）: 形の合わない所は捨て、何も決めていなければ欄を持たない
  // 会社と合わせたバランスシートの入力（0.50 から。0107）: 形の合わない所は捨て、何も無ければ欄を持たない
  const company = readCombinedInput(wh.companyBs);
  if (company !== null) wh.companyBs = company;
  else delete wh.companyBs;
  const choice = readItemChoice(wh.itemChoice);
  if (!isEmptyChoice(choice)) wh.itemChoice = choice;
  else delete wh.itemChoice;
  const snapshots = readSnapshots(b.snapshots);
  if (snapshots.length > 0) wh.snapshots = snapshots;
  if (isObj(b.statements)) {
    const statements = readLog(b.statements);
    if (hasStatements(statements)) wh.statements = statements;
  }
  const w = isObj(b.workspace) ? b.workspace : {};
  const workspace: SavedWorkspace = {
    template: typeof w.template === "string" ? w.template : null,
    band: strings(w.band),
    base: typeof w.base === "string" ? w.base : CURRENT,
    selected: typeof w.selected === "string" ? w.selected : CURRENT,
    shownItems: strings(w.shownItems),
  };
  const display = readDisplay(b.display);
  // 内訳を分けた行の額（0109。拡張領域から作業中の世帯へ。書き戻すときは bodyObject が入れ直す）
  const ext = isObj(b.ext) ? b.ext : {};
  const parts = readLivingParts(ext[LIVING_PARTS_EXT]);
  if (Object.keys(parts).length > 0) wh.livingParts = parts;
  else delete wh.livingParts;
  const { [LIVING_PARTS_EXT]: _parts, ...restExt } = ext;
  void _parts;
  const defs = isObj(b.extDefinitions) ? b.extDefinitions : {};
  const { [LIVING_PARTS_EXT]: _def, ...restDefs } = defs;
  void _def;
  return {
    wh,
    workspace,
    display,
    carry: { extDefinitions: restDefs, ext: restExt, ...(isObj(b[OUTSIDE_KEPT]) ? { outside: b[OUTSIDE_KEPT] } : {}) },
  };
}

/**
 * 表示の設定を読む（タブごとの区画 display.result・display.balance。区画の無い 0.7 までの本文は直下の値から読む）。
 * 読めない値は既定。区画の中の知らない欄は持たない（なくした dock など）
 */
export function readDisplay(v: unknown): StoredDisplay {
  const d = isObj(v) ? v : {};
  const r = isObj(d.result) ? d.result : d;
  const bal = isObj(d.balance) ? d.balance : null;
  return {
    result: {
      metrics: strings(r.metrics).filter((k): k is MetricKey => METRIC_CHOICES.some((c) => c.key === k)),
      atAge: typeof r.atAge === "number" ? r.atAge : DEFAULT_DISPLAY_SETTINGS.atAge,
      layout: LAYOUT_CHOICES.some((c) => c.key === r.layout) ? (r.layout as DisplaySettings["layout"]) : DEFAULT_DISPLAY_SETTINGS.layout,
      invBreakdown: typeof r.invBreakdown === "boolean" ? r.invBreakdown : DEFAULT_DISPLAY_SETTINGS.invBreakdown,
      invPeriods: typeof r.invPeriods === "boolean" ? r.invPeriods : DEFAULT_DISPLAY_SETTINGS.invPeriods,
    },
    balance: {
      guide: readBsGuide(bal !== null ? bal.guide : d.bsGuide),
      points: readBsPoints(bal !== null ? bal.points : d.bsPoints),
      columns: readBsColumns(bal !== null ? bal.columns : d.bsColumns),
      moneyThree: readMoneyThree(bal !== null ? bal.moneyThree : undefined),
    },
  };
}

/** 一覧に出す構成の要約（続柄と人数だけ。氏名・年齢は入れない）。例: 本人・配偶者・子2人 */
export function summaryOf(req: EngineRequest): string {
  const ms = req.input.household.members;
  const parts: string[] = [];
  if (ms.some((m) => m.kind === "self")) parts.push("本人");
  if (ms.some((m) => m.kind === "spouse")) parts.push("配偶者");
  const kids = ms.filter((m) => m.kind === "child").length;
  if (kids > 0) parts.push(`子${kids}人`);
  const others = ms.filter((m) => m.kind !== "self" && m.kind !== "spouse" && m.kind !== "child").length;
  if (others > 0) parts.push(`ほか${others}人`);
  return parts.join("・");
}
