// ライフイベントのカード（0068）: 一時的支出・何年かごとの支出（結婚・子の成人式・親の葬儀・法事・お墓・特別な旅行・大きな買い物・資格・予備費）と、
// その他の一時的収入（祝い金・お見舞い・一時の給付金・動産の売却・一時所得・その他の入金）。ほかのカードに置いた予定も含めた「この世帯の予定」を読むだけで並べる。
// 車（cars.ts）・FP顧問料（fees.ts）は別の項目。介護の費用は介護・親の項目（care.ts。careGroup はここに置いたまま使う）、種類の無い古い行で子の年齢で
// 始まる支出は子ども・教育のカード、介護・親と相続・贈与のお金の行はそれぞれのカードに出す。FP が「＋ 項目を追加」で足した物もここに出る（ホームのピンは見せ方だけ。items.ts）
import type { CareExpense, EducationGift, Household, IncomeFlow, Member, PeriodicExpense, Timepoint } from "../../../engine/types.ts";
import { lifeExpectancy } from "../../../../../hearing/src/estimates.ts";
import { addMonths, ageAt } from "../../levers.ts";
import { resolveTimepoint } from "../../timepoint.ts";
import { livingEstimate } from "../estimates.ts";
import { byId, field, plain, removeAction, timepointField, yenBox, type ActionDef, type FieldDef, type GroupDef, type SectionDef, type StageDef } from "../form.ts";
import { mutate, newId, standardBox, type WorkingHousehold } from "../household.ts";
import { CARE_PLACE, memberLabel, memberOptions } from "../labels.ts";
import { addExpense, addIncome, cadenceOf, expenseCard, growthFields, incomeCard, moneySections, OUT_ROWS, OUT_ROWS_BY_KIND, periodicGroup, periodicGroups } from "../moneyRows.ts";
import { isDream } from "../../../engine/moneyRows.ts";
import { addDream, DREAM_TEMPLATES, dreamRows, moveDream } from "../dreams.ts";
import { deathEstimate, hasBirth } from "../fill.ts";
import { manYen, readGroup, readLine } from "../readLines.ts";
import { overlapYears, scheduleItems, yearLabel } from "../schedule.ts";
import { clearsAssumed } from "./care.ts";
import { defaultStages } from "./education.ts";
import { onContingencyDetailFields, onContingencyFields } from "./onContingency.ts";

// 出るお金の行のまとまり（周期的な支出）は、どのカードでも同じ形（moneyRows.ts。0044）
export { periodicGroup, periodicGroups, periodicStageGroups } from "../moneyRows.ts";

const cares = (h: Household) => h.careExpenses;

/** もう始まっている介護か（始まりが計算の基準の月より前） */
export function careStarted(wh: WorkingHousehold, c: CareExpense): boolean {
  const from = resolveTimepoint(wh.request.input.household, c.from);
  return from !== null && from < wh.request.input.baseMonth;
}

/**
 * 介護の費用の欄。始まり・期間・月々の費用は詳細（空欄の期間と額は統計の目安。見出しの1行に出る）。
 * もう始まっている介護だけ、月々の費用を標準に出す（今かかっている額は顧客が答えられ、目安より確か）
 */
export function careGroup(wh: WorkingHousehold, c: CareExpense): GroupDef {
  const find = byId(cares, c.id);
  const k = `ev/care/${c.id}`;
  const started = careStarted(wh, c);
  return {
    key: k,
    title: `介護の費用（${memberLabel(wh, c.member)}）`,
    note: "空欄の額は統計の目安（生命保険文化センターの調査など）で計算します",
    level: "simple",
    fields: [
      plain({ key: `${k}/member`, item: "care.member", label: "介護を受ける人", level: "simple", kind: "select", options: memberOptions(wh), find, path: ["member"] }),
      timepointField({ key: `${k}/from`, item: "care.from", label: "始まり", level: "detail", find, path: ["from"], ageOf: (h) => h.members.find((m) => m.id === (h.careExpenses ?? []).find((x) => x.id === c.id)?.member), anchor: "careStart" }),
      plain({ key: `${k}/months`, item: "care.months", label: "期間", level: "detail", kind: "int", suffix: "か月", min: 1, max: 600, find, path: ["months"], optional: true }),
      plain({ key: `${k}/place`, item: "care.place", label: "在宅か施設か", level: "simple", kind: "select", options: CARE_PLACE, find, path: ["place"], optional: true, fallback: "home" }),
      yenBox({ key: `${k}/other`, item: "care.otherMonthly", label: "月々の費用（自己負担の合計）", level: started ? "simple" : "detail", basis: "monthly", find, path: ["otherMonthly"], optional: true, help: "空欄は統計の目安（在宅・施設の平均の月額）で計算します。施設の請求書の額などで入れてください。介護保険の1割負担の前の額が分かれば、詳細の「介護保険の対象の費用」に分けて入れます" }),
      yenBox({ key: `${k}/service`, item: "care.serviceMonthly", label: "介護保険の対象の費用（月額・1割負担の前の10割）", level: "detail", basis: "monthly", find, path: ["serviceMonthly"], optional: true, help: "入れると、所得に応じた自己負担の割合（1〜3割）と高額介護サービス費の上限を当てます。空欄は上の月々の費用だけで計算します" }),
      yenBox({ key: `${k}/initial`, item: "care.initial", label: "一時費用", level: "detail", basis: "once", find, path: ["initial"], optional: true, help: "住宅の改修・入居金など。空欄は統計の目安（一時費用の平均）で計算します" }),
      plain({ key: `${k}/payer`, item: "care.payer", label: "払う人", level: "detail", kind: "select", options: [{ value: "", label: "介護を受ける人" }, ...memberOptions(wh)], find, path: ["payer"], optional: true, fallback: "", help: "介護を受ける人が世帯の外の家族で、その人のお金を見ているときは、まずその人のお金から払い、尽きた月からここで選んだ人が払います" }),
      ...growthFields(k, "care.growth", find, c.id, c.growth),
      ...onContingencyFields({ key: `${k}/on`, item: "care.onContingency", find, path: ["onContingency"], level: "detail", help: "払う人の万一（死亡など）が起きた月の翌月から、この扱いにします" }).map((x) => ({ ...x, address: () => ({ target: { object: c.id }, item: "care.onContingency", at: [] }) })),
      ...onContingencyDetailFields({ key: `${k}/on`, item: "care.onContingency", find, path: ["onContingency"], on: c.onContingency, level: "detail" }).map((x) => ({ ...x, address: () => ({ target: { object: c.id }, item: "care.onContingency", at: [] }) })),
    ],
    actions: [removeAction(`${k}/remove`, "外す", "simple", (h) => void (h.careExpenses = (h.careExpenses ?? []).filter((x) => x.id !== c.id)))],
  };
}

