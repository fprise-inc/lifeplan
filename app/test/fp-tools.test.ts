// 面談の準備（0074）: 世帯の中身の一覧・次の1年に起きること・過ぎた予定・前回（控え）との入力の違い・気づき・見直しの面談の時期
import { describe, expect, it } from "vitest";
import type { TableCell } from "../src/engine/types.ts";
import { fromRequest, mutate } from "../src/workspace/input/household.ts";
import { addMonths } from "../src/workspace/levers.ts";
import { addMember } from "../src/workspace/input/stages/family.ts";
import { householdContents, inputChanges, insights, nextYearEvents, pastPlans } from "../src/workspace/tools/fpTools.ts";
import { reviewTiming } from "../src/workspace/tools/FpTools.tsx";
import { inheritancePayable } from "../src/workspace/tools/Insights.tsx";
import type { Snapshot } from "../src/workspace/snapshots/snapshots.ts";
import { modelHousehold, preview } from "./helpers.ts";

const open = (id: string) => fromRequest(modelHousehold(id));

describe("世帯の中身の一覧", () => {
  it("物を出すカードごとに並べ、人は年齢つき。読むだけ", () => {
    const wh = open("salariedCoupleTwoKids");
    const before = JSON.stringify(wh);
    const secs = householdContents(wh);
    expect(secs[0]!.card).toBe("family");
    expect(secs[0]!.rows.length).toBe(wh.request.input.household.members.length);
    expect(secs[0]!.rows.every((r) => /歳|予定/.test(r.text ?? ""))).toBe(true);
    expect(secs.some((s) => s.card === "savings" && s.rows.some((r) => (r.text ?? "").includes("万円")))).toBe(true);
    expect(JSON.stringify(wh)).toBe(before);
  });
});

describe("次の1年に起きること", () => {
  it("年齢の節目（計算の基準の月から12か月）を年月で出す", () => {
    const wh0 = open("salariedCoupleTwoKids");
    const self = wh0.request.input.household.members.find((m) => m.kind === "self")!;
    const base = wh0.request.input.baseMonth;
    // 本人が3か月後に60歳になるように生年月を直す
    const birth = addMonths(base, 3 - 60 * 12);
    const wh = mutate(wh0, (h) => void (h.members.find((m) => m.id === self.id)!.birth.birthYearMonth = birth));
    const ev = nextYearEvents(wh, null);
    expect(ev.some((e) => e.label.endsWith("60歳") && e.ym === addMonths(base, 3))).toBe(true);
    for (const e of ev.filter((x) => x.ym !== null)) {
      expect(e.ym! >= base).toBe(true);
      expect(e.ym! <= addMonths(base, 11)).toBe(true);
    }
  });

  it("計算の結果から読む物（入学金の年・年金の始まり）は年で出す", () => {
    const wh = open("educationTwoKids");
    const r = preview(wh.request);
    const ev = nextYearEvents(wh, r);
    const y0 = Number(wh.request.input.baseMonth.slice(0, 4));
    for (const e of ev.filter((x) => x.ym === null)) expect([y0, y0 + 1]).toContain(e.year);
  });
});

describe("過ぎた予定", () => {
  it("計算の基準の月より前に終わった1回きりの出るお金を出す", () => {
    const wh0 = open("salariedCoupleTwoKids");
    const base = wh0.request.input.baseMonth;
    const at = addMonths(base, -2);
    const wh = mutate(wh0, (h) => void (h.periodicExpenses ??= []).push({ id: "00000000-0000-4000-8000-0000000000e1", row: "cf.expense.lumpSum.other", label: "架空の旅行", from: { at }, to: { at }, everyYears: 1, amount: { value: 300000, state: "confirmed", origin: { kind: "manual" } } }));
    expect(pastPlans(wh).map((p) => p.label)).toContain("出るお金「架空の旅行」");
    expect(pastPlans(wh0).some((p) => p.label.includes("架空の旅行"))).toBe(false);
  });
});

