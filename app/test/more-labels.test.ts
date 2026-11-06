// 「▸ 続きを見る」の文を場所ごとに（0078 の 2026-11-01 の追記）: 開くと出る欄の代表を書く。種類で開く欄が違う所（退職金・企業年金・学校の段・
// 保険・口座・住まい）は種類ごとの文。文の無い所は「続きを見る」のまま。読み上げ用の名前は、見えている文に物の名前を添える
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { headsWithMore, MoreToggle, moreAriaLabel, type GroupOpenState } from "../src/workspace/input/FieldViews.tsx";
import { allFields, type ActionDef, type GroupDef, type StageId } from "../src/workspace/input/form.ts";
import { fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { InputPanel } from "../src/workspace/input/InputPanel.tsx";
import { KINDS } from "../src/workspace/input/insuranceKinds.ts";
import { buildStage, STAGE_ORDER } from "../src/workspace/input/stages/index.ts";
import { stageMoreLabel } from "../src/workspace/input/stages/education.ts";
import { insuranceMoreLabel } from "../src/workspace/input/stages/insurance.ts";
import { benefitMoreLabel } from "../src/workspace/input/stages/retirement.ts";
import { accountMoreLabel } from "../src/workspace/input/stages/savings.ts";
import { REPO_DIR } from "../scripts/lib.ts";
import { modelHousehold } from "./helpers.ts";

const noop = () => undefined;
const open = (m: string): WorkingHousehold => fromRequest(modelHousehold(m), {});
const panel = (wh: WorkingHousehold, card: string, keys: readonly string[] = []) => {
  const groupOpen: GroupOpenState = { isOpen: (k) => keys.includes(k), toggle: noop };
  return renderToString(h(InputPanel, { wh, itemId: card, level: "simple", onLevel: noop, onSave: noop, onClose: noop, groupOpen }));
};
/** 描いた画面の「▸ …」のボタン: まとまりのキー → 見えている文（折り返しの <wbr> は外す） */
const toggles = (html: string): Map<string, string> => {
  const out = new Map<string, string>();
  for (const m of html.matchAll(/<button[^>]*data-group-more="([^"]+)"[^>]*>(?:(?!<\/button>)[\s\S])*?<span class="grp-more-text">([\s\S]*?)<\/span><\/button>/g)) out.set(m[1]!, m[2]!.replace(/<wbr\/?>/g, ""));
  return out;
};
const groupsOf = (w: WorkingHousehold, stage: StageId): GroupDef[] => buildStage(stage, w).sections.flatMap((s) => s.groups);
/** ボタンの付くまとまり（貯蓄・運用の口座の区画は、表の行に口座の種類の文を出すので除く。SavingsPanel） */
const headsOf = (w: WorkingHousehold, stage: StageId): GroupDef[] =>
  buildStage(stage, w)
    .sections.filter((s) => s.key !== "sav/accounts")
    .flatMap((s) => s.groups.filter((g) => headsWithMore(s.groups).has(g.key)));
const STAGES: StageId[] = [...STAGE_ORDER.map((s) => s.id), "fee"];
const MODELS = readdirSync(join(REPO_DIR, "data", "modelHouseholds"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""));

describe("ボタンの部品", () => {
  it("文が無ければ「▸ 続きを見る」、あれば場所ごとの文。開くと「▾ 閉じる」", () => {
    const html = (text: string | undefined, isOpen: boolean) => renderToString(h(MoreToggle, { groupKey: "g", open: isOpen, toggle: noop, label: "配偶者", text }));
    expect(html(undefined, false)).toContain('<span class="grp-more-mark" aria-hidden="true">▸</span><span class="grp-more-text">続きを見る</span>');
    expect(html("呼び名・性別などを入れる", false)).toContain('<span class="grp-more-text">呼び名・<wbr/>性別などを入れる</span>');
    expect(html("呼び名・性別などを入れる", true)).toContain('<span class="grp-more-mark" aria-hidden="true">▾</span><span class="grp-more-text">閉じる</span>');
  });

  it("読み上げ用の名前は、見えている文に物の名前を添える（「○○を続きを見る」の形はやめた）", () => {
    expect(moreAriaLabel("呼び名・性別などを入れる", "配偶者", false)).toBe("呼び名・性別などを入れる（配偶者）");
    expect(moreAriaLabel("呼び名・性別などを入れる", "配偶者", true)).toBe("閉じる（配偶者）");
    expect(moreAriaLabel(undefined, "この欄", false)).toBe("続きを見る（この欄）");
    const html = renderToString(h(MoreToggle, { groupKey: "g", open: false, toggle: noop, label: "配偶者", text: "呼び名・性別などを入れる" }));
    expect(html).toContain('aria-label="呼び名・性別などを入れる（配偶者）"');
    expect(html).not.toContain("を続きを見る");
  });
});

describe("見本の世帯の「▸ …」はどれも場所ごとの文", () => {
  it("51件の見本の世帯の15の入力項目で、ボタンの付くまとまりには文がある（「続きを見る」のままの所が無い）", () => {
    const missing: string[] = [];
    for (const m of MODELS) {
      const wh = open(m);
      for (const st of STAGES) for (const g of headsOf(wh, st)) if (g.moreLabel === undefined) missing.push(`${m} ${st} ${g.title ?? g.key}`);
    }
    expect(missing).toEqual([]);
  });

  it("「＋」で足せる物も（見本の世帯に無い物。入るお金・出るお金の行、介護、贈与、カーリースなど）", () => {
    const missing: string[] = [];
    for (const m of ["salariedCoupleTwoKids", "dualAssetsTwoKids", "sampleSingle40s"]) {
      const base = open(m);
      for (const st of STAGES) {
        const adds = buildStage(st, base).sections.flatMap((s) => [...s.actions, ...s.groups.flatMap((g) => g.actions)]).filter((a: ActionDef) => a.label.startsWith("＋"));
        for (const a of adds) {
          const w = a.run(base);
          for (const g of headsOf(w, st)) if (g.moreLabel === undefined) missing.push(`${m} ${st} ${a.label} → ${g.title ?? g.key}`);
        }
      }
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it("描いた画面のボタンの文は、まとまりの文と同じ", () => {
    const wh = open("dualAssetsTwoKids");
    for (const st of ["family", "work", "pension", "retirement", "housing", "car", "rental"] as const) {
      const shown = toggles(panel(wh, st));
      const heads = headsOf(wh, st);
      expect(heads.length, st).toBeGreaterThan(0);
      for (const g of heads) expect(shown.get(g.key), `${st} ${g.key}`).toBe(g.moreLabel);
    }
  });
});

describe("種類で文が変わる所", () => {
  it("家族: ご本人（性別は標準で出ている）・配偶者・子（性別は出さない）で文を変える", () => {
    const wh = open("salariedCoupleTwoKids");
    const byKind = new Map(wh.request.input.household.members.map((m) => [m.id, m.kind]));
    const labels = new Map(headsOf(wh, "family").map((g) => [byKind.get(g.key.replace("family/", "")), g.moreLabel]));
    expect(labels.get("self")).toBe("呼び名・1日生まれを入れる");
    expect(labels.get("spouse")).toBe("呼び名・性別などを入れる");
    expect(labels.get("child")).toBe("呼び名・加わる時期を入れる");
  });

  it("退職金・企業年金: 種類ごと（確定給付企業年金は受け取り方でも）", () => {
    expect(benefitMoreLabel({ kind: "lumpSum" })).toBe("勤続期間・受け取る時期を入れる");
    expect(benefitMoreLabel({ kind: "officerAllowance" })).toBe("功績倍率・在任期間を入れる");
    expect(benefitMoreLabel({ kind: "db", receipt: { method: "annuity" } as never })).toBe("年金の受け取り方を入れる");
    expect(benefitMoreLabel({ kind: "db", receipt: { method: "lumpSum" } as never })).toBe("勤続期間・受け取る時期を入れる");
    expect(benefitMoreLabel({ kind: "nationalPensionFund" })).toBe("保証期間・支給の月を入れる");
    expect(benefitMoreLabel({ kind: "civilServantAllowance" })).toBe("退職の理由・勤続期間を入れる");
    expect(benefitMoreLabel({ kind: "civilServantPension" })).toBe("年金の受け取り方を入れる");
  });

  it("学校の段: 保育園・小〜高・高校のあとの学校（自宅外は仕送り）で文を変え、開くと文の欄が出る", () => {
    expect(stageMoreLabel({ stage: "nursery" })).toBe("保育料の水準などを入れる");
    for (const stage of ["kindergarten", "elementary", "juniorHigh", "highSchool", "kosen"]) expect(stageMoreLabel({ stage }), stage).toBe("入学金・在学年数などを入れる");
    expect(stageMoreLabel({ stage: "university", living: "away" })).toBe("初期費用・受験の費用などを入れる");
    expect(stageMoreLabel({ stage: "university", living: "home" })).toBe("系統・受験の費用などを入れる");
    expect(stageMoreLabel({ stage: "vocational", living: "home" })).toBe("入学金・受験の費用などを入れる");
    expect(stageMoreLabel({ stage: "graduateMaster", living: "away" })).toBe("初期費用・受験の費用などを入れる");
    // 見本の世帯（保育園から大学〔自宅外〕まで）で、描いた文と開いた欄
    const wh = open("lifetime100Plan");
    const stages = groupsOf(wh, "education").filter((g) => /\/stage\/\d+$/.test(g.key));
    const shown = toggles(panel(wh, "education"));
    const nursery = stages.find((g) => g.title?.startsWith("保育園（2歳まで）"))!;
    const university = stages.find((g) => g.title?.startsWith("大学"))!;
    const elementary = stages.find((g) => g.title?.startsWith("小学校"))!;
    expect(shown.get(nursery.key)).toBe("保育料の水準などを入れる");
    expect(shown.get(elementary.key)).toBe("入学金・在学年数などを入れる");
    expect(shown.get(university.key)).toBe("初期費用・受験の費用などを入れる");
    const detail = (g: GroupDef) => g.fields.filter((f) => f.level === "detail").map((f) => f.label);
    expect(detail(nursery)).toContain("保育料の水準（国の基準に対する割合）");
    expect(detail(elementary)).toEqual(expect.arrayContaining(["入学金", "在学年数"]));
    expect(detail(university)).toEqual(expect.arrayContaining(["自宅外の初期費用", "受験・併願の費用"]));
    // 自宅外の仕送り（月額）は、自宅外を選んだときだけ標準に出す
    expect(university.fields.find((f) => f.label === "自宅外の仕送り（月額）")!.level).toBe("simple");
  });

  it("保険: 種類ごと。損害保険は保障の明細が出ないので、契約の欄で書く", () => {
    expect(insuranceMoreLabel("nonLife")).toBe("契約者・契約年月などを入れる");
    expect(insuranceMoreLabel("medical")).toBe("手術・入院の限度日数などを入れる");
    expect(insuranceMoreLabel("incomeProtection")).toBe("最低保証の月数などを入れる");
    expect(insuranceMoreLabel("incapacity")).toBe("免責の月数などを入れる");
    expect(insuranceMoreLabel("education")).toBe("受取人・解約返戻率などを入れる");
    expect(insuranceMoreLabel("endowment")).toBe("受取人・解約返戻率などを入れる");
    expect(insuranceMoreLabel("privateAnnuity")).toBe("年金の年数・受取人などを入れる");
    expect(insuranceMoreLabel("wholeLife")).toBe("解約返戻率・保障の明細などを入れる");
    expect(insuranceMoreLabel("term")).toBe("契約者・保障の明細などを入れる");
    // 種類ごとに1件ずつ入れて、まとまりの文が種類の文になっていること。損害保険は保障の明細のまとまりが無い
    const base = mutate(open("salariedCoupleTwoKids"), (hh) => void (hh.insuranceContracts = []));
    const add = buildStage("insurance", base).sections[0]!.actions.find((a) => a.key === "ins/add")!;
    for (const k of KINDS) {
      const one = add.run(base);
      const kindField = allFields(buildStage("insurance", one)).find((f) => f.key.endsWith("/template"))!;
      const w = kindField.set(one, k.kind);
      const [head] = headsOf(w, "insurance");
      expect(head?.moreLabel, k.kind).toBe(insuranceMoreLabel(k.kind));
      const hasCoverage = groupsOf(w, "insurance").some((g) => g.title?.startsWith("保障 "));
      expect(hasCoverage, k.kind).toBe(k.kind !== "nonLife");
      if (!hasCoverage) expect(head?.moreLabel).not.toContain("保障の明細");
    }
  });

  it("住まい: 持ち家・賃貸・家賃なし・住宅の購入で文を変える", () => {
    const wh = open("dualAssetsTwoKids");
    const head = (w: WorkingHousehold) => headsOf(w, "housing").find((g) => g.key.startsWith("housing/res/"));
    expect(head(wh)?.moreLabel).toBe("評価額・固定資産税などを入れる");
    const kindField = allFields(buildStage("housing", wh)).find((f) => /^housing\/res\/[^/]+\/kind$/.test(f.key));
    expect(kindField).toBeDefined();
    const rent = kindField!.set(wh, "rent");
    expect(head(rent)?.moreLabel).toBe("更新料・家賃の変化を入れる");
    expect(toggles(panel(open("housingPurchase"), "housing")).size).toBeGreaterThan(0);
    const buying = headsOf(open("housingPurchase"), "housing").find((g) => g.title === "住宅の購入");
    expect(buying?.moreLabel).toBe("名義・固定資産税などを入れる");
  });
});

describe("貯蓄・運用の表の行", () => {
  it("口座の種類ごとの文（積立の終わりは積立がある口座だけ。外貨預金・小規模企業共済は残高の時点）", () => {
    expect(accountMoreLabel({ kind: "nisa" })).toBe("運用の費用・資産の配分を入れる");
    expect(accountMoreLabel({ kind: "ideco" })).toBe("運用の費用・資産の配分を入れる");
    expect(accountMoreLabel({ kind: "legacyNisa" })).toBe("買付の年・資産の配分を入れる");
    expect(accountMoreLabel({ kind: "juniorNisa" })).toBe("買付の年・資産の配分を入れる");
    expect(accountMoreLabel({ kind: "deposit" })).toBe("残高の時点・配分などを入れる");
    expect(accountMoreLabel({ kind: "deposit", contributions: [{ monthly: 10000 } as never] })).toBe("積立の終わり・配分などを入れる");
    expect(accountMoreLabel({ kind: "fxDeposit", contributions: [{ monthly: 10000 } as never] })).toBe("残高の時点・配分などを入れる");
    expect(accountMoreLabel({ kind: "smallBusinessMutualAid" })).toBe("残高の時点・配分などを入れる");
    expect(accountMoreLabel({ kind: "otherAsset" })).toBeUndefined();
  });

  it("表の行に、その口座の種類の文を出す（旧NISA を足した表も）", () => {
    const wh = open("dualAssetsTwoKids");
    const addLegacy = buildStage("savings", wh).sections.flatMap((s) => s.actions).find((a) => a.key === "sav/add/legacyNisa")!;
    const w = addLegacy.run(wh);
    const shown = toggles(panel(w, "savings"));
    const accounts = (w.request.input.household.accounts ?? []).filter((a) => shown.has(`sav/${a.id}`));
    expect(new Set(accounts.map((a) => a.kind))).toEqual(new Set(["deposit", "nisa", "ideco", "corporateDc", "taxable", "fxDeposit", "esop", "zaikei", "legacyNisa"]));
    for (const a of accounts) expect(shown.get(`sav/${a.id}`), a.kind).toBe(accountMoreLabel(a));
    expect(shown.get(`sav/${accounts.find((a) => a.kind === "zaikei")!.id}`)).toBe("積立の終わり・配分などを入れる");
    expect(shown.get(`sav/${accounts.find((a) => a.kind === "legacyNisa")!.id}`)).toBe("買付の年・資産の配分を入れる");
    expect(shown.get(`sav/${accounts.find((a) => a.kind === "fxDeposit")!.id}`)).toBe("残高の時点・配分などを入れる");
  });
});
