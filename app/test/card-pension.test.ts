// 年金のカード（0066・0067）: 入れ方の区分（推計／書類から／加入歴から）と書類の種類・推計に戻しても書類の記録を残す・加入月数の
// わからない（代わりの値）・推定で埋める・受け取っている遺族年金・障害年金（種類・終わりの推定・再婚の知らせ）・外国の年金・
// 年金の見込み（計算の結果から読む）・世帯の外の家族を混ぜない・古い世帯を黙って書き換えない
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { Field, FieldStateOps } from "../src/workspace/input/FieldViews.tsx";
import type { EngineRequest, IncomeFlow, PensionRecord } from "../src/engine/types.ts";
import { checkList } from "../src/workspace/input/checkRows.ts";
import { fillAll, gapsOf } from "../src/workspace/input/fill.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { inputItems } from "../src/workspace/input/items.ts";
import { estimateView, pensionEstimateRequest, pensionEstimateSummary, pensionLines } from "../src/workspace/input/pensionEstimate.ts";
import { rowAt } from "../src/workspace/input/rows.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { addReceiving, pensionNotices, receivingRows, statementMonthsMissing, substituteMonths } from "../src/workspace/input/stages/pension.ts";
import { applyStateOp, fieldStatus } from "../src/workspace/input/valueState.ts";
import { modelHousehold, preview } from "./helpers.ts";

type Obj = Record<string, unknown>;
const BASE = "2026-10";
let n = 0;
const ids = () => () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const open = (id: string) => fromRequest(modelHousehold(id));
const fields = (wh: WorkingHousehold) => allFields(buildStage("pension", wh));
const fieldOf = (wh: WorkingHousehold, suffix: string): FieldDef => {
  const f = fields(wh).find((x) => x.key.endsWith(suffix));
  if (f === undefined) throw new Error(`no field ${suffix}`);
  return f;
};
const actionOf = (wh: WorkingHousehold, suffix: string) => {
  for (const s of buildStage("pension", wh).sections) for (const a of [...s.actions, ...s.groups.flatMap((g) => g.actions)]) if (a.key.endsWith(suffix)) return a;
  throw new Error(`no action ${suffix}`);
};
const recordsOf = (wh: WorkingHousehold): PensionRecord[] => wh.request.input.household.pensionRecords ?? [];
const selfOf = (wh: WorkingHousehold) => wh.request.input.household.members.find((m) => m.kind === "self")!;
const input = (wh: WorkingHousehold) => wh.request.input as unknown as Obj;
const pensionTotal = (req: EngineRequest, member?: string) => preview(req).table.filter((c) => c.row === "cf.income.pension" && c.object === undefined && (member === undefined || c.member === member)).reduce((s, c) => s + c.amount, 0);

/** 40歳の本人（空の世帯）を会社員にして、書類からを選ぶ。legacy は前の版で保存した定期便（加入月数が0か月のまま・代わりの値の行も無い） */
function withStatement(legacy = false): { wh: WorkingHousehold; self: string } {
  let wh = blankHousehold(BASE, ids());
  const self = selfOf(wh).id;
  wh = fieldOf(wh, `pension/${self}/mode`).set(wh, "document");
  if (legacy)
    wh = mutate(wh, (h) => {
      for (const r of h.pensionRecords ?? []) {
        r.months = { basic: 0, employee: 0 };
        delete r.valueStates;
      }
    });
  return { wh, self };
}

