// 見本の世帯「共働きの夫婦と子2人（資産が多め）」（data/modelHouseholds/dualAssetsTwoKids.json）: 資産と負債のタブ・資産運用・前回と比べるの
// 機能が全部働く見本。入力の中身（口座の種類・資産配分・受け取り方・車・保険・住まい以外の不動産）、計算の結果（資産の合計＝負債の合計＋純資産・
// 不足やマイナスが出ない）、開いたときに入れるプラン4つと控え2つ（指紋・前回と比べる）を確かめる
import { describe, expect, it } from "vitest";
import type { EngineRequest } from "../src/engine/types.ts";
import { agoText, bsPlan, bsPrev } from "../src/workspace/balanceTab.ts";
import { DEMO_HOUSEHOLDS, demoHousehold, type DemoHousehold } from "../src/workspace/catalog.ts";
import { seedDemo, withBalances } from "../src/workspace/demoSeed.ts";
import { fromRequest } from "../src/workspace/input/household.ts";
import { bandOf, breakdownOf, lastsAge, stressRequests, STRESS_KEYS } from "../src/workspace/invest/present.ts";
import { planLetters } from "../src/workspace/plans/band.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { applyValues, effectiveValues } from "../src/workspace/plans/plans.ts";
import { displayYears, financialOf } from "../src/workspace/present.ts";
import { verifySnapshot } from "../src/workspace/snapshots/snapshots.ts";
import { modelHousehold, preview } from "./helpers.ts";

const ID = "dualAssetsTwoKids";
const req = modelHousehold(ID);
const h = req.input.household;
const demo = demoHousehold(ID) as DemoHousehold;
const selfId = h.members.find((m) => m.kind === "self")?.id as string;
const r = preview(req);
const plan = bsPlan({ key: "A", letter: "A", name: "プランA", title: "現状", base: true, req, table: r.table });

describe("入力の中身（BS・資産運用・資産と負債のタブの機能が全部働く）", () => {
  it("見本の一覧から選べる。架空の世帯（氏名・識別子を持たない）", () => {
    expect(DEMO_HOUSEHOLDS.map((d) => d.id)).toContain(ID);
    expect(demo.title).toBe("共働きの夫婦と子2人（資産が多め）");
    const text = JSON.stringify(req);
    expect(text).not.toMatch(/"(name|fullName|kana|address|phone|email)"/);
    expect(h.members.map((m) => m.kind)).toEqual(["self", "spouse", "child", "child"]);
  });

  it("金融資産は多くの口座に分かれる（預金・NISA・iDeCo 2人分・企業型DC・課税口座・外貨預金・持株会・財形）と、住まい以外の不動産・その他の資産", () => {
    const kinds = (h.accounts ?? []).map((a) => a.kind);
    for (const k of ["deposit", "nisa", "ideco", "corporateDc", "taxable", "fxDeposit", "esop", "zaikei", "realEstate", "otherAsset"]) expect(kinds, k).toContain(k);
    const owners = (kind: string) => new Set((h.accounts ?? []).filter((a) => a.kind === kind).map((a) => a.owner)).size;
    expect(owners("ideco")).toBe(2);
    expect(owners("nisa")).toBe(2);
    // NISA: つみたて枠を期間を分けて積み立て、成長投資枠も使う
    const nisa = (h.accounts ?? []).find((a) => a.kind === "nisa" && a.owner === selfId)!;
    expect((nisa.contributions ?? []).filter((c) => c.tranche !== "growth").length).toBeGreaterThanOrEqual(2);
    expect((nisa.contributions ?? []).some((c) => c.tranche === "growth")).toBe(true);
    // 資産配分（国内株・外国株・債券・REIT・現金）を入れた口座
    const classes = new Set((h.accounts ?? []).flatMap((a) => (a.assetMix ?? []).map((m) => m.assetClass.split(".")[0])));
    expect([...classes].sort()).toEqual(["bond", "cash", "equity", "reit"]);
    // 受け取り方: iDeCo の一時金と年金の併用・一時金、受け取ったお金の行き先「運用を続ける」
    const payouts = (h.accounts ?? []).filter((a) => a.kind === "ideco").map((a) => a.payout);
    expect(payouts.map((p) => p?.method).sort()).toEqual(["lumpSum", "mixed"]);
    expect(payouts.every((p) => p?.destination === "invest")).toBe(true);
  });

  it("持ち家（評価・構造・購入年と価格）と住宅ローン、車2台（1台はローンあり）、解約返戻金のある保険、取り崩しの計画（定額）", () => {
    const home = (h.residences ?? [])[0]!;
    expect(home.kind).toBe("own");
    expect(home.valuation).toMatchObject({ structure: "wood", builtYear: 2012 });
    expect((h.debts ?? []).map((d) => d.kind).sort()).toEqual(["car", "mortgage", "other"]);
    // 賃貸に出しているマンション: 土地と建物・家賃収入・経費・取得と、そのローン（0028）
    const condo = (h.accounts ?? []).find((a) => a.kind === "realEstate")!;
    expect(condo.property).toMatchObject({ structure: "rc", rental: { vacancyRate: "0.05" }, expenses: { rate: "0.05" }, acquisition: { at: "2016-03" } });
    expect((h.debts ?? []).find((d) => d.kind === "other")!.property).toBe(condo.id);
    expect((h.cars ?? []).length).toBe(2);
    expect((h.cars ?? []).some((c) => c.loan !== undefined)).toBe(true);
    expect((h.insuranceContracts ?? []).some((c) => (c as { simple?: { returnRate?: string } }).simple?.returnRate !== undefined)).toBe(true);
    expect(req.input.assumptions?.investment?.drawdown).toMatchObject({ method: "fixed", monthly: 350000 });
  });
});

