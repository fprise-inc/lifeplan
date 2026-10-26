// 3. 年金: 入れ方（ねんきん定期便の版・改定通知書・見込額・加入歴）を最初に選ぶ。国民年金の免除などは定期便の数字を入れる形を主にし、
// 加入歴を細かく入れる形は「詳しく入れる」で開く。受け取り開始（繰上げ・繰下げ）も入れる
import type { Household, Member, PensionRecord, Timepoint } from "../../../engine/types.ts";
import { addMonths, ageAt, ageReachedMonth } from "../../levers.ts";
import { ageSwitchMonth } from "../../timepoint.ts";
import { byId, field, plain, removeAction, resolveTimepoint, timeView, yenBox, type FieldDef, type Finder, type GroupDef, type SectionDef, type StageDef } from "../form.ts";
import { formatYearMonth } from "../units.ts";
import { sameWhen } from "../when.ts";
import { estimatedBox, mutate, newId, periodsOf, type WorkingHousehold } from "../household.ts";
import { earners, HISTORY_CATEGORIES, memberLabel, PENSION_KINDS } from "../labels.ts";

const records = (h: Household) => h.pensionRecords;
const recordOf = (h: Household, memberId: string) => (h.pensionRecords ?? []).find((r) => r.member === memberId);
/** 額をまだ入れていないときの印（0円の推定）の文。入れ方ごとに、写す書類を言う */
const UNENTERED: Record<string, string> = {
  statementUnder50: "未入力（0円で計算。ねんきん定期便の額を入れてください）",
  statementOver50: "未入力（0円で計算。ねんきん定期便の見込額を入れてください）",
  receiving: "未入力（0円で計算。年金額改定通知書の年金額（年額）を入れてください）",
  projection: "未入力（0円で計算。見込額（年額）を入れてください）",
};
const UNENTERED_TEXTS = new Set([...Object.values(UNENTERED), "未入力（0円で計算。定期便の額を入れてください）"]);
const unentered = (kind: string) => UNENTERED[kind] ?? UNENTERED.statementUnder50 as string;
/** まだ額を入れていない印のままの箱（入れ方を変えたら、新しい入れ方の文に入れ替える） */
const isUnentered = (b: PensionAmount | undefined) => b !== undefined && b.state === "estimated" && b.value === 0 && UNENTERED_TEXTS.has((b as { estimate?: { basis?: string } }).estimate?.basis ?? "");
type PensionAmount = NonNullable<NonNullable<PensionRecord["amounts"]>["basic"]>;

/** ねんきん定期便の入れ方で、加入月数が国民年金・厚生年金とも0か月のまま（写していない） */
export function statementMonthsMissing(rec: PensionRecord | undefined): boolean {
  if (rec === undefined || (rec.kind !== "statementUnder50" && rec.kind !== "statementOver50")) return false;
  return (rec.months?.basic ?? 0) === 0 && (rec.months?.employee ?? 0) === 0;
}

/** 加入月数が0か月のままのときの知らせ（年金のパネル・入力のカード・結果のタブで同じ文を使う） */
export function monthsMissingText(kind: string): string {
  return kind === "statementOver50"
    ? "加入月数が0か月のままです。このままでは受給資格期間（10年）に届かないため、見込額を入れても年金は0円で計算します。定期便の「加入期間」の月数を写してください（月数が分からないときは、入れ方を「見込額だけ」にします）"
    : "加入月数が0か月のままです。このままでは、これまでの加入の分を数えずに年金を少なく計算します（受給資格期間の10年に届かなければ0円）。定期便の「加入期間」の月数を写してください";
}

