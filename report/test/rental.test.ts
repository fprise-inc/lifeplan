// 収益不動産のまとめ（公式の帳票の章。0082）: 帳票の入力の数字がエンジンの分析の数字（asset.realEstateAnalysis）のまま書式だけ当てたものであること、
// 物件名・種類を載せること（所在地・メモは載せない）、売る年を変えた比べ、収益不動産の無い世帯は章が無いこと、PDF のページ
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { buildProposalInput, displayYears } from "../src/build.ts";
import { selectChapters } from "../src/chapters.ts";
import { saleVariantRequest, saleVariants } from "../src/rentalSale.ts";
import { depreciationEndText, pctText, timesText } from "../src/rentalText.ts";
import { modelHousehold, REPORT_DIR, runAll } from "../scripts/engine.ts";
import { renderAndExtract, reportPdfBin, sampleFrame } from "../scripts/reportPdf.ts";
import { rentalPropertyBundle, salariedCoupleBundle } from "../scripts/sampleBundles.ts";
import { man, normalize, UUID, yenText } from "./helpers.ts";

const schema = JSON.parse(readFileSync(join(REPORT_DIR, "schema", "proposal-input.schema.json"), "utf8")) as object;
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
const bundle = rentalPropertyBundle();
const input = buildProposalInput(bundle);
const a = bundle.proposal.result.summary.realEstateAnalysis;