describe("入れ方の区分と書類の種類", () => {
  it("推計のままなら欄は区分と受け取り開始だけで、「書類の額で置き換える」で書類からになる。書類の種類の既定は年齢から（40歳は定期便の50歳未満）", () => {
    const wh = blankHousehold(BASE, ids());
    const self = selfOf(wh).id;
    // 推計でも受け取り開始は標準（構成員の pensionClaim。0078）
    expect(fields(wh).filter((f) => f.key.startsWith(`pension/${self}`)).map((f) => f.key)).toEqual([`pension/${self}/mode`, `pension/${self}/estimate/claim`, `pension/${self}/estimate/claim/basic`, `pension/${self}/estimate/claim/employee`]);
    expect(fieldOf(wh, `pension/${self}/mode`).get(wh).value).toBe("");
    const w = actionOf(wh, `pension/${self}/toDocument`).run(wh);
    expect(recordsOf(w)).toMatchObject([{ member: self, kind: "statementUnder50" }]);
    expect(fieldOf(w, `pension/${self}/mode`).get(w).value).toBe("document");
    expect(fieldOf(w, `pension/${self}/kind`).get(w).value).toBe("statementUnder50");
  });

  it("50歳以上は定期便の50歳以上、65歳以上は改定通知書が既定", () => {
    const old = (year: string) => {
      const wh = mutate(blankHousehold(BASE, ids()), (h) => void (h.members[0]!.birth.birthYearMonth = year));
      const self = selfOf(wh).id;
      return recordsOf(fieldOf(wh, `pension/${self}/mode`).set(wh, "document"))[0]!.kind;
    };
    expect(old("1973-04")).toBe("statementOver50");
    expect(old("1958-04")).toBe("receiving");
  });

  it("推計に戻しても書類の記録は画面の側に残し（計算には渡さない）、書類からに戻すと同じ記録に戻る", () => {
    const { wh: w0, self } = withStatement();
    // 50歳未満の定期便は老齢厚生年金の額だけを写す（老齢基礎年金は加入月数から計算する）
    let wh = fieldOf(w0, "/amounts/employee").set(w0, 500000);
    wh = fieldOf(wh, "/months/basic").set(wh, 200);
    const rec = recordsOf(wh)[0]!;
    const est = fieldOf(wh, `pension/${self}/mode`).set(wh, "");
    expect(est.request.input.household.pensionRecords).toBeUndefined();
    expect(est.pensionKept?.[self]).toEqual([rec]);
    expect(JSON.stringify(est.request)).not.toContain(rec.id);
    expect(buildStage("pension", est).sections[0]!.groups[0]!.note).toContain("前に入れた記録（ねんきん定期便（50歳未満））を残しています");
    const back = fieldOf(est, `pension/${self}/mode`).set(est, "document");
    expect(recordsOf(back)).toEqual([rec]);
    expect(back.pensionKept).toBeUndefined();
  });

  it("書類の種類を変えても作成年月・加入月数・値の状態の行は引き継ぎ、額の欄の名前と未入力の文は新しい書類のもの", () => {
    const { wh: w0, self } = withStatement();
    // 定期便にした時点で、加入月数に代わりの値（推定の印）が入っている
    const wh = fieldOf(w0, "/asOf").set(w0, "2026-06");
    const before = recordsOf(wh)[0]!;
    expect(before.valueStates).toBeDefined();
    const w = fieldOf(wh, `pension/${self}/kind`).set(wh, "statementOver50");
    const after = recordsOf(w)[0]!;
    expect(after).toMatchObject({ id: before.id, kind: "statementOver50", asOf: "2026-06", months: before.months, valueStates: before.valueStates });
    expect(fieldOf(w, "/amounts/basic").label).toBe("老齢基礎年金（65歳からの見込額）");
    expect(fieldOf(w, "/amounts/basic").get(w).estimated).toContain("ねんきん定期便の見込額");
  });

  it("改定通知書の額の欄は、加給年金・振替加算を除いて写すと説明する", () => {
    const { wh: w0, self } = withStatement();
    const w = fieldOf(w0, `pension/${self}/kind`).set(w0, "receiving");
    expect(fieldOf(w, "/amounts/basic").help).toContain("加給年金・振替加算は計算で足すので、除いて写します");
  });

  it("書類から⇄加入歴からも、前の記録を残して戻せる（加入歴の初めの行は働き方の期間から作る）", () => {
    const { wh: w0, self } = withStatement();
    const doc = recordsOf(w0)[0]!;
    const hist = fieldOf(w0, `pension/${self}/mode`).set(w0, "history");
    expect(recordsOf(hist)[0]).toMatchObject({ kind: "history" });
    expect(recordsOf(hist)[0]!.id).not.toBe(doc.id);
    expect(hist.pensionKept?.[self]).toEqual([doc]);
    const back = fieldOf(hist, `pension/${self}/mode`).set(hist, "document");
    expect(recordsOf(back)).toEqual([doc]);
    expect(back.pensionKept?.[self]?.[0]).toMatchObject({ kind: "history" });
    expect(() => preview(back.request)).not.toThrow();
  });
});