/**
 * 種類の無い古い周期的な支出のうち、子の年齢で始まる物の子（その物は子ども・教育のカードの、その子の所に出す。前の留学など）。無ければ null。
 * 種類のある行（ライフイベントの支出・その他の支出）は、子の年齢で始まってもライフイベントに出す（子の成人式など。0068 の追記 2026-10-31）
 */
export function childOfPeriodic(h: Household, p: PeriodicExpense): string | null {
  // ほかのカードに属する種類のお金の行（仕送り・贈与など）は、その種類のカードのまま。ライフイベントの種類を選んだ行もライフイベントのまま
  if (expenseCard(h, p) !== "events" || p.kind !== undefined) return null;
  const id = p.from.memberAge?.member;
  return id !== undefined && h.members.some((m) => m.id === id && m.kind === "child") ? id : null;
}

/** ライフイベントのカードに出す出るお金の行（種類がライフイベントの行。子の年齢で始まる行と、夢プランの夢は除く） */
export const eventExpenses = (h: Household): PeriodicExpense[] => (h.periodicExpenses ?? []).filter((p) => expenseCard(h, p) === "events" && !isDream(p) && childOfPeriodic(h, p) === null);

/** ピンにした物も、属するカードに出す（ピンは見せ方だけ。0045） */
export const NONE_CLAIMED: ReadonlySet<string> = new Set();

// ---- ひな形（0068。額・時期は推定〔目安のボタンの値〕。額の無いひな形は未入力の警告） ----

/** ひな形のまとまり（画面ではまとまりごとに1行、小さな見出しの後にボタンを並べる） */
export type EventTemplateGroup = "family" | "parents" | "fun" | "reserve";
export const TEMPLATE_GROUPS: readonly { key: EventTemplateGroup; label: string }[] = [
  { key: "family", label: "家族の節目" },
  { key: "parents", label: "親・お墓" },
  { key: "fun", label: "楽しみ・学び" },
  { key: "reserve", label: "備え" },
];

/**
 * 出るお金のひな形: ボタンの名前・足した行の名前・まとまり・額（1回の額。null は未入力の警告）・何年ごと（1回は null）・優先度・
 * 足したかを見分ける名前の形（行の名前は FP が直せるので、名前の形で見る）
 */
export interface EventTemplate {
  key: string;
  label: string;
  name: string;
  group: EventTemplateGroup;
  amount: number | null;
  everyYears: number | null;
  priority: "need" | "want";
  help?: string;
  match: RegExp;
}

/** 1回の行のひな形の名前の形（くり返す行は数えない。前の「家族旅行」〔毎年〕は特別な旅行に数えない） */
const ONCE_ONLY: ReadonlySet<string> = new Set(["specialTrip"]);

/**
 * 出るお金のひな形（10。額は推定。根拠はよくある額の目安。0068 の追記 2026-10-31）。どれも表の行は一時的支出。
 * 前のひな形「家族旅行（毎年30万円）」は外した（ふだんの旅行は基本生活費の趣味・娯楽。前に入れた行はふつうの行のまま）。
 * 前の「リフォーム以外の大きな買い物」は「大きな買い物（趣味の道具など）」にした（前に入れた行の名前はそのまま）
 */
export const OUT_TEMPLATES: readonly EventTemplate[] = [
  { key: "wedding", label: "結婚の費用", name: "結婚の費用", group: "family", amount: null, everyYears: null, priority: "need", help: "時期は、配偶者が家族に加わる時期（入っていなければ1年後）です。額は入れてください", match: /結婚の費用|挙式|結婚式/u },
  { key: "comingOfAge", label: "子の成人式（振袖・スーツ・写真）", name: "成人式", group: "family", amount: 150000, everyYears: null, priority: "need", help: "20歳前の子ごとに、その子が20歳になる時期で1行ずつ足します（1人15万円の目安）", match: /成人式/u },
  { key: "childWedding", label: "子の結婚の援助", name: "結婚の援助", group: "family", amount: 1000000, everyYears: null, priority: "want", help: "子ども・教育の入力項目の「子への援助（結婚資金）」として、30歳前の子ごとに、その子が30歳になる時期で足します（1人100万円の目安）。直すときは子ども・教育の入力項目で直します。援助の優先度は「できれば」にします（結果の「確実な分だけ」で外して見られます。子ども・教育の入力項目で直せます）", match: /結婚の援助/u },
  { key: "funeral", label: "親の葬儀（世帯が払う分）", name: "葬儀", group: "parents", amount: 1200000, everyYears: null, priority: "need", help: "親ごとに1行ずつ、世帯が払う分を足します（1回120万円の目安）。時期は、親の年齢と性別から平均余命で見た推定です（亡くなる見込みが入っていればその時期）。香典は入るお金で入れられます。葬儀の費用を相続税から引く扱いは、相続・贈与の入力項目で見ます", match: /葬儀|葬式/u },
  { key: "memorial", label: "法事", name: "法事", group: "parents", amount: 200000, everyYears: null, priority: "need", help: "時期は、葬儀の行があればその1年後（一周忌）、無ければ1年後です", match: /法事|法要|一周忌|回忌/u },
  { key: "grave", label: "お墓・仏壇", name: "お墓・仏壇", group: "parents", amount: null, everyYears: null, priority: "need", help: "お墓や仏壇の費用は、墓じまい・永代供養・新しく建てるなどで0〜300万円ほどと幅があります。額を入れてください", match: /墓|仏壇/u },
  { key: "specialTrip", label: "特別な旅行", name: "特別な旅行", group: "fun", amount: null, everyYears: null, priority: "want", help: "名前の欄に中身を書きます（ハワイ旅行・結婚20周年の旅行など）。額は、海外なら80万円・国内なら30万円ほどが目安です。毎年のふだんの旅行は基本生活費の「趣味・娯楽」に入れます", match: /旅行/u },
  { key: "purchase", label: "大きな買い物（趣味の道具など）", name: "大きな買い物", group: "fun", amount: 500000, everyYears: null, priority: "want", help: "趣味の道具・楽器など、ふだんの生活費とは別の大きな買い物です（1回50万円の目安）。家電・家具・スマホの買い替えは基本生活費、住まい・車はそれぞれの入力項目で入れます", match: /大きな買い物|趣味の道具/u },
  { key: "study", label: "資格・学び直し", name: "資格・学び直し", group: "fun", amount: 300000, everyYears: null, priority: "want", help: "資格の講座・学び直しの費用です（1回30万円の目安）。教育訓練給付を受けるときは、働き方と収入の入力項目で入るお金を入れます", match: /資格|学び直し/u },
  { key: "reserve", label: "予備費", name: "予備費", group: "reserve", amount: null, everyYears: 1, priority: "need", help: "毎年、今の生活費の1か月分を入れます（足した後に直せます）", match: /予備費/u },
];

