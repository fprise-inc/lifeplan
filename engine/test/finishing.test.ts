// 計算部品の仕上げ（L1）: 免除の月の割合（死亡一時金・寡婦年金・老齢基礎年金）、国民健康保険の高額療養費の所得区分、高額療養費の年間上限の
// 計算し直し、贈与税の按分の端数、中高齢者の期間短縮の特例、経過的寡婦加算、贈与者（donors）、障害年金の65歳からの選択（2026-10-10 の決定）。
// 製品の制度データ（原本での確認待ちの値を含む）で手計算と突き合わせる
import { describe, expect, it } from "vitest";
import { runEngine, type EngineResult } from "../src/engine/run.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import type { DisabilityPensionOutput, GiftReceivedOutput, GiftTaxOutput, PensionOutput, SurvivorPensionOutput } from "../src/sdk/contracts.ts";
import { box, household, member, period, realPacks, uid } from "./helpers.ts";

type Req = EngineRequest;
type Flow = EngineResult["flows"][number];
type Obj = Record<string, unknown>;
const H = uid("fh");
const W = uid("fw");
const at = (ym: string) => ({ at: ym });
const call = <T>(req: Req, component: string, input: unknown): T => runEngine(req, realPacks(), { checkInternal: true, entry: { component, input } }).entryOutput as T;
const edit = (req: Req, f: (h: Obj, input: Obj) => void): Req => {
  const r = JSON.parse(JSON.stringify(req)) as Req;
  const input = r.input as unknown as Obj;
  f(input.household as Obj, input);
  return r;
};
const spouse = { type: "spouse", a: H, b: W, marriage: "legal", from: null, to: null };
const sumFlows = (fs: readonly Flow[], f: (x: Flow) => boolean) => fs.filter(f).reduce((s, x) => s + x.amount, 0);
const selfEmployed = (who: string, income: number, from = "2010-04", to: string | null = null) => ({
  id: uid(`fse.${who}.${from}`),
  member: who,
  from: at(from),
  to: to === null ? null : at(to),
  type: "selfEmployed",
  business: { income: box(income) },
});

/** 自営業の夫（1980年生まれ）と子のない妻（1985年生まれ）。夫の加入歴と死亡の月を与える */
const selfEmployedDeath = (history: Obj[], deathYm: string, endYear = 2028) =>
  edit(
    household({
      baseMonth: "2026-10",
      endYear,
      members: [member("fh", "self", "1980-05", { sex: "male" }), member("fw", "spouse", "1985-05")],
      relations: [{ ...spouse, from: at("2005-04") }],
    }),
    (h, input) => {
      h.employmentPeriods = [selfEmployed(H, 3000000, "2026-10")];
      h.pensionRecords = [{ id: uid("frec"), member: H, kind: "history", asOf: "2026-09", history }];
      input.contingencies = [{ id: uid("fcg"), kind: "death", member: H, occurs: at(deathYm) }];
    },
  );

describe("死亡一時金・寡婦年金の第1号の月数（免除の割合。国民年金法52条の2・49条・50条）", () => {
  // 納付済30か月＋（4分の1免除12か月）＋未納3か月。記録の後（2026年10〜12月。死亡の月の前月まで）は自営業で納付済
  const hist = (exempt: string) => [
    { from: "2023-01", to: "2025-06", category: "national1" },
    { from: "2025-07", to: "2026-06", category: exempt },
    { from: "2026-07", to: "2026-09", category: "national1Unpaid" },
  ];
  it("4分の1免除の月は4分の3で数える: 33＋12×3/4 = 42か月（36か月以上）→ 死亡一時金 120,000円", () => {
    expect(call<SurvivorPensionOutput>(selfEmployedDeath(hist("national1ExemptQuarter"), "2027-01"), "pension.survivor", { member: W }).lumpSum).toBe(120000);
  });
  it("4分の3免除は4分の1: 33＋12×1/4 = 36か月 → 120,000円。全額免除・学生納付特例は数えない: 33か月 → 0円", () => {
    expect(call<SurvivorPensionOutput>(selfEmployedDeath(hist("national1ExemptThreeQuarters"), "2027-01"), "pension.survivor", { member: W }).lumpSum).toBe(120000);
    expect(call<SurvivorPensionOutput>(selfEmployedDeath(hist("national1ExemptFull"), "2027-01"), "pension.survivor", { member: W }).lumpSum).toBe(0);
    expect(call<SurvivorPensionOutput>(selfEmployedDeath(hist("national1Deferred"), "2027-01"), "pension.survivor", { member: W }).lumpSum).toBe(0);
  });
  it("寡婦年金の額: 全額免除の月は2分の1（2009年4月以後）で、納付済の月と比べて額が按分される", () => {
    const wp = (category: string) => {
      const out = call<SurvivorPensionOutput>(
        selfEmployedDeath(
          [
            { from: "2015-02", to: "2023-05", category: "national1" },
            { from: "2023-06", to: "2026-09", category },
          ],
          "2027-06",
          2052,
        ),
        "pension.survivor",
        { member: W },
      );
      return out.months.find((m) => m.month === "2045-07")?.widowPension ?? 0;
    };
    const paid = wp("national1"); // 100＋40＋記録の後の8か月（死亡の月の前月まで） = 148か月
    const full = wp("national1ExemptFull"); // 100＋40×1/2＋8 = 128か月
    expect(paid).toBeGreaterThan(0);
    expect(Math.abs(full - Math.round((paid * 128) / 148))).toBeLessThanOrEqual(1);
    // 学生納付特例だけの夫は寡婦年金の対象外（49条の括弧書き）だが、納付済の月があれば対象。額には入らない
    const deferred = wp("national1Deferred"); // 100＋8 = 108か月
    expect(Math.abs(deferred - Math.round((paid * 108) / 148))).toBeLessThanOrEqual(1);
  });
});