describe("定期便の加入月数（わからない・代わりの値）", () => {
  it("0か月のままは空欄で見せ、「加入月数がわからない」で代わりの値（20歳の月から作成年月まで・働き方の期間の厚生年金の月）にする", () => {
    const { wh, self } = withStatement(true);
    const rec = recordsOf(wh)[0]!;
    expect(statementMonthsMissing(rec)).toBe(true);
    expect(fieldOf(wh, "/months/basic").get(wh).value).toBeNull();
    expect(pensionNotices(wh)).toHaveLength(1);
    const w = actionOf(wh, "/months/unknown").run(wh);
    const sub = substituteMonths(w.request.input.household, selfOf(w), rec.asOf, BASE);
    // 1986年4月生まれ・作成年月 2026年9月: 20歳の月（2006年4月）から 246か月
    expect(sub.basic).toBe(246);
    expect(recordsOf(w)[0]!.months).toMatchObject({ basic: sub.basic, employee: sub.employee });
    const basic = fieldOf(w, "/months/basic");
    expect(fieldStatus(basic, w)).toMatchObject({ status: "unknown", basis: expect.stringContaining("代わりの値") });
    expect(statementMonthsMissing(recordsOf(w)[0])).toBe(false);
    expect(pensionNotices(w)).toEqual([]);
    // 写した値を打つと、わからないの行は外れて確定
    const typed = basic.set(w, 300);
    expect(fieldStatus(fieldOf(typed, "/months/basic"), typed).status).toBe("confirmed");
    expect(rowAt(input(typed), { target: { object: rec.id }, item: "pensionRecord.months", at: ["basic"] })).toBeUndefined();
    void self;
  });

  it("欄の「わからない」も同じ代わりの値を入れる（その欄だけ）", () => {
    const { wh } = withStatement();
    const f = fieldOf(wh, "/months/basic");
    const w = applyStateOp(wh, f, "unknown");
    expect(recordsOf(w)[0]!.months?.basic).toBeGreaterThan(200);
    expect(fieldStatus(fieldOf(w, "/months/basic"), w).status).toBe("unknown");
  });

  it("書類待ちの行と状態の印の文は「代わりの値」を重ねない（根拠がもう「代わりの値（…）」で始まる）", () => {
    const { wh: w0 } = withStatement(true);
    const w = actionOf(w0, "/months/unknown").run(w0);
    const f = fieldOf(w, "/months/basic");
    const row = checkList(w).find((r) => r.fieldKey === f.key)!;
    expect(row).toMatchObject({ kind: "unknown" });
    expect(row.detail).toMatch(/^ねんきん定期便で確かめる（代わりの値（国民年金は/);
    expect(row.detail).not.toContain("代わりの値: 代わりの値");
    const html = renderToString(h(FieldStateOps.Provider, { value: applyStateOp }, h(Field, { f, wh: w, onEdit: () => undefined })));
    expect(html).toContain("書類待ち（ねんきん定期便で確かめるまで、代わりの値（国民年金は");
    expect(html).not.toContain("代わりの値: 代わりの値");
  });
});

