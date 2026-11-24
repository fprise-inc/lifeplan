// 見本の棚にまだ出していない新しい見本の世帯4件（data/modelHouseholds。すべて架空）: 基本の見本の顔ぶれを入れ替えるときに棚に出す。
// - sampleSingle50sRenter（おひとり様・50代・賃貸）・samplePensionerCouple（もう働いていない年金生活の夫婦）は新しく作った世帯
// - sampleCoupleTwoKidsPeak は salariedCoupleTwoKids に sampleFamilyDreams の夢7件を写した世帯、sampleDualAssetsInvest は dualAssetsTwoKids に
//   investmentCouple の NISA の入れ方（つみたて投資枠を年齢で3つの期間に分ける）を写した世帯。元の世帯は多くのテストの入力なので書き換えない
// 棚に出すまでの見本の設定（目盛り・最初の提案・補足・メモ・プラン・控え）は、ここに置く（棚に出すときに見本の一覧へ移す）。
// 確かめることは見本の世帯のテスト（sample-households.test.ts）と同じ。計算は画面と同じく、計算に入れない夢などを外した要求（forEngine）で見る
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { forEngine } from "../src/engine/moneyRows.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import { DEMO_HOUSEHOLDS, type DemoHousehold } from "../src/workspace/catalog.ts";
import { fromRequest } from "../src/workspace/input/household.ts";
import { inputItems } from "../src/workspace/input/items.ts";
import { addMonths, ageReachedMonth, applyLevers, LEVER_KEYS, pensionStarted, readLevers, type LeverKey } from "../src/workspace/levers.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { applyValues, normalizeValues } from "../src/workspace/plans/plans.ts";
import { financialOf } from "../src/workspace/present.ts";
import { REPO_DIR } from "../scripts/lib.ts";
import { modelHousehold, preview } from "./helpers.ts";

type Upcoming = Omit<DemoHousehold, "family" | "age" | "rev"> & {
  /** 家族の形・本人の年代（棚の見出し・絞り込みに使う予定の値） */
  family: "単身" | "夫婦のみ" | "夫婦と子" | "ひとり親" | "シニア";
  age: number;
  /** 今の状態（現状）では資金の不足が出る見本（最初の提案で不足が消えることを見せる） */
  shortNow?: true;
};