describe("老齢基礎年金の免除の月（国民年金法27条ただし書・平成16年改正法附則10条）", () => {
  const oldAge = (months: Obj) =>
    edit(household({ baseMonth: "2026-10", endYear: 2028, members: [member("fa", "self", "1961-06")] }), (h) => {
      h.pensionRecords = [{ id: uid("farec"), member: uid("fa"), kind: "statementUnder50", asOf: "2026-05", months, amounts: { employee: box(0) } }];
    });
  it("日本年金機構の計算例: 納付400月・全額免除40月・4分の1免除40月 → 847,300×(400＋20＋35)/480 = 803,170円", () => {
    const out = call<{ months: PensionOutput["months"] }>(oldAge({ basic: 400, employee: 0, category1: { paid: 400, exemptFull: 40, exemptQuarter: 40 } }), "pension.oldAgeBase", { member: uid("fa") });
    expect(out.months.find((m) => m.month === "2026-10")?.basic).toBe(803170);
  });
  it("2009年3月以前の免除の月は 5/6・2/3・1/2・1/3（加入歴）", () => {
    const req = edit(household({ baseMonth: "2026-10", endYear: 2028, members: [member("fa", "self", "1961-06")] }), (h) => {
      h.pensionRecords = [
        {
          id: uid("farec"),
          member: uid("fa"),
          kind: "history",
          asOf: "2021-05",
          history: [
            { from: "1981-06", to: "2008-08", category: "national1" }, // 327か月
            { from: "2008-09", to: "2009-02", category: "national1ExemptFull" }, // 6か月×1/3 = 2
            { from: "2009-04", to: "2009-09", category: "national1ExemptFull" }, // 6か月×1/2 = 3
          ],
        },
      ];
    });
    const out = call<{ months: PensionOutput["months"] }>(req, "pension.oldAgeBase", { member: uid("fa") });
    // 847,300×(327＋2＋3)/480 = 586,049.1… → 586,049円
    expect(out.months.find((m) => m.month === "2026-10")?.basic).toBe(586049);
  });
});

