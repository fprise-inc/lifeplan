// 事務所の推定の値: 公式の値が新しくなったときの知らせの中身（前の公式・新しい公式・今の事務所の値・出典・押したらどうなるか）
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { officialMasterValue, type BracketStep } from "../../hearing/src/statistics.ts";
import { estimateCenterNotice } from "../src/workspace/office/customNotice.ts";
import { EstimatesSection } from "../src/workspace/office/EstimatesSection.tsx";
import { EMPTY_ESTIMATES, keepOfficeValue, officialUpdates, readOfficeEstimates, sourceLine, withOfficeValue, type OfficeEstimates, type OfficeEstimateValue } from "../src/workspace/office/estimates.ts";

const LIVING = "living.statistics.basicMonthly";
const CARE_MONTHS = "care.statistics.months";
const PRICE = "preset.housing.purchase.price";
const living = (): readonly BracketStep[] => officialMasterValue(LIVING)?.value as readonly BracketStep[];
const at = (t: readonly BracketStep[], upTo: number | null, amount: number) => t.map((s) => (s.upTo === upTo ? { upTo, amount } : s));

/** 事務所の値を、前の版の公式の値で変えた形にする（写しの rev より1つ前の版） */
function older(id: string, patch: Partial<OfficeEstimateValue>, base: OfficeEstimates): OfficeEstimates {
  const v = base.values[id]!;
  return { ...base, values: { ...base.values, [id]: { ...v, officialRev: v.officialRev - 1, ...patch } } };
}

describe("記録する出典", () => {
  it("変えたとき・「このまま」のときに、そのときの公式の出典を覚える（読み直しても残る。前の版の値は出典なしで読める）", () => {
    const e = withOfficeValue(EMPTY_ESTIMATES, CARE_MONTHS, 60, null, "2026-11-02");
    const official = officialMasterValue(CARE_MONTHS)!;
    expect(e.values[CARE_MONTHS]?.officialSource).toEqual({ title: official.title, retrievedAt: official.retrievedAt, reviewed: official.reviewed });
    expect(readOfficeEstimates(JSON.parse(JSON.stringify(e)))).toEqual(e);
    const { officialSource: _s, ...noSource } = e.values[CARE_MONTHS]!;
    void _s;
    expect(readOfficeEstimates({ values: { [CARE_MONTHS]: noSource }, noFill: [] }).values[CARE_MONTHS]).toEqual(noSource);
    // 形の違う出典は捨てる（値は読む）
    expect(readOfficeEstimates({ values: { [CARE_MONTHS]: { ...noSource, officialSource: { title: 1 } } }, noFill: [] }).values[CARE_MONTHS]).toEqual(noSource);
  });

  it("公式の値が新しくなっていなければ知らせない", () => {
    expect(officialUpdates(withOfficeValue(EMPTY_ESTIMATES, LIVING, at(living(), 2, 250000), null, "2026-11-02"))).toEqual([]);
  });
});

describe("1つの値が変わった", () => {
  it("前の公式・新しい公式・今の事務所の値と、押したらどうなるかを出す", () => {
    const e = older(CARE_MONTHS, { officialValue: 50, officialSource: { title: "介護の期間の平均（月数）", retrievedAt: "2025-10-01", reviewed: true } }, withOfficeValue(EMPTY_ESTIMATES, CARE_MONTHS, 60, null, "2026-01-10"));
    const [u] = officialUpdates(e);
    expect(u).toMatchObject({ kind: "value", single: { before: "50か月", after: "55か月", office: "60か月" }, sameAsOfficial: false, sourceChanges: ["取得日"] });
    expect(u?.keepText).toBe("「このまま」: 事務所の値 60か月を使い続けます。今の計算は変わりません。");
    expect(u?.revertText).toContain("新しい公式の値 55か月で計算します");
    expect(u?.effect).toContain("どの世帯でも");
    const [n] = estimateCenterNotice(e);
    expect(n).toMatchObject({ urgency: "normal", title: "介護の期間: 公式の値が新しくなりました" });
    expect(n?.body).toBe("公式の値: 前 50か月 → 新しい 55か月。今の事務所の値: 60か月。今は事務所の値を使い続けています。事務所の既定値の画面の「推定の値（統計・目安）」で、「このまま」か「公式に戻す」を選んでください。");
    expect(n?.body).not.toMatch(/前 値は同じ/);
  });

  it("新しい公式の値が事務所の値と同じなら、どちらを押しても計算は同じと書く", () => {
    const e = older(CARE_MONTHS, { value: 55, officialValue: 50 }, withOfficeValue(EMPTY_ESTIMATES, CARE_MONTHS, 60, null, "2026-01-10"));
    const [u] = officialUpdates(e);
    expect(u?.sameAsOfficial).toBe(true);
    expect(u?.keepText).toContain("どちらを押しても計算は同じです");
    expect(estimateCenterNotice(e)[0]?.body).toContain("新しい公式の値は事務所の値と同じです。");
  });

  it("コードの中の目安（ボタンで足すときの初めの値）は、効く所をその目安の決まりで書く", () => {
    const official = officialMasterValue(PRICE);
    expect(official).toBeNull();
    const e = older(PRICE, { officialValue: 35000000 }, withOfficeValue(EMPTY_ESTIMATES, PRICE, 50000000, null, "2026-01-10"));
    const [u] = officialUpdates(e);
    expect(u).toMatchObject({ kind: "value", single: { before: "35,000,000円", after: "40,000,000円", office: "50,000,000円" } });
    expect(u?.effect).toBe("ボタンで新しく足す行の初めの値に効きます。足してある行は変わりません。");
    // 題名「出典なし」・取得日なしは同じなので、出典は変わっていない
    expect(u?.sourceChanges).toEqual([]);
  });
});