const UNENTERED = "未入力（額を入れてください。0円で計算中）";
const everyText = (n: number) => (n === 1 ? "毎年" : `${String(n)}年ごと`);

/**
 * ひな形の推定の根拠の文（ボタンには額を出さない）。原本で確かめた統計ではないので「よくある額の目安」「よくある間隔の目安」と書く。
 * 何年ごとはくり返すひな形だけ（1回の行には何年ごとの欄が無い）。per は1人あたりなどの添え書き
 */
export const eventBasis = (t: Pick<EventTemplate, "label" | "everyYears"> & { amount: number }, per = "") => ({
  amount: `よくある額の目安（${t.label} ${per}${t.everyYears === null ? "1回" : t.everyYears === 1 ? "年" : `${String(t.everyYears)}年ごとに`}${manYen(t.amount)}。この世帯に合わせて直してください）`,
  everyYears: t.everyYears === null ? null : `よくある間隔の目安（${t.label} ${everyText(t.everyYears)}。この世帯に合わせて直してください）`,
});

/** 1年後（計算の基準の月の12か月後） */
const nextYear = (wh: WorkingHousehold): Timepoint => ({ at: addMonths(wh.request.input.baseMonth, 12) });

/** これからの時点か（計算の基準の月より後） */
const ahead = (wh: WorkingHousehold, t: Timepoint | null | undefined): boolean => {
  const ym = resolveTimepoint(wh.request.input.household, t);
  return ym !== null && ym > wh.request.input.baseMonth;
};

/** 時期の仮の印（時点の欄は値の箱を持たないので、欄のキーで持つ。直すと外れる） */
const withTimingMark = (wh: WorkingHousehold, id: string, basis: string | null): WorkingHousehold => (basis === null ? wh : { ...wh, assumed: { ...wh.assumed, [`ev/${id}/from`]: basis } });

/**
 * ひな形の出るお金の行を足す（時期は既定で1年後。額は目安＝推定。額の無いひな形は未入力の警告）。表の行は一時的支出。
 * くり返すひな形の何年ごとも推定（物の値の状態の欄を持たない数なので、仮の印で持つ。年払いのひな形と同じ）
 */
export function addEventTemplate(wh: WorkingHousehold, t: EventTemplate, id: string = newId(), o: { from?: Timepoint; name?: string; per?: string; fromBasis?: string | null } = {}): WorkingHousehold {
  const w = addExpense(wh, "general", id);
  const basis = t.amount === null ? null : eventBasis({ ...t, amount: t.amount }, o.per);
  const next = mutate(w, (h) => {
    const p = (h.periodicExpenses ?? []).find((x) => x.id === id);
    if (p === undefined) return;
    p.label = o.name ?? t.name;
    p.row = EVENT_ROW;
    p.everyYears = t.everyYears ?? 1;
    if (o.from !== undefined) p.from = structuredClone(o.from);
    p.to = t.everyYears !== null ? null : structuredClone(p.from);
    if (t.priority === "want") p.priority = "want";
    p.amount = (t.amount === null || basis === null ? standardBox(0, UNENTERED) : standardBox(t.amount, basis.amount)) as PeriodicExpense["amount"];
  });
  const marked = withTimingMark(next, id, o.fromBasis ?? null);
  return basis?.everyYears == null ? marked : { ...marked, assumed: { ...marked.assumed, [`ev/${id}/every`]: basis.everyYears } };
}

/** ライフイベントの出るお金の行の表の行（どの行も一時的支出。0068 の追記 2026-10-31） */
export const EVENT_ROW = "cf.expense.lumpSum.other";

/** 予備費の月額の元: 今の基本生活費の月額（総額か費目の合計）。生活費が無ければ人数の目安 */
export function livingMonthlyNow(wh: WorkingHousehold): number {
  const h = wh.request.input.household;
  const l = (h.livingExpenses ?? [])[0];
  const v = l === undefined ? null : l.mode === "total" ? (l.monthly?.value ?? null) : (l.categories ?? []).reduce((s, c) => s + (c.monthly.value ?? 0), 0);
  return v !== null && v > 0 ? v : livingEstimate(h, wh.request.input.baseMonth).value;
}

/** 予備費の根拠の文（額は足したときの生活費の1か月分。何年ごとは毎年） */
export const RESERVE_BASIS = {
  amount: (monthly: number) => `よくある額の目安（予備費 毎年、生活費の1か月分〔月${manYen(monthly)}〕。この世帯に合わせて直してください）`,
  everyYears: "よくある間隔の目安（予備費 毎年。この世帯に合わせて直してください）",
};

/** 予備費を足す: 毎年、足したときの生活費の1か月分（写す。生活費の割合として持ち続けない。額と何年ごとは推定） */
export function addReserve(wh: WorkingHousehold, id: string = newId()): WorkingHousehold {
  const monthly = Math.round(livingMonthlyNow(wh) / 10000) * 10000;
  const w = addExpense(wh, "general", id);
  const next = mutate(w, (h) => {
    const p = (h.periodicExpenses ?? []).find((x) => x.id === id);
    if (p === undefined) return;
    p.label = "予備費";
    p.row = EVENT_ROW;
    p.everyYears = 1;
    p.to = null;
    p.amount = standardBox(monthly, RESERVE_BASIS.amount(monthly)) as PeriodicExpense["amount"];
  });
  return { ...next, assumed: { ...next.assumed, [`ev/${id}/every`]: RESERVE_BASIS.everyYears } };
}

// ---- ひな形ごとの時期と、人ごとに足すひな形 ----

/** 子（世帯の中の子。離れて暮らす子は入れない）。生まれる予定の子も入れる */
const homeChildren = (h: Household): Member[] => h.members.filter((m) => m.kind === "child" && m.outside === undefined).sort((a, b) => a.birth.birthYearMonth.localeCompare(b.birth.birthYearMonth));
/** 親（本人・配偶者の親） */
const parentsOf = (h: Household): Member[] => h.members.filter((m) => m.kind === "parent");

/** 結婚の費用の時期: 配偶者がこれから家族に加わるならその時期、無ければ1年後 */
export function weddingTiming(wh: WorkingHousehold): Timepoint {
  const spouse = wh.request.input.household.members.find((m) => m.kind === "spouse");
  return spouse?.joins != null && ahead(wh, spouse.joins) ? structuredClone(spouse.joins) : nextYear(wh);
}