/** 棚に出す前の見本の設定（名前は相談の場面の短い名前） */
const UPCOMING_SAMPLES: readonly Upcoming[] = [
  {
    id: "sampleSingle50sRenter",
    title: "おひとり様・50代（賃貸）",
    family: "単身",
    age: 50,
    traits: ["会社員", "賃貸"],
    targetAge: 95,
    steps: { retireAge: [60, 62, 65, 68, 70], pensionAge: [60, 65, 68, 70, 75], nisaMonthly: [0, 10000, 30000, 50000], livingMonthly: [140000, 150000, 160000, 180000] },
    firstProposal: { retireAge: 65, nisaMonthly: 50000 },
    reemployment: { fromAge: 60, type: "contract", annualSalary: 4000000, standardMonthlyRemuneration: 340000 },
    notes: { retireAge: "60歳で定年、その後は再雇用（年収400万円）", nisaMonthly: "働いている間、毎月積み立てる", livingMonthly: "家賃（月5.8万円）は別。退職後は90%、80歳から80%" },
    memo: ["家賃は月5.8万円。退職した後も同じ賃貸に住み続ける前提（架空の例）", "退職金1,900万円は勤め先の規程からの見込み（架空の例）", "次回: 60歳からの働き方（再雇用の条件）と、老後の住まいの希望を確認"],
    plans: [
      { name: "プランB 65歳まで働く（60歳から再雇用）", tags: ["老後"], values: { "lever:retireAge": 65 } },
      { name: "プランC 生活費を月15万円に", tags: ["老後"], values: { "lever:livingMonthly": 150000 } },
    ],
  },
  {
    id: "sampleCoupleTwoKidsPeak",
    title: "会社員の夫婦と子2人・40代（教育費のピーク）",
    family: "夫婦と子",
    age: 40,
    traits: ["会社員", "片働き", "持ち家", "住宅ローン", "教育費"],
    targetAge: 95,
    shortNow: true,
    steps: { retireAge: [60, 62, 65, 68, 70], pensionAge: [60, 65, 68, 70, 75], nisaMonthly: [0, 10000, 30000, 50000], livingMonthly: [260000, 280000, 300000, 320000] },
    firstProposal: { retireAge: 65, pensionAge: 65, nisaMonthly: 30000, livingMonthly: 280000 },
    reemployment: { fromAge: 60, type: "contract", annualSalary: 4200000, standardMonthlyRemuneration: 360000 },
    notes: { retireAge: "60歳から再雇用（年収420万円）", nisaMonthly: "働いている間、毎月積み立てる", livingMonthly: "子の独立後は85%、退職後は80%、80歳から70%" },
    memo: [
      "退職金1,800万円は規程の確認待ち（架空の例）",
      "配偶者は扶養内のパートを60歳まで続ける意向（架空の例）",
      "夢は7件を聞き取った。家族で海外旅行・キャンプは最初から計算に入れ、車の買い替え・リフォーム・長女の結婚の援助・退職後のゴルフ・二拠点の暮らしは「最初から計算に入れない」で置いた（架空の例）",
      "次回: 長男の進路の希望を確認",
    ],
    plans: [
      { name: "プランB 65歳まで働く（60歳から再雇用）", tags: ["老後"], values: { "lever:retireAge": 65 } },
      { name: "プランC NISA を月3万円に増やす", tags: ["運用"], values: { "lever:nisaMonthly": 30000 } },
    ],
  },
  {
    id: "sampleDualAssetsInvest",
    title: "共働き・子2人・40代（資産運用）",
    family: "夫婦と子",
    age: 40,
    traits: ["会社員", "共働き", "持ち家", "住宅ローン", "教育費", "資産運用", "収益不動産"],
    targetAge: 95,
    steps: { retireAge: [60, 62, 65, 68, 70], pensionAge: [60, 65, 68, 70, 75], nisaMonthly: [0, 30000, 50000, 80000, 100000], livingMonthly: [420000, 450000, 480000, 520000] },
    firstProposal: { nisaMonthly: 80000 },
    reemployment: { fromAge: 60, type: "contract", annualSalary: 6000000, standardMonthlyRemuneration: 500000 },
    notes: { retireAge: "60歳から再雇用（年収600万円）", nisaMonthly: "つみたて投資枠の最初の期間（50歳から月8万円、55歳から月10万円に増やす）" },
    memo: [
      "NISA のつみたて投資枠を年齢で増やす（49歳まで月5万円、50〜54歳は月8万円、55歳から月10万円。架空の例）",
      "賃貸に出しているマンション1室は月9.5万円で貸している（空室5%・管理費などは年36万円＋家賃の5%。架空の例）",
      "65歳から毎月35万円を取り崩す前提（架空の例）",
      "次回: 繰上返済と資産配分の見直しのどちらを先にするか相談",
    ],
    plans: [
      { name: "プランB 住宅ローンを500万円繰上返済", tags: ["住宅"], values: { "loan:f219eceb-c600-449c-9f42-de1997fe7037:prepay": 5000000 } },
      {
        name: "プランC 資産配分の見直し（課税口座・iDeCo）",
        tags: ["運用"],
        values: {
          "mix:74c8181f-16e4-41df-8248-c16e264f012f": [
            { assetClass: "equity.global", share: "0.5" },
            { assetClass: "equity.domestic", share: "0.2" },
            { assetClass: "bond.global", share: "0.3" },
          ],
          "mix:18b3d3e9-3088-41de-95c3-20a9e6bf3246": [
            { assetClass: "equity.global", share: "0.7" },
            { assetClass: "bond.global", share: "0.3" },
          ],
        },
      },
      { name: "プランD 65歳まで働く（60歳から再雇用）", tags: ["老後"], values: { "lever:retireAge": 65 } },
      { name: "プランE 黒字の6割が貯まる", tags: ["老後"], values: { "surplus:ratio": "0.6" } },
    ],
    snapshots: [
      {
        id: "5fc9ba2f-07e7-48b8-9867-a28ee9837839",
        createdAt: "2024-10-12T10:00:00+09:00",
        trigger: "manual",
        memo: "初回の面談（架空の例）",
        balances: {
          "94960b89-c82c-4914-a2db-cd18a3123861": 6100000, "a43b25ff-395d-4d3e-8c6e-03a422854c73": 2700000, "2f831eca-84c4-41ea-8e88-c90b6992daeb": 4300000, "63c9944b-afae-45e0-bf54-d4ac335d8d64": 2000000,
          "18b3d3e9-3088-41de-95c3-20a9e6bf3246": 2000000, "b3623d8b-c500-439c-8e37-e6684a259bb7": 1150000, "67c9ae0d-6fe9-4c08-93b0-3f91646891c0": 4000000, "74c8181f-16e4-41df-8248-c16e264f012f": 3500000,
          "fb07252d-b687-4416-bb18-fa26c8666608": 1900000, "db61701e-5604-46a3-81e0-22cf3cdce3e8": 1700000, "9e5663d4-61e9-4d8e-b655-df0221cdf111": 1300000, "203ed3d8-74df-450b-8ba0-346f86d70963": 18600000,
          "f219eceb-c600-449c-9f42-de1997fe7037": 24600000, "9f29a302-6059-4f50-bb21-b05379a27a5c": 1700000,
        },
      },
      {
        id: "d03f494e-9324-46b7-978c-8f46b4fe2f02",
        createdAt: "2025-10-18T14:00:00+09:00",
        trigger: "pdf",
        memo: "提案書（架空の例）",
        balances: {
          "94960b89-c82c-4914-a2db-cd18a3123861": 5000000, "a43b25ff-395d-4d3e-8c6e-03a422854c73": 2400000, "2f831eca-84c4-41ea-8e88-c90b6992daeb": 4600000, "63c9944b-afae-45e0-bf54-d4ac335d8d64": 2200000,
          "18b3d3e9-3088-41de-95c3-20a9e6bf3246": 2250000, "b3623d8b-c500-439c-8e37-e6684a259bb7": 1350000, "67c9ae0d-6fe9-4c08-93b0-3f91646891c0": 4500000, "74c8181f-16e4-41df-8248-c16e264f012f": 3600000,
          "fb07252d-b687-4416-bb18-fa26c8666608": 2150000, "db61701e-5604-46a3-81e0-22cf3cdce3e8": 1800000, "9e5663d4-61e9-4d8e-b655-df0221cdf111": 1550000, "203ed3d8-74df-450b-8ba0-346f86d70963": 18300000,
          "f219eceb-c600-449c-9f42-de1997fe7037": 23900000, "9f29a302-6059-4f50-bb21-b05379a27a5c": 1500000,
        },
      },
    ],
  },
  {
    id: "samplePensionerCouple",
    title: "年金生活の夫婦",
    family: "シニア",
    age: 60,
    traits: ["年金生活", "持ち家", "資産運用"],
    targetAge: 95,
    // 働いていないので「働く最後の年齢」は出ない。年金はもう受け取っているので、受け取り開始は動かせない（画面は今の年齢で止める）
    steps: { retireAge: [], pensionAge: [], nisaMonthly: [0, 10000, 20000, 30000], livingMonthly: [220000, 230000, 246000, 260000] },
    firstProposal: { nisaMonthly: 30000, livingMonthly: 230000 },
    notes: { nisaMonthly: "75歳まで、預金から毎月積み立てる", livingMonthly: "住まいの修繕（月1.5万円）・固定資産税は別。80歳から87%" },
    memo: [
      "夫68歳・妻66歳。2人とも年金を受け取っている（夫は会社員の期間が中心、妻は国民年金が中心。架空の例）",
      "持ち家は住宅ローンを返し終えている。修繕に月1.5万円を見込む（架空の例）",
      "次回: 預金のうち、使う予定の無いお金の置き場所を相談",
    ],
    plans: [{ name: "プランB 生活費を月23万円に", tags: ["老後"], values: { "lever:livingMonthly": 230000 } }],
  },
];