describe("計算の結果（数字が自然か）", () => {
  it("どの年も資産の合計＝負債の合計＋純資産。資金の不足も純資産のマイナスも出ない", () => {
    for (const y of plan.years) {
      expect(y.totalAssets).toBe(y.totalLiabilities + y.netWorth);
      expect(y.shortfall).toBe(0);
      expect(y.netWorth).toBeGreaterThan(0);
    }
    expect(r.table.some((c) => c.row === "cf.balance.shortfall" && c.amount > 0)).toBe(false);
  });

  it("今の年のバランスシートに、全部の項目が出る（換金しにくい資産・その他の負債も）", () => {
    const keys = plan.years[0]!.lines.map((l) => l.key);
    for (const k of ["deposit", "zaikei", "nisa", "taxable", "fxDeposit", "esop", "ideco", "corporateDc", "land", "building", "car", "insurance", "otherAsset", "mortgage", "propertyLoan", "carLoan"]) expect(keys, k).toContain(k);
    const groups = new Set(plan.years[0]!.lines.map((l) => l.group));
    expect([...groups].sort()).toEqual(["debt", "illiquid", "liquid", "locked", "market", "mortgage"]);
  });

  it("運用の期間は 積み立てる・据え置く（60〜64歳）・取り崩す（65歳から毎月35万円）。金融資産は100歳まで持つ", () => {
    const years = displayYears(req);
    const self = h.members.find((m) => m.id === selfId)!;
    const ages = years.map((y) => y - Number(self.birth.birthYearMonth.slice(0, 4)));
    const band = bandOf(req, ages)!;
    expect(band.stopAge).toBe(60);
    expect(band.wdAge).toBe(65);
    expect(band.holdSub).toBe("60〜64歳");
    expect(lastsAge(req, r.table, years)).toBe(100);
    // 口座の内訳: 預金・iDeCo/DC・NISA・課税口座などのどれにも額がある年がある
    for (const s of breakdownOf(r.table, years)) expect(s.values.some((v) => v > 0), s.key).toBe(true);
    // 金融資産は退職の年が一番多く、その後はゆるやかに減る（100歳でも残る）
    const fin = financialOf(r.table);
    expect(fin.get(2078)!).toBeGreaterThan(0);
    expect(fin.get(2078)!).toBeLessThan(fin.get(2040)!);
  });

  it("相場が下がった場合の3つの型も計算でき、どれも退職の前後までは資金が足りる", () => {
    const sr = stressRequests(req);
    for (const k of STRESS_KEYS) {
      const s = preview(sr[k]);
      const fin = financialOf(s.table);
      expect(fin.get(2045)!, k).toBeGreaterThan(0);
    }
  });
});