/** 生まれる予定の子の加わる時期（いちばん早い子）。いなければ null */
function expectedChildTiming(wh: WorkingHousehold): Timepoint | null {
  const kids = wh.request.input.household.members.filter((m) => m.kind === "child" && m.expected === true);
  const points = kids.map((m) => (m.joins != null ? m.joins : { at: m.birth.birthYearMonth })).filter((t) => ahead(wh, t));
  const ym = (t: Timepoint) => resolveTimepoint(wh.request.input.household, t) ?? "";
  return [...points].sort((a, b) => ym(a).localeCompare(ym(b)))[0] ?? null;
}

/** 本人の年齢から親の年齢を見るときの年の差（親の生年月が入っていないとき） */
export const PARENT_AGE_GAP = 30;

/**
 * 親の葬儀の時期の推定（聞かない。亡くなる見込みは聞きにくいので、平均余命で置く）:
 * - 親の亡くなる見込み（leaves）が入っていればその時期
 * - 親の生年月があれば、その親の年齢と性別の平均余命（簡易生命表）を足した年齢
 * - 親がいなければ（生年月も無ければ）、本人より30歳上の親とみて、その年齢の平均余命（男女の平均）を足した年の本人の年齢
 * - どれも過ぎていれば1年後
 * 根拠の文は時期の仮の印に書く
 */
export function funeralTiming(wh: WorkingHousehold, parent: Member | null): { from: Timepoint; basis: string } {
  const h = wh.request.input.household;
  const base = wh.request.input.baseMonth;
  const who = parent === null ? "親" : memberLabel(wh, parent.id);
  const later = (from: Timepoint, basis: string) => (ahead(wh, from) ? { from, basis } : { from: nextYear(wh), basis: `推定（${who}の亡くなる見込みの時期が過ぎているので1年後）` });
  if (parent !== null && parent.leaves != null) return later(structuredClone(parent.leaves), `推定（${who}の亡くなる見込みの時期に合わせました）`);
  if (parent !== null && hasBirth(parent)) {
    const est = deathEstimate(parent, base);
    if (est !== null) return later(est.point, est.basis.replace(/^推定（/u, `推定（${who}の年齢と性別から、`));
  }
  const self = h.members.find((m) => m.kind === "self");
  if (self !== undefined && hasBirth(self)) {
    const selfAge = Math.max(0, ageAt(self, base));
    const le = lifeExpectancy(selfAge + PARENT_AGE_GAP, undefined);
    if (le !== null) {
      const at = selfAge + Math.max(1, Math.floor(le.value));
      return later({ memberAge: { member: self.id, years: at } }, `推定（親の年齢を本人より${String(PARENT_AGE_GAP)}歳上とみて、${le.basis}から、本人が${String(at)}歳ごろ）`);
    }
  }
  return { from: nextYear(wh), basis: "推定（親の年齢が分からないので1年後）" };
}

/** 法事の時期: 葬儀の行（いちばん早い物）の1年後（一周忌）。年齢で持つ時期は年齢を1つ足す。無ければ1年後 */
export function memorialTiming(wh: WorkingHousehold): { from: Timepoint; basis: string | null } {
  const h = wh.request.input.household;
  const funeral = tmpl("funeral");
  const rows = eventExpenses(h).filter((p) => funeral.match.test(p.label ?? ""));
  const ym = (p: PeriodicExpense) => resolveTimepoint(h, p.from) ?? "9999-12";
  const first = [...rows].sort((a, b) => ym(a).localeCompare(ym(b)))[0];
  if (first === undefined) return { from: nextYear(wh), basis: null };
  const a = first.from.memberAge;
  const from: Timepoint = a !== undefined ? { memberAge: { ...a, years: a.years + 1 } } : { at: addMonths(ym(first), 12) };
  return { from, basis: `推定（${first.label ?? "葬儀"}の1年後〔一周忌〕）` };
}

const tmpl = (key: string): EventTemplate => OUT_TEMPLATES.find((t) => t.key === key) as EventTemplate;

/** 成人式を足す子（20歳になる前の子） */
const comingOfAgeKids = (wh: WorkingHousehold): Member[] => homeChildren(wh.request.input.household).filter((m) => ageAt(m, wh.request.input.baseMonth) < 20);

/** 結婚の援助を足す子（30歳になる前の子）。子ども・教育の進路（教育の目標）がまだ無く、これからの学校がある子は除く（進路の推定を先に入れる） */
function childWeddingKids(wh: WorkingHousehold): { ok: Member[]; noGoal: Member[] } {
  const h = wh.request.input.household;
  const base = wh.request.input.baseMonth;
  const kids = homeChildren(h).filter((m) => ageAt(m, base) < 30);
  const goalOf = (m: Member) => (h.goals ?? []).find((g) => g.kind === "education" && g.owner === m.id);
  const noGoal = kids.filter((m) => goalOf(m) === undefined && defaultStages(m, base).length > 0);
  return { ok: kids.filter((m) => !noGoal.includes(m)), noGoal };
}

/** 子への援助（結婚資金。子ども・教育の入力項目の物）の一覧（ライフイベントには読むだけで出す） */
export function childWeddingGifts(h: Household): { child: Member; at: Timepoint; amount: number; priority?: "need" | "want" }[] {
  const out: { child: Member; at: Timepoint; amount: number; priority?: "need" | "want" }[] = [];
  for (const g of h.goals ?? []) {
    const child = h.members.find((m) => m.id === g.owner && m.kind === "child");
    if (g.kind !== "education" || child === undefined) continue;
    for (const gift of g.education?.gifts ?? []) if (gift.purpose === "wedding") out.push({ child, at: gift.at, amount: gift.amount, ...(gift.priority !== undefined ? { priority: gift.priority } : {}) });
  }
  return out;
}

/**
 * 子の結婚の援助を足す: 子ども・教育の「子への援助（結婚資金）」（goals.education.gifts）に、子が30歳になる時期で1人100万円（世帯から出す。
 * 贈与する人は選ばない）。同じ援助を2つの所で入れて二重に数えないよう、ライフイベントの行にはしない。もう結婚資金の援助がある子は飛ばす
 * （どの子にもあれば、もう一度押すと全員に足す）。教育の目標が無い子（これからの学校が無い子）には、段の無い教育の目標を作って入れる
 */
export function addChildWedding(wh: WorkingHousehold, ids: () => string = newId): WorkingHousehold {
  const h0 = wh.request.input.household;
  const { ok } = childWeddingKids(wh);
  const has = new Set(childWeddingGifts(h0).map((x) => x.child.id));
  const targets = ok.some((m) => !has.has(m.id)) ? ok.filter((m) => !has.has(m.id)) : ok;
  if (targets.length === 0) return wh;
  const amount = tmpl("childWedding").amount as number;
  return mutate(wh, (h) => {
    for (const m of targets) {
      let g = (h.goals ?? []).find((x) => x.kind === "education" && x.owner === m.id);
      if (g === undefined) {
        g = { id: ids(), kind: "education", owner: m.id, education: { stages: [] } };
        (h.goals ??= []).push(g);
      }
      if (g.education === undefined) g.education = { stages: [] };
      (g.education.gifts ??= []).push({ id: ids(), at: { memberAge: { member: m.id, years: 30 } }, amount, purpose: "wedding", priority: "want" } as EducationGift);
    }
  });
}