/** 結果のタブに出す、年金の入力の知らせ（加入月数が0か月のままの人） */
export function pensionNotices(wh: WorkingHousehold): string[] {
  const h = wh.request.input.household;
  return earners(h)
    .filter((m) => m.kind === "self" || m.kind === "spouse")
    .flatMap((m) => {
      const rec = recordOf(h, m.id);
      if (rec === undefined || !statementMonthsMissing(rec)) return [];
      return [`${memberLabel(wh, m.id)}の年金: ねんきん定期便の加入月数が0か月のままです。${rec.kind === "statementOver50" ? "年金を0円で計算しています" : "年金を少なく計算しています"}。入力の「年金」で加入月数を入れてください`];
    });
}

/** 受け取り開始の月 ↔ 年齢（その年齢に達した月の翌月から。0003・年金の決まり） */
const claimMonth = (m: Member, age: number) => addMonths(ageReachedMonth(m, age), 1);
const claimAge = (m: Member, at: string) => ageAt(m, addMonths(at, -1));

/** 加入歴の初めの行を、働き方の期間から作る（加入歴から計算する型を選んだとき） */
function historyFromPeriods(h: Household, m: Member, asOf: string): NonNullable<PensionRecord["history"]> {
  const out: NonNullable<PensionRecord["history"]> = [];
  for (const p of periodsOf(h, m.id)) {
    const from = p.from.at;
    if (from === undefined || from > asOf) continue;
    const to = p.to?.at !== undefined && p.to.at < asOf ? p.to.at : asOf;
    const employee = p.pensionCategory !== undefined && p.pensionCategory !== "none";
    const annual = (p.salary?.annual.value ?? 0) + (p.salary?.bonus?.value ?? 0);
    out.push(employee ? { from, to, category: "employee", averageRemuneration: Math.round(annual / 12) } : { from, to, category: "national1" });
  }
  return out;
}

/** 記録の型を変える。要る欄を足し、使わない欄を外す（受け取り開始と時点は残す） */
export function convertRecord(h: Household, m: Member, rec: PensionRecord | undefined, kind: string, baseMonth: string): PensionRecord | null {
  if (kind === "") return null;
  const asOf = rec?.asOf ?? addMonths(baseMonth, -1);
  const out: PensionRecord = { id: rec?.id ?? newId(), member: m.id, kind, asOf };
  // まだ額を入れていない印のままの箱は、新しい入れ方の文（写す書類）に入れ替える
  const placeholder = (b: PensionAmount | undefined) => (b === undefined || isUnentered(b) ? estimatedBox(0, unentered(kind)) : b);
  const amounts = { basic: placeholder(rec?.amounts?.basic), employee: placeholder(rec?.amounts?.employee) };
  if (kind === "statementUnder50" || kind === "statementOver50") {
    out.months = rec?.months ?? { basic: 0, employee: 0 };
    out.amounts = { ...rec?.amounts, ...amounts };
  } else if (kind === "receiving" || kind === "projection") {
    out.amounts = { ...rec?.amounts, ...amounts };
    if (rec?.months !== undefined) out.months = rec.months;
  } else if (kind === "history") {
    out.history = rec?.history ?? historyFromPeriods(h, m, asOf);
  }
  if (rec?.claim !== undefined) out.claim = rec.claim;
  return out;
}

const AMOUNT_LABEL: Record<string, [string, string]> = {
  statementUnder50: ["老齢基礎年金（これまでの加入実績に応じた額）", "老齢厚生年金（これまでの加入実績に応じた額）"],
  statementOver50: ["老齢基礎年金（65歳からの見込額）", "老齢厚生年金（65歳からの見込額）"],
  receiving: ["老齢基礎年金（今の年額）", "老齢厚生年金（今の年額・報酬比例部分）"],
  projection: ["老齢基礎年金（見込額）", "老齢厚生年金（見込額）"],
};

/** 額の欄の説明（写す書類の欄） */
const AMOUNT_HELP: Record<string, string> = {
  statementUnder50: "ねんきん定期便の「これまでの加入実績に応じた年金額」の欄の額",
  statementOver50: "ねんきん定期便の「老齢年金の見込額」の欄の額（65歳から受け取る額）",
  receiving: "年金額改定通知書の年金額（年額）。年金振込通知書の額（2か月分・税などを引いた後）ではありません",
};