describe("帳票の入力（rental）", () => {
  const r = input.rental;
  const p = r?.properties[0];
  const e = a?.properties[0];

  it("提案の貸している物件が1件: 物件名・種類・名義を載せ、合計の1枚は無い。JSON Schema に合う。物の ID・所在地・メモは入らない", () => {
    expect(r).not.toBeNull();
    expect(r?.properties.length).toBe(1);
    expect(r?.total).toBeNull();
    expect(p?.label).toBe("見本マンション 301");
    expect(p?.kind).toEqual({ key: "condo", label: "区分マンション" });
    expect(p?.owner?.label).toBe("ご本人");
    expect(validate(input), JSON.stringify(validate.errors)).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(UUID);
    // 独自帳票の材料（realEstate）にも物件名・種類
    expect(input.realEstate?.proposal[0]?.name).toBe("見本マンション 301");
    expect(input.realEstate?.proposal[0]?.kind?.label).toBe("区分マンション");
  });

  it("年は表の年（計算基準月が10月なので翌年から）。金額はエンジンの分析の数字のまま。元金の返済が減価償却費を上回る年の印", () => {
    const years = displayYears(bundle.proposal.request);
    expect(p?.years[0]?.year).toBe(years[0]);
    for (const y of p?.years ?? []) {
      const x = e?.years.find((z) => z.year === y.year);
      expect(y.rent).toBe(x?.rent);
      expect(y.cashBeforeTax).toBe(x?.cashBeforeTax);
      expect(y.cashAfterTax).toBe(x?.cashAfterTax);
      expect(y.loanBalance).toBe(x?.loanBalance);
      expect(y.deadCross).toBe(e?.deadCross === y.year);
    }
    expect(p?.deadCross).toBe(e?.deadCross);
  });

  it("指標は最初の年の率に書式を当てたもの。月の手残りは年の手残り÷貸している月数", () => {
    const x = e?.years.find((z) => z.year === r?.pointYear);
    expect(p?.point?.grossYield).toBe(pctText(x?.grossYield));
    expect(p?.point?.netYield).toBe(pctText(x?.netYield));
    expect(p?.point?.dscr).toBe(timesText(x?.dscr));
    expect(p?.point?.ltv).toBe(pctText(x?.ltv));
    expect(p?.point?.ccr).toBe(pctText(x?.ccr));
    expect(p?.point?.monthlyBeforeTax).toBe(Math.trunc((x?.cashBeforeTax ?? 0) / (x?.months ?? 1)));
  });

  it("含み益は評価額−帳簿価額、売ったときの手残りの目安は評価額−ローン残高。減価償却が終わる年の文と、もう上回っているかは画面と同じ", () => {
    const x = e?.years.find((z) => z.year === r?.pointYear);
    expect(x?.unrealizedGain).toBe((x?.value ?? 0) - (x?.bookValue ?? 0));
    expect(p?.point?.unrealizedGain).toBe(x?.unrealizedGain);
    expect(p?.point?.equity).toBe(x?.equity);
    expect(p?.depreciationEndText).toBe(depreciationEndText({ ...(e as NonNullable<typeof e>), sells: e?.exit !== null }));
    expect(p?.deadCrossNow).toBe(e?.deadCross !== null && (e?.deadCross ?? 0) <= Number(bundle.proposal.request.input.baseMonth.slice(0, 4)));
  });

  it("今の予定の売却と、売る年を変えた比べ（今の予定・5年前・5年後・持ち続ける）。差は今の予定との金融資産の差", () => {
    expect(p?.exit?.net).toBe(e?.exit?.net);
    const rows = p?.saleCompare?.rows ?? [];
    expect(rows.map((x) => x.label)).toEqual(["2033年6月に売る（5年前）", "2038年6月に売る（今の予定）", "2043年6月に売る（5年後）", "持ち続ける"]);
    const cur = rows.find((x) => x.current);
    expect(cur?.diff).toBe(0);
    expect(cur?.net).toBe(e?.exit?.net);
    for (const x of rows) expect(x.diff).toBe(x.financialEnd - (cur?.financialEnd ?? 0));
    // 持ち続けるなら税引後の手取りは無く、表の最後の年の評価額−ローン残高がある
    const hold = rows.find((x) => x.label === "持ち続ける");
    expect(hold?.net).toBeNull();
    expect(hold?.equityEnd ?? 0).toBeGreaterThan(0);
  });

  it("売る年の写しの要求は、売る年だけを変える（5年後の案は売却価格を入れない・持ち続けるは売却の予定を外す）", () => {
    const req = bundle.proposal.request;
    const obj = (req.input.household.accounts ?? []).find((x) => x.property !== undefined)?.id as string;
    const vs = saleVariants(req, obj);
    const later = saleVariantRequest(req, obj, vs.find((v) => v.key === "later")!);
    const hold = saleVariantRequest(req, obj, vs.find((v) => v.key === "hold")!);
    const prop = (r0: typeof req) => (r0.input.household.accounts ?? []).find((x) => x.id === obj)?.property;
    expect(prop(later)?.sale).toEqual({ at: { at: "2043-06" } });
    expect(prop(hold)?.sale).toBeUndefined();
    // ほかは同じ
    const strip = (r0: typeof req) => JSON.stringify({ ...r0, input: { ...r0.input, household: { ...r0.input.household, accounts: (r0.input.household.accounts ?? []).filter((x) => x.id !== obj) } } });
    expect(strip(later)).toBe(strip(req));
  });

  it("収益不動産の無い世帯・章を外したときは null（ほかの章は変わらない）", () => {
    expect(buildProposalInput(salariedCoupleBundle()).rental).toBeNull();
    const off = selectChapters(input, ["summary", "cashflow"]);
    expect(off.rental).toBeNull();
    expect(off.cashflow).toEqual(input.cashflow);
  });
});

const bin = reportPdfBin();
describe.skipIf(bin === null)("PDF の収益不動産のまとめのページ", () => {
  const res = renderAndExtract(bin as string, input, sampleFrame(bundle, input));
  const page = res.pages.find((t) => normalize(t).includes(normalize("収益不動産のまとめ")) && normalize(t).includes(normalize("売る年を変えた比べ")));
  const p = input.rental!.properties[0]!;

  it("物件名（種類）・指標・年ごとの数字（万円）・売る年の比べが1枚に載る", () => {
    expect(page).toBeDefined();
    const t = normalize(page as string);
    expect(t).toContain(normalize("見本マンション 301（区分マンション）"));
    expect(t).toContain(normalize(`表面利回り ${p.point!.grossYield}`));
    expect(t).toContain(normalize(`返済余裕率（DSCR） ${p.point!.dscr}`));
    expect(t).toContain(normalize(`月の手残り（税引前） ${yenText(p.point!.monthlyBeforeTax)}`));
    // 含み益は評価額−帳簿価額、評価額−ローン残高は売ったときの手残りの目安（画面と同じ言葉）
    expect(t).toContain(normalize(`含み益 ${man(p.point!.unrealizedGain!)}万円`));
    expect(t).toContain(normalize(`売ったときの手残りの目安（ローン返済後・売却の費用と税の前） ${man(p.point!.equity!)}万円`));
    const y = p.years.find((x) => !x.deadCross && x.depreciation !== null)!;
    const row = [String(y.year), man(y.rent), man(y.expenses), man(y.depreciation!), man(y.interest!), man(y.income!), man(y.repayment), man(y.cashBeforeTax), man(y.cashAfterTax), man(y.loanBalance), man(y.value!)].join(" ");
    expect((page as string).replace(/\s+/g, " ")).toContain(row);
    for (const x of p.saleCompare!.rows) expect(t).toContain(normalize(x.label));
    expect(t).toContain(normalize(`税引後の手取り ${man(p.exit!.net)}万円`));
    expect(page as string).not.toMatch(UUID);
  });
});