describe("表の値が変わった", () => {
  /** 前の公式の表（2人・4人の段が今と違った）。事務所は2人と5人の段を変え、4人の段は変えていない（前の公式の値のまま） */
  const before = at(at(living(), 2, 200000), 4, 240000);
  const office = at(at(before, 2, 250000), 5, 300000);
  const e = older(LIVING, { value: office, officialValue: before }, withOfficeValue(EMPTY_ESTIMATES, LIVING, at(living(), 2, 250000), null, "2026-01-10"));

  it("変わった段だけを、前の公式・新しい公式・今の事務所の値で出す（変えていない段は分かるように）", () => {
    const [u] = officialUpdates(e);
    expect(u?.kind).toBe("value");
    expect(u?.single).toBeNull();
    expect(u?.steps).toEqual([
      { label: "2人", before: "200,000円", after: "208,847円", office: "250,000円", officeChanged: true },
      { label: "4人", before: "240,000円", after: "245,354円", office: "240,000円", officeChanged: false },
    ]);
    expect(u?.officeSteps).toEqual(["5人 300,000円"]);
    expect(u?.keepText).toBe("「このまま」: 事務所で変えた段はその値を使い続け、事務所で変えていない段は新しい公式の値にします。");
    const [n] = estimateCenterNotice(e);
    expect(n?.title).toBe("基本生活費（月額・世帯人員別）: 公式の値が新しくなりました");
    expect(n?.body).toContain("公式の値: 2人 前 200,000円 → 新しい 208,847円 ほか1段。この段の事務所の値: 250,000円。");
  });

  it("「このまま」は、事務所で変えた段を残し、変えていない段を新しい公式の値にする", () => {
    const kept = keepOfficeValue(e, LIVING);
    expect(kept.values[LIVING]?.value).toEqual(at(at(living(), 2, 250000), 5, 300000));
    expect(kept.values[LIVING]?.changedOn).toBe("2026-01-10");
    expect(officialUpdates(kept)).toEqual([]);
  });

  it("事務所で変えていない段だけが変わったときは、その段は事務所では変えていないと書く", () => {
    const onlyUntouched = older(LIVING, { value: at(at(living(), 4, 240000), 2, 250000), officialValue: at(living(), 4, 240000) }, e);
    const [u] = officialUpdates(onlyUntouched);
    expect(u?.steps).toEqual([{ label: "4人", before: "240,000円", after: "245,354円", office: "240,000円", officeChanged: false }]);
    expect(estimateCenterNotice(onlyUntouched)[0]?.body).toContain("この段は事務所では変えていません。");
  });
});

describe("値は同じで出典だけが新しくなった", () => {
  const base = withOfficeValue(EMPTY_ESTIMATES, LIVING, at(living(), 2, 250000), null, "2026-01-10");
  const official = officialMasterValue(LIVING)!;

  it("値は変わっていないと書き、前の出典と新しい出典を並べる（参考の知らせ）", () => {
    const e = older(LIVING, { officialSource: { title: official.title, retrievedAt: "2025-10-01", reviewed: false } }, base);
    const [u] = officialUpdates(e);
    expect(u).toMatchObject({ kind: "source", change: null, steps: [], sourceChanges: ["取得日", "原本との照らし合わせ"] });
    expect(u?.keepText).toBe("「確認した」: 事務所の値を使い続けます。今の計算は変わりません。");
    const [n] = estimateCenterNotice(e);
    expect(n).toMatchObject({ urgency: "info", title: "基本生活費（月額・世帯人員別）: 公式の値の出典が新しくなりました（値は変わっていません）" });
    expect(n?.body).toContain("取得日: 前 2025年10月1日 → 新しい 2026年10月26日。原本との照らし合わせが済みました。出典は同じ「家計調査（総務省）2025年");
    expect(n?.body).toContain("計算は変わっていません");
    expect(n?.body).not.toContain("upTo");
    expect(officialUpdates(keepOfficeValue(e, LIVING))).toEqual([]);
  });

  it("題名が変わったときは前と新しい題名を並べる。前の出典の記録が無いときは新しい出典だけ", () => {
    const renamed = older(LIVING, { officialSource: { title: "家計調査（総務省）2024年 二人以上の世帯", retrievedAt: "2025-10-01", reviewed: true } }, base);
    expect(estimateCenterNotice(renamed)[0]?.body).toMatch(/^出典: 前 「家計調査（総務省）2024年 二人以上の世帯」・2025年10月1日に取得 → 新しい 「家計調査（総務省）2025年/);
    const { officialSource: _s, ...v } = base.values[LIVING]!;
    void _s;
    const unknown = older(LIVING, {}, { ...base, values: { [LIVING]: v } });
    const [u] = officialUpdates(unknown);
    expect(u).toMatchObject({ kind: "source", beforeSource: null, sourceChanges: [] });
    expect(estimateCenterNotice(unknown)[0]?.body).toMatch(/^新しい出典: 「家計調査/);
  });

  it("出典の1行は、データの読み方の注記を外し、取得日と確認待ちを書く", () => {
    expect(sourceLine({ title: "統計（upTo は世帯人員）", retrievedAt: "2026-10-26", reviewed: false })).toBe("「統計」・2026年10月26日に取得・原本での確認待ち");
    expect(sourceLine({ title: "出典なし", retrievedAt: null, reviewed: true })).toBe("「出典なし」");
  });
});