function claimFields(m: Member, rec: PensionRecord, find: Finder, prefix: string): FieldDef[] {
  const tpAge = (h: Household, t: Timepoint | undefined) => {
    const ym = t === undefined ? null : resolveTimepoint(h, t);
    return ym !== null ? claimAge(m, ym) : null;
  };
  // 整数の年齢で書き換えると年月の形になる時点（年齢・出来事で決めた時点、月まで決めた時点）の印。入力の画面は時点の部品で入れるので出さない
  const derived = (h: Household, t: Timepoint | undefined) => {
    if (t === undefined) return null;
    if (t.at === undefined) return "年齢・出来事で決めた時点";
    const ym = resolveTimepoint(h, t);
    return ym !== null && claimMonth(m, claimAge(m, ym)) !== ym ? "月まで決めた時点（年齢の整数に直すとずれる）" : null;
  };
  // 時点の部品（0038）: 既定は本人の年齢で「65歳」＝65歳になった翌月から。「66歳3か月」のように月まで、年月・出来事からでも入れられる。
  // 空欄は65歳から（標準）。60歳になった翌月から75歳になった翌月までの間だけ。結果のタブで動かす項目は年齢の整数のまま
  const lo = ageSwitchMonth(m, 60, 0, "monthAfterReach");
  const hi = ageSwitchMonth(m, 75, 0, "monthAfterReach");
  const std = (): Timepoint => ({ memberAge: { member: m.id, years: 65, ageSwitch: "monthAfterReach" } });
  const check = (w: WorkingHousehold, tp: Timepoint | null): string | null => {
    const ym = tp === null ? null : resolveTimepoint(w.request.input.household, tp);
    return ym !== null && (ym < lo || ym > hi) ? `受け取り開始は、60歳になった翌月（${formatYearMonth(lo)}）から75歳になった翌月（${formatYearMonth(hi)}）までの間で入れてください` : null;
  };
  /** 標準（65歳になった翌月）と同じ月の、出来事でない時点は省く（省略は標準） */
  const tidy = (h: Household, r: PensionRecord) => {
    const claim = r.claim;
    if (claim === undefined) return;
    for (const part of ["basic", "employee"] as const) {
      const t = claim[part];
      if (t !== undefined && t.event === undefined && resolveTimepoint(h, t) === claimMonth(m, 65)) delete claim[part];
    }
    if (claim.basic === undefined && claim.employee === undefined) delete r.claim;
  };
  const rec0 = (w: WorkingHousehold) => find(w.request.input.household, w) as PensionRecord | undefined;
  const common = { ageOf: (h: Household) => h.members.find((x) => x.id === m.id), mode: "age" as const, ageMeans: "after" as const, optional: true, nullText: "65歳から（標準）", fallback: () => std(), check };
  const writeClaim = (parts: readonly ("basic" | "employee")[]) => (w: WorkingHousehold, tp: Timepoint | null) =>
    mutate(w, (h) => {
      const r = find(h, w) as PensionRecord | undefined;
      if (r === undefined) return;
      const claim = { ...r.claim };
      for (const part of parts) {
        if (tp === null) delete claim[part];
        else claim[part] = structuredClone(tp);
      }
      r.claim = claim;
      tidy(h, r);
    });
  const both = field({
    key: `${prefix}/claim`,
    item: "pensionRecord.claim",
    label: "受け取り開始（基礎・厚生とも）",
    level: "simple",
    kind: "int",
    suffix: "歳から",
    min: 60,
    max: 75,
    help: "65歳より前は繰上げ（減額）、後は繰下げ（増額）。「66歳3か月」のように月まで入れられます。結果の対策でも動かせます",
    time: timeView({ ...common, anchor: "pensionStart", read: (w) => rec0(w)?.claim?.basic ?? null, write: writeClaim(["basic", "employee"]) }),
    get: (w) => {
      const h = w.request.input.household;
      const r = rec0(w);
      const age = tpAge(h, r?.claim?.basic) ?? 65;
      const split = r?.claim !== undefined && !sameWhen(r.claim.basic ?? std(), r.claim.employee ?? std());
      const splitText = "基礎と厚生で別の時点です（詳しく入れるで見られます）。ここを直すと両方そろえます";
      return { value: age, derived: derived(h, r?.claim?.basic) ?? (split ? splitText : null), ...(split ? { warn: splitText } : {}), ...(r?.claim === undefined ? { implicit: true } : {}) };
    },
    set: (w, v) =>
      mutate(w, (h) => {
        const r = find(h, w) as PensionRecord | undefined;
        if (r === undefined || v === null) return;
        if (Number(v) === 65) delete r.claim;
        else r.claim = { basic: { at: claimMonth(m, Number(v)) }, employee: { at: claimMonth(m, Number(v)) } };
      }),
  });
  const one = (part: "basic" | "employee", label: string) =>
    field({
      key: `${prefix}/claim/${part}`,
      item: "pensionRecord.claim",
      label,
      level: "detail",
      kind: "int",
      suffix: "歳から",
      min: 60,
      max: 75,
      time: timeView({ ...common, read: (w) => rec0(w)?.claim?.[part] ?? null, write: writeClaim([part]) }),
      get: (w) => {
        const h = w.request.input.household;
        const r = rec0(w);
        return { value: tpAge(h, r?.claim?.[part]) ?? 65, derived: derived(h, r?.claim?.[part]), ...(r?.claim?.[part] === undefined ? { implicit: true } : {}) };
      },
      set: (w, v) =>
        mutate(w, (h) => {
          const r = find(h, w) as PensionRecord | undefined;
          if (r === undefined || v === null) return;
          const claim = { ...r.claim };
          if (Number(v) === 65) delete claim[part];
          else claim[part] = { at: claimMonth(m, Number(v)) };
          if (claim.basic === undefined && claim.employee === undefined) delete r.claim;
          else r.claim = claim;
        }),
    });
  void rec;
  return [both, one("basic", "老齢基礎年金の受け取り開始"), one("employee", "老齢厚生年金の受け取り開始")];
}