/** 元にした世帯（書き換えない） */
const SOURCES = ["salariedCoupleTwoKids", "sampleFamilyDreams", "dualAssetsTwoKids", "investmentCouple", "sampleSingle20s", "sampleSeniorCouple", "pensionCouple"];
const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TRAITS = new Set(["会社員", "公務員", "自営業", "役員", "年金生活", "共働き", "片働き", "持ち家", "賃貸", "住宅ローン", "教育費", "資産運用", "収益不動産", "親の介護・相続"]);

function idsOf(req: EngineRequest): string[] {
  const out: string[] = [];
  const walk = (v: unknown, key: string | null) => {
    if (Array.isArray(v)) v.forEach((x) => walk(x, null));
    else if (v !== null && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k);
    else if (key === "id" && typeof v === "string") out.push(v);
  };
  walk(req.input.household, null);
  return out;
}

/** 画面と同じ計算（計算に入れない夢などを外す） */
const run = (req: EngineRequest) => preview(forEngine(req));
const finalOf = (req: EngineRequest) => financialOf(run(req).table).get(req.input.endYear) as number;
const shortOf = (req: EngineRequest) => run(req).table.some((c) => c.row === "cf.balance.shortfall" && c.amount > 0);

describe("棚にまだ出していない見本", () => {
  it("見本の一覧にはまだ無い。名前は重ならず、絞り込みの項目は決まった語から選ぶ", () => {
    const shelf = new Set(DEMO_HOUSEHOLDS.map((d) => d.id));
    for (const s of UPCOMING_SAMPLES) expect(shelf.has(s.id), s.id).toBe(false);
    const titles = [...DEMO_HOUSEHOLDS.map((d) => d.title), ...UPCOMING_SAMPLES.map((s) => s.title)];
    expect(new Set(titles).size).toBe(titles.length);
    for (const s of UPCOMING_SAMPLES) for (const t of s.traits) expect(TRAITS.has(t), `${s.id}: ${t}`).toBe(true);
  });

  it("元にした世帯の ID を写していない（元の世帯は残っている）", () => {
    for (const id of SOURCES) expect(modelHousehold(id).input.baseMonth).toBe("2026-10");
  });
});