describe("物件が2件の世帯: 全体の1枚の月の手残り", () => {
  // 円未満の端数が物件ごとに出るよう、見本の世帯に駐車場（月の賃料を 60,001〜60,012円で変える・年の経費 120,005円）を足す
  const reqs = Array.from({ length: 12 }, (_, i) => {
    const req = modelHousehold("dualAssetsTwoKids");
    const first = (req.input.household.accounts ?? []).find((x) => x.property !== undefined)!;
    const second = JSON.parse(JSON.stringify(first)) as typeof first;
    (second as { id: string }).id = "0b9a1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2e";
    (second as unknown as { property: Record<string, unknown> }).property = { structure: "wood", name: "月極駐車場", kind: "parking", rental: { monthly: { value: 60001 + i, state: "confirmed", origin: { kind: "manual" } } }, expenses: { annual: { value: 120005, state: "confirmed", origin: { kind: "manual" } } } };
    (req.input.household as unknown as { accounts: unknown[] }).accounts = [...(req.input.household.accounts ?? []), second];
    return req;
  });
  const runs = runAll(reqs);

  it("合計の行の月の手残り（税引前・税引後）は、物件の行の月の手残り（円未満を物件ごとに切り捨てた額）の合計（1円もずれない）", () => {
    let fractional = 0;
    for (const run of runs) {
      const r = buildProposalInput({ document: { issuedOn: "2026-10-20" }, current: run, proposal: run }).rental!;
      const t = r.total!.point!;
      const ps = r.properties.map((p) => p.point!);
      expect(ps.every((x) => x.year === t.year)).toBe(true);
      expect(t.monthlyBeforeTax).toBe(ps.reduce((s, x) => s + x.monthlyBeforeTax, 0));
      expect(t.monthlyAfterTax).toBe(ps.reduce((s, x) => s + x.monthlyAfterTax, 0));
      const ra = run.result.summary.realEstateAnalysis!;
      const ys = ra.properties.map((p) => p.years.find((y) => y.year === t.year)!);
      const raw = (k: "cashBeforeTax" | "cashAfterTax") => Math.trunc(ys.reduce((s, y) => s + y[k] / y.months, 0));
      if (raw("cashBeforeTax") !== t.monthlyBeforeTax || raw("cashAfterTax") !== t.monthlyAfterTax) fractional++;
    }
    // 端数を足してから切り捨てると1円ずれる世帯がある（この見本で確かめになっていること）
    expect(fractional).toBeGreaterThan(0);
  });
});

