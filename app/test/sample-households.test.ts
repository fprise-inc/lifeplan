// 見本の世帯（data/modelHouseholds。すべて架空）: 面談で打ち手（働く最後の年齢・年金の受け取り開始・NISA の積立・生活費）を動かして見せる見本。
// 計算でき、数字が現実的で、打ち手を動かすと最後の金融資産が変わることを確かめる。目盛り・最初の提案などの見本の設定は、見本のセットの定義
// （src/workspace/samples/sets.ts）から読む。
// - ファイナンシアの見本は12件（0247 の9）。並び・名前・家族の形・年代を決まった形で確かめる
// - 棚から外した見本（OFF_SHELF_DEMOS）も、前に見本から作った世帯の目盛り・開発用の入口に使うので、同じ確かめをする（前の版で確かめていた sample* の世帯）
// - 計算は画面と同じく、計算に入れない夢などを外した要求（forEngine）で見る
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { forEngine } from "../src/engine/moneyRows.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import { DEMO_HOUSEHOLDS, demoHousehold, KNOWN_DEMOS, type DemoHousehold } from "../src/workspace/catalog.ts";
import { NO_FEATURES } from "../src/workspace/office/featureCodes.ts";
import { DEFAULT_FEATURES } from "../src/workspace/office/settings.ts";
import { FIRST_SAMPLE_ID, firstSampleId, OFF_SHELF_DEMOS, SAMPLE_SETS, shownSampleSets } from "../src/workspace/samples/sets.ts";
import { guessShape, reservedSampleNames, SAMPLE_TRAITS, sampleNameKey, shapeText } from "../src/workspace/store/numbering.ts";
import { fromRequest } from "../src/workspace/input/household.ts";
import { inputItems } from "../src/workspace/input/items.ts";
import { addMonths, ageReachedMonth, applyLevers, LEVER_KEYS, pensionStarted, readLevers, type LeverKey } from "../src/workspace/levers.ts";
import { buildCatalog, leverSteps } from "../src/workspace/plans/items.ts";
import { applyValues, normalizeValues } from "../src/workspace/plans/plans.ts";
import { financialOf } from "../src/workspace/present.ts";
import { CURRENT } from "../src/workspace/plans/band.ts";
import { DEFAULT_BALANCE_SETTINGS, DEFAULT_DISPLAY_SETTINGS } from "../src/workspace/settings.ts";
import { bodyOf, fromBody } from "../src/workspace/store/body.ts";
import { roles } from "../src/workspace/roles.ts";
import { APP_DIR, REPO_DIR } from "../scripts/lib.ts";
import { modelHousehold, preview } from "./helpers.ts";

const BASIC = SAMPLE_SETS.find((s) => s.id === "official.basic")!.samples;

/** ファイナンシアの見本12件（0247 の9 の表。並び・名前・家族の形・年代） */
const LINEUP: readonly [string, string, string][] = [
  ["sampleCoupleNoKids", "住宅を買う前の共働き・30代（子なし）", "夫婦のみ・30代"],
  ["lifetime100Plan", "共働き・子1人・30代", "夫婦と子・30代"],
  ["sampleCoupleTwoKidsPeak", "会社員の夫婦と子2人・40代（教育費のピーク）", "夫婦と子・40代"],
  ["sampleDualAssetsInvest", "共働き・子2人・40代（資産運用）", "夫婦と子・40代"],
  ["sampleSelfEmployedFamily", "自営業の夫婦と子2人・40代", "夫婦と子・40代"],
  ["sampleSingleParent", "ひとり親と子2人・30代", "ひとり親・30代"],
  ["sampleSingle50sRenter", "おひとり様・50代（賃貸）", "単身・50代"],
  ["rentalSample", "収益不動産を持つ会社員の夫婦", "夫婦と子・40代"],
  ["sampleParentsCare", "親の介護と相続を控える夫婦・50代", "夫婦と子・50代"],
  ["sampleSeniorRental", "退職前後の夫婦・60代", "夫婦と子・60代"],
  ["samplePensionerCouple", "年金生活の夫婦", "シニア・60代"],
  ["sampleExecutive", "会社を経営する夫婦・50代", "夫婦と子・50代"],
];