describe.each(UPCOMING_SAMPLES)("$id（$title）", (s) => {
  const req = modelHousehold(s.id);
  const h = req.input.household;
  const self = h.members.find((m) => m.kind === "self")!;
  const birthYear = Number(self.birth.birthYearMonth.slice(0, 4));
  const opts = s.reemployment !== undefined ? { reemployment: s.reemployment } : {};
  const now = readLevers(req, self.id);
  const usable = LEVER_KEYS.filter((k) => now[k] !== undefined && !(k === "pensionAge" && pensionStarted(req, self.id)));
  const base = finalOf(req);

  it("架空の世帯（氏名・連絡先の欄を持たない）。ID は UUID 第4版で、ほかのモデル世帯と重ならない", () => {
    expect(JSON.stringify(req)).not.toMatch(/"(name|fullName|kana|address|phone|email)"/);
    const mine = idsOf(req);
    for (const id of mine) expect(id).toMatch(UUID4);
    expect(new Set(mine).size).toBe(mine.length);
    const others = new Set(
      readdirSync(join(REPO_DIR, "data", "modelHouseholds"))
        .filter((f) => f.endsWith(".json") && f !== `${s.id}.json`)
        .flatMap((f) => idsOf(modelHousehold(f.replace(/\.json$/, "")))),
    );
    for (const id of mine) expect(others.has(id), id).toBe(false);
  });

  it("計算基準月は2026年10月、表は本人の95歳の年まで。本人の年代が設定と合う", () => {
    expect(req.input.baseMonth).toBe("2026-10");
    expect(req.input.endYear).toBe(birthYear + s.targetAge);
    const age = 2026 - birthYear - (Number(self.birth.birthYearMonth.slice(5)) > 10 ? 1 : 0);
    expect(Math.floor(age / 10) * 10).toBe(s.age);
  });

  it("赤い未入力（0円の所あり）の入力項目が無い", () => {
    const miss = inputItems(fromRequest(req)).filter((i) => i.status === "missing").map((i) => i.id);
    expect(miss).toEqual([]);
  });

  it("使える打ち手の現状の値は目盛りの中。最初の提案は現状と違い、目盛りの範囲の中で、まだ来ていない月に当たる", () => {
    for (const k of usable) {
      const steps = s.steps[k];
      expect(now[k]!, k).toBeGreaterThanOrEqual(Math.min(...steps));
      expect(now[k]!, k).toBeLessThanOrEqual(Math.max(...steps));
    }
    for (const [k, p] of Object.entries(s.firstProposal) as [LeverKey, number][]) {
      expect(usable, k).toContain(k);
      expect(p, k).toBeGreaterThanOrEqual(Math.min(...s.steps[k]));
      expect(p, k).toBeLessThanOrEqual(Math.max(...s.steps[k]));
    }
    expect(usable.some((k) => s.firstProposal[k] !== undefined && s.firstProposal[k] !== now[k])).toBe(true);
    for (const k of ["retireAge", "pensionAge"] as const) {
      if (!usable.includes(k)) continue;
      for (const a of s.steps[k]) expect(addMonths(ageReachedMonth(self, a), k === "retireAge" ? -1 : 1) >= req.input.baseMonth, `${k} ${a}`).toBe(true);
    }
  });

  it.runIf(s.shortNow !== true)("現状の数字が現実的: 本人の95歳の年に金融資産が残り、資金の不足が出ない", () => {
    expect(base).toBeGreaterThan(0);
    expect(shortOf(req)).toBe(false);
  });

  it.runIf(s.shortNow === true)("現状では資金の不足が出て、最初の提案で不足が消える（見本の論点）", () => {
    expect(shortOf(req)).toBe(true);
    expect(shortOf(applyLevers(req, self.id, s.firstProposal, opts))).toBe(false);
  });

  it("生活費を下げると、最後の金融資産が増える", () => {
    const lower = Math.min(...s.steps.livingMonthly);
    expect(lower).toBeLessThan(now.livingMonthly!);
    expect(finalOf(applyLevers(req, self.id, { livingMonthly: lower }, opts))).toBeGreaterThan(base);
  });

  it("NISA の積立を増やすと最後の金融資産が増え、やめると減る", () => {
    const more = Math.max(...s.steps.nisaMonthly);
    expect(more).toBeGreaterThan(now.nisaMonthly!);
    expect(finalOf(applyLevers(req, self.id, { nisaMonthly: more }, opts))).toBeGreaterThan(base);
    expect(finalOf(applyLevers(req, self.id, { nisaMonthly: 0 }, opts))).toBeLessThan(base);
  });

  it.runIf(usable.includes("retireAge"))("働く最後の年齢を延ばすと最後の金融資産が増え、早めると減る（今が目盛りの最小なら延ばす側だけ）", () => {
    const later = Math.max(...s.steps.retireAge);
    const earlier = Math.min(...s.steps.retireAge);
    expect(finalOf(applyLevers(req, self.id, { retireAge: later }, opts))).toBeGreaterThan(base);
    if (earlier < now.retireAge!) expect(finalOf(applyLevers(req, self.id, { retireAge: earlier }, opts))).toBeLessThan(base);
  });

  it.runIf(usable.includes("pensionAge"))("年金の受け取り開始を動かすと、最後の金融資産が変わる", () => {
    const other = s.steps.pensionAge.filter((a) => a !== now.pensionAge);
    expect(other.length).toBeGreaterThan(0);
    for (const a of other) expect(finalOf(applyLevers(req, self.id, { pensionAge: a }, opts)), String(a)).not.toBe(base);
  });

  it("最初の提案は計算でき、結果が現状と違い、資金の不足が出ない", () => {
    const p = applyLevers(req, self.id, s.firstProposal, opts);
    expect(finalOf(p)).not.toBe(base);
    expect(shortOf(p)).toBe(false);
  });

  it("入れておくプランは動かす項目で、どれも現状と違う結果になる", () => {
    const re = s.reemployment;
    const wh = fromRequest(req, { memo: s.memo, ...(re !== undefined ? { postRetirement: { [self.id]: { ...re, type: re.type as "contract" } } } : {}) });
    const cat = buildCatalog(wh, self.id, { ...s, family: 0, age: 0, rev: 0 });
    for (const p of s.plans ?? []) {
      for (const k of Object.keys(p.values)) expect(cat.byKey.has(k), `${p.name}: ${k}`).toBe(true);
      const values = normalizeValues(p.values, {}, wh, cat);
      expect(Object.keys(values).length, p.name).toBeGreaterThan(0);
      expect(finalOf(applyValues(wh, values, cat)), p.name).not.toBe(base);
    }
  });

  it.runIf(s.snapshots !== undefined)("控えの残高は、この世帯の口座・負債を指す", () => {
    const objs = new Set([...(h.accounts ?? []).map((a) => a.id), ...(h.debts ?? []).map((d) => d.id)]);
    for (const snap of s.snapshots ?? []) {
      expect(snap.id).toMatch(UUID4);
      for (const id of Object.keys(snap.balances)) expect(objs.has(id), id).toBe(true);
    }
  });
});