describe("前回（控え）との入力の違い", () => {
  it("同じなら0件。値を変えると欄ごと、足した物は物ごとに1行", () => {
    const wh = open("salariedCoupleTwoKids");
    expect(inputChanges(wh.request, wh)).toEqual([]);
    const lv = wh.request.input.household.livingExpenses![0]!;
    const changed = mutate(wh, (h) => {
      const l = h.livingExpenses![0]! as unknown as { monthly?: { value: number } };
      if (l.monthly !== undefined) l.monthly.value += 10000;
      (h.periodicExpenses ??= []).push({ id: "00000000-0000-4000-8000-0000000000e2", row: "cf.expense.lumpSum.other", label: "架空の買い物", from: { at: addMonths(wh.request.input.baseMonth, 6) }, to: { at: addMonths(wh.request.input.baseMonth, 6) }, everyYears: 1, amount: { value: 100000, state: "confirmed", origin: { kind: "manual" } } });
    });
    const rows = inputChanges(wh.request, changed);
    expect(rows.some((r) => r.key === "add:00000000-0000-4000-8000-0000000000e2" && r.after === "足した")).toBe(true);
    // 足した物の欄は物の1行にまとめる
    expect(rows.filter((r) => r.key.includes("0000000000e2"))).toHaveLength(1);
    if ((lv as unknown as { monthly?: unknown }).monthly !== undefined) expect(rows.some((r) => r.card === "living")).toBe(true);
  });
});

describe("気づき", () => {
  const req = modelHousehold("salariedCoupleTwoKids");
  const years = (() => {
    const y0 = Number(req.input.baseMonth.slice(0, 4)) + 1;
    return Array.from({ length: 10 }, (_, i) => y0 + i);
  })();
  const cell = (row: string, year: number, amount: number, member?: string): TableCell => ({ row, year, amount, ...(member !== undefined ? { member } : {}) });

  it("赤字が3年以上続く・教育と介護が重なる・預金が生活費の何か月分を下回る・NISA の枠を使い切る", () => {
    const [a, b, c, d] = years as [number, number, number, number];
    const table: TableCell[] = [
      cell("cf.net", a, 10), cell("cf.net", b, -1), cell("cf.net", c, -1), cell("cf.net", d, -1),
      cell("cf.expense.education.school", c, 500000), cell("cf.expense.care.nursing", c, 300000),
      ...years.map((y) => cell("cf.expense.living.base", y, 3600000)),
      ...years.map((y, i) => cell("cf.balance.account.deposit", y, i < 3 ? 5000000 : 1000000)),
      cell("cf.balance.nisaFrame", a, 1000000, "m1"), cell("cf.balance.nisaFrame", b, 0, "m1"),
    ];
    const list = insights(req, { header: {} as never, table, summary: null }, { months: 6 });
    const keys = list.map((x) => x.key);
    expect(keys).toEqual(["deposit", "deficit", "eduCare", "nisa:m1"]);
    expect(list.find((x) => x.key === "deposit")!.year).toBe(years[3]);
    expect(list.find((x) => x.key === "deficit")!.text).toContain("3年続けて");
    expect(list.find((x) => x.key === "eduCare")!.year).toBe(c);
    expect(list.find((x) => x.key === "nisa:m1")!.year).toBe(b);
    expect(insights(req, { header: {} as never, table: [], summary: null })).toEqual([]);
  });

  it("相続税がかかる見込み（いま亡くなったときの目安が0円でない）", () => {
    const r = { header: {} as never, table: [], summary: null, inheritanceTax: { points: [{ point: "now", status: "ok", noTax: false, payable: 3200000 }, { point: "bothAfter", status: "ok", noTax: false, payable: 9000000 }] } } as never;
    expect(inheritancePayable(r)).toBe(3200000);
    expect(insights(req, { header: {} as never, table: [], summary: null }, { inheritanceTax: 3200000 }).map((x) => x.key)).toEqual(["inheritanceTax"]);
    expect(inheritancePayable(null)).toBeNull();
  });

  it("見本の世帯でも計算でき、読むだけ", () => {
    for (const id of ["salariedCoupleTwoKids", "elderCare", "selfEmployed"]) {
      const q = modelHousehold(id);
      expect(() => insights(q, preview(q))).not.toThrow();
    }
  });
});

describe("見直しの時期", () => {
  it("いちばん新しい控えの年月と、その1年後", () => {
    const s = (createdAt: string) => ({ createdAt }) as unknown as Snapshot;
    expect(reviewTiming([])).toBeNull();
    expect(reviewTiming([s("2026-03-10T10:00:00+09:00"), s("2026-09-01T10:00:00+09:00")])).toEqual({ last: "2026-09", next: "2027-09" });
  });
});

describe("世帯の中身: これから生まれる子", () => {
  it("生まれる予定の年月（和暦）を出す", () => {
    const wh = addMember(fromRequest(modelHousehold("salariedCoupleTwoKids")), "child", undefined, { expected: true });
    const kid = wh.request.input.household.members.find((m) => m.expected === true)!;
    const rows = householdContents(wh).flatMap((s) => s.rows);
    expect(rows.find((r) => r.id === kid.id)?.text).toMatch(/^これから生まれる予定（令和\d+年\d+月）$/);
  });
});
