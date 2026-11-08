// お金の行と入力項目をまたぐ言葉の決まり（0130）: 足したときの始まり（毎月・毎年は今の月から・推定の印）、回数／時期／始まり・終わりの言葉、
// 欄の並び（相手→回数→額→時期→見込み）、ライフイベントの入るお金は1回／年ごと、あげる贈与の相手と根拠の文、受け取る相続・贈与の課税は読むだけ、
// 万一のときの扱いの3択（前の世帯の「続ける」の読み）、伸び方の言葉、名義の候補を持てる人に絞る部品、口座の「預金」、行の見出しの額の形
import { describe, expect, it } from "vitest";
import { forEngine } from "../src/engine/moneyRows.ts";
import type { Household, IncomeFlow, Member, PeriodicExpense } from "../src/engine/types.ts";
import { allFields, type FieldDef, type StageDef, type StageId } from "../src/workspace/input/form.ts";
import { fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { ACCOUNT_KINDS, accountHolderRule, canHold, GROWTH_KINDS, holderOptions, LEGACY_HOLDER_SUFFIX, WORDS } from "../src/workspace/input/labels.ts";
import {
  addExpense,
  addIncome,
  addOutsideGrandchild,
  GIFT_PRESET,
  giftRecipientOptions,
  growthFields,
  reexpressedNote,
  rowParts,
  START_NOW_BASIS,
} from "../src/workspace/input/moneyRows.ts";
import { addOutside } from "../src/workspace/input/stages/care.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { ON_CONTINGENCY_MODES, onContingencyDetailFields } from "../src/workspace/input/stages/onContingency.ts";
import { fieldStatus } from "../src/workspace/input/valueState.ts";
import { modelHousehold, preview } from "./helpers.ts";

const stage = (id: StageId, wh: WorkingHousehold): StageDef => buildStage(id, wh);
const fieldOf = (id: StageId, wh: WorkingHousehold, key: string): FieldDef => {
  const f = allFields(stage(id, wh)).find((x) => x.key === key);
  if (f === undefined) throw new Error(`no field ${key}`);
  return f;
};
const groupOf = (id: StageId, wh: WorkingHousehold, key: string) => {
  const g = stage(id, wh).sections.flatMap((s) => s.groups).find((x) => x.key === key);
  if (g === undefined) throw new Error(`no group ${key}`);
  return g;
};
const lastIncome = (wh: WorkingHousehold): IncomeFlow => wh.request.input.household.incomeFlows!.at(-1)!;
const lastExpense = (wh: WorkingHousehold): PeriodicExpense => wh.request.input.household.periodicExpenses!.at(-1)!;
const singleParent = () => fromRequest(modelHousehold("sampleSingleParent"));
const twoKids = () => fromRequest(modelHousehold("salariedCoupleTwoKids"));
const options = (f: FieldDef) => (f.kind === "select" ? f.options : []);

describe("足したときの始まり（毎月・毎年は今の月から）", () => {
  it("養育費を受け取る・手当: 始まりは計算の基準の月で、推定の印「今から」。今年の表に入る（前は1年後からで、今続いている分が1年抜けた）", () => {
    const w0 = singleParent();
    const base = w0.request.input.baseMonth;
    for (const kind of ["childSupport", "benefit"] as const) {
      const wh = addIncome(w0, kind);
      const f = lastIncome(wh);
      expect(f.from).toEqual({ at: base });
      const st = fieldStatus(fieldOf("family", wh, `in/${f.id}/from`), wh);
      expect(st.status).toBe("estimated");
      expect(st.basis).toBe(START_NOW_BASIS.in);
    }
    // 計算: 月3万円の養育費は、今年（基準の月から12月まで）の表に入る
    const wh = addIncome(w0, "childSupport");
    const f = lastIncome(wh);
    const paid = mutate(wh, (h) => void (h.incomeFlows!.find((x) => x.id === f.id)!.amount = { value: 30000, state: "confirmed", origin: { kind: "manual" } }));
    const year = Number(base.slice(0, 4));
    const months = 12 - Number(base.slice(5, 7)) + 1;
    const other = (w: WorkingHousehold) => preview(forEngine(w.request)).table.filter((c) => c.row === "cf.income.other" && c.year === year).reduce((s, c) => s + c.amount, 0);
    expect(other(paid) - other(wh)).toBe(30000 * months);
  });

  it("始まりを直すと推定の印は外れる", () => {
    const wh = addIncome(singleParent(), "childSupport");
    const f = lastIncome(wh);
    const from = fieldOf("family", wh, `in/${f.id}/from`);
    const next = from.set(wh, { at: "2027-04" } as never);
    expect(fieldStatus(fieldOf("family", next, `in/${f.id}/from`), next).status).toBe("confirmed");
  });

  it("1回の行（財産分与）と何年かごとの行（修繕）は1年後のまま、印は付けない。毎年の出るお金（年1回の支出）・毎月の仕送りは今の月から", () => {
    const w0 = singleParent();
    const base = w0.request.input.baseMonth;
    const nextYear = `${String(Number(base.slice(0, 4)) + 1)}${base.slice(4)}`;
    const once = addIncome(w0, "propertyDivision");
    expect(lastIncome(once).from).toEqual({ at: nextYear });
    expect((lastIncome(once) as { valueStates?: unknown }).valueStates).toBeUndefined();
    const repair = addExpense(w0, "repair");
    expect(lastExpense(repair).everyYears).toBeGreaterThan(1);
    expect(lastExpense(repair).from).toEqual({ at: nextYear });
    const annual = addExpense(w0, "livingAnnual");
    expect(lastExpense(annual).from).toEqual({ at: base });
    const allowance = addExpense(w0, "allowance");
    const p = lastExpense(allowance);
    expect(p.from).toEqual({ at: base });
    const st = fieldStatus(allFields(stage("care", allowance)).find((x) => x.key === `ev/${p.id}/from`)!, allowance);
    expect(st).toMatchObject({ status: "estimated", basis: START_NOW_BASIS.out });
  });
});

describe("回数・時期・始まり／終わりの言葉と欄の並び", () => {
  it("入るお金: 回数（1回）→ 額 → 時期。くり返しは始まり・終わり。「受け取る時期」「初め」は使わない", () => {
    const wh = addIncome(singleParent(), "childSupport");
    const f = lastIncome(wh);
    const labels = groupOf("family", wh, `in/${f.id}`).fields.map((x) => x.label);
    expect(labels).toContain(WORDS.cadence);
    expect(labels).toContain("始まり");
    expect(labels).toContain("終わり");
    expect(labels).not.toContain("受け取る時期");
    expect(labels).not.toContain("時期");
    // 1回にすると「時期」
    const once = fieldOf("family", wh, `in/${f.id}/cadence`).set(wh, "once");
    const onceLabels = groupOf("family", once, `in/${f.id}`).fields.map((x) => x.label);
    expect(onceLabels).toContain("時期");
    expect(onceLabels).not.toContain("始まり");
  });

  it("出るお金: くり返しの「初め」をやめて「始まり」、1回は「時期」", () => {
    const wh = addExpense(singleParent(), "allowance");
    const p = lastExpense(wh);
    const labels = groupOf("care", wh, `ev/${p.id}`).fields.map((x) => x.label);
    expect(labels).toEqual(expect.arrayContaining(["回数", "始まり", "終わり"]));
    expect(labels).not.toContain("初め");
  });

  it("並びは相手→回数→額→時期→見込み（受け取る相続の行）", () => {
    const w0 = addOutside(twoKids(), "parent");
    const wh = addIncome(w0, "inheritance");
    const f = lastIncome(wh);
    const keys = groupOf("inheritance", wh, `in/${f.id}`).fields.map((x) => x.key.slice(`in/${f.id}/`.length));
    const at = (k: string) => keys.indexOf(k);
    expect(at("counterparty")).toBeGreaterThan(-1);
    expect(at("counterparty")).toBeLessThan(at("cadence"));
    expect(at("cadence")).toBeLessThan(at("amount"));
    expect(at("amount")).toBeLessThan(at("from"));
    expect(at("from")).toBeLessThan(at("likelihood"));
  });

  it("ライフイベントの入るお金は1回／年ごと。前の版で毎月にした行は「毎月（前の版の入れ方）」で残して見せる", () => {
    const wh = addIncome(twoKids(), "celebration");
    const f = lastIncome(wh);
    expect(options(fieldOf("events", wh, `in/${f.id}/cadence`)).map((o) => o.value)).toEqual(["once", "repeat"]);
    const monthly = mutate(wh, (h) => {
      const x = h.incomeFlows!.find((y) => y.id === f.id)!;
      x.monthly = true;
      x.to = null;
    });
    const cad = fieldOf("events", monthly, `in/${f.id}/cadence`);
    expect(options(cad).find((o) => o.value === "monthly")?.label).toBe("毎月（前の版の入れ方）");
    expect(cad.get(monthly).value).toBe("monthly");
  });
});

describe("あげる贈与", () => {
  it("相手は世帯の子・世帯の外の子と孫・その他。親・贈与者は出さない", () => {
    let wh = addOutside(twoKids(), "parent");
    wh = addOutsideGrandchild(wh);
    wh = addExpense(wh, "gift");
    const p = lastExpense(wh);
    const h = wh.request.input.household;
    const kids = h.members.filter((m) => m.kind === "child" && m.outside === undefined).map((m) => m.id);
    const grandchild = h.members.find((m) => m.kind === "grandchild")!.id;
    const parent = h.members.find((m) => m.kind === "parent")!.id;
    const values = options(fieldOf("inheritance", wh, `ev/${p.id}/counterparty`)).map((o) => o.value);
    expect(kids).toHaveLength(2);
    expect(values).toEqual(expect.arrayContaining([...kids, grandchild, ""]));
    expect(values).not.toContain(parent);
  });

  it("前に親を相手に選んだ行は、その相手を添え書きつきで残す（書き換えない）", () => {
    const w0 = addOutside(twoKids(), "parent");
    const parent = w0.request.input.household.members.find((m) => m.kind === "parent")!.id;
    const wh = mutate(addExpense(w0, "gift"), (h) => void (h.periodicExpenses!.at(-1)!.counterparty = parent));
    const o = giftRecipientOptions(wh, parent).find((x) => x.value === parent);
    expect(o?.label).toMatch(/（前に選んだ相手）$/u);
    expect(lastExpense(wh).counterparty).toBe(parent);
  });

  it("110万円は推定の印のまま、根拠は暦年贈与の基礎控除の額", () => {
    const wh = addExpense(twoKids(), "gift");
    const p = lastExpense(wh);
    expect(p.amount).toMatchObject({ value: 1100000, state: "estimated" });
    expect((p.amount as { estimate?: { basis: string } }).estimate?.basis).toBe(GIFT_PRESET);
    expect(GIFT_PRESET).toContain("暦年贈与の基礎控除の額");
  });
});

describe("受け取る相続・贈与の課税", () => {
  it("相続・遺贈: 9択の課税の扱いを出さず、読むだけの1行「相続税で見る」", () => {
    const wh = addIncome(addOutside(twoKids(), "parent"), "inheritance");
    const f = lastIncome(wh);
    const all = allFields(stage("inheritance", wh));
    expect(all.some((x) => x.key === `in/${f.id}/tax`)).toBe(false);
    const note = all.find((x) => x.key === `in/${f.id}/taxNote`)!;
    expect(note.readOnly).toBeDefined();
    expect(note.get(wh).value).toBe("相続税で見る（所得税・住民税はかかりません）");
  });

  it("贈与を受ける: 読むだけの1行と、課税の方法（暦年・精算課税）だけ", () => {
    const wh = addIncome(addOutside(twoKids(), "parent"), "giftReceived");
    const f = lastIncome(wh);
    const all = allFields(stage("inheritance", wh));
    expect(all.some((x) => x.key === `in/${f.id}/tax`)).toBe(false);
    expect(all.find((x) => x.key === `in/${f.id}/taxNote`)?.get(wh).value).toMatch(/^贈与税で見る/u);
    expect(all.some((x) => x.key === `in/${f.id}/giftMethod`)).toBe(true);
  });

  it("前に別の課税の扱いを選んだ行は、選ぶ欄を残す", () => {
    const w0 = addIncome(addOutside(twoKids(), "parent"), "inheritance");
    const wh = mutate(w0, (h) => void (h.incomeFlows!.at(-1)!.taxTreatment = "temporary"));
    const f = lastIncome(wh);
    const tax = allFields(stage("inheritance", wh)).find((x) => x.key === `in/${f.id}/tax`);
    expect(tax?.get(wh).value).toBe("temporary");
  });
});

describe("万一のときの扱い（続ける・やめる・割合を変える）", () => {
  const withRow = (on?: PeriodicExpense["onContingency"]) => {
    const wh = addExpense(singleParent(), "allowance");
    const p = lastExpense(wh);
    return { wh: on === undefined ? wh : mutate(wh, (h) => void (h.periodicExpenses!.find((x) => x.id === p.id)!.onContingency = on)), id: p.id };
  };
  it("選択肢は「続ける（既定）／やめる／割合を変える」の3つ（「指定しない」と「続ける」を2つ出さない）", () => {
    expect(ON_CONTINGENCY_MODES.map((o) => o.label)).toEqual(["続ける（既定）", "やめる", "割合を変える"]);
    const { wh, id } = withRow();
    expect(fieldOf("care", wh, `ev/${id}/on/mode`).get(wh).value).toBe("");
  });

  it("前の世帯の「続ける」（continue）は「続ける（既定）」と読み、書き換えない。割合・該当する万一の欄も出さない", () => {
    const { wh, id } = withRow({ mode: "continue" });
    const f = fieldOf("care", wh, `ev/${id}/on/mode`);
    expect(f.get(wh).value).toBe("");
    // 同じ値を選んでも世帯は変えない
    expect(lastExpense(f.set(wh, "")).onContingency).toEqual({ mode: "continue" });
    expect(onContingencyDetailFields({ key: "k", item: "periodicExpense.onContingency", find: () => undefined, path: ["onContingency"], on: { mode: "continue" } })).toEqual([]);
  });

  it("やめる → 続けるに戻すと空（省略）にする", () => {
    const { wh, id } = withRow();
    const f = fieldOf("care", wh, `ev/${id}/on/mode`);
    const stop = f.set(wh, "stop");
    expect(lastExpense(stop).onContingency).toEqual({ mode: "stop" });
    const back = fieldOf("care", stop, `ev/${id}/on/mode`).set(stop, "");
    expect(lastExpense(back).onContingency).toBeUndefined();
  });
});

describe("伸び方の言葉", () => {
  it("選択肢は「物価に合わせる／決まった率で／変えない」、率の欄は「伸び率（年）」（値は変えない）", () => {
    expect(GROWTH_KINDS).toEqual([
      { value: "inflation", label: "物価に合わせる" },
      { value: "rate", label: "決まった率で" },
      { value: "none", label: "変えない" },
    ]);
    const fs = growthFields("ev/x", "periodicExpense.growth", () => undefined, "x", { kind: "rate", rate: "0.01" });
    expect(fs.map((f) => f.label)).toEqual([WORDS.growth, WORDS.growthRate]);
    expect(WORDS.growthRate).toBe("伸び率（年）");
  });
  it("率の欄の言葉は2つ: 出るお金（伸びるのが前提）は「伸び率（年）」、入るお金（減ることもある）は「増減率（年）」", () => {
    expect(WORDS.changeRate).toBe("増減率（年）");
    const inc = growthFields("in/x", "incomeFlow.growth", () => undefined, "x", { kind: "rate", rate: "-0.01" });
    expect(inc.map((f) => f.label)).toEqual([WORDS.growth, WORDS.changeRate]);
    const care = growthFields("ev/x", "care.growth", () => undefined, "x", { kind: "rate", rate: "0.01" });
    expect(care.map((f) => f.label)).toEqual([WORDS.growth, WORDS.growthRate]);
  });
});

describe("名義・人の候補を持てる人に絞る部品", () => {
  const child = (h: Household, i = 0): Member => h.members.filter((m) => m.kind === "child" && m.outside === undefined)[i]!;
  it("iDeCo は20歳以上か働き方の期間がある人（子は出ない）、NISA は18歳以上、こどもNISA は子", () => {
    const wh = twoKids();
    const h = wh.request.input.household;
    const base = wh.request.input.baseMonth;
    const self = h.members.find((m) => m.kind === "self")!;
    expect(canHold(h, base, accountHolderRule("ideco"), self)).toBe(true);
    expect(canHold(h, base, accountHolderRule("ideco"), child(h))).toBe(false);
    expect(canHold(h, base, accountHolderRule("nisa"), child(h))).toBe(false);
    expect(canHold(h, base, accountHolderRule("childNisa"), child(h))).toBe(true);
    expect(canHold(h, base, accountHolderRule("childNisa"), self)).toBe(false);
    expect(canHold(h, base, accountHolderRule("deposit"), child(h))).toBe(true);
    // これから買う車: 買う月に18歳以上なら持てる
    const later = `${String(Number(child(h).birth.birthYearMonth.slice(0, 4)) + 19)}-01`;
    expect(canHold(h, base, "age18", child(h), later)).toBe(true);
  });

  it("企業型DC・財形・持株会は勤めている期間がある人、小規模企業共済は自営業・役員の期間がある人", () => {
    const wh = twoKids();
    const h = wh.request.input.household;
    const base = wh.request.input.baseMonth;
    const self = h.members.find((m) => m.kind === "self")!;
    const selfType = (h.employmentPeriods ?? []).find((e) => e.member === self.id)?.type;
    expect(selfType).toBeDefined();
    expect(canHold(h, base, "employee", self)).toBe(selfType !== "selfEmployed" && selfType !== "unemployed");
    expect(canHold(h, base, "selfEmployedOrExecutive", self)).toBe(selfType === "selfEmployed" || selfType === "executive");
  });

  it("選択肢は持てる人だけ。今入っている人が持てなければ、添え書きを付けて残す", () => {
    const wh = twoKids();
    const h = wh.request.input.household;
    const kid = child(h);
    const opts = holderOptions(wh, "pensionInsured", undefined);
    expect(opts.some((o) => o.value === kid.id)).toBe(false);
    const kept = holderOptions(wh, "pensionInsured", kid.id);
    expect(kept.find((o) => o.value === kid.id)?.label.endsWith(LEGACY_HOLDER_SUFFIX)).toBe(true);
  });
});

describe("口座の呼び方と行の見出しの額", () => {
  it("口座の種類の「預貯金」は「預金」", () => {
    expect(ACCOUNT_KINDS.find((o) => o.value === "deposit")?.label).toBe("預金");
  });

  it("毎月の行は「月3万円」、毎年は「10万円・毎年」、1万円以上は万円で小数1桁、1万円未満は円", () => {
    const h = modelHousehold("sampleSingleParent").input.household;
    const row = (amount: number, o: { monthly?: boolean; everyYears?: number; once?: boolean }) => ({
      amount: { value: amount },
      from: { at: "2027-01" },
      to: o.once === true ? { at: "2027-01" } : null,
      everyYears: o.everyYears ?? 1,
      ...(o.monthly === true ? { monthly: true } : {}),
    });
    expect(rowParts(h, row(30000, { monthly: true })).amount).toBe("月3万円");
    expect(rowParts(h, row(100000, {})).amount).toBe("10万円・毎年");
    expect(rowParts(h, row(100000, { everyYears: 3 })).amount).toBe("10万円・3年ごと");
    expect(rowParts(h, row(20000000, { once: true })).amount).toBe("2,000万円・1回");
    expect(rowParts(h, row(12345, { monthly: true })).amount).toBe("月1.2万円");
    expect(rowParts(h, row(4500, { monthly: true })).amount).toBe("月4,500円");
  });

  it("回数を変えて直した額の知らせは、前の版の文の頭（「時期に…」）も読む", () => {
    const box = (basis: string) => ({ value: 1, state: "confirmed", estimate: { basis } });
    expect(reexpressedNote(box("回数に合わせて直した額。年あたりが同じになるよう…"))).toBe("年あたりが同じになるよう…");
    expect(reexpressedNote(box("時期に合わせて直した額。年あたりが同じになるよう…"))).toBe("年あたりが同じになるよう…");
  });
});