describe("それぞれの見本の中身", () => {
  it("おひとり様・50代: 女性の会社員（60歳で定年・退職一時金）、賃貸、預金と NISA、50歳以上の定期便", () => {
    const h = modelHousehold("sampleSingle50sRenter").input.household;
    expect(h.members.map((m) => m.kind)).toEqual(["self"]);
    expect(h.members[0]!.sex).toBe("female");
    expect(h.residences?.map((r) => r.kind)).toEqual(["rent"]);
    expect(h.employmentPeriods?.map((p) => p.type)).toEqual(["regular"]);
    expect(h.retirementBenefits?.map((b) => b.kind)).toEqual(["lumpSum"]);
    expect(h.pensionRecords?.map((r) => r.kind)).toEqual(["statementOver50"]);
    expect(h.accounts?.map((a) => a.kind).sort()).toEqual(["deposit", "nisa"]);
    expect(h.careExpenses ?? []).toEqual([]);
  });

  it("教育費のピーク: 元の世帯の子2人の教育に、夢7件（計算に入れるのは2件）", () => {
    const req = modelHousehold("sampleCoupleTwoKidsPeak");
    const dreams = (req.input.household.periodicExpenses ?? []).filter((p) => p.kind === "dream");
    expect(dreams.map((d) => d.dream?.rank)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(dreams.filter((d) => d.dream?.include !== false).map((d) => d.label)).toEqual(["家族で海外旅行", "趣味を始める（夫婦でキャンプ）"]);
    expect((req.input.household.goals ?? []).filter((g) => g.kind === "education").length).toBe(2);
    // 夢のほかは元の世帯と同じ数字（最初から計算に入れない夢を外すと、計算に入る夢の分だけ元の世帯より少ない）
    const src = modelHousehold("salariedCoupleTwoKids");
    expect(finalOf(req)).toBeLessThan(financialOf(run(src).table).get(req.input.endYear) as number);
  });

  it("資産運用: つみたて投資枠を年齢（50歳・55歳）で3つの期間に分け、最後の期間は退職の月まで", () => {
    const h = modelHousehold("sampleDualAssetsInvest").input.household;
    const self = h.members.find((m) => m.kind === "self")!;
    const nisa = (h.accounts ?? []).find((a) => a.kind === "nisa" && a.owner === self.id)!;
    const tsumitate = (nisa.contributions ?? []).filter((c) => c.tranche !== "growth");
    expect(tsumitate.map((c) => c.monthly)).toEqual([50000, 80000, 100000]);
    expect(tsumitate[1]!.from).toEqual({ at: ageReachedMonth(self, 50) });
    expect(tsumitate[2]!.from).toEqual({ at: ageReachedMonth(self, 55) });
    expect(tsumitate[2]!.to).toBeNull();
  });

  it("年金生活の夫婦: 2人とも働いておらず、年金を受け取っている。持ち家", () => {
    const req = modelHousehold("samplePensionerCouple");
    const h = req.input.household;
    expect(h.employmentPeriods ?? []).toEqual([]);
    expect(h.pensionRecords?.map((r) => r.kind)).toEqual(["receiving", "receiving"]);
    for (const m of h.members) expect(pensionStarted(req, m.id), m.kind).toBe(true);
    expect(h.residences?.map((r) => r.kind)).toEqual(["own"]);
    expect(readLevers(req, h.members.find((m) => m.kind === "self")!.id).retireAge).toBeUndefined();
  });
});