describe.skipIf(bin === null)("物件が2件の世帯: 全体の1枚と物件ごとの1枚", () => {
  // 見本の世帯の物件をもう1件（駐車場。ローンなし・取得の入力なし）足す
  const req = modelHousehold("dualAssetsTwoKids");
  const first = (req.input.household.accounts ?? []).find((x) => x.property !== undefined)!;
  const second = JSON.parse(JSON.stringify(first)) as typeof first;
  (second as { id: string }).id = "0b9a1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d";
  (second as unknown as { property: Record<string, unknown> }).property = { structure: "wood", name: "月極駐車場", kind: "parking", rental: { monthly: { value: 60000, state: "confirmed", origin: { kind: "manual" } } }, expenses: { annual: { value: 120000, state: "confirmed", origin: { kind: "manual" } } } };
  (req.input.household as unknown as { accounts: unknown[] }).accounts = [...(req.input.household.accounts ?? []), second];
  const [run] = runAll([req]);
  const two = buildProposalInput({ document: { issuedOn: "2026-10-20" }, current: run!, proposal: run! });
  const res = renderAndExtract(bin as string, two, sampleFrame({ document: { issuedOn: "2026-10-20" }, current: run!, proposal: run! }, two));
  const pages = res.pages.filter((t) => normalize(t).includes(normalize("年ごとの数字（万円）")));

  it("合計の行は物件の足し算で、取得の入力の無い物件は利回りを出さない。物件ごとのページが続く", () => {
    const r = two.rental!;
    // 物件名を入れていない物件は「物件1」（収益不動産の物件の並びの番号）
    expect(r.properties.map((x) => x.label)).toEqual(["物件1", "月極駐車場"]);
    expect(r.properties[1]?.point?.grossYield).toBe("—");
    const t = r.total!.years[0]!;
    expect(t.rent).toBe(r.properties.reduce((s, p) => s + (p.years.find((y) => y.year === t.year)?.rent ?? 0), 0));
    expect(validate(two), JSON.stringify(validate.errors)).toBe(true);
    expect(normalize(res.pages.join("\n"))).toContain(normalize("全物件の合計の年ごとの数字（万円）"));
    expect(normalize(res.pages.join("\n"))).toContain(normalize(`合計（2件）`));
    // 全体の1枚＋物件ごとの1枚
    expect(pages.length).toBe(3);
  });
  it("駐車場の1枚は建物を前提にした言葉にしない（駐車場の収入・損益分岐の稼働率・減価償却なし）。建物のある物件は今までの言葉", () => {
    const park = pages.find((t) => normalize(t).includes(normalize("月極駐車場（駐車場）")))!;
    const t = normalize(park);
    expect(t).toContain(normalize("駐車場の収入"));
    expect(t).toContain(normalize("損益分岐の稼働率"));
    expect(t).toContain(normalize("減価償却 なし（設備を入れていません）"));
    expect(t).not.toContain(normalize("損益分岐の入居率"));
    const other = normalize(pages.find((x) => normalize(x).includes(normalize("物件1")) && !normalize(x).includes(normalize("全物件の合計")))!);
    expect(other).toContain(normalize("損益分岐の入居率"));
    expect(other).toContain(normalize("家賃収入"));
  });
});

describe.skipIf(bin === null)("貸している土地の1枚: 損益分岐は地代の割合", () => {
  // 見本の世帯の物件をもう1件（貸している土地。ローンなし・取得の入力なし）足す
  const req = modelHousehold("dualAssetsTwoKids");
  const first = (req.input.household.accounts ?? []).find((x) => x.property !== undefined)!;
  const land = JSON.parse(JSON.stringify(first)) as typeof first;
  (land as { id: string }).id = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
  (land as unknown as { property: Record<string, unknown> }).property = { name: "貸地", kind: "land", rental: { monthly: { value: 50000, state: "confirmed", origin: { kind: "manual" } } }, expenses: { annual: { value: 100000, state: "confirmed", origin: { kind: "manual" } } } };
  (req.input.household as unknown as { accounts: unknown[] }).accounts = [...(req.input.household.accounts ?? []), land];
  const [run] = runAll([req]);
  const input = buildProposalInput({ document: { issuedOn: "2026-10-20" }, current: run!, proposal: run! });
  const res = renderAndExtract(bin as string, input, sampleFrame({ document: { issuedOn: "2026-10-20" }, current: run!, proposal: run! }, input));
  it("「損益分岐の地代の割合」と「地代収入」。稼働率・入居率の言葉にしない", () => {
    const page = normalize(res.pages.find((t) => normalize(t).includes(normalize("貸地（貸している土地）")))!);
    expect(page).toContain(normalize("損益分岐の地代の割合"));
    expect(page).toContain(normalize("地代収入"));
    expect(page).not.toContain(normalize("損益分岐の稼働率"));
    expect(page).not.toContain(normalize("損益分岐の入居率"));
  });
});