describe("推定で埋める（入っていない物）", () => {
  it("書類からで額が2つとも未入力なら確かめの一覧のいちばん上に出し、推定で埋めると推計に戻す（書類の記録は残す）", () => {
    const { wh, self } = withStatement();
    const g = gapsOf(wh).find((x) => x.id === `pension/amounts/${self}`)!;
    expect(g).toMatchObject({ card: "pension", basis: expect.stringContaining("働き方の期間から推計") });
    // 未入力の側（いちばん上の種類）に出る（同じ未入力の仮の生年月は、カードの順で先に並ぶ）
    expect(checkList(wh).find((r) => r.id.includes("pension/amounts"))?.kind).toBe("missing");
    const { wh: filled, count } = fillAll(wh, "pension");
    expect(count).toBe(1);
    expect(filled.request.input.household.pensionRecords).toBeUndefined();
    expect(filled.pensionKept?.[self]).toHaveLength(1);
    // 50歳未満の定期便の老齢基礎年金は加入月数（定期便にしたときの代わりの値）から計算するので、推計に戻しても少なくならない
    expect(pensionTotal(filled.request, self)).toBeGreaterThanOrEqual(pensionTotal(wh.request, self));
  });

  it("額を入れて加入月数が0か月のままなら、推定で埋めると代わりの値を推定（出どころ auto）で入れる", () => {
    const { wh: w0, self } = withStatement(true);
    const wh = fieldOf(w0, "/amounts/employee").set(w0, 400000);
    const g = gapsOf(wh).find((x) => x.id === `pension/months/${self}`)!;
    expect(g.basis).toContain("代わりの値");
    const w = g.fill!(wh);
    expect(fieldStatus(fieldOf(w, "/months/basic"), w)).toMatchObject({ status: "estimated" });
    expect(gapsOf(w).some((x) => x.card === "pension")).toBe(false);
  });

  it("古い世帯（見本の世帯）を開いても年金の記録は書き換えず、入れてある書類の人には入っていない物を出さない", () => {
    for (const id of ["salariedCoupleTwoKids", "pensionCouple", "deferral", "sampleSeniorCouple"]) {
      const req = modelHousehold(id);
      const wh = fromRequest(req);
      expect(wh.request.input.household.pensionRecords).toEqual(req.input.household.pensionRecords);
      expect(wh.pensionKept).toBeUndefined();
      expect(gapsOf(wh).filter((g) => g.card === "pension"), id).toEqual([]);
    }
  });
});