describe("開いたときに入れるプランと控え", () => {
  const wh = fromRequest(req, { memo: demo.memo });
  const cat = buildCatalog(wh, selfId, demo);

  it("プランと控えが指す口座・負債は世帯にある（ID のずれを防ぐ）", () => {
    const ids = new Set([...(h.accounts ?? []).map((a) => a.id), ...(h.debts ?? []).map((d) => d.id)]);
    const keys = (demo.plans ?? []).flatMap((p) => Object.keys(p.values));
    for (const k of keys) {
      expect(cat.byKey.has(k), k).toBe(true);
      const id = /[0-9a-f]{8}-[0-9a-f-]{27}/.exec(k)?.[0];
      if (id !== undefined) expect(ids.has(id), k).toBe(true);
    }
    for (const s of demo.snapshots ?? []) for (const id of Object.keys(s.balances)) expect(ids.has(id), id).toBe(true);
  });

  it("プラン4つ（繰上返済・資産配分の見直し・65歳まで働く・黒字の6割が貯まる）を帯に並べ、どれも現状と違う結果になる", async () => {
    const seeded = await seedDemo(wh, cat, demo, { now: "2026-10-20T00:00:00.000Z", appVersion: "0.1.0" });
    expect(seeded.band.length).toBe(4);
    const letters = planLetters(seeded.wh.proposals);
    expect(seeded.band.map((id) => letters.get(id)?.letter)).toEqual(["B", "C", "D", "E"]);
    const base = financialOf(r.table).get(2040)!;
    for (const id of seeded.band) {
      const p = seeded.wh.proposals.find((x) => x.id === id)!;
      expect(p.diffs.length, p.name).toBeGreaterThan(0);
      const pr = preview(applyValues(seeded.wh, effectiveValues(seeded.wh.proposals, id), cat) as EngineRequest);
      expect(financialOf(pr.table).get(2040), p.name).not.toBe(base);
    }
  });

  it("控え2つ（1年前・2年前）は指紋が合い、前回と比べるで見込みと今の実際の差が出る", async () => {
    const seeded = await seedDemo(wh, cat, demo, { now: "2026-10-20T00:00:00.000Z", appVersion: "0.1.0" });
    const snaps = seeded.wh.snapshots ?? [];
    expect(snaps.map((s) => agoText(s.createdAt, req.input.baseMonth))).toEqual(["2年前", "1年前"]);
    expect(snaps.map((s) => s.createdAt)).toEqual(["2024-10-12T10:00:00+09:00", "2025-10-18T14:00:00+09:00"]);
    for (const s of snaps) {
      expect(await verifySnapshot(s)).toBe(true);
      expect(s.inputs.request).toEqual(withBalances(req, (demo.snapshots ?? []).find((d) => d.id === s.id)!.balances));
      const t = preview(s.inputs.request).table;
      const m = bsPrev({ key: "p1", label: "控え", createdAt: s.createdAt, baseMonth: req.input.baseMonth, actual: plan.years[0]!, snapshot: { req: s.inputs.request, table: t } });
      expect(m.reason).toBeNull();
      expect(m.expected!.netWorth).not.toBe(plan.years[0]!.netWorth);
      expect(m.items.length).toBeGreaterThan(0);
    }
    // 元の世帯の残高は変えない
    expect(seeded.wh.request).toBe(wh.request);
  });
});