/** 足した行（名前の形で見る。特別な旅行は1回の行だけ） */
function templateRows(h: Household, t: EventTemplate): PeriodicExpense[] {
  return eventExpenses(h).filter((p) => t.match.test(p.label ?? "") && (!ONCE_ONLY.has(t.key) || cadenceOf(h, p) === "once"));
}

/** 人ごとのひな形で、もう行がある人を飛ばす（全員にあれば全員にもう一度足す） */
function pending<T extends { id: string }>(people: readonly T[], done: (m: T) => boolean): T[] {
  const rest = people.filter((m) => !done(m));
  return rest.length > 0 ? rest : [...people];
}

/**
 * その人の行か: 時期がその人の年齢の行か、名前が「（その人の呼び方）の…」の行。時期を年月などに直した行も、名前でその人の行と見る
 * （成人式の時期を式の月に直した後に、もう一度押して同じ子に二重に足さない）
 */
const rowOf = (wh: WorkingHousehold, p: PeriodicExpense, m: Member): boolean => p.from.memberAge?.member === m.id || (p.label ?? "").startsWith(`${memberLabel(wh, m.id)}の`);

/** ひな形のボタンを押したとき（人ごとのひな形は人ごとに行を足す） */
export function addOutTemplate(wh: WorkingHousehold, key: string, ids: () => string = newId): WorkingHousehold {
  const t = tmpl(key);
  const h = wh.request.input.household;
  switch (key) {
    case "reserve":
      return addReserve(wh, ids());
    case "childWedding":
      return addChildWedding(wh, ids);
    case "wedding":
      return addEventTemplate(wh, t, ids(), { from: weddingTiming(wh) });
    case "comingOfAge": {
      const rows = templateRows(h, t);
      let w = wh;
      for (const m of pending(comingOfAgeKids(wh), (c) => rows.some((p) => rowOf(wh, p, c))))
        w = addEventTemplate(w, t, ids(), { from: { memberAge: { member: m.id, years: 20 } }, name: `${memberLabel(wh, m.id)}の成人式`, per: "1人 " });
      return w;
    }
    case "funeral": {
      const rows = templateRows(h, t);
      const parents = parentsOf(h);
      if (parents.length === 0) {
        const tm = funeralTiming(wh, null);
        return addEventTemplate(wh, t, ids(), { from: tm.from, name: "親の葬儀", fromBasis: tm.basis });
      }
      let w = wh;
      for (const m of pending(parents, (pa) => rows.some((p) => rowOf(wh, p, pa)))) {
        const tm = funeralTiming(wh, m);
        w = addEventTemplate(w, t, ids(), { from: tm.from, name: `${memberLabel(wh, m.id)}の葬儀`, fromBasis: tm.basis });
      }
      return w;
    }
    case "memorial": {
      const tm = memorialTiming(wh);
      return addEventTemplate(wh, t, ids(), { from: tm.from, fromBasis: tm.basis });
    }
    default:
      return addEventTemplate(wh, t, ids());
  }
}

/** 足したひな形の「入れた（2031年・80万円）」の文（3つまで。額が0円の行は「額は未入力」） */
function addedText(h: Household, list: readonly { at: Timepoint; amount: number }[]): string | undefined {
  if (list.length === 0) return undefined;
  const one = (x: { at: Timepoint; amount: number }) => {
    const ym = resolveTimepoint(h, x.at);
    return `${ym === null ? "時期は未定" : `${String(Number(ym.slice(0, 4)))}年`}・${x.amount > 0 ? manYen(x.amount) : "額は未入力"}`;
  };
  const ys = (x: { at: Timepoint }) => resolveTimepoint(h, x.at) ?? "";
  const sorted = [...list].sort((a, b) => ys(a).localeCompare(ys(b)));
  const shown = sorted.slice(0, 3).map(one).join("、");
  return `入れた（${shown}${sorted.length > 3 ? `ほか${String(sorted.length - 3)}件` : ""}）`;
}

/** ひな形のボタンが押せないときの理由（足す相手の人がいない） */
function unavailable(wh: WorkingHousehold, key: string): string | null {
  if (key === "comingOfAge" && comingOfAgeKids(wh).length === 0) return "（20歳前の子がいません）";
  if (key === "childWedding") {
    const k = childWeddingKids(wh);
    if (k.ok.length === 0) return k.noGoal.length > 0 ? "（先に子ども・教育で進路を入れてください）" : "（30歳前の子がいません）";
  }
  return null;
}

/** そのまとまりのひな形が当てはまる人のいない世帯か（子のいない・これから結婚しない世帯の「家族の節目」、親のいない世帯の「親・お墓」）。後ろに回す（隠さない） */
function groupAway(h: Household, g: EventTemplateGroup): boolean {
  if (g === "family") {
    const spouse = h.members.find((m) => m.kind === "spouse");
    return homeChildren(h).length === 0 && spouse !== undefined && spouse.joins == null;
  }
  return g === "parents" ? parentsOf(h).length === 0 : false;
}

/** ひな形のまとまりの並び（当てはまる人のいないまとまりは後ろ） */
export function templateGroupOrder(h: Household): EventTemplateGroup[] {
  const keys = TEMPLATE_GROUPS.map((g) => g.key);
  return [...keys.filter((k) => !groupAway(h, k)), ...keys.filter((k) => groupAway(h, k))];
}

/** 出るお金のひな形のボタン（標準・詳細とも、行を足した後も出す）。足したひな形はボタンの横に「入れた（…）」 */
function outTemplateGroup(wh: WorkingHousehold): GroupDef {
  const h = wh.request.input.household;
  const actions: ActionDef[] = [];
  for (const g of templateGroupOrder(h)) {
    const label = TEMPLATE_GROUPS.find((x) => x.key === g)?.label ?? "";
    for (const t of OUT_TEMPLATES.filter((x) => x.group === g)) {
      const added =
        t.key === "childWedding"
          ? addedText(h, childWeddingGifts(h))
          : addedText(h, templateRows(h, t).map((p) => ({ at: p.from, amount: p.amount.value ?? 0 })));
      const off = unavailable(wh, t.key);
      actions.push({
        key: `ev/template/${t.key}`,
        label: `＋ ${t.label}`,
        level: "simple",
        ...(t.help !== undefined ? { help: t.help } : {}),
        chip: { group: label, ...(off !== null && added === undefined ? { added: off, disabled: true } : added !== undefined ? { added } : {}) },
        run: (w) => addOutTemplate(w, t.key),
      });
    }
  }
  return { key: "ev/templates", title: "よくあるライフイベント（当てはまるものだけ足してください）", level: "simple", chips: true, fields: [], actions };
}

