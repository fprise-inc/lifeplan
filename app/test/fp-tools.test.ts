// 面談の準備（0074）: 世帯の中身の一覧・次の1年に起きること・過ぎた予定・前回（控え）との入力の違い・結果のタブのポイント（前の名前は気づき）・見直しの面談の時期
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import type { TableCell } from "../src/engine/types.ts";
import { fromRequest, mutate } from "../src/workspace/input/household.ts";
import { addMonths } from "../src/workspace/levers.ts";
import { addMember } from "../src/workspace/input/stages/family.ts";
import { bigSpendOverlaps, householdContents, inputChanges, insights, nextYearEvents, OVERLAP_RULE, OVERLAP_RULES, pastPlans, withoutHousingCredit, type OverlapRule } from "../src/workspace/tools/fpTools.ts";
import { reviewTiming } from "../src/workspace/tools/FpTools.tsx";
import { Insights, inheritancePayable } from "../src/workspace/tools/Insights.tsx";
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

describe("ポイント（0074 の追記 2026-11-12 の見直し）", () => {
  const req = modelHousehold("salariedCoupleTwoKids");
  const self = req.input.household.members.find((m) => m.kind === "self")!.id;
  const spouse = req.input.household.members.find((m) => m.kind === "spouse")!.id;
  const years = (() => {
    const y0 = Number(req.input.baseMonth.slice(0, 4)) + 1;
    return Array.from({ length: 10 }, (_, i) => y0 + i);
  })();
  const cell = (row: string, year: number, amount: number, member?: string, object?: string): TableCell => ({ row, year, amount, ...(member !== undefined ? { member } : {}), ...(object !== undefined ? { object } : {}) });
  const res = (table: TableCell[]) => ({ header: {} as never, table, summary: null });
  const [a, b, c, d, e, f, g] = years as [number, number, number, number, number, number, number];

  it("預金が少なくなる年: 下回る年と、その年の預金の額（「○万円になり、…を下回ります」。0円以下は「なくなります（…目安…）」）", () => {
    const table: TableCell[] = [...years.map((y) => cell("cf.expense.living.base", y, 3600000)), ...years.map((y, i) => cell("cf.balance.account.deposit", y, i < 3 ? 5000000 : 1000000))];
    const dep = insights(req, res(table), { months: 6 }).find((x) => x.key === "deposit")!;
    expect(dep.year).toBe(d);
    expect(dep.text).toBe(`${d}年に、預金が100万円になり、生活費の6か月分（180万円）を下回ります`);
    const none = insights(req, res([...years.map((y) => cell("cf.expense.living.base", y, 3600000)), ...years.map((y) => cell("cf.balance.account.deposit", y, 0))]), { months: 6 });
    expect(none.find((x) => x.key === "deposit")!.text).toBe(`${a}年に、預金がなくなります（手元に置く目安の生活費6か月分は180万円です）`);
  });

  it("赤字が続く: 働いている間（いまの主な働き手が働く最後の年まで）だけで見る。退職した後の赤字（取り崩し）は出さない", () => {
    // ご本人（主な働き手）は d 年まで、配偶者は f 年まで働く。赤字は b〜c（2年）と e〜g（退職した後）
    const work = [...years.filter((y) => y <= d).map((y) => cell("cf.income.salary", y, 6000000, self)), ...years.filter((y) => y <= f).map((y) => cell("cf.income.salary", y, 2000000, spouse))];
    const net = (minus: number[]) => years.map((y) => cell("cf.net", y, minus.includes(y) ? -1 : 10));
    expect(insights(req, res([...work, ...net([b, c, e, f, g])])).some((x) => x.key === "deficit")).toBe(false);
    // 働いている間に3年続けば出す（退職した後の赤字の年は数えない）
    const run = insights(req, res([...work, ...net([b, c, d, e, f, g])])).find((x) => x.key === "deficit")!;
    expect(run.text).toBe(`働いている間の${b}年から${d}年まで、3年続けて年間収支が赤字です`);
    expect(run.year).toBe(b);
    // だれも働いて得る収入が無い世帯（年金で暮らしている）では出さない
    expect(insights(req, res(net(years))).some((x) => x.key === "deficit")).toBe(false);
  });

  it("大きな支出が重なる年: 教育費（子ごと）・介護（人ごと）などの50万円以上が2件以上で、支出がふだんの年より2割以上多い年。いちばん大きく重なる年と、ほかの年", () => {
    const goal = req.input.household.goals!.find((x) => x.kind === "education")!;
    const table: TableCell[] = [
      ...years.map((y) => cell("cf.expense.living.base", y, 3000000)),
      // 教育費は毎年60万円、e 年だけ200万円。介護は d・e 年に120万円
      ...years.map((y) => cell("cf.expense.education.school", y, y === e ? 2000000 : 600000, goal.owner, goal.id)),
      cell("cf.expense.care.facility", d, 1200000, self), cell("cf.expense.care.facility", e, 1200000, self),
    ];
    const big = insights(req, res(table)).find((x) => x.key === "bigSpend")!;
    expect(big.title).toBe("大きな支出が重なる年");
    expect(big.year).toBe(e);
    expect(big.text).toMatch(new RegExp(`^${e}年に、第\\d子の教育費200万円・ご本人の介護120万円が重なり、支出が前後の年より約[0-9]割多くなります（ほかに${d}年）$`));
    // 1件だけの年・ふだんと変わらない年は出さない
    expect(insights(req, res(table.filter((x) => !x.row.startsWith("cf.expense.care")))).some((x) => x.key === "bigSpend")).toBe(false);
    // 前の「教育と介護が重なる」「NISA の枠を使い切る年」は出さない
    const keys = insights(req, res([...table, cell("cf.balance.nisaFrame", a, 1000000, self), cell("cf.balance.nisaFrame", b, 0, self)])).map((x) => x.key);
    expect(keys.some((k) => k === "eduCare" || k.startsWith("nisa"))).toBe(false);
  });

  it("大きな支出が重なる年の決め方は3つの案から選べ、見本 3-4-06 ではそれぞれ別の年が出る（採用は案2）", () => {
    const q = modelHousehold("sampleFamilyDreams");
    const r = preview(q);
    const yearsOf = (rule: OverlapRule) => bigSpendOverlaps(q, r.table, rule).map((y) => y.year);
    expect(OVERLAP_RULE).toBe(OVERLAP_RULES.usual);
    expect(yearsOf(OVERLAP_RULES.count)).toEqual([2033, 2034, 2035, 2036]);
    expect(yearsOf(OVERLAP_RULES.usual)).toEqual([2029, 2036]);
    expect(yearsOf(OVERLAP_RULES.living)).toEqual([2029, 2033, 2034, 2035, 2036]);
    const big = insights(q, r).find((x) => x.key === "bigSpend")!;
    expect(big.text).toBe("2036年に、夢「車の買い替え」442万円・第2子の教育費364万円・第1子の教育費110万円が重なり、支出が前後の年より約8割多くなります（ほかに2029年）");
    // 決め方を差し替えると文の「ほかに」の年も変わる
    expect(insights(q, r, { overlapRule: OVERLAP_RULES.count }).find((x) => x.key === "bigSpend")!.text).toContain("（ほかに2033〜2035年）");
  });

  it("退職から年金までの空白・退職後もローンが残る（見本 3-4-01。配偶者の働く収入がある間はそう書く。繰上返済の予定も入った完済の年）", () => {
    const r = preview(req);
    const list = insights(req, r);
    const gap = list.filter((x) => x.key.startsWith("retireGap:"));
    expect(gap.map((x) => x.text)).toEqual([
      "ご本人が60歳で退職してから年金の受け取りまで5年、収入が少ない期間があります（配偶者の働く収入は2043年まで）",
      "配偶者が60歳で退職してから年金の受け取りまで5年、収入が少ない期間があります",
    ]);
    expect(gap[0]!.year).toBe(2042);
    const loan = list.find((x) => x.key.startsWith("loanAfterRetire:"))!;
    expect(loan.title).toBe("退職後もローンが残る");
    expect(loan.text).toBe("住宅ローン（ご本人）の完済は70歳（2051年）で、退職後も10年返済が続きます");
    expect(loan.year).toBe(2051);
    // 働く最後の年に年金が始まる・年金の後も働く人は出さない（見本 3-4-04 のご本人は70歳まで働き65歳から年金）
    const se = modelHousehold("sampleSelfEmployedFamily");
    expect(insights(se, preview(se)).some((x) => x.key.startsWith("retireGap:"))).toBe(false);
  });

  it("住宅ローン控除が終わる年: 控除を受けない計算との所得税・住民税の違いの最後の年と、その年の軽減の額", () => {
    const q = modelHousehold("housingPurchase");
    const off = withoutHousingCredit(q)!;
    expect(off.input.household.debts!.every((x) => x.housing === undefined || x.housing.creditDisabled === true)).toBe(true);
    expect(q.input.household.debts!.some((x) => x.housing?.creditDisabled === true)).toBe(false);
    const r = preview(q);
    const credit = { on: r, off: preview(off) };
    const c = insights(q, r, { credit }).find((x) => x.key === "housingCredit")!;
    expect(c.title).toBe("住宅ローン控除が終わる年");
    expect(c.text).toBe("2040年で住宅ローン控除が終わり、翌年から手取りが年18万円ほど減ります（2040年の所得税・住民税の軽減の額）");
    expect(c.year).toBe(2040);
    // 組が無ければ出さない。控除の期間の中の住宅ローンが無い世帯は、控除を受けない計算をしない
    expect(insights(q, r).some((x) => x.key === "housingCredit")).toBe(false);
    expect(withoutHousingCredit(modelHousehold("sampleSingle20s"))).toBeNull();
    // 控除の期間の中でも、計算で控除が出ていなければ（違いが無ければ）出さない
    const s = preview(req);
    expect(insights(req, s, { credit: { on: s, off: preview(withoutHousingCredit(req)!) } }).some((x) => x.key === "housingCredit")).toBe(false);
  });

  it("相続税がかかる見込み（いま亡くなったときの目安が0円でない）", () => {
    const r = { header: {} as never, table: [], summary: null, inheritanceTax: { points: [{ point: "now", status: "ok", noTax: false, payable: 3200000 }, { point: "bothAfter", status: "ok", noTax: false, payable: 9000000 }] } } as never;
    expect(inheritancePayable(r)).toBe(3200000);
    expect(insights(req, res([]), { inheritanceTax: 3200000 }).map((x) => x.key)).toEqual(["inheritanceTax"]);
    expect(inheritancePayable(null)).toBeNull();
    expect(insights(req, res([]))).toEqual([]);
  });

  it("結果のタブ: 閉じているときは「ポイント ○件 ▸」の1行だけ。開くと一覧と「その年を見る」「対策を考える」（0074 の追記 2026-11-12）", () => {
    const table: TableCell[] = [...years.map((y) => cell("cf.expense.living.base", y, 3600000)), ...years.map((y, i) => cell("cf.balance.account.deposit", y, i < 3 ? 5000000 : 1000000))];
    const result = res(table);
    const props = { req, result, months: 6, onYear: () => undefined, onLevers: () => undefined };
    const closed = renderToString(h(Insights, props));
    expect(closed).toContain("ポイント 1件");
    expect(closed).not.toContain("気づき");
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).not.toContain("data-insight=");
    const opened = renderToString(h(Insights, { ...props, initialOpen: true }));
    expect(opened).toContain('aria-expanded="true"');
    expect(opened).toContain('data-insight="deposit"');
    expect(opened).toContain("その年を見る");
    expect(opened).toContain("対策を考える");
    expect(renderToString(h(Insights, { ...props, result: { ...result, table: [] } }))).toBe("");
  });

  it("結果のタブ: 住宅ローン控除を受ける・受けない計算の組を渡すと、控除が終わる年も出す", () => {
    const q = modelHousehold("housingPurchase");
    const r = preview(q);
    const html = renderToString(h(Insights, { req: q, result: r, credit: { on: r, off: preview(withoutHousingCredit(q)!) }, initialOpen: true }));
    expect(html).toContain('data-insight="housingCredit"');
    expect(html).toContain("2040年で住宅ローン控除が終わり");
  });

  it("見本の世帯でも計算でき、読むだけ", () => {
    for (const id of ["salariedCoupleTwoKids", "elderCare", "selfEmployed", "sampleFamilyDreams", "pairLoan", "sampleSeniorCouple"]) {
      const q = modelHousehold(id);
      const before = JSON.stringify(q);
      const r = preview(q);
      const off = withoutHousingCredit(q);
      expect(() => insights(q, r, { credit: off === null ? null : { on: r, off: preview(off) } })).not.toThrow();
      expect(JSON.stringify(q)).toBe(before);
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