describe("中高齢者の期間短縮の特例・経過的寡婦加算（昭和60年改正法附則12条・73条）", () => {
  /** 夫（1950年1月生まれ）が2026年12月に亡くなる。妻は1953年6月生まれ（経過的寡婦加算の第27区分: 63,392円） */
  const elderly = (history: Obj[], wifeBirth = "1953-06") =>
    edit(
      household({
        baseMonth: "2026-10",
        endYear: 2028,
        members: [member("fh", "self", "1950-01", { sex: "male" }), member("fw", "spouse", wifeBirth)],
        relations: [{ ...spouse, from: at("1975-04") }],
      }),
      (h, input) => {
        h.pensionRecords = [{ id: uid("frec"), member: H, kind: "history", asOf: "2026-09", history }];
        input.contingencies = [{ id: uid("fcg"), kind: "death", member: H, occurs: at("2026-12") }];
      },
    );
  const month = (req: Req) => call<SurvivorPensionOutput>(req, "pension.survivor", { member: W }).months.find((m) => m.month === "2027-01");
  it("40歳以後の厚生年金が216月（昭和24年4月2日〜昭和25年4月1日生まれは18年）あれば240月とみなし、65歳以上の妻に経過的寡婦加算 63,392円（令和8年度）", () => {
    const m = month(
      elderly([
        { from: "1970-01", to: "1989-12", category: "national1" },
        { from: "1990-01", to: "2007-12", category: "employee", averageRemuneration: 300000 },
      ]),
    );
    expect(m?.employee).toBeGreaterThan(0);
    expect(m?.widowAddition).toBe(63392);
  });
  it("40歳より前からの216月（40歳以後は156月）なら特例に当たらず、経過的寡婦加算は無い", () => {
    const m = month(
      elderly([
        { from: "1970-01", to: "1984-12", category: "national1" },
        { from: "1985-01", to: "2002-12", category: "employee", averageRemuneration: 300000 },
        { from: "2003-01", to: "2009-12", category: "national1" },
      ]),
    );
    expect(m?.employee).toBeGreaterThan(0);
    expect(m?.widowAddition).toBe(0);
  });
  it("昭和31年4月2日以後生まれの妻には経過的寡婦加算は無い", () => {
    const m = month(
      elderly(
        [
          { from: "1970-01", to: "1989-12", category: "national1" },
          { from: "1990-01", to: "2009-12", category: "employee", averageRemuneration: 300000 },
        ],
        "1956-06",
      ),
    );
    expect(m?.widowAddition).toBe(0);
  });
  it("経過的寡婦加算の全区分が日本年金機構の年金給付の経過措置一覧（令和8年度）の額と1円まで一致する（老齢基礎年金の額×率を先に1円未満四捨五入してから引く）", () => {
    // 昭和2年4月1日以前生まれ（附則別表第九の「〇」）と、昭和2年4月2日〜昭和31年4月1日生まれの29区分
    const table = [
      633700, 601204, 571115, 543175, 517162, 492883, 470171, 448878, 428876, 410050, 392300, 375536, 359678, 344655, 330403, 316862, 295740, 274617,
      253495, 232372, 211250, 190127, 169005, 147882, 126760, 105637, 84515, 63392, 42270, 21147,
    ];
    const hist = [
      { from: "1970-01", to: "1989-12", category: "national1" },
      { from: "1990-01", to: "2007-12", category: "employee", averageRemuneration: 300000 },
    ];
    const got = table.map((_, i) => month(elderly(hist, `${String(1926 + i)}-06`))?.widowAddition);
    expect(got).toEqual(table);
  });
});

describe("高額療養費（medical.highCost）: 国民健康保険の所得区分と年間上限の計算し直し", () => {
  const nhi = (husband: Obj[], wifeIncome: number, medical: Obj, endYear = 2031) =>
    edit(
      household({
        baseMonth: "2026-10",
        endYear,
        members: [member("fh", "self", "1980-05", { sex: "male" }), member("fw", "spouse", "1982-05")],
        relations: [spouse],
      }),
      (h, input) => {
        h.employmentPeriods = [...husband, ...(wifeIncome > 0 ? [selfEmployed(W, wifeIncome)] : [])];
        input.contingencies = [{ id: uid("fcg"), kind: "incapacity", member: H, occurs: (medical.from as Obj | undefined) ?? at("2029-03"), medical }];
      },
    );
  const copay = (req: Req, ym: string) => sumFlows(call<{ flows: Flow[] }>(req, "medical.highCost", { member: H }).flows, (f) => f.ym === ym && f.row === "cf.expense.care.medical");
  it("世帯の国民健康保険の構成員全員の基準所得額を合算して区分を決める（妻の所得で夫の区分が上がる）", () => {
    const med = { monthly: 1000000, months: 1, from: at("2029-09") };
    const alone = copay(nhi([selfEmployed(H, 2000000)], 0, med), "2029-09");
    const both = copay(nhi([selfEmployed(H, 2000000)], 9000000, med), "2029-09");
    expect(both).toBeGreaterThan(alone);
  });
  it("1〜7月の療養は前々年、8〜12月は前年の所得（2027年まで所得があり、2028年から無い）", () => {
    const req = nhi([selfEmployed(H, 8000000, "2010-04", "2027-12")], 0, { monthly: 1000000, months: 8 }, 2031);
    const mar = copay(req, "2029-03"); // 2027年の所得（800万円）
    const sep = copay(req, "2029-09"); // 2028年の所得（0円。住民税非課税なら最後の区分）
    expect(mar).toBeGreaterThan(sep);
    expect(sep).toBeLessThanOrEqual(36900);
  });
  it("令和8年8月〜令和9年7月: 年収約200万円以下（標準報酬月額15万円）は、負担の合計のうち41万円を超えた分を令和9年8月に払い戻す", () => {
    const req = edit(
      household({
        baseMonth: "2026-10",
        endYear: 2028,
        members: [member("fh", "self", "1980-05", { sex: "male" })],
        periods: [period("fp", { member: "fh", from: "2003-04", annual: 1800000, std: [150000, 150000] })],
        residentTaxAssessments: [{ id: uid("frta"), member: H, fiscalYear: 2026, amount: box(50000) }],
      }),
      (_h, input) => (input.contingencies = [{ id: uid("fcg"), kind: "incapacity", member: H, occurs: at("2026-10"), medical: { monthly: 300000, months: 10 } }]),
    );
    const fs = call<{ flows: Flow[] }>(req, "medical.highCost", { member: H }).flows;
    // 区分エ: 61,500円×3回＋多数回該当 44,400円×7回 = 495,300円（年間上限 53万円には届かない）
    expect(sumFlows(fs, (f) => f.row === "cf.expense.care.medical")).toBe(495300);
    expect(fs.filter((f) => f.row === "cf.income.benefit.medical").map((f) => [f.ym, f.amount])).toEqual([["2027-08", 85300]]);
  });
});