/** 子への援助（結婚資金）の読むだけの行（子ども・教育の入力項目で直す） */
function childWeddingLines(wh: WorkingHousehold): GroupDef | null {
  const h = wh.request.input.household;
  const lines = childWeddingGifts(h).map((x, i) => {
    const ym = resolveTimepoint(h, x.at);
    return readLine(`events/childWedding/${String(i)}`, `${memberLabel(wh, x.child.id)}の結婚の援助`, `${ym === null ? "" : `${String(Number(ym.slice(0, 4)))}年・`}${manYen(x.amount)}・${x.priority === "want" ? "できれば" : "必ず"}`, "子ども・教育");
  });
  return readGroup("events/childWedding", "子への援助（結婚資金）", lines, "子ども・教育の入力項目の「子への援助」です。直すときは子ども・教育の入力項目で直します（ここと二重には数えません）");
}

/** 入るお金のひな形（祝い金・一時の給付金。額は未入力の警告）。時期: 結婚のお祝いは配偶者が加わる時期、出産のお祝いは生まれる予定の子が加わる月 */
export const IN_TEMPLATES: readonly { key: string; label: string; help?: string }[] = [
  { key: "weddingGift", label: "結婚のお祝い", help: "時期は、配偶者が家族に加わる時期（入っていなければ1年後）です" },
  { key: "birthGift", label: "出産のお祝い", help: "時期は、生まれる予定の子が家族に加わる月（いなければ1年後）です。出産育児一時金は自動で計算します" },
  { key: "benefit", label: "一時の給付金" },
];

export function addIncomeTemplate(wh: WorkingHousehold, label: string, id: string = newId()): WorkingHousehold {
  const key = IN_TEMPLATES.find((t) => t.label === label)?.key;
  const from = key === "weddingGift" ? weddingTiming(wh) : key === "birthGift" ? (expectedChildTiming(wh) ?? null) : null;
  const w = addIncome(wh, "celebration", id);
  return mutate(w, (h) => {
    const f = (h.incomeFlows ?? []).find((x) => x.id === id);
    if (f === undefined) return;
    f.label = label;
    if (from !== null) {
      f.from = structuredClone(from);
      f.to = structuredClone(from);
    }
  });
}

/** 入るお金のひな形のボタン（行を足した後も出す。足したひな形は「入れた（…）」） */
function inTemplateActions(wh: WorkingHousehold): ActionDef[] {
  const h = wh.request.input.household;
  return IN_TEMPLATES.map((t): ActionDef => {
    const rows = (h.incomeFlows ?? []).filter((f) => incomeCard(f) === "events" && f.label === t.label);
    const added = addedText(h, rows.map((f) => ({ at: f.from, amount: f.amount.value ?? 0 })));
    return { key: `in/template/${t.key}`, label: `＋ ${t.label}`, level: "simple", ...(t.help !== undefined ? { help: t.help } : {}), chip: { group: "入るお金", ...(added !== undefined ? { added } : {}) }, run: (w) => addIncomeTemplate(w, t.label) };
  });
}

// ---- 入る⇄出るの付け替え・基本生活費へ移す（0068） ----

/** 出るお金の行を入るお金の行にする（同じ名前・額・時期。種類は「その他の入金」。行を外して足す） */
export function expenseToIncome(wh: WorkingHousehold, id: string, newRowId: string = newId()): WorkingHousehold {
  return mutate(wh, (h) => {
    const p = (h.periodicExpenses ?? []).find((x) => x.id === id);
    if (p === undefined) return;
    const f: IncomeFlow = {
      id: newRowId,
      ...(p.label !== undefined ? { label: p.label } : {}),
      kind: "other",
      from: structuredClone(p.from),
      to: p.to === undefined ? null : structuredClone(p.to),
      everyYears: p.everyYears,
      ...(p.monthly === true ? { monthly: true } : {}),
      amount: structuredClone(p.amount),
      ...(p.growth !== undefined ? { growth: structuredClone(p.growth) } : {}),
    };
    h.periodicExpenses = (h.periodicExpenses ?? []).filter((x) => x.id !== id);
    (h.incomeFlows ??= []).push(f);
  });
}

/** 入るお金の行を出るお金の行にする（同じ名前・額・時期。種類は「ライフイベントの支出」。表の行は、1回でもくり返しでも一時的支出） */
export function incomeToExpense(wh: WorkingHousehold, id: string, newRowId: string = newId()): WorkingHousehold {
  return mutate(wh, (h) => {
    const f = (h.incomeFlows ?? []).find((x) => x.id === id);
    if (f === undefined) return;
    const p: PeriodicExpense = {
      id: newRowId,
      ...(f.label !== undefined ? { label: f.label } : {}),
      kind: "general",
      row: EVENT_ROW,
      from: structuredClone(f.from),
      to: f.to === undefined ? null : structuredClone(f.to),
      everyYears: f.everyYears,
      ...(f.monthly === true ? { monthly: true } : {}),
      amount: structuredClone(f.amount),
      ...(f.growth !== undefined ? { growth: structuredClone(f.growth) } : {}),
    };
    h.incomeFlows = (h.incomeFlows ?? []).filter((x) => x.id !== id);
    (h.periodicExpenses ??= []).push(p);
  });
}

/**
 * 古い世帯の周期的な支出（年払いの暮らしの支出に当たる物）を、基本生活費のカードの行にする（種類を変える。額はそのまま）。表の行は、年払いの暮らしの
 * 支出で選べる行（基本生活費に含める・医療・介護・その他の支出）ならそのまま、選べない行（一時的支出など）なら「基本生活費に含める」にする
 */
export function moveToLiving(wh: WorkingHousehold, id: string): WorkingHousehold {
  return mutate(wh, (h) => {
    const p = (h.periodicExpenses ?? []).find((x) => x.id === id);
    if (p === undefined) return;
    p.kind = "livingAnnual";
    if (!(OUT_ROWS_BY_KIND.livingAnnual ?? []).includes(p.row ?? "")) p.row = "cf.expense.living";
  });
}

/** ライフイベントの時期の選択肢（毎月は出さない。毎月の支出は基本生活費で入れる。前に毎月で入れた行は、毎月も残して見せる） */
const EVENT_CADENCES = [
  { value: "once", label: "1回" },
  { value: "repeat", label: "年ごと" },
];
const MONTHLY_NOTE = "毎月の支出は基本生活費の入力項目で入れます（この行は毎月のまま計算します）";