/** 棚から外した見本（モデル世帯のファイルは残る） */
const REMOVED = ["salariedCoupleTwoKids", "investmentCouple", "dualAssetsTwoKids", "sampleSingle20s", "sampleSingle40s", "sampleSeniorCouple", "sampleFamilyDreams"];

/**
 * 計算の確かめ用の世帯の家族（同じ構成員・物の ID を持つ世帯がほかにある）から棚に出した見本。ほかのモデル世帯と ID が重ならないことは確かめない
 * （世帯の中では重ならない。見本から作る顧客の世帯は1つずつ別のファイルなので、ほかの世帯と ID が同じでも混ざらない）
 */
const SHARED_IDS = new Set(["lifetime100Plan"]);

/** 今の状態（現状）では資金の不足が出る見本（最初の提案で不足が消えることを見せる。教育費のピークの後の老後） */
const SHORT_NOW = new Set(["sampleCoupleTwoKidsPeak"]);

/** 確かめる見本: 棚に出すすべての見本（法人経営者の見本を含む）と、棚から外した sample* の見本 */
const CHECKED: readonly DemoHousehold[] = [...DEMO_HOUSEHOLDS, ...OFF_SHELF_DEMOS.filter((d) => d.id.startsWith("sample"))];

const TRAITS = new Set(SAMPLE_TRAITS);
const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** 要求の中の ID（members・物の id） */
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
const shortOf = (req: EngineRequest) => run(req).table.some((c) => c.row === "cf.balance.shortfall" && c.amount > 0);

describe("ファイナンシアの見本の顔ぶれ（12件。0247 の9）", () => {
  it("並び・名前・家族の形と年代が決まった12件", () => {
    expect(BASIC.map((d) => [d.id, d.title, shapeText(d.family, d.age)])).toEqual(LINEUP);
    for (const d of BASIC) expect(d.rev, d.id).toBe(1);
  });

  it("棚から外した見本は、どのセットにも無く、棚から外した見本の並びに残る。モデル世帯のファイルも残る", () => {
    const shelf = new Set(DEMO_HOUSEHOLDS.map((d) => d.id));
    expect(OFF_SHELF_DEMOS.map((d) => d.id)).toEqual(REMOVED);
    for (const id of REMOVED) {
      expect(shelf.has(id), id).toBe(false);
      expect(demoHousehold(id)?.id, id).toBe(id);
      expect(modelHousehold(id).input.baseMonth, id).toBe("2026-10");
    }
    // 棚の見本と棚から外した見本は重ならない（同じ ID を2か所に置かない）
    expect(new Set(KNOWN_DEMOS.map((d) => d.id)).size).toBe(KNOWN_DEMOS.length);
    // 棚から外した見本の名前は、見本の名前に使えない名前（本体に渡す一覧）に入れない（棚に出ないため）
    const reserved = new Set(reservedSampleNames(SAMPLE_SETS));
    for (const d of OFF_SHELF_DEMOS) expect(reserved.has(d.title), d.id).toBe(false);
    for (const d of BASIC) expect(reserved.has(d.title), d.id).toBe(true);
  });

  it("はじめて起動したときに開く見本は、並びの3「会社員の夫婦と子2人・40代（教育費のピーク）」（法人経営者の見本のコードの有無によらない）", () => {
    expect(FIRST_SAMPLE_ID).toBe("sampleCoupleTwoKidsPeak");
    expect(BASIC.findIndex((d) => d.id === FIRST_SAMPLE_ID)).toBe(2);
    const off = shownSampleSets(SAMPLE_SETS, NO_FEATURES, DEFAULT_FEATURES).flatMap((s) => s.samples);
    expect(firstSampleId(off)).toBe("sampleCoupleTwoKidsPeak");
    expect(firstSampleId(DEMO_HOUSEHOLDS)).toBe("sampleCoupleTwoKidsPeak");
  });

  it("起動のときに前回・開発用の入口の世帯が棚から外した見本を指していても開ける（起動の一覧は棚から外した見本も持つ。棚に出すのはセットの見本だけ）", () => {
    const app = readFileSync(join(APP_DIR, "src", "workspace", "App.tsx"), "utf8");
    expect(app).toContain("const list = KNOWN_DEMOS.filter((d) => ids.has(d.id));");
    expect(app).toContain("initial.household !== undefined && households.some((h) => h.id === initial.household) ? initial.household");
    expect(app).toContain("set.samples.filter((d) => households.includes(d))");
    // 保存した世帯の出発点の見本は demoHousehold で読む（棚から外した見本も探す）
    expect(app).toContain("const demo = st.workspace.template !== null ? (demoHousehold(st.workspace.template) ?? null) : null;");
    for (const id of REMOVED) expect(KNOWN_DEMOS.some((d) => d.id === id), id).toBe(true);
  });
});