describe("贈与税（gift.tax）: 按分の端数と贈与者（donors）", () => {
  const A = uid("fa");
  const gifts = (list: Obj[], donors: Obj[] = [], residences = 1) =>
    edit(household({ baseMonth: "2026-01", endYear: 2030, members: [member("fa", "self", "1995-01"), member("fp", "parent", "1965-01")] }), (h) => {
      h.donors = donors;
      h.residences = Array.from({ length: residences }, (_, i) => ({
        id: uid(`fhome${i}`),
        kind: "own",
        from: at(i === 0 ? "2026-04" : "2026-10"),
        to: i === 0 && residences > 1 ? at("2026-09") : null,
        purchase: { price: 50000000, downPayment: 0, costs: 0, gifts: list.filter((g) => (g.home ?? 0) === i).map((g) => ({ recipient: A, ...Object.fromEntries(Object.entries(g).filter(([k]) => k !== "home")) })) },
        ownership: [{ member: A, share: "1" }],
      }));
    });
  const tax = (req: Req) => call<GiftTaxOutput>(req, "gift.tax", { member: A, year: 2026 });
  it("一般と特例の両方: 按分の各部分の1円未満を切り捨てて合計し、100円未満を切り捨てる（一般10万円・特例150万円 → 3,125＋46,875 = 50,000円）", () => {
    expect(
      tax(
        gifts([
          { giver: "other", amount: 100000, housingExemption: "none" },
          { giver: "parent", amount: 1500000, housingExemption: "none" },
        ]),
      ).tax,
    ).toBe(50000);
  });
  it("同じ贈与者からの住宅資金2回（精算課税 1,500万円ずつ）は特別控除2,500万円を合わせて数える: (3,000万−110万−2,500万)×20% = 78万円", () => {
    const D = uid("fdonor");
    const list = [
      { home: 0, giver: "parent", donor: D, amount: 15000000, taxMethod: "settlement", housingExemption: "none" },
      { home: 1, giver: "parent", donor: D, amount: 15000000, taxMethod: "settlement", housingExemption: "none" },
    ];
    expect(tax(gifts(list, [{ id: D, kind: "parent" }], 2)).tax).toBe(780000);
    // 贈与者を指さなければ、援助の物ごとに別の贈与者（これまでどおり）
    expect(tax(gifts(list.map((g) => Object.fromEntries(Object.entries(g).filter(([k]) => k !== "donor"))), [], 2)).tax).toBe(0);
  });
  it("精算課税を選んだ贈与者からのその後の贈与は、暦年課税と書いてあっても精算課税（撤回できない）", () => {
    const D = uid("fdonor");
    const req = gifts(
      [
        { home: 0, giver: "parent", donor: D, amount: 20000000, taxMethod: "settlement", housingExemption: "none" },
        { home: 1, giver: "parent", donor: D, amount: 10000000, taxMethod: "calendar", housingExemption: "none" },
      ],
      [{ id: D, kind: "parent" }],
      2,
    );
    expect(tax(req).tax).toBe(780000);
  });
  it("贈与者の区分: 配偶者の親（of が配偶者）は直系尊属でないので一般税率、本人の親の親（of が親）なら直系尊属", () => {
    const D = uid("fdonor");
    const req = (of: string) =>
      edit(
        household({
          baseMonth: "2026-01",
          endYear: 2028,
          members: [member("fh", "self", "1980-05", { sex: "male" }), member("fw", "spouse", "1982-05"), member("fc", "child", "2000-04")],
          relations: [spouse, { type: "parentOf", parent: H, child: uid("fc") }, { type: "parentOf", parent: W, child: uid("fc") }],
        }),
        (h) => {
          h.donors = [{ id: D, kind: "parent", of }];
          h.residences = [{ id: uid("fhome"), kind: "own", from: at("2026-04"), to: null, purchase: { price: 50000000, downPayment: 0, costs: 0, gifts: [{ recipient: H, donor: D, amount: 5000000, housingExemption: "none" }, { recipient: uid("fc"), donor: D, amount: 5000000, housingExemption: "none" }] }, ownership: [{ member: H, share: "1" }] }];
        },
      );
    const giver = (r: Req, who: string) => call<GiftReceivedOutput>(r, "gift.received", { member: who }).gifts[0]?.giver;
    expect(giver(req(W), H)).toBe("other");
    expect(giver(req(H), H)).toBe("parent");
    expect(giver(req(H), uid("fc"))).toBe("grandparent");
    expect(call<GiftTaxOutput>(req(W), "gift.tax", { member: H, year: 2026 }).tax).toBe(530000);
  });
  it("贈与者の ID は donors に無いと E_ARGUMENT", () => {
    const req = gifts([{ giver: "parent", donor: uid("fnone"), amount: 1000000 }]);
    expect(() => runEngine(req, realPacks(), {})).toThrow("E_ARGUMENT");
  });
});