/** 前に選んだ表の行（一時的支出でない行）の読むだけの欄。ライフイベントの支出は一時的支出の行に出し、選ばない */
function legacyRowLine(p: PeriodicExpense): FieldDef {
  const label = OUT_ROWS.find((o) => o.value === p.row)?.label ?? p.row ?? "";
  return field({ key: `ro/ev/${p.id}/row`, item: null, label: "キャッシュフロー表の行", level: "detail", kind: "text", readOnly: "前に選んだ行のまま計算します（新しく足す行は一時的支出の行です）", get: () => ({ value: label }), set: (w) => w });
}

/**
 * ライフイベントの行の1行目の欄: 種類は選ばない（どの行もライフイベントの支出。前の「その他の支出」も読める）、時期は1回／年ごと、表の行は一時的支出に
 * 決めて選ばない（前に別の行を選んだ行は読むだけで見せる）。時期の仮の印（親の葬儀の推定など）は、直すと外す
 */
function eventHeadFields(p: PeriodicExpense, fields: readonly FieldDef[]): FieldDef[] {
  const k = `ev/${p.id}`;
  const out: FieldDef[] = [];
  for (const f of fields) {
    if (f.key === `${k}/kind`) continue;
    if (f.key === `${k}/row`) {
      if (p.row !== undefined && p.row !== EVENT_ROW) out.push(legacyRowLine(p));
      continue;
    }
    if (f.key === `${k}/cadence`) out.push(p.monthly === true ? f : ({ ...f, options: EVENT_CADENCES } as FieldDef));
    else if (f.key === `${k}/from`) out.push(clearsAssumed(f));
    else out.push(f);
  }
  return out;
}

/** 出るお金の行のまとまり（1行目に付け替えのボタンを足す） */
function eventRowGroups(wh: WorkingHousehold, p: PeriodicExpense): GroupDef[] {
  const h = wh.request.input.household;
  const [first, ...rest] = periodicGroups(wh, p);
  if (first === undefined) return rest;
  const head: GroupDef = { ...first, fields: eventHeadFields(p, first.fields), ...(p.monthly === true ? { note: [first.note, MONTHLY_NOTE].filter((x) => x !== undefined).join("。") } : {}) };
  const more: ActionDef[] = [{ key: `ev/${p.id}/toIncome`, label: "入るお金にする", level: "detail", run: (w) => expenseToIncome(w, p.id) }];
  if (cadenceOf(h, p) !== "once") more.push({ key: `ev/${p.id}/toLiving`, label: "基本生活費の項目へ移す", help: "年払いの暮らしの支出として、基本生活費の項目へ移します", level: "detail", run: (w) => moveToLiving(w, p.id) });
  return [{ ...head, actions: [...more, ...head.actions] }, ...rest];
}

/** この世帯の予定（ほかのカードを含む。読むだけ） */
function scheduleSection(wh: WorkingHousehold): SectionDef {
  const items = scheduleItems(wh);
  const lines = items.map((x, i) => readLine(`events/schedule/${i}`, yearLabel(wh, x.year), `${x.dir === "—" ? "" : `${x.dir}｜`}${x.name}${x.amount !== "" ? `（${x.amount}）` : ""}`, x.card));
  const overlap = overlapYears(items);
  const note = [
    "ほかの項目に入れた予定も含めて、年の順に並べます（額は今の値段。くり返しは最初の年）。直すときは、それぞれの項目で",
    ...(overlap.length > 0 ? [`1回の出るお金が重なる年: ${overlap.map((o) => `${o.year}年（${o.names.join("・")}）`).join("、")}`] : []),
  ].join("。");
  const g = readGroup("events/schedule", undefined, lines, note);
  return { key: "events/schedule", title: "この世帯の予定", ...(g === null ? { note: "まだ予定がありません" } : {}), level: "detail", groups: g === null ? [] : [g], actions: [] };
}

/** 出るお金の区画の説明: ほかの入力項目で入れる物の行き先（ふだんの旅行・帰省・家電・スマホは基本生活費、住まい・車・教育・介護・贈与はそれぞれ） */
export const OUT_NOTE =
  "ふだんの旅行・帰省は基本生活費に入れます。ここには特別な旅行を入れます。家電・スマホの買い替えも基本生活費、住まい・車・教育・介護・贈与はそれぞれの入力項目で入れます。行の右の「必ず」「できれば」を選んでおくと、結果の画面で「できれば」の支出を外した場合と比べられます";

/** 「＋ ほかの支出を足す」: ひな形に無い支出（1回・1年後。額は目安＝推定。名前は FP が書く） */
export function addOtherExpense(wh: WorkingHousehold, id: string = newId()): WorkingHousehold {
  return mutate(addExpense(wh, "general", id), (h) => {
    const p = (h.periodicExpenses ?? []).find((x) => x.id === id);
    if (p !== undefined) delete p.label;
  });
}

// ---- 夢プラン（やりたいこと。0103） ----

/** 夢プランの区画の説明（車・住まいそのものを夢にするときの行き先） */
export const DREAM_NOTE = "車・住まいそのものを夢にするときも、ここでは額と時期で入れます。維持費・ローンは車・住まいの入力項目で";

/** 夢の見出しの額と時期（「額は未入力」「300万円・1回」「年50万円・毎年」） */
function dreamAmountText(h: Household, p: PeriodicExpense): string {
  const v = p.amount.value ?? 0;
  const c = cadenceOf(h, p);
  if (v <= 0) return "額は未入力";
  return c === "once" ? `${manYen(v)}・1回` : c === "monthly" ? `月${manYen(v)}・毎月` : p.everyYears === 1 ? `年${manYen(v)}・毎年` : `${manYen(v)}・${String(p.everyYears)}年ごと`;
}

/**
 * 夢の1件のまとまり（1件を1つの枠に。0077 の追記）: 名前・時期（1回／年ごと）・額・始まり・何年ごと・終わり・ひとことメモ・計算に入れる。
 * 優先度の欄は無い（夢はふつうの行の「必ず」「できれば」と別の物）。順位は「↑ 上へ」「↓ 下へ」で動かす
 */