describe("前に棚の見本から作った世帯（workspace.template が棚から外した見本を指す）", () => {
  // 外した見本の設定を残さないと、前に見本から作った顧客の世帯のつまみの目盛りが既定に戻る（0247 の9）
  it.each(REMOVED)("%s: 保存して開き直しても、出発点の見本の目盛り・既定の値が読める", (id) => {
    const demo = OFF_SHELF_DEMOS.find((d) => d.id === id)!;
    const wh = fromRequest(modelHousehold(id));
    const self = roles(wh.request).find((r) => r.key === "self")!.member;
    const body = bodyOf({
      wh,
      workspace: { template: id, band: [], base: CURRENT, selected: CURRENT, shownItems: [] },
      display: { result: DEFAULT_DISPLAY_SETTINGS, balance: DEFAULT_BALANCE_SETTINGS },
      carry: { extDefinitions: {}, ext: {} },
    });
    const st = fromBody(body);
    expect(st.workspace.template).toBe(id);
    const found = demoHousehold(st.workspace.template!);
    expect(found).toBe(demo);
    // 目盛りは見本の目盛り（＋今の値）
    const base = readLevers(st.wh.request, self.id);
    const steps = leverSteps(found!, base);
    for (const k of LEVER_KEYS) for (const v of demo.steps[k]) expect(steps[k], `${k} ${v}`).toContain(v);
    // 見本の目盛りが標準の目盛りと違う見本では、見本の設定が無いとき（null）の目盛りに戻らない
    const std = leverSteps(null, base);
    const own = LEVER_KEYS.filter((k) => demo.steps[k].some((v) => !std[k].includes(v)));
    for (const k of own) expect(steps[k], k).not.toEqual(std[k]);
    // 再雇用の既定（見本の設定）も読める
    expect(buildCatalog(st.wh, self.id, found!).items.length).toBeGreaterThan(0);
  });
});

describe("見本の家族の形・年代と絞り込みの項目（見本は番号を持たない。0247）", () => {
  it("家族の形・本人の年代（セットの定義の family・age）が、世帯の中身と合う。年代は計算基準の月の満年齢から", () => {
    for (const s of CHECKED) {
      const req = modelHousehold(s.id);
      expect(guessShape(req), s.id).toEqual({ family: s.family, age: s.age });
      const self = req.input.household.members.find((m) => m.kind === "self")!;
      const age = 2026 - Number(self.birth.birthYearMonth.slice(0, 4)) - (Number(self.birth.birthYearMonth.slice(5)) > 10 ? 1 : 0);
      expect(s.age, s.id).toBe(Math.floor(age / 10));
    }
  });

  it("名前はアプリのすべての見本（棚から外した見本も含む）の間で重ならない（前後の空白を除き NFC で比べる）", () => {
    const keys = KNOWN_DEMOS.map((d) => sampleNameKey(d.title));
    expect(new Set(keys).size).toBe(keys.length);
    for (const d of KNOWN_DEMOS) expect(d.title, d.id).toBe(d.title.trim());
    // 名前に機能の名前（「（○○の見本）」）を付けない
    for (const d of BASIC) expect(d.title, d.id).not.toMatch(/見本/);
  });

  it("絞り込みの項目は決まった語から選び、重ならない", () => {
    for (const s of CHECKED) {
      for (const t of s.traits) expect(TRAITS.has(t), `${s.id}: ${t}`).toBe(true);
      expect(new Set(s.traits).size, s.id).toBe(s.traits.length);
    }
  });
});