describe("障害年金の65歳からの選択（pension.disability・pension.oldAge）", () => {
  /** 会社員の夫（1990年生まれ）が2030年に障害（等級 grade）。65歳（2055年5月）からの組み合わせ */
  const disabled = (grade: number) =>
    edit(
      household({
        baseMonth: "2026-10",
        endYear: 2058,
        members: [member("fh", "self", "1990-05", { sex: "male" })],
        periods: [period("fp", { member: "fh", from: "2013-04", annual: 6000000, std: [500000, 500000] })],
        residentTaxAssessments: [{ id: uid("frta"), member: H, fiscalYear: 2026, amount: box(300000) }],
      }),
      (_h, input) => (input.contingencies = [{ id: uid("fcg"), kind: "disability", member: H, occurs: at("2030-01"), grade }]),
    );
  it("選んだ組み合わせを出力に残し、選ばれなかった老齢年金の部分は止める（2級は障害基礎年金を含む組み合わせ）", () => {
    const req = disabled(2);
    const dis = call<DisabilityPensionOutput>(req, "pension.disability", { member: H });
    expect(dis.choices?.length).toBeGreaterThan(0);
    expect(dis.choices?.[0]?.from).toBe("2055-06");
    const old = call<PensionOutput>(req, "pension.oldAge", { member: H });
    for (const c of dis.choices ?? []) {
      const ms = old.months.filter((m) => m.month >= c.from && m.month <= c.to);
      if (c.combination === "disability") expect(ms.every((m) => m.basic === 0 && m.employee === 0)).toBe(true);
      if (c.combination === "disabilityBasicOldAgeEmployee") expect(ms.every((m) => m.basic === 0)).toBe(true);
      if (c.combination !== "oldAge") expect(dis.months.some((m) => m.month >= c.from && m.month <= c.to && m.basic > 0)).toBe(true);
    }
  });
  it("3級（障害基礎年金なし）で老齢年金の手取りが多ければ老齢年金を選び、障害厚生年金は止まる", () => {
    const req = disabled(3);
    const dis = call<DisabilityPensionOutput>(req, "pension.disability", { member: H });
    const base = call<{ months: PensionOutput["months"] }>(req, "pension.oldAgeBase", { member: H }).months.find((m) => m.month === "2056-01");
    expect(dis.choices).toEqual([{ from: "2055-06", to: "2058-12", combination: "oldAge" }]);
    expect(dis.months.find((m) => m.month === "2056-01")).toBeUndefined();
    expect((base?.basic ?? 0) + (base?.employee ?? 0)).toBeGreaterThan(0);
    const old = call<PensionOutput>(req, "pension.oldAge", { member: H }).months.find((m) => m.month === "2056-01");
    expect(old?.basic).toBe(base?.basic);
  });
});