function dreamGroup(wh: WorkingHousehold, p: PeriodicExpense, rank: number, count: number): GroupDef {
  const h = wh.request.input.household;
  const base = periodicGroup(wh, p, "events");
  const k = `ev/${p.id}`;
  const find = (hh: Household) => (hh.periodicExpenses ?? []).find((x) => x.id === p.id) as unknown as Record<string, unknown> | undefined;
  const fields: FieldDef[] = [];
  for (const f of base.fields) {
    if (f.key === `${k}/kind` || f.key === `${k}/row` || f.key === `${k}/priority`) continue;
    if (f.key === `${k}/cadence`) fields.push(p.monthly === true ? f : ({ ...f, options: EVENT_CADENCES } as FieldDef));
    else if (f.key === `${k}/from`) fields.push(clearsAssumed(f));
    else fields.push(f);
  }
  const address = (item: string, at: string[] = []) => () => ({ target: { object: p.id }, item, at });
  fields.push(
    { ...plain({ key: `${k}/dreamNote`, item: "periodicExpense.dreamNote", label: "ひとことメモ（なぜかなえたいか）", level: "simple", kind: "text", find, path: ["dream", "note"], optional: true }), address: address("periodicExpense.dreamNote") },
    { ...plain({ key: `${k}/dreamInclude`, item: "periodicExpense.dream", label: "計算に入れる", level: "simple", kind: "bool", find, path: ["dream", "include"], optional: true, fallback: true, help: "外すと、この夢を除いて計算します。結果の画面の「外している物」で、入れた場合を見られます" }), address: address("periodicExpense.dream", ["include"]) },
  );
  const off = p.dream?.include === false;
  const name = p.label !== undefined && p.label !== "" ? p.label : "夢";
  const actions: ActionDef[] = [
    ...(rank > 1 ? [{ key: `${k}/up`, label: "↑ 上へ", title: "順位を1つ上げます", level: "simple" as const, run: (w: WorkingHousehold) => moveDream(w, p.id, -1) }] : []),
    ...(rank < count ? [{ key: `${k}/down`, label: "↓ 下へ", title: "順位を1つ下げます", level: "simple" as const, run: (w: WorkingHousehold) => moveDream(w, p.id, 1) }] : []),
    ...base.actions.filter((a) => a.key === `${k}/remove`),
  ];
  return {
    key: k,
    title: `夢${String(rank)}｜${name} ${dreamAmountText(h, p)} ${rowWhen(h, p)}${off ? "（計算に入れない）" : ""}`,
    ...(p.monthly === true ? { note: MONTHLY_NOTE } : {}),
    level: "simple",
    fields,
    actions,
  };
}

/** 夢の見出しの時期（「2031年4月」「2031年4月〜最後まで」） */
function rowWhen(h: Household, p: PeriodicExpense): string {
  const ym = (t: Timepoint | null | undefined) => {
    const v = resolveTimepoint(h, t);
    return v === null ? "時期は未定" : `${String(Number(v.slice(0, 4)))}年${String(Number(v.slice(5, 7)))}月`;
  };
  return cadenceOf(h, p) === "once" ? ym(p.from) : `${ym(p.from)}〜${p.to == null ? "最後まで" : ym(p.to)}`;
}

/** 夢のひな形のボタン（名前と時期だけ。額は未入力の警告。行を足した後も出す） */
function dreamTemplateGroup(wh: WorkingHousehold): GroupDef {
  const h = wh.request.input.household;
  const ds = dreamRows(h);
  return {
    key: "ev/dreamTemplates",
    title: "よくある夢（名前と時期だけ）",
    level: "simple",
    chips: true,
    fields: [],
    actions: DREAM_TEMPLATES.map((t): ActionDef => {
      const n = ds.filter((p) => p.label === t.label).length;
      return { key: `ev/dream/template/${t.key}`, label: `＋ ${t.label}`, level: "simple", ...(t.help !== undefined ? { help: t.help } : {}), chip: { group: "夢", ...(n > 0 ? { added: `入れた（${String(n)}件）` } : {}) }, run: (w) => addDream(w, t) };
    }),
  };
}

/** 区画「夢プラン（やりたいこと）」（ライフイベントの入力項目のいちばん上。ヒアリングで最初に聞くため） */
function dreamSection(wh: WorkingHousehold): SectionDef {
  const ds = dreamRows(wh.request.input.household);
  return {
    key: "ev/dreams",
    title: "夢プラン（やりたいこと）",
    note: `${ds.length === 0 ? "まだありません。" : ""}ご家族がかなえたいことを、上から順に並べます。${DREAM_NOTE}`,
    level: "simple",
    groups: [...ds.map((p, i) => dreamGroup(wh, p, i + 1, ds.length)), dreamTemplateGroup(wh)],
    actions: [{ key: "ev/addDream", label: "＋ 夢を足す", help: "よくある夢に無い夢を、1回・1年後で足します（名前・額・時期を入れてください）", level: "simple", run: (w) => addDream(w) }],
  };
}

export function eventsStage(wh: WorkingHousehold): StageDef {
  const h = wh.request.input.household;
  const rows = eventExpenses(h);
  const empty = rows.length === 0;
  const gifts = childWeddingLines(wh);
  const outSection: SectionDef = {
    key: "ev/periodic",
    title: "出るお金",
    note: `${empty && gifts === null ? "まだありません。" : ""}${OUT_NOTE}`,
    level: "simple",
    groups: [...rows.flatMap((p) => eventRowGroups(wh, p)), ...(gifts !== null ? [gifts] : []), outTemplateGroup(wh)],
    actions: [{ key: "ev/addOther", label: "＋ ほかの支出を足す", help: "よくあるライフイベントに無い支出を、1回・1年後で足します（名前・額・時期を直してください）", level: "simple", run: (w) => addOtherExpense(w) }],
  };
  // 入るお金（祝い金・一時所得・動産の売却・その他の入金。0044）。行に「出るお金にする」。ひな形は行を足した後も出す
  const inSec = moneySections(wh, "events", { claimed: NONE_CLAIMED, level: "simple", inTitle: "入るお金" }).find((x) => x.key.endsWith("/in"));
  const inRows = (h.incomeFlows ?? []).filter((f) => incomeCard(f) === "events");
  const inSection: SectionDef | null =
    inSec === undefined
      ? null
      : {
          ...inSec,
          note: `${inRows.length === 0 ? "まだありません。" : ""}祝い金・お見舞い・一時の給付金・物の売却などの入金です。香典もここで入れられます。相続・贈与、親からの援助、副業の収入などは、それぞれの入力項目で入れます`,
          groups: [
            ...inSec.groups.map((g) => {
              const m = /^in\/([^/]+)$/.exec(g.key);
              const id = m?.[1];
              return id === undefined ? g : { ...g, actions: [{ key: `in/${id}/toExpense`, label: "出るお金にする", level: "detail" as const, run: (w: WorkingHousehold) => incomeToExpense(w, id) }, ...g.actions] };
            }),
            { key: "in/templates", title: "よくある入金（当てはまるものだけ足してください）", level: "simple", chips: true, fields: [], actions: inTemplateActions(wh) },
          ],
          actions: inSec.actions,
        };
  const sections: SectionDef[] = [dreamSection(wh), outSection, ...(inSection !== null ? [inSection] : []), scheduleSection(wh)];
  return { id: "events", label: "ライフイベント", lead: "夢プラン（やりたいこと）と、一時的な収支（結婚・成人式・葬儀・特別な旅行・大きな買い物・祝い金など）、世帯の予定の一覧。", sections };
}