describe("段の分け方が変わった（事務所の値を使えない）", () => {
  it("前と新しい段の分け方・事務所で変えていた段・今の計算を書く", () => {
    const oldTable = living().slice(1);
    const officeOld = at(oldTable, 2, 250000);
    const base = withOfficeValue(EMPTY_ESTIMATES, LIVING, at(living(), 2, 250000), null, "2026-01-10");
    const e = older(LIVING, { value: officeOld, officialValue: oldTable }, base);
    const [u] = officialUpdates(e);
    expect(u).toMatchObject({ kind: "broken", broken: true, change: null, officeSteps: ["2人 250,000円"], layout: { before: "5段（2人・3人・4人・5人・6人以上）", after: "6段（1人・2人・3人・4人・5人・6人以上）" } });
    expect(u?.revertText).toContain("計算は変わりません");
    const [n] = estimateCenterNotice(e);
    expect(n?.title).toBe("基本生活費（月額・世帯人員別）: 公式の表の段の分け方が変わり、事務所の値を使えなくなりました");
    expect(n?.body).toBe(
      "段の分け方: 前 5段（2人・3人・4人・5人・6人以上） → 新しい 6段（1人・2人・3人・4人・5人・6人以上）。今は新しい公式の値で計算しています。事務所で変えていた段: 2人 250,000円。事務所の既定値の画面の「推定の値（統計・目安）」で、値を入れ直すか公式に戻してください。",
    );
    // 「このまま」は使えない値を変えない
    expect(keepOfficeValue(e, LIVING).values[LIVING]?.value).toEqual(officeOld);
  });
});

describe("区画の見せ方", () => {
  const render = (value: OfficeEstimates) => renderToString(h(EstimatesSection, { value, onChange: async () => undefined, today: () => "2026-11-15" }));

  it("表の変わった段の表・出典・押したらどうなるかを出し、文が崩れない", () => {
    const before = at(living(), 2, 200000);
    const e = older(LIVING, { value: at(before, 2, 250000), officialValue: before, officialSource: { title: officialMasterValue(LIVING)!.title, retrievedAt: "2025-10-01", reviewed: true } }, withOfficeValue(EMPTY_ESTIMATES, LIVING, at(living(), 2, 250000), null, "2026-01-10"));
    const html = render(e);
    expect(html).toContain('data-office-estimate-update-kind="value"');
    expect(html).toContain("data-office-estimate-update-steps");
    expect(html).toContain("前の公式");
    expect(html).toContain("208,847円");
    expect(html).toContain("新しい出典");
    expect(html).toContain("「このまま」: 事務所の値を使い続けます");
    expect(html).toContain("このまま（事務所の値を使う）");
    expect(html).not.toContain("前 値は同じ");
    expect(html).not.toMatch(/\b0\d{3}\b/);
  });

  it("出典だけのときは「確かめた」と「公式に戻す」、使えないときは「値を入れ直す」と「公式に戻す」", () => {
    const base = withOfficeValue(EMPTY_ESTIMATES, CARE_MONTHS, 60, null, "2026-01-10");
    const src = render(older(CARE_MONTHS, {}, base));
    expect(src).toContain('data-office-estimate-update-kind="source"');
    expect(src).toContain("確認した（事務所の値のまま）");
    expect(src).toContain("値は変わっていません。");
    expect(src).toContain("公式に戻す");
    const oldTable = living().slice(1);
    const broken = render(older(LIVING, { value: at(oldTable, 2, 250000), officialValue: oldTable }, withOfficeValue(EMPTY_ESTIMATES, LIVING, at(living(), 2, 250000), null, "2026-01-10")));
    expect(broken).toContain('data-office-estimate-update-kind="broken"');
    expect(broken).toContain("値を入れ直す");
    expect(broken).toContain("新しい段の分け方");
    expect(broken).not.toContain("data-office-estimate-keep");
  });
});