describe("受け取っている遺族年金・障害年金", () => {
  const family = () => {
    let wh = open("singleEarnerTwoKids");
    wh = mutate(wh, (h) => void (h.relations = (h.relations ?? []).filter((r) => r.type !== "spouse")));
    return wh;
  };
  it("遺族年金を足すと、子がいれば遺族基礎年金で、終わりはいちばん下の子が18歳になった年度の末（推定）。年額は未入力", () => {
    const wh = actionOf(family(), "pension/receiving/add/survivor").run(family());
    const f = receivingRows(wh.request.input.household)[0]!;
    const kids = wh.request.input.household.members.filter((m) => m.kind === "child").sort((a, b) => (a.birth.birthYearMonth < b.birth.birthYearMonth ? 1 : -1));
    expect(f).toMatchObject({ kind: "survivorPension", pensionType: "survivorBasic", recipient: selfOf(wh).id, to: { memberAge: { member: kids[0]!.id, years: 18, ageSwitch: "firstMarch31AfterReach" } } });
    const to = fieldOf(wh, `in/${f.id}/to`);
    expect(fieldStatus(to, wh)).toMatchObject({ status: "estimated", basis: expect.stringContaining("18歳になった年度の末") });
    expect(fieldStatus(fieldOf(wh, `in/${f.id}/amount`), wh).status).toBe("missing");
  });

  it("種類を変えると、推定のままの終わりを入れ直す（寡婦年金は65歳、障害年金は続く＝行を書かない）。FP が入れた終わりは変えない", () => {
    const wh = addReceiving(family(), "survivorBasic");
    const f = receivingRows(wh.request.input.household)[0]!;
    const widow = fieldOf(wh, `in/${f.id}/pensionType`).set(wh, "widow");
    const fw = receivingRows(widow.request.input.household)[0]!;
    expect(fw).toMatchObject({ label: "寡婦年金", to: { memberAge: { member: selfOf(wh).id, years: 65 } } });
    expect(fieldStatus(fieldOf(widow, `in/${f.id}/to`), widow).basis).toContain("65歳になった月（");
    // 受け取る人を変えても推定のまま入れ直す
    const kid = widow.request.input.household.members.find((m) => m.kind === "child")!;
    const other = fieldOf(widow, `in/${f.id}/recipient`).set(widow, kid.id);
    expect(receivingRows(other.request.input.household)[0]!.to).toMatchObject({ memberAge: { member: kid.id, years: 65 } });
    expect(fieldStatus(fieldOf(other, `in/${f.id}/to`), other).status).toBe("estimated");
    const dis = fieldOf(widow, `in/${f.id}/pensionType`).set(widow, "disabilityEmployee");
    const fd = receivingRows(dis.request.input.household)[0]!;
    expect(fd.to).toBeNull();
    expect(fd.valueStates).toBeUndefined();
    // FP が終わりを入れたら、種類を変えても入れ直さない
    const fixed = fieldOf(wh, `in/${f.id}/to`).set(wh, "2035-03");
    const again = fieldOf(fixed, `in/${f.id}/pensionType`).set(fixed, "widow");
    expect(receivingRows(again.request.input.household)[0]!.to).toEqual({ at: "2035-03" });
  });

  it("年額を入れると年金の行（非課税）に入り、種類は計算に使わない", () => {
    let wh = addReceiving(family(), "survivorEmployee");
    const f = receivingRows(wh.request.input.household)[0]!;
    wh = fieldOf(wh, `in/${f.id}/amount`).set(wh, 1200000);
    const t = preview(wh.request).table.filter((c) => c.object === f.id && c.row === "cf.income.pension");
    expect(t.length).toBeGreaterThan(0);
    const plain = structuredClone(wh.request);
    for (const x of plain.input.household.incomeFlows ?? []) delete (x as IncomeFlow).pensionType;
    expect(preview(wh.request).table).toEqual(preview(plain).table);
  });

  it("受け取る人が再婚する（配偶者の関係が始まる）なら、終わりの欄に知らせを出し、1押しで再婚の月に合わせる", () => {
    let wh = addReceiving(family(), "survivorEmployee");
    const self = selfOf(wh);
    const partner = "00000000-0000-4000-8000-0000000fff01";
    wh = mutate(wh, (h) => {
      h.members.push({ id: partner, kind: "spouse", birth: { birthYearMonth: "1980-01", bornOnFirst: false }, sex: "male", joins: { at: "2030-04" }, leaves: null, expected: false } as (typeof h.members)[number]);
      (h.relations ??= []).push({ type: "spouse", a: self.id, b: partner, marriage: "legal", from: { at: "2030-04" }, to: null });
    });
    const f = receivingRows(wh.request.input.household)[0]!;
    expect(fieldOf(wh, `in/${f.id}/to`).get(wh).warn).toContain("2030年4月に再婚");
    const w = actionOf(wh, `in/${f.id}/endAtRemarriage`).run(wh);
    expect(receivingRows(w.request.input.household)[0]!.to).toEqual({ at: "2030-04" });
  });

  it("外国の年金は別の区画（円の額・雑所得）。その区画からは遺族年金・障害年金を足さない", () => {
    const wh = blankHousehold(BASE, ids());
    const sec = buildStage("pension", wh).sections.find((s) => s.key === "money/pension/in")!;
    expect(sec.title).toBe("外国の年金（円の額で）");
    expect(sec.actions.map((a) => a.key)).toEqual(["money/pension/in/add/foreignPension"]);
    const w = sec.actions[0]!.run(wh);
    expect(w.request.input.household.incomeFlows?.[0]).toMatchObject({ kind: "foreignPension" });
    expect(receivingRows(w.request.input.household)).toEqual([]);
  });
});

describe("世帯の外の家族の年金は混ぜない", () => {
  it("介護・親の世帯の親は年金のカードに出さない（本人だけ）", () => {
    const wh = open("parentCare");
    const parent = wh.request.input.household.members.find((m) => m.kind === "parent")!;
    expect(buildStage("pension", wh).sections.some((s) => s.key === `pension/${parent.id}`)).toBe(false);
    expect(buildStage("pension", wh).sections.some((s) => s.key === `pension/${selfOf(wh).id}`)).toBe(true);
  });
});

