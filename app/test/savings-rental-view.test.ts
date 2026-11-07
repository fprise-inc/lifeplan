// 貯蓄・運用・収益不動産・前提条件の見せ方（0145）: 名義の候補は持てる人だけ・足すボタンは持てる人のいる種類だけ・その他の資産の種類は2つ・
// 収支が入る口座の積立・口座の利回りの推定の印・資産配分の名前・iDeCo の受け取りの推定の文・お金の行き先と運用の期間の出し方・空き家と土地の
// 持ち始める時点、収益不動産の既定の値の推定の印・区分マンションの構造・足したときの目安の推定・戸数・並び・借り換え・物件の一覧の額、
// 前提条件の不動産の評価の区画と計算の基準の月
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import type { Account, EngineRequest } from "../src/engine/types.ts";
import { allFields, type FieldDef, type StageId } from "../src/workspace/input/form.ts";
import { fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { ASSET_CLASSES, LEGACY_HOLDER_SUFFIX } from "../src/workspace/input/labels.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { OTHER_ASSET_KINDS, SETTLEMENT_CONTRIBUTION_UNUSED, SETTLEMENT_SAVES } from "../src/workspace/input/stages/savings.ts";
import { addPropertyLoan, addPropertyRefinance, addRentalProperty, addRepair, CONDO_STRUCTURE_BASIS, UNITS_BLANK } from "../src/workspace/input/stages/rental.ts";
import { REAL_ESTATE_SECTION } from "../src/workspace/input/stages/assumptions.ts";
import { CLASSES, payoutAgeBasis, rateBasisOf } from "../src/workspace/input/savings/model.ts";
import { SavingsPanel } from "../src/workspace/input/savings/SavingsPanel.tsx";
import { RentalOverview } from "../src/workspace/input/RentalOverview.tsx";
import { estimatedFields } from "../src/workspace/input/checkRows.ts";
import { applyStateOp, confirmAll, fieldStatus } from "../src/workspace/input/valueState.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { planView, recordPlanEdit, settleFields } from "../src/workspace/plans/planEdit.ts";
import { modelHousehold, preview } from "./helpers.ts";

const open = (id: string): WorkingHousehold => fromRequest(modelHousehold(id));
const fieldsOf = (wh: WorkingHousehold, stage: StageId): Map<string, FieldDef> => new Map(allFields(buildStage(stage, wh)).map((f) => [f.key, f]));
const fieldOf = (wh: WorkingHousehold, key: string, stage: StageId = "savings"): FieldDef => {
  const f = fieldsOf(wh, stage).get(key);
  if (f === undefined) throw new Error(`欄が無い: ${key}`);
  return f;
};
const actionKeys = (wh: WorkingHousehold, stage: StageId = "savings"): string[] => buildStage(stage, wh).sections.flatMap((s) => [...s.actions, ...s.groups.flatMap((g) => g.actions)]).map((a) => a.key);
const action = (wh: WorkingHousehold, key: string, stage: StageId = "savings") => {
  const a = buildStage(stage, wh).sections.flatMap((s) => [...s.actions, ...s.groups.flatMap((g) => g.actions)]).find((x) => x.key === key);
  if (a === undefined) throw new Error(`操作が無い: ${key}`);
  return a;
};
const accountsOf = (wh: WorkingHousehold): Account[] => wh.request.input.household.accounts ?? [];
const accOf = (wh: WorkingHousehold, kind: string): Account => accountsOf(wh).find((a) => a.kind === kind) as Account;
const optionValues = (f: FieldDef): string[] => ((f as { options?: { value: string }[] }).options ?? []).map((o) => o.value);
const memberId = (wh: WorkingHousehold, kind: string, n = 0): string => wh.request.input.household.members.filter((m) => m.kind === kind)[n]!.id;

describe("貯蓄・運用: 名義の候補と足すボタン", () => {
  it("iDeCo・NISA・企業型DC の名義に、持てない小さな子を出さない（預金・課税口座は世帯の誰でも）", () => {
    const wh = open("investmentCouple");
    const kids = wh.request.input.household.members.filter((m) => m.kind === "child").map((m) => m.id);
    for (const kind of ["ideco", "nisa", "corporateDc"]) {
      const opts = optionValues(fieldOf(wh, `sav/${accOf(wh, kind).id}/owner`));
      expect(opts.some((v) => kids.includes(v)), kind).toBe(false);
      expect(opts).toContain(memberId(wh, "self"));
    }
    // 第3号（会社員の配偶者）も iDeCo に入れる: 配偶者は候補に残る
    expect(optionValues(fieldOf(wh, `sav/${accOf(wh, "ideco").id}/owner`))).toContain(memberId(wh, "spouse"));
    expect(optionValues(fieldOf(wh, `sav/${accOf(wh, "deposit").id}/owner`))).toEqual(expect.arrayContaining(kids));
  });

  it("前に持てない人を名義にした口座は、添え書きを付けて候補の後ろに残す（黙って書き換えない）", () => {
    let wh = open("investmentCouple");
    const kid = memberId(wh, "child", 1);
    const ideco = accOf(wh, "ideco");
    wh = mutate(wh, (hh) => void ((hh.accounts ?? []).find((a) => a.id === ideco.id)!.owner = kid));
    const opts = (fieldOf(wh, `sav/${ideco.id}/owner`) as { options: { value: string; label: string }[] }).options;
    expect(opts.at(-1)).toMatchObject({ value: kid });
    expect(opts.at(-1)!.label.endsWith(LEGACY_HOLDER_SUFFIX)).toBe(true);
    // 表の名義の部品も同じ候補
    const html = renderToString(h(SavingsPanel, { wh, level: "detail", onEdit: () => undefined }));
    expect(html).toContain(LEGACY_HOLDER_SUFFIX);
  });

  it("足すボタンは持てる人のいる種類だけ: 自営業だけの世帯に財形・企業型DC・持株会を出さず、小規模企業共済を出す。子のいない世帯にこどもNISA・ジュニアNISA を出さない", () => {
    const self = actionKeys(open("selfEmployed"));
    for (const k of ["zaikei", "corporateDc", "esop"]) expect(self).not.toContain(`sav/add/${k}`);
    expect(self).toContain("sav/add/smallBusinessMutualAid");
    const office = actionKeys(open("salariedCoupleTwoKids"));
    for (const k of ["zaikei", "corporateDc", "esop", "childNisa"]) expect(office).toContain(`sav/add/${k}`);
    expect(office).not.toContain("sav/add/smallBusinessMutualAid");
    const single = actionKeys(open("single45"));
    for (const k of ["childNisa", "juniorNisa"]) expect(single).not.toContain(`sav/add/${k}`);
  });

  it("こどもNISA は最初の子の名義で足す", () => {
    const wh = open("salariedCoupleTwoKids");
    const next = action(wh, "sav/add/childNisa").run(wh);
    expect(accOf(next, "childNisa").owner).toBe(memberId(wh, "child"));
  });

  it("その他の資産の「種類」は貸していない不動産とその他の資産の2つだけ", () => {
    let wh = open("single45");
    wh = action(wh, "sav/add/otherAsset").run(wh);
    const other = accOf(wh, "otherAsset");
    expect(optionValues(fieldOf(wh, `sav/${other.id}/kind`))).toEqual(OTHER_ASSET_KINDS.map((o) => o.value));
    expect(OTHER_ASSET_KINDS.map((o) => o.value)).toEqual(["realEstate", "otherAsset"]);
  });
});

describe("貯蓄・運用: 収支が入る口座の積立", () => {
  it("積立の無い決済口座は、積立の欄の代わりに「黒字はこの口座に貯まります」（欄は読むだけ）", () => {
    const wh = open("salariedCoupleTwoKids");
    const dep = accOf(wh, "deposit");
    const f = fieldOf(wh, `sav/${dep.id}/monthly`);
    expect(f.readOnly).toBe(SETTLEMENT_SAVES);
    const html = renderToString(h(SavingsPanel, { wh, level: "simple", onEdit: () => undefined }));
    expect(html).toContain("data-settlement-saves");
    expect(html).toContain(SETTLEMENT_SAVES);
  });

  it("前の版で決済口座に入れた積立は、計算に使っていないことを知らせ、合計の「今 月○万円」に入れない。「積立を外す」を押すと外し、結果は変わらない", () => {
    const wh = open("investmentCouple");
    const dep = accOf(wh, "deposit");
    expect((dep.contributions ?? []).length).toBeGreaterThan(0);
    const st = fieldOf(wh, `sav/${dep.id}/monthly`).get(wh);
    expect(st.warn).toBe(SETTLEMENT_CONTRIBUTION_UNUSED);
    const html = renderToString(h(SavingsPanel, { wh, level: "simple", onEdit: () => undefined }));
    expect(html).toContain("data-settlement-unused");
    // 合計の行の毎月の積立に、決済口座の積立（月1万円）を足さない
    const total = (html.match(/今 月([\d.,]+)万円/) ?? [])[1];
    const dropped = st.warnFix!.run(wh);
    expect(accOf(dropped, "deposit").contributions).toEqual([]);
    const html2 = renderToString(h(SavingsPanel, { wh: dropped, level: "simple", onEdit: () => undefined }));
    expect((html2.match(/今 月([\d.,]+)万円/) ?? [])[1]).toBe(total);
    const end = (r: ReturnType<typeof preview>) => r.table.filter((c) => c.row === "cf.balance.financial" || c.row.startsWith("cf.balance.account.")).filter((c) => c.year === 2050).reduce((s, c) => s + c.amount, 0);
    expect(end(preview(dropped.request))).toBe(end(preview(wh.request)));
  });

  it("決済口座でない預金（2つ目の預金）には積立の欄を出す", () => {
    const wh = open("rentalSample");
    const deps = accountsOf(wh).filter((a) => a.kind === "deposit");
    const second = deps.find((a) => a.settlement !== true)!;
    expect(fieldOf(wh, `sav/${second.id}/monthly`).readOnly).toBeUndefined();
  });
});

describe("貯蓄・運用: 推定の印と言葉", () => {
  it("利回りを入れていない口座は、灰色の値に推定の印と、どこから来た値かの根拠（前提条件・資産の配分）。数えない推定（まとめて「この値にする」に入れない）", () => {
    const wh = open("salariedCoupleTwoKids");
    const nisa = accOf(wh, "nisa");
    const f = fieldOf(wh, `sav/${nisa.id}/rate`);
    const s = fieldStatus(f, wh);
    expect(s.status).toBe("estimated");
    expect(s.basis).toMatch(/^既定の値（(資産の配分|前提条件の運用利回り)/);
    expect(estimatedFields(wh, "savings").some((x) => x.key === f.key)).toBe(false);
    // 預金は前提条件の預金の利回り
    const dep = { ...accOf(wh, "deposit"), expectedReturn: undefined, assetMix: undefined } as Account;
    expect(rateBasisOf(wh.request, dep)).toMatch(/預金の利回り 0\.1%/);
    const ideco = { ...accOf(open("investmentCouple"), "ideco"), expectedReturn: undefined, assetMix: undefined } as Account;
    expect(rateBasisOf(wh.request, ideco)).toMatch(/前提条件の運用利回り/);
  });

  it("資産配分の表の資産の種類の名前は、前提条件の資産の種類ごとの利回りと同じ。列は「利回り（年・信託報酬を引く前）」", () => {
    for (const c of CLASSES) expect(c.name).toBe(ASSET_CLASSES.find((o) => o.value === c.key)?.label);
    let wh = open("investmentCouple");
    wh = mutate(wh, (_h, r) => void (r.input.assumptions!.investment = { ...(r.input.assumptions!.investment ?? {}), method: "allocation" }));
    const html = renderToString(h(SavingsPanel, { wh, level: "detail", onEdit: () => undefined }));
    expect(html).toContain("利回り（年・信託報酬を引く前）");
    expect(html).not.toContain("期待リターン（年）");
  });

  it("iDeCo の受け取りを始める年齢の推定: 退職が65歳より後なら「65歳（推定は65歳までにしています）」（退職の年と言わない。加入の上限は2026年12月から70歳なので上限とも言わない。0150）", () => {
    let wh = open("single45");
    const ideco = accOf(wh, "ideco");
    expect(payoutAgeBasis(wh.request, ideco)).toMatch(/^退職の年（\d+歳）$/);
    // 働く最後を70歳に
    wh = mutate(wh, (hh) => {
      const p = (hh.employmentPeriods ?? [])[0]!;
      p.to = { at: "2051-01" };
    });
    expect(payoutAgeBasis(wh.request, accOf(wh, "ideco"))).toBe("65歳（推定は65歳までにしています）");
    expect(fieldStatus(fieldOf(wh, `sav/${ideco.id}/payoutAge`), wh).basis).toBe("65歳（推定は65歳までにしています）");
  });

  it("単身の世帯の「積立をやめる年齢」に「（ご本人）」を付けない。加入の始まりは「加入した年月」、積立の終わりは「積立の終わり」", () => {
    expect(fieldOf(open("single45"), "sav/stopAge").label).toBe("積立をやめる年齢");
    expect(fieldOf(open("investmentCouple"), "sav/stopAge").label).toBe("積立をやめる年齢（ご本人）");
    const wh = open("single45");
    const ideco = accOf(wh, "ideco");
    expect(fieldOf(wh, `sav/${ideco.id}/enrolled`).label).toBe("加入した年月");
    const labels = [...fieldsOf(open("investmentCouple"), "savings").values()].map((f) => f.label);
    expect(labels.some((l) => l.includes("（最後の月）"))).toBe(false);
  });

  it("配偶者の口座の積立の期間は、配偶者の年齢で「〜○歳（ご本人の積立をやめる年齢の月まで）」を見せる", () => {
    let wh = open("salariedCoupleTwoKids");
    const spouse = memberId(wh, "spouse");
    wh = mutate(wh, (hh) => {
      const n = (hh.accounts ?? []).find((a) => a.kind === "nisa")!;
      n.owner = spouse;
      n.contributions = [{ from: { at: "2026-10" }, to: { at: "2046-06" }, monthly: 30000 }];
    });
    const html = renderToString(h(SavingsPanel, { wh, level: "simple", onEdit: () => undefined }));
    // ご本人（1981-07 生まれ）の65歳の前の月 2046-06 は、配偶者（1983-10 生まれ）の62歳
    expect(html).toContain("〜62歳");
    expect(html).toContain("（ご本人が65歳になる前の月まで）");
  });

  it("定額の取り崩しの額は物価で伸ばさないと書く。取り崩し方の説明は「?」の中", () => {
    const wh = mutate(open("single45"), (_h, r) => void (r.input.assumptions!.investment = { ...(r.input.assumptions!.investment ?? {}), drawdown: { method: "fixed", monthly: 100000, start: { at: "2046-03" } } as never }));
    const html = renderToString(h(SavingsPanel, { wh, level: "simple", onEdit: () => undefined }));
    expect(html).toContain("毎年同じ額です（物価で伸ばしません）");
  });
});

describe("貯蓄・運用: 運用の期間・お金の行き先の出し方", () => {
  it("口座が無い新しい世帯では「積み立てる」の箱も「お金の行き先」も出さない", () => {
    const wh = mutate(open("single45"), (hh) => void (hh.accounts = []));
    const html = renderToString(h(SavingsPanel, { wh, level: "simple", onEdit: () => undefined }));
    expect(html).not.toContain("↑ 積み立てる");
    expect(html).not.toContain('aria-label="お金の行き先"');
    expect(buildStage("savings", wh).sections.some((s) => s.key === "sav/flow")).toBe(false);
  });

  it("取り崩す口座が2つ以上なら「お金の行き先」を出し、標準の札は灰色の「詳細で直せます」", () => {
    const wh = open("salariedCoupleTwoKids");
    const html = renderToString(h(SavingsPanel, { wh, level: "simple", onEdit: () => undefined }));
    expect(html).toContain('aria-label="お金の行き先"');
    expect(html).toContain('<span class="sv-tag">詳細で直せます</span>');
    expect(html).not.toContain("詳細あり");
  });
});

describe("貯蓄・運用: 貸していない不動産の持ち始める時点", () => {
  it("中身が空き家・土地のときだけ、持ち始める時点を標準に出す（別荘・その他は詳細）", () => {
    let wh = open("single45");
    wh = action(wh, "sav/add/realEstate").run(wh);
    const re = accOf(wh, "realEstate");
    const level = (sub: string) => {
      const w = fieldOf(wh, `sav/${re.id}/subtype`).set(wh, sub);
      return fieldOf(w, `sav/${re.id}/holdFrom`).level;
    };
    expect(level("vacantHouse")).toBe("simple");
    expect(level("vacantLand")).toBe("simple");
    expect(level("villa")).toBe("detail");
    expect(level("other")).toBe("detail");
  });
});

describe("収益不動産: 既定の値の推定の印", () => {
  const fresh = (): { wh: WorkingHousehold; id: string } => {
    const wh = addRentalProperty(open("single45"), () => "00000000-0000-4000-8000-00000000a001");
    return { wh, id: "00000000-0000-4000-8000-00000000a001" };
  };
  it("足した物件の構造・建った年・土地の割合・空室率は、既定の値の推定の印（打つと確定。既定の値そのものは変えない）", () => {
    const { wh, id } = fresh();
    for (const k of ["structure", "builtYear", "landShare", "vacancy"]) {
      const f = fieldOf(wh, `sav/${id}/property/${k}`, "rental");
      const s = fieldStatus(f, wh);
      expect(s.status, k).toBe("estimated");
      expect(s.basis, k).toMatch(/^既定の値（/);
    }
    expect(fieldOf(wh, `sav/${id}/property/structure`, "rental").get(wh).value).toBe("wood");
    const typed = fieldOf(wh, `sav/${id}/property/structure`, "rental").set(wh, "steel");
    expect(fieldStatus(fieldOf(typed, `sav/${id}/property/structure`, "rental"), typed).status).toBe("confirmed");
    // 見本の物件（既定と違う構造・建った年を入れてある）は推定にしない
    const sample = open("rentalSample");
    const condo = accountsOf(sample).find((a) => a.property?.kind === "condo")!;
    expect(fieldStatus(fieldOf(sample, `sav/${condo.id}/property/structure`, "rental"), sample).status).toBe("confirmed");
    expect(fieldStatus(fieldOf(sample, `sav/${condo.id}/property/builtYear`, "rental"), sample).status).toBe("confirmed");
  });

  it("種類を区分マンションにすると、構造が空なら鉄筋コンクリート造を推定の印で入れる。前から構造の空の区分マンションは、知らせと「鉄筋コンクリート造にする」", () => {
    const { wh, id } = fresh();
    const condo = fieldOf(wh, `sav/${id}/property/kind`, "rental").set(wh, "condo");
    expect(accOf(condo, "realEstate").property?.structure).toBe("rc");
    expect(fieldStatus(fieldOf(condo, `sav/${id}/property/structure`, "rental"), condo).basis).toBe(CONDO_STRUCTURE_BASIS);
    // 区分マンションには戸数・土地の面積を出さない
    expect(fieldsOf(condo, "rental").has(`sav/${id}/property/units`)).toBe(false);
    expect(fieldsOf(condo, "rental").has(`sav/${id}/property/landArea`)).toBe(false);
    // 前の版の区分マンション（構造なし）
    const old = mutate(wh, (hh) => void ((hh.accounts ?? []).find((a) => a.id === id)!.property!.kind = "condo"));
    const st = fieldOf(old, `sav/${id}/property/structure`, "rental").get(old);
    expect(st.value).toBe("wood");
    expect(st.warn).toMatch(/鉄筋コンクリート造/);
    const fixed = st.warnFix!.run(old);
    expect(accOf(fixed, "realEstate").property?.structure).toBe("rc");
  });

  it("一棟の物件で戸数が空なら「1室で数えています」と、申告の事業的規模の目安にも知らせ", () => {
    const { wh, id } = fresh();
    const apt = fieldOf(wh, `sav/${id}/property/kind`, "rental").set(wh, "apartment");
    expect(fieldOf(apt, `sav/${id}/property/units`, "rental").get(apt).warn).toBe(UNITS_BLANK);
    const owner = accOf(apt, "realEstate").owner;
    expect(fieldOf(apt, `rental/taxReturn/${owner}/scale`, "rental").get(apt).warn).toMatch(/戸数が入っていない一棟の物件/);
    const set = fieldOf(apt, `sav/${id}/property/units`, "rental").set(apt, 8);
    expect(fieldOf(set, `sav/${id}/property/units`, "rental").get(set).warn ?? null).toBeNull();
  });

  it("計算に使わない面積の欄に「?」で「計算には使いません」", () => {
    const { wh, id } = fresh();
    expect(fieldOf(wh, `sav/${id}/property/landArea`, "rental").help).toContain("計算には使いません");
    expect(fieldOf(wh, `sav/${id}/property/floorArea`, "rental").help).toContain("計算には使いません");
    expect(fieldOf(wh, `sav/${id}/property/tenure`, "rental").help).toContain("地代の欄");
  });

  it("足した大きな修繕の額・年月と、足したローンの借入額・金利・返済期間は推定（打つと確定）", () => {
    const { wh, id } = fresh();
    const r = addRepair(wh, id, () => "00000000-0000-4000-8000-00000000b001");
    const kr = `sav/${id}/property/repair/00000000-0000-4000-8000-00000000b001`;
    expect(fieldStatus(fieldOf(r, `${kr}/amount`, "rental"), r).status).toBe("estimated");
    expect(fieldStatus(fieldOf(r, `${kr}/at`, "rental"), r).status).toBe("estimated");
    const typed = fieldOf(r, `${kr}/amount`, "rental").set(r, 2_000_000);
    expect(fieldStatus(fieldOf(typed, `${kr}/amount`, "rental"), typed).status).toBe("confirmed");
    let n = 0;
    const ids = ["00000000-0000-4000-8000-00000000c001", "00000000-0000-4000-8000-00000000c002"];
    const l = addPropertyLoan(wh, id, () => ids[n++]!);
    const k = `housing/debt/${ids[0]}`;
    for (const x of ["principal", "rate", "term"]) expect(fieldStatus(fieldOf(l, `${k}/${x}`, "rental"), l).status, x).toBe("estimated");
    const principal = fieldOf(l, `${k}/principal`, "rental").set(l, 30_000_000);
    expect(fieldStatus(fieldOf(principal, `${k}/principal`, "rental"), principal).status).toBe("confirmed");
    // 画面の「＋ この物件のローン」も同じ
    const viaAction = action(wh, `sav/${id}/property/addLoan`, "rental").run(wh);
    const d = (viaAction.request.input.household.debts ?? []).at(-1)!;
    expect(fieldStatus(fieldOf(viaAction, `housing/debt/${d.id}/principal`, "rental"), viaAction).status).toBe("estimated");
  });

  it("売却・大きな修繕の予定の中は、見出しと同じ売却→大きな修繕の順", () => {
    const sample = open("rentalSample");
    const apt = accountsOf(sample).find((a) => a.property?.kind === "apartment")!;
    const keys = buildStage("rental", sample).sections.flatMap((s) => s.groups.map((g) => g.key)).filter((k) => k.startsWith(`sav/${apt.id}/property/`));
    const sale = keys.indexOf(`sav/${apt.id}/property/sale`);
    const repair = keys.findIndex((k) => k.includes("/repair/") || k.endsWith("/repairs"));
    expect(sale).toBeGreaterThanOrEqual(0);
    expect(sale).toBeLessThan(repair);
  });

  it("物件のローンの借り換えは、共通の関数の時期（これから借りるローンは借入の5年後）で、金利は今の最後の金利の固定・期間は収益不動産の目安", () => {
    const sample = open("rentalSample");
    const d = (sample.request.input.household.debts ?? []).find((x) => x.property !== undefined)!;
    const next = addPropertyRefinance(sample, d.id);
    const r = (next.request.input.household.debts ?? []).find((x) => x.id === d.id)!.refinance!.at(-1)!;
    expect(r.rateSchedule[0]).toMatchObject({ type: "fixed", rate: d.rateSchedule.at(-1)!.rate });
    expect(r.termMonths).toBe(240);
    // これから借りるローン
    const later = mutate(sample, (hh) => void ((hh.debts ?? []).find((x) => x.id === d.id)!.start = { at: "2030-04" }));
    const r2 = (addPropertyRefinance(later, d.id).request.input.household.debts ?? []).find((x) => x.id === d.id)!.refinance!.at(-1)!;
    expect(r2.at).toEqual({ at: "2035-04" });
  });

  it("物件の一覧: ローン残高は「（今）」、額は欄の外の書き方（万円で小数1桁・1万円未満は円）", () => {
    const html = renderToString(h(RentalOverview, { wh: open("rentalSample") }));
    expect(html).toContain("ローン残高（今）");
    expect(html).not.toMatch(/\d{2},\d{3}円/);
    expect(html).toMatch(/\d+(\.\d)?万円/);
  });

  it("伸び方の率の欄は「伸び率（年）」（家賃・年額・土地の評価額・貯蓄の不動産の評価額）", () => {
    const sample = open("rentalSample");
    const labels = [...fieldsOf(sample, "rental").values()].map((f) => f.label);
    expect(labels).toEqual(expect.arrayContaining(["家賃の伸び率（年）", "年額の伸び率（年）", "土地の評価額の伸び率（年）"]));
    expect(labels.some((l) => /変化率|増減率/.test(l))).toBe(false);
  });
});

describe("既定の値の推定の印は、明示の操作をした欄では確定（確定は明示の操作だけ、の裏返しの誤りを作らない）", () => {
  const ID = "00000000-0000-4000-8000-00000000a002";
  const fresh = () => addRentalProperty(open("single45"), () => ID);
  const st = (wh: WorkingHousehold, key: string, stage: StageId = "rental") => fieldStatus(fieldOf(wh, key, stage), wh).status;

  it("既定の値と同じ値でも、世帯に入れてある値は確定（見本の作り手が入れた木造など）", () => {
    const sample = open("rentalSample");
    const apt = accountsOf(sample).find((a) => a.property?.kind === "apartment")!;
    expect(apt.property?.structure).toBe("wood");
    expect(st(sample, `sav/${apt.id}/property/structure`)).toBe("confirmed");
    // 見本の収益不動産の入力項目に、既定の値の推定は残らない（売却の費用も見本に入れてある）
    const marked = [...fieldsOf(sample, "rental").values()].filter((f) => /\/property\/(structure|builtYear|landShare|vacancy|saleCost)$/.test(f.key));
    expect(marked.filter((f) => fieldStatus(f, sample).status === "estimated").map((f) => f.key)).toEqual([]);
  });

  it("打って既定の値に戻しても確定（木造→鉄骨造→木造・30%→35%→30%）。値は世帯に書く", () => {
    let wh = fresh();
    wh = fieldOf(wh, `sav/${ID}/property/structure`, "rental").set(wh, "steel");
    wh = fieldOf(wh, `sav/${ID}/property/structure`, "rental").set(wh, "wood");
    expect(accOf(wh, "realEstate").property?.structure).toBe("wood");
    expect(st(wh, `sav/${ID}/property/structure`)).toBe("confirmed");
    wh = fieldOf(wh, `sav/${ID}/property/landShare`, "rental").set(wh, "0.35");
    wh = fieldOf(wh, `sav/${ID}/property/landShare`, "rental").set(wh, "0.3");
    expect(st(wh, `sav/${ID}/property/landShare`)).toBe("confirmed");
  });

  it("「この値にする」とまとめての確定で、既定の値の欄は確定になる", () => {
    const wh = fresh();
    for (const k of ["structure", "builtYear", "landShare", "vacancy"]) {
      const key = `sav/${ID}/property/${k}`;
      expect(st(wh, key), k).toBe("estimated");
      const c = applyStateOp(wh, fieldOf(wh, key, "rental"), "confirm");
      expect(st(c, key), k).toBe("confirmed");
    }
    const all = confirmAll(wh, [...fieldsOf(wh, "rental").values()]).wh;
    for (const k of ["structure", "builtYear", "landShare", "vacancy"]) expect(st(all, `sav/${ID}/property/${k}`), k).toBe("confirmed");
  });

  it("前提条件: 不動産の評価の目安・土地の上昇率・経済の前提も、打った値は標準と同じでも確定（空欄にすると推定に戻る）", () => {
    let wh = open("salariedCoupleTwoKids");
    const a = (k: string) => st(wh, k, "assumptions");
    expect(a("assume/realEstate/landShare")).toBe("estimated");
    wh = fieldOf(wh, "assume/realEstate/landShare", "assumptions").set(wh, "0.35");
    wh = fieldOf(wh, "assume/realEstate/landShare", "assumptions").set(wh, "0.3");
    expect(a("assume/realEstate/landShare")).toBe("confirmed");
    const inf = wh.request.input.assumptions!.inflation!.default;
    wh = fieldOf(wh, "assume/realEstate/landGrowth", "assumptions").set(wh, "0.02");
    wh = fieldOf(wh, "assume/realEstate/landGrowth", "assumptions").set(wh, inf);
    expect(a("assume/realEstate/landGrowth")).toBe("confirmed");
    wh = fieldOf(wh, "assume/realEstate/landGrowth", "assumptions").set(wh, null);
    expect(a("assume/realEstate/landGrowth")).toBe("estimated");
    expect(a("assume/inflation")).toBe("estimated");
    wh = fieldOf(wh, "assume/inflation", "assumptions").set(wh, "0.02");
    wh = fieldOf(wh, "assume/inflation", "assumptions").set(wh, "0.01");
    expect(a("assume/inflation")).toBe("confirmed");
    wh = fieldOf(wh, "assume/inflation", "assumptions").set(wh, null);
    expect(a("assume/inflation")).toBe("estimated");
  });

  it("プランで既定の値の欄を直して既定の値に戻すと、確定の印の違いだけでは差分を残さない", () => {
    const req = modelHousehold("rentalSample");
    const wh: WorkingHousehold = { ...fromRequest(req, {}), proposals: [{ id: "B", name: "プランB", createdAt: "2026-10-26T00:00:00Z", updatedAt: "2026-10-26T00:00:00Z", base: null, tags: [], diffs: [] }] };
    const cat = buildCatalog(wh, memberId(wh, "self"), null);
    const apt = accountsOf(wh).find((x) => x.property?.kind === "apartment")!;
    const key = `sav/${apt.id}/property/saleCost`;
    const cur = mutate(wh, (hh) => void delete (hh.accounts ?? []).find((x) => x.id === apt.id)!.property!.sale!.costRate);
    const view = planView(cur, cat, "B");
    const f = fieldOf(view, key, "rental");
    const w1 = recordPlanEdit(cur, cat, "B", view, f.set(view, "0.05"));
    expect(w1.proposals[0]!.diffs.length).toBeGreaterThan(0);
    const v2 = planView(w1, cat, "B");
    const back = settleFields(recordPlanEdit(w1, cat, "B", v2, fieldOf(v2, key, "rental").set(v2, "0.04")), cat, "B", [...fieldsOf(v2, "rental").values()]);
    expect(back.proposals[0]!.diffs).toEqual([]);
  });
});

describe("前提条件: 不動産の評価・計算の基準の月", () => {
  it("区画の名前は「不動産の評価（持ち家・収益不動産など）」。持ち家・不動産の無い世帯では出さない", () => {
    const none = mutate(open("single45"), (hh) => {
      hh.residences = (hh.residences ?? []).filter((r) => r.kind !== "own");
      hh.accounts = (hh.accounts ?? []).filter((a) => a.kind !== "realEstate");
    });
    expect(buildStage("assumptions", none).sections.some((s) => s.key === "assume/realEstate")).toBe(false);
    const sec = buildStage("assumptions", open("rentalSample")).sections.find((s) => s.key === "assume/realEstate");
    expect(sec?.title).toBe(REAL_ESTATE_SECTION);
  });

  it("計算の基準の月は「2026年10月・令和8年」の形（欄の外の年月の書き方）", () => {
    const wh = open("single45");
    expect(fieldOf(wh, "assume/baseMonth", "assumptions").get(wh).value).toBe("2026年10月・令和8年");
  });
});

// 型の確かめ（使わない import を残さない）
void ((r: EngineRequest) => r);
