// 3. 年金: 入れ方（ねんきん定期便の版・改定通知書・見込額・加入歴）を最初に選ぶ。国民年金の免除などは定期便の数字を入れる形を主にし、
// 加入歴を細かく入れる形は「詳しく入れる」で開く。受け取り開始（繰上げ・繰下げ）も入れる
import type { Household, Member, PensionRecord, Timepoint } from "../../../engine/types.ts";
import { addMonths, ageAt, ageReachedMonth } from "../../levers.ts";
import { byId, field, plain, removeAction, yenBox, type FieldDef, type Finder, type GroupDef, type SectionDef, type StageDef } from "../form.ts";
import { estimatedBox, mutate, newId, periodsOf, type WorkingHousehold } from "../household.ts";
import { earners, HISTORY_CATEGORIES, memberLabel, PENSION_KINDS } from "../labels.ts";

const records = (h: Household) => h.pensionRecords;
const recordOf = (h: Household, memberId: string) => (h.pensionRecords ?? []).find((r) => r.member === memberId);
const UNENTERED = "未入力（0円で計算。定期便の額を入れてください）";

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
  const amounts = { basic: rec?.amounts?.basic ?? estimatedBox(0, UNENTERED), employee: rec?.amounts?.employee ?? estimatedBox(0, UNENTERED) };
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

function claimFields(m: Member, rec: PensionRecord, find: Finder, prefix: string): FieldDef[] {
  const tpAge = (t: Timepoint | undefined) => (t?.at !== undefined ? claimAge(m, t.at) : null);
  const derived = (t: Timepoint | undefined) => (t === undefined ? null : t.at === undefined ? "年齢・イベントで決めた時点" : claimMonth(m, claimAge(m, t.at)) !== t.at ? "月で決めた時点（年齢に直すとずれる）" : null);
  const both = field({
    key: `${prefix}/claim`,
    item: "pensionRecord.claim",
    label: "受け取り開始（基礎・厚生とも）",
    level: "simple",
    kind: "int",
    suffix: "歳から",
    min: 60,
    max: 75,
    help: "65歳より前は繰上げ（減額）、後は繰下げ（増額）。見通しの対策でも動かせます",
    get: (w) => {
      const r = find(w.request.input.household, w) as PensionRecord | undefined;
      const age = tpAge(r?.claim?.basic) ?? 65;
      const split = r?.claim?.basic?.at !== r?.claim?.employee?.at;
      return { value: age, derived: derived(r?.claim?.basic) ?? (split ? "基礎と厚生で別の年齢（詳しく入れるで見られます）" : null), ...(r?.claim === undefined ? { implicit: true } : {}) };
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
      get: (w) => {
        const r = find(w.request.input.household, w) as PensionRecord | undefined;
        return { value: tpAge(r?.claim?.[part]) ?? 65, derived: derived(r?.claim?.[part]), ...(r?.claim?.[part] === undefined ? { implicit: true } : {}) };
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
    fields.push(
      plain({ key: `${prefix}/months/basic`, item: "pensionRecord.months", label: "国民年金の加入月数（年金額に反映する月）", level: "simple", kind: "int", suffix: "か月", min: 0, max: 600, find, path: ["months", "basic"], help: "定期便の「加入期間」の欄の国民年金（計）。免除・猶予の月は含めません" }),
      plain({ key: `${prefix}/months/employee`, item: "pensionRecord.months", label: "厚生年金の加入月数", level: "simple", kind: "int", suffix: "か月", min: 0, max: 900, find, path: ["months", "employee"] }),
      plain({ key: `${prefix}/months/qualifying`, item: "pensionRecord.months", label: "受給資格期間の月数", level: "detail", kind: "int", suffix: "か月", min: 0, max: 900, find, path: ["months", "qualifying"], optional: true, help: "空欄なら、加入月数と免除・猶予の月数の合計" }),
    );
  }
  const labels = AMOUNT_LABEL[rec.kind];
  if (labels !== undefined) {
    fields.push(
      yenBox({ key: `${prefix}/amounts/basic`, item: "pensionRecord.amounts", label: labels[0], level: "simple", basis: "annual", find, path: ["amounts", "basic"], optional: true }),
      yenBox({ key: `${prefix}/amounts/employee`, item: "pensionRecord.amounts", label: labels[1], level: "simple", basis: "annual", find, path: ["amounts", "employee"], optional: true }),
      yenBox({ key: `${prefix}/amounts/transitional`, item: "pensionRecord.amounts", label: "経過的加算", level: "detail", basis: "annual", find, path: ["amounts", "transitional"], optional: true }),
      yenBox({ key: `${prefix}/amounts/special`, item: "pensionRecord.amounts", label: "特別支給の老齢厚生年金（報酬比例部分）", level: "detail", basis: "annual", find, path: ["amounts", "special"], optional: true }),
    );
  }
  fields.push(...claimFields(m, rec, find, prefix));
  const groups: GroupDef[] = [{ key: `pension/${m.id}`, title: `${who}の公的年金`, level: "simple", fields, actions: [] }];

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