describe("年金の見込み（計算の結果から読む。0067）", () => {
  it("写しの要求は伸びの前提と受け取り開始を外し、世帯の物は変えない", () => {
    const req = modelHousehold("deferral");
    const r = pensionEstimateRequest(req, false);
    expect(r.input.assumptions).not.toHaveProperty("inflation");
    expect(r.input.assumptions).not.toHaveProperty("wageGrowth");
    expect(r.input.household.pensionRecords?.[0]?.claim).toBeUndefined();
    expect(req.input.household.pensionRecords?.[0]?.claim).toBeDefined();
    expect(pensionEstimateRequest(req, true).input.household.pensionRecords?.[0]?.claim).toEqual(req.input.household.pensionRecords?.[0]?.claim);
  });

  it("人ごとの65歳からの年額と、受け取り開始を変えた人はその時点からの額（繰下げで増える）。カードの要約は月額", () => {
    const wh = open("deferral");
    const std = preview(pensionEstimateRequest(wh.request, false));
    const claimed = preview(pensionEstimateRequest(wh.request, true));
    const [l65] = pensionLines(wh, std, false);
    const [l70] = pensionLines(wh, claimed, true);
    expect(l65).toMatchObject({ from: "65歳から", receiving: false });
    // 見本は基礎だけ70歳に繰り下げている
    expect(l70!.from).toBe("基礎70歳・厚生65歳から");
    expect(l65!.annual).toBeGreaterThan(0);
    expect(l70!.annual!).toBeGreaterThan(l65!.annual!);
    const v = estimateView(wh, { std, claimed })!;
    expect(v.people[0]!.text).toMatch(/^65歳から 年[\d,.]+万円（月[\d,.]+万円）$/);
    expect(v.people[0]!.sub[0]).toMatch(/^受け取り開始（基礎70歳・厚生65歳）から 年/);
    const s = pensionEstimateSummary(wh, std)!;
    expect(s).toMatchObject({ pre: "月", unit: "万円（65歳から・推定）" });
    expect(inputItems(wh, { pension: s }).find((i) => i.id === "pension")!.summary).toEqual(s);
  });

  it("夫婦なら合計の月額。もう受け取っている夫婦は「今」の年額", () => {
    const wh = open("pensionCouple");
    const std = preview(pensionEstimateRequest(wh.request, false));
    const v = estimateView(wh, { std, claimed: null })!;
    expect(v.people.map((p) => p.text.slice(0, 1))).toEqual(["今", "今"]);
    expect(v.total).toMatch(/^夫婦で月[\d,.]+万円（今・推定）$/);
    expect(pensionEstimateSummary(wh, std)).toMatchObject({ pre: "夫婦で月", unit: "万円（今・推定）" });
    const couple = open("salariedCoupleTwoKids");
    const s2 = pensionEstimateSummary(couple, preview(pensionEstimateRequest(couple.request, false)))!;
    expect(s2).toMatchObject({ pre: "夫婦で月", unit: "万円（65歳から・推定）" });
  });

  it("推計の人は推定の額と「書類の額で置き換える」の案内、加入月数が0か月のままの定期便は要約に出さない", () => {
    const wh = blankHousehold(BASE, ids());
    const v = estimateView(wh, { std: preview(pensionEstimateRequest(wh.request, false)), claimed: null })!;
    expect(v.people[0]!.sub.at(-1)).toContain("書類が無いので、働き方の期間から推計した額");
    const { wh: doc } = withStatement(true);
    expect(pensionEstimateSummary(doc, preview(pensionEstimateRequest(doc.request, false)))).toBeNull();
  });
});