const EXEMPT: [string, string][] = [
  ["paid", "第1号の納付済みの月数"],
  ["exemptFull", "全額免除の月数"],
  ["exemptThreeQuarters", "4分の3免除の月数"],
  ["exemptHalf", "半額免除の月数"],
  ["exemptQuarter", "4分の1免除の月数"],
  ["deferred", "納付猶予・学生納付特例の月数（追納していない分）"],
];

function recordGroups(wh: WorkingHousehold, m: Member): GroupDef[] {
  const h = wh.request.input.household;
  const base = wh.request.input.baseMonth;
  const rec = recordOf(h, m.id);
  const who = memberLabel(wh, m.id);
  const kindField = field({
    key: `pension/${m.id}/kind`,
    item: "pensionRecord.kind",
    label: "入れ方",
    level: "simple",
    kind: "select",
    options: PENSION_KINDS,
    structural: true,
    help: "手元の書類に合わせて選びます。定期便は50歳未満と50歳以上で中身が違います",
    get: (w) => ({ value: recordOf(w.request.input.household, m.id)?.kind ?? "" }),
    set: (w, v) =>
      mutate(w, (hh) => {
        const cur = recordOf(hh, m.id);
        const next = convertRecord(hh, m, cur, String(v ?? ""), base);
        const others = (hh.pensionRecords ?? []).filter((r) => r.member !== m.id);
        hh.pensionRecords = next === null ? others : [...others, next];
        if (hh.pensionRecords.length === 0) delete hh.pensionRecords;
      }),
  });
  if (rec === undefined)
    return [
      {
        key: `pension/${m.id}`,
        title: `${who}の公的年金`,
        note: "記録が入っていないので、働き方の期間から加入歴を推計しています（推定）",
        level: "simple",
        fields: [kindField],
        actions: [],
      },
    ];
  const find = byId(records, rec.id);
  const prefix = `pension/${rec.id}`;
  const fields: FieldDef[] = [
    kindField,
    plain({ key: `${prefix}/asOf`, item: "pensionRecord.asOf", label: rec.kind === "history" ? "加入歴の終わりの月" : "書類の作成年月", level: "simple", kind: "ym", find, path: ["asOf"], help: "この月より後の加入は、働き方の期間から足します" }),
  ];
  if (rec.kind === "statementUnder50" || rec.kind === "statementOver50") {
    // 加入月数が0か月のままなら、欄の下に知らせ（warn。ほかの入力と合わないときの知らせと同じ形）を出す
    const missing = (f: FieldDef): FieldDef => ({
      ...f,
      get: (w) => {
        const st = f.get(w);
        return statementMonthsMissing(recordOf(w.request.input.household, m.id)) ? { ...st, warn: "0か月のままです。見込額を入れても、定期便の加入月数を写すまでは年金を正しく計算できません" } : st;
      },
    });
    fields.push(
      ...[
        plain({ key: `${prefix}/months/basic`, item: "pensionRecord.months", label: "国民年金の加入月数（年金額に反映する月）", level: "simple", kind: "int", suffix: "か月", min: 0, max: 600, find, path: ["months", "basic"], help: "定期便の「加入期間」の欄の国民年金（計）。免除・猶予の月は含めません" }),
        plain({ key: `${prefix}/months/employee`, item: "pensionRecord.months", label: "厚生年金の加入月数", level: "simple", kind: "int", suffix: "か月", min: 0, max: 900, find, path: ["months", "employee"] }),
      ].map(missing),
      plain({ key: `${prefix}/months/qualifying`, item: "pensionRecord.months", label: "受給資格期間の月数", level: "detail", kind: "int", suffix: "か月", min: 0, max: 900, find, path: ["months", "qualifying"], optional: true, help: "空欄なら、加入月数と免除・猶予の月数の合計" }),
    );
  }
  const labels = AMOUNT_LABEL[rec.kind];
  if (labels !== undefined) {
    fields.push(
      yenBox({ key: `${prefix}/amounts/basic`, item: "pensionRecord.amounts", label: labels[0], level: "simple", basis: "annual", find, path: ["amounts", "basic"], optional: true, ...(AMOUNT_HELP[rec.kind] !== undefined ? { help: AMOUNT_HELP[rec.kind] as string } : {}) }),
      yenBox({ key: `${prefix}/amounts/employee`, item: "pensionRecord.amounts", label: labels[1], level: "simple", basis: "annual", find, path: ["amounts", "employee"], optional: true, ...(AMOUNT_HELP[rec.kind] !== undefined ? { help: AMOUNT_HELP[rec.kind] as string } : {}) }),
      yenBox({ key: `${prefix}/amounts/transitional`, item: "pensionRecord.amounts", label: "経過的加算", level: "detail", basis: "annual", find, path: ["amounts", "transitional"], optional: true }),
      yenBox({ key: `${prefix}/amounts/special`, item: "pensionRecord.amounts", label: "特別支給の老齢厚生年金（報酬比例部分）", level: "detail", basis: "annual", find, path: ["amounts", "special"], optional: true }),
    );
  }
  fields.push(...claimFields(m, rec, find, prefix));
  const groups: GroupDef[] = [{ key: `pension/${m.id}`, title: `${who}の公的年金`, ...(statementMonthsMissing(rec) ? { note: monthsMissingText(rec.kind) } : {}), level: "simple", fields, actions: [] }];

  if (rec.kind === "statementUnder50" || rec.kind === "statementOver50") {
    const c1 = rec.months?.category1;
    groups.push({
      key: `${prefix}/exempt`,
      title: `${who}の国民年金の免除・猶予`,
      note: "定期便の加入期間の欄（第1号被保険者の月数と、免除・猶予の月数）を写します。追納した月は納付済みに数えます",
      level: c1 !== undefined ? "simple" : "detail",
      fields:
        c1 === undefined
          ? []
          : EXEMPT.map(([k, label]) =>
              plain({ key: `${prefix}/c1/${k}`, item: "pensionRecord.months", label, level: "simple", kind: "int", suffix: "か月", min: 0, max: 480, find, path: ["months", "category1", k], optional: k !== "paid" }),
            ),
      actions:
        c1 === undefined
          ? [{ key: `${prefix}/c1/add`, label: "＋ 免除・猶予の月を入れる", level: "simple", run: (w) => mutate(w, (hh) => void ((recordOf(hh, m.id) as PensionRecord).months = { ...(recordOf(hh, m.id) as PensionRecord).months, category1: { paid: 0 } })) }]
          : [
              removeAction(`${prefix}/c1/remove`, "免除・猶予の内訳を外す", "detail", (hh) => {
                const r = recordOf(hh, m.id) as PensionRecord;
                if (r.months !== undefined) delete r.months.category1;
              }),
            ],
    });
  }

  if (rec.kind === "history") {
    (rec.history ?? []).forEach((row, i) => {
      const findRow: Finder = (hh) => (recordOf(hh, m.id)?.history?.[i] as Record<string, unknown> | undefined) ?? undefined;
      const rp = `${prefix}/history/${i}`;
      groups.push({
        key: rp,
        title: `${who}の加入歴 ${i + 1}`,
        level: "detail",
        fields: [
          plain({ key: `${rp}/from`, item: "pensionRecord.history", label: "始まり", level: "detail", kind: "ym", find: findRow, path: ["from"] }),
          plain({ key: `${rp}/to`, item: "pensionRecord.history", label: "終わり", level: "detail", kind: "ym", find: findRow, path: ["to"] }),
          plain({ key: `${rp}/category`, item: "pensionRecord.history", label: "加入の種類", level: "detail", kind: "select", options: HISTORY_CATEGORIES, find: findRow, path: ["category"] }),
          ...(row.category === "employee"
            ? [plain({ key: `${rp}/avg`, item: "pensionRecord.history", label: "平均標準報酬額（月額・今の水準）", level: "detail", kind: "yen", basis: "monthly", find: findRow, path: ["averageRemuneration"], optional: true })]
            : []),
        ],
        actions: [
          removeAction(`${rp}/remove`, "この行を外す", "detail", (hh) => {
            const r = recordOf(hh, m.id) as PensionRecord;
            r.history = (r.history ?? []).filter((_, j) => j !== i);
          }),
        ],
      });
    });
    groups.push({
      key: `${prefix}/history/add`,
      level: "detail",
      fields: [],
      actions: [
        {
          key: `${prefix}/history/addRow`,
          label: "＋ 加入歴の行を足す",
          level: "detail",
          run: (w) =>
            mutate(w, (hh) => {
              const r = recordOf(hh, m.id) as PensionRecord;
              const last = (r.history ?? []).at(-1)?.to ?? addMonths(ageReachedMonth(m, 20), 0);
              (r.history ??= []).push({ from: addMonths(last, 1), to: r.asOf ?? base, category: "national1" });
            }),
        },
      ],
    });
  }
  return groups;
}

export function pensionStage(wh: WorkingHousehold): StageDef {
  const h = wh.request.input.household;
  const sections: SectionDef[] = earners(h)
    .filter((m) => m.kind === "self" || m.kind === "spouse")
    .map((m) => ({ key: `pension/${m.id}`, title: memberLabel(wh, m.id), level: "simple", groups: recordGroups(wh, m), actions: [] }));
  return { id: "pension", label: "年金", lead: "ねんきん定期便・年金額改定通知書の数字を写します。無ければ働き方から推計します。", sections };
}