describe.each(CHECKED)("$id（$title）", (s) => {
  const req = modelHousehold(s.id);
  const h = req.input.household;
  const self = h.members.find((m) => m.kind === "self")!;
  const birthYear = Number(self.birth.birthYearMonth.slice(0, 4));
  const opts = s.reemployment !== undefined ? { reemployment: s.reemployment } : {};
  const now = readLevers(req, self.id);
  const usable = LEVER_KEYS.filter((k) => now[k] !== undefined && !(k === "pensionAge" && pensionStarted(req, self.id)));
  // 主役の年齢（本人の95歳）の年の金融資産。100年分の表（lifetime100Plan）でも同じ年で見る
  const year = birthYear + s.targetAge;
  const finalOf = (r: EngineRequest) => financialOf(run(r).table).get(year) as number;
  const base = finalOf(req);
  const proposed = Object.keys(s.firstProposal).length > 0;

  it("架空の世帯（氏名・連絡先の欄を持たない）。ID は UUID 第4版で、ほかのモデル世帯と重ならない（計算の確かめ用の世帯の家族から出した見本を除く）", () => {
    // 収益不動産の物件の名前（「見本ハイツ（架空）」）は人の名前ではないので外して見る
    const people = JSON.stringify(req, (k, v: unknown) => (k === "property" ? undefined : v));
    expect(people).not.toMatch(/"(name|fullName|kana|address|phone|email)"/);
    const mine = idsOf(req);
    for (const id of mine) expect(id).toMatch(UUID4);
    expect(new Set(mine).size).toBe(mine.length);
    const others = new Set(
      readdirSync(join(REPO_DIR, "data", "modelHouseholds"))
        .filter((f) => f.endsWith(".json") && f !== `${s.id}.json`)
        .flatMap((f) => idsOf(modelHousehold(f.replace(/\.json$/, "")))),
    );
    if (!SHARED_IDS.has(s.id)) for (const id of mine) expect(others.has(id), id).toBe(false);
  });

  it("計算基準月は2026年10月（収益不動産の見本は11月）、表は本人の95歳の年まで（100年分の世帯はそれより先まで）", () => {
    expect(req.input.baseMonth).toBe(s.id === "rentalSample" ? "2026-11" : "2026-10");
    if (s.id === "lifetime100Plan") expect(req.input.endYear).toBeGreaterThan(year);
    else expect(req.input.endYear).toBe(year);
  });

  it.runIf(BASIC.includes(s))("赤い未入力（0円の所あり）の入力項目が無い", () => {
    const miss = inputItems(fromRequest(req)).filter((i) => i.status === "missing").map((i) => i.id);
    expect(miss).toEqual([]);
  });

  it("使える打ち手の現状の値は目盛りの中。最初の提案（無ければ入れておくプラン）は現状と違い、目盛りの範囲の中で、まだ来ていない月に当たる", () => {
    // 働いている見本は打ち手4つが読める（年金生活の見本は、働く最後の年齢が無く、年金の受け取り開始は動かせない）
    if (s.steps.retireAge.length > 0) expect(usable.sort()).toEqual([...LEVER_KEYS].sort());
    else expect(usable.sort()).toEqual(["livingMonthly", "nisaMonthly"]);
    for (const k of usable) {
      expect(now[k]!, k).toBeGreaterThanOrEqual(Math.min(...s.steps[k]));
      expect(now[k]!, k).toBeLessThanOrEqual(Math.max(...s.steps[k]));
    }
    for (const [k, p] of Object.entries(s.firstProposal) as [LeverKey, number][]) {
      expect(usable, k).toContain(k);
      expect(p, k).toBeGreaterThanOrEqual(Math.min(...s.steps[k]));
      expect(p, k).toBeLessThanOrEqual(Math.max(...s.steps[k]));
    }
    if (proposed) expect(usable.some((k) => s.firstProposal[k] !== undefined && s.firstProposal[k] !== now[k])).toBe(true);
    else expect(s.plans?.length ?? 0).toBeGreaterThan(0);
    for (const k of ["retireAge", "pensionAge"] as const) {
      if (!usable.includes(k)) continue;
      for (const a of s.steps[k]) expect(addMonths(ageReachedMonth(self, a), k === "retireAge" ? -1 : 1) >= req.input.baseMonth, `${k} ${a}`).toBe(true);
    }
  });

  it.runIf(!SHORT_NOW.has(s.id))("現状の数字が現実的: 本人の95歳の年に金融資産が残り、資金の不足が出ない", () => {
    expect(base).toBeGreaterThan(0);
    expect(shortOf(req)).toBe(false);
  });

  it.runIf(SHORT_NOW.has(s.id))("現状では資金の不足が出て、最初の提案で不足が消える（見本の論点）", () => {
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
    expect(later).toBeGreaterThan(now.retireAge!);
    expect(finalOf(applyLevers(req, self.id, { retireAge: later }, opts))).toBeGreaterThan(base);
    if (earlier < now.retireAge!) expect(finalOf(applyLevers(req, self.id, { retireAge: earlier }, opts))).toBeLessThan(base);
  });

  it.runIf(usable.includes("pensionAge"))("年金の受け取り開始を動かすと、最後の金融資産が変わる", () => {
    const other = s.steps.pensionAge.filter((a) => a !== now.pensionAge);
    expect(other.length).toBeGreaterThan(0);
    for (const a of other) expect(finalOf(applyLevers(req, self.id, { pensionAge: a }, opts)), String(a)).not.toBe(base);
  });

  it.runIf(proposed)("最初の提案は計算でき、結果が現状と違い、資金の不足が出ない", () => {
    const p = applyLevers(req, self.id, s.firstProposal, opts);
    expect(finalOf(p)).not.toBe(base);
    expect(shortOf(p)).toBe(false);
  });

  it.runIf(s.plans !== undefined)("入れておくプランは動かす項目で、どれも現状と違う結果になる", () => {
    const re = s.reemployment;
    const wh = fromRequest(req, { memo: s.memo, ...(re !== undefined ? { postRetirement: { [self.id]: { ...re, type: re.type as "contract" } } } : {}) });
    const cat = buildCatalog(wh, self.id, s);
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

describe("新しく棚に出した見本の中身", () => {
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
    expect(financialOf(run(req).table).get(req.input.endYear) as number).toBeLessThan(financialOf(run(src).table).get(req.input.endYear) as number);
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

  it("共働き・子1人・30代: 賃貸から2029年に新築を買う（住宅ローンは夫婦の連帯債務）、子は0歳。メモは見本の場面の例（速さの計測の説明ではない）", () => {
    const d = BASIC.find((x) => x.id === "lifetime100Plan")!;
    const h = modelHousehold("lifetime100Plan").input.household;
    expect(h.members.map((m) => m.kind)).toEqual(["self", "spouse", "child"]);
    expect(h.residences?.map((r) => r.kind)).toEqual(["rent", "own"]);
    expect(h.debts?.map((x) => x.kind)).toEqual(["mortgage"]);
    expect(d.memo.join("")).not.toContain("計測");
    for (const m of d.memo.slice(0, -1)) expect(m, m).toMatch(/（架空の例）$/);
  });
});