describe("推計のしかたと受け取り開始の欄（0066 の 2026-10-29 の追記）", () => {
  it("推計（書類なし）のときは、入れ方の欄の横に推計のしかたを出す。書類からのときは出さない", () => {
    const wh = blankHousehold(BASE, ids());
    const self = selfOf(wh).id;
    expect(fieldOf(wh, `pension/${self}/mode`).get(wh).hint).toMatch(/^推計のしかた: 生年月と、働き方と収入の項目の働き方の期間/);
    const doc = fieldOf(wh, `pension/${self}/mode`).set(wh, "document");
    expect(fieldOf(doc, `pension/${self}/mode`).get(doc).hint ?? null).toBeNull();
  });

  it("「基礎・厚生とも」は標準だけの欄（詳細では基礎・厚生の別々の欄を代わりに出す）。別々の欄は詳細", () => {
    const wh = blankHousehold(BASE, ids());
    const self = selfOf(wh).id;
    const both = fieldOf(wh, `pension/${self}/estimate/claim`);
    expect(both).toMatchObject({ level: "simple", simpleOnly: true });
    expect(fieldOf(wh, `pension/${self}/estimate/claim/basic`)).toMatchObject({ level: "detail" });
    expect(fieldOf(wh, `pension/${self}/estimate/claim/employee`).simpleOnly).toBeUndefined();
  });

  it("繰下げは別々にでき、標準の欄に「違う時期にしています」を出す。標準の欄を直すと両方そろう", () => {
    const wh = blankHousehold(BASE, ids());
    const self = selfOf(wh).id;
    const w = fieldOf(wh, `pension/${self}/estimate/claim/basic`).set(wh, 70);
    const m = w.request.input.household.members.find((x) => x.id === self)!;
    expect(m.pensionClaim?.basic).toBeDefined();
    expect(m.pensionClaim?.employee).toBeUndefined();
    expect(fieldOf(w, `pension/${self}/estimate/claim`).get(w).warn).toMatch(/基礎と厚生で違う時期にしています/);
    const w2 = fieldOf(w, `pension/${self}/estimate/claim`).set(w, 68);
    const m2 = w2.request.input.household.members.find((x) => x.id === self)!;
    expect(m2.pensionClaim?.basic).toEqual(m2.pensionClaim?.employee);
    expect(fieldOf(w2, `pension/${self}/estimate/claim`).get(w2).warn ?? null).toBeNull();
  });

  it("繰上げは両方同時: 片方を65歳より前にすると両方そろえ、繰上げの後に片方を直すと両方を直す", () => {
    const wh = blankHousehold(BASE, ids());
    const self = selfOf(wh).id;
    const early = fieldOf(wh, `pension/${self}/estimate/claim/employee`).set(wh, 62);
    const m = early.request.input.household.members.find((x) => x.id === self)!;
    expect(m.pensionClaim?.basic).toEqual(m.pensionClaim?.employee);
    expect(fieldOf(early, `pension/${self}/estimate/claim/basic`).get(early).value).toBe(62);
    // 繰上げのまま片方を66歳に → 両方66歳（片方だけ繰上げの形は作らない）
    const later = fieldOf(early, `pension/${self}/estimate/claim/basic`).set(early, 66);
    expect(fieldOf(later, `pension/${self}/estimate/claim/employee`).get(later).value).toBe(66);
    // 片方を65歳（標準）に戻すと、もう片方も標準に戻る
    const std = fieldOf(early, `pension/${self}/estimate/claim/basic`).set(early, 65);
    expect(std.request.input.household.members.find((x) => x.id === self)!.pensionClaim).toBeUndefined();
    // 繰下げどうしは別々のまま
    const d1 = fieldOf(wh, `pension/${self}/estimate/claim/basic`).set(wh, 70);
    const d2 = fieldOf(d1, `pension/${self}/estimate/claim/employee`).set(d1, 67);
    expect(fieldOf(d2, `pension/${self}/estimate/claim/basic`).get(d2).value).toBe(70);
    expect(fieldOf(d2, `pension/${self}/estimate/claim/employee`).get(d2).value).toBe(67);
  });

  it("時点の部品で片方を繰上げにしても両方そろえる（書類からの記録の claim）", () => {
    const { wh, self } = withStatement();
    const f = fieldOf(wh, `/claim/employee`);
    const m = wh.request.input.household.members.find((x) => x.id === self)!;
    const tp = { memberAge: { member: m.id, years: 63, ageSwitch: "monthAfterReach" as const } };
    const w = f.time!.setWhen(wh, tp, "auto");
    const rec = recordsOf(w)[0]!;
    expect(rec.claim?.basic).toEqual(rec.claim?.employee);
  });
});
