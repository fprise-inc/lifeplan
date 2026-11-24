// 口座の名前（accounts[].label。金融機関名・用途など。表示だけで計算には使わない。形式 0.81。0223）:
// 欄の書き方（整える・空と空白だけは名前なし・長さ・番号らしき数字）、名前が出る所（口座の表・まとまりの見出し・取り崩す順番・決済口座・
// 年間収支の取り崩しの行・利回りの段階・資産運用の配分の項目）、計算の結果が変わらないこと、持ち帰り用のレポート、前回との違い、
// 入れ方（合計・口座ごと）、世帯ファイルの読み書き（0.81 の見本と前の版）
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { REPO_DIR } from "../scripts/lib.ts";
import type { Account, EngineRequest } from "../src/engine/types.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { ACCOUNT_LABEL_MAX, accountLabelCloses, accountLabelOf, accountLabelProblem, cleanAccountLabel, withAccountLabel } from "../src/workspace/input/labels.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { SavingsPanel } from "../src/workspace/input/savings/SavingsPanel.tsx";
import { accountName, switchMethod, withdrawViewOf } from "../src/workspace/input/savings/model.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { cashflowTable, displayYears } from "../src/workspace/present.ts";
import { inputChanges } from "../src/workspace/tools/fpTools.ts";
import { IdMap, sanitizeRequest } from "../src/workspace/takeaway/sanitize.ts";
import { bodyObject, fromBody } from "../src/workspace/store/body.ts";
import { checkList } from "../src/workspace/input/checkRows.ts";
import { modelHousehold, preview } from "./helpers.ts";

const MODEL_IDS = [
  "advisoryFeeProposal", "civilServant", "deferral", "dualAssetsTwoKids", "dualHighTwoKids", "dualNoKids", "educationTwoKids", "elderCare", "executiveOwner", "highIncome",
  "housingGiftFromParents", "housingPurchase", "idecoPayout", "incapacityDisability", "insuranceMaturityAnnuity", "investmentCouple", "jobLeaver", "lifetime100", "lifetime100Assets",
  "lifetime100Plan", "marketDropAtRetirement", "nisaWithdrawal", "pairLoan", "pairLoanDeath", "parentCare", "parentMoney", "parentalLeave", "partTimeExpansion", "partTimeSpouse",
  "pensionCouple", "protectionNeed", "reemployment", "rentalSample", "retirementSequence", "salariedCoupleTwoKids", "sampleCoupleNoKids", "sampleExecutive", "sampleFamilyDreams",
  "sampleOwnerCompany", "sampleParentsCare", "sampleSelfEmployedFamily", "sampleSeniorCouple", "sampleSeniorRental", "sampleSingle20s", "sampleSingle40s", "sampleSingleParent", "selfEmployed", "single25",
];
const FIXTURES = join(REPO_DIR, "crates", "household-store", "tests", "fixtures", "household-format");

const open = (id = "investmentCouple"): WorkingHousehold => fromRequest(modelHousehold(id));
const fieldsOf = (wh: WorkingHousehold): Map<string, FieldDef> => new Map(allFields(buildStage("savings", wh)).map((f) => [f.key, f]));
const labelField = (wh: WorkingHousehold, id: string): FieldDef => {
  const f = fieldsOf(wh).get(`sav/${id}/label`);
  if (f === undefined) throw new Error(`名前の欄が無い: ${id}`);
  return f;
};
const accountsOf = (wh: WorkingHousehold): Account[] => (wh.request.input.household.accounts ?? []) as Account[];
const accOf = (wh: WorkingHousehold, id: string): Account => accountsOf(wh).find((a) => a.id === id)!;
const financial = (wh: WorkingHousehold): Account[] => accountsOf(wh).filter((a) => !["realEstate", "otherAsset", "pooled"].includes(a.kind));
/** 名前を付ける（欄の書き方で） */
const named = (wh: WorkingHousehold, id: string, v: string | null): WorkingHousehold => (labelField(wh, id).write ?? labelField(wh, id).set)(wh, v);
/** 要求の口座のすべてに名前を付けた写し（計算の結果が変わらないことの確かめ） */
function labelAll(req: EngineRequest): EngineRequest {
  const copy = structuredClone(req);
  (copy.input.household.accounts ?? []).forEach((a, i) => ((a as { label?: string }).label = `架空の銀行${i + 1}`));
  return copy;
}

describe("名前の整え方と確かめ（0223）", () => {
  it("前後の空白を除き、続く空白・改行・タブを1つの空白にする。空・空白だけ・全角の空白だけは名前なし", () => {
    expect(cleanAccountLabel("  架空の銀行\t 普通\n口座  ")).toBe("架空の銀行 普通 口座");
    expect(cleanAccountLabel("　　")).toBe("");
    expect(accountLabelOf({ label: "   " })).toBeNull();
    expect(accountLabelOf({ label: "" })).toBeNull();
    expect(accountLabelOf({})).toBeNull();
    expect(accountLabelOf({ label: " 架空の銀行 " })).toBe("架空の銀行");
  });

  it("40文字まで（絵文字も1文字）。41文字・口座番号らしき数字（7桁以上・見出しの後）は理由を返す", () => {
    expect(accountLabelProblem("あ".repeat(ACCOUNT_LABEL_MAX))).toBeNull();
    expect(accountLabelProblem("😀".repeat(ACCOUNT_LABEL_MAX))).toBeNull();
    expect(accountLabelProblem("あ".repeat(ACCOUNT_LABEL_MAX + 1))).toContain("40文字までです（今は41文字）");
    expect(accountLabelProblem("架空の銀行 1234567")).toContain("口座番号");
    expect(accountLabelProblem("架空の銀行 口座番号 1234")).toContain("口座番号");
    expect(accountLabelProblem("教育資金用（2030年まで）")).toBeNull();
  });

  it("呼び名: 名前があれば「名前（種類・名義）」、無ければ今までの「種類（名義）」", () => {
    expect(withAccountLabel({ label: "架空のみどり証券" }, "NISA", "ご本人")).toBe("架空のみどり証券（NISA・ご本人）");
    expect(withAccountLabel({}, "NISA", "ご本人")).toBe("NISA（ご本人）");
    expect(withAccountLabel({ label: "  " }, "NISA", "ご本人")).toBe("NISA（ご本人）");
  });
});

describe("名前の欄（0223）", () => {
  it("金融資産の口座ごとに1つ（種類の次）。詳細の欄で、空欄は名前なし。合計の器・その他の資産には無い", () => {
    const wh = open();
    const keys = [...fieldsOf(wh).keys()];
    for (const a of financial(wh)) {
      const own = keys.filter((k) => k.startsWith(`sav/${a.id}/`));
      expect(own.slice(0, 2)).toEqual([`sav/${a.id}/kind`, `sav/${a.id}/label`]);
      const f = labelField(wh, a.id);
      expect(f).toMatchObject({ item: "account.label", kind: "text", level: "detail", optional: true });
      expect(f.get(wh).value).toBeNull();
      expect(f.help).toContain("氏名・口座番号は入れません");
    }
    for (const a of accountsOf(wh).filter((x) => ["realEstate", "otherAsset", "pooled"].includes(x.kind))) expect(keys).not.toContain(`sav/${a.id}/label`);
  });

  it("書くと整えて書き、空・空白だけで外す（欄を書き足さない）。書けない名前は世帯を変えない", () => {
    const wh = open();
    const a = financial(wh)[0]!;
    const w1 = named(wh, a.id, "  架空のさくら銀行　 普通  ");
    expect(accOf(w1, a.id).label).toBe("架空のさくら銀行 普通");
    expect(labelField(w1, a.id).get(w1).value).toBe("架空のさくら銀行 普通");
    // 同じ名前は世帯を変えない
    expect(named(w1, a.id, "架空のさくら銀行 普通")).toBe(w1);
    const w2 = named(w1, a.id, "   ");
    expect("label" in accOf(w2, a.id)).toBe(false);
    expect("label" in accOf(named(w1, a.id, null), a.id)).toBe(false);
    // 長すぎる・番号らしき数字: 欄の refuse が理由を返し、書かない
    const long = "あ".repeat(41);
    expect(labelField(w1, a.id).refuse?.(w1, long)).toContain("40文字まで");
    expect(named(w1, a.id, long)).toBe(w1);
    expect(named(w1, a.id, "架空の銀行 1234567")).toBe(w1);
    expect(accOf(w1, a.id).label).toBe("架空のさくら銀行 普通");
  });

  it("名前の無い口座を、確かめの一覧（未入力・推定）に数えない。名前を付けても確かめの一覧の行の数は同じ", () => {
    const wh = open();
    const rows0 = checkList(wh);
    expect(rows0.some((r) => JSON.stringify(r).includes("/label"))).toBe(false);
    const w1 = named(wh, financial(wh)[0]!.id, "架空のさくら銀行");
    expect(checkList(w1).length).toBe(rows0.length);
  });

  it("口座の表: 名前の無い口座は「名前を付ける」の小さなリンクだけ（欄を出さない）。名前のある口座は欄に名前、リンクは出さない", () => {
    const wh = open();
    const [a, b] = financial(wh) as [Account, Account];
    const html = renderToString(h(SavingsPanel, { wh, level: "simple", onEdit: () => undefined }));
    expect(html).not.toContain("data-account-label=");
    expect(html.match(/data-account-label-open=/g)?.length).toBe(financial(wh).length);
    const w1 = named(wh, a.id, "架空のさくら銀行");
    const html1 = renderToString(h(SavingsPanel, { wh: w1, level: "simple", onEdit: () => undefined }));
    expect(html1).toContain(`data-account-label="${a.id}"`);
    expect(html1).toContain('value="架空のさくら銀行"');
    expect(html1).not.toContain(`data-account-label-open="${a.id}"`);
    expect(html1).toContain(`data-account-label-open="${b.id}"`);
    // 詳細の「口座ごとの詳細」には名前の欄を重ねて出さない（表で入れる）
    const detail = renderToString(h(SavingsPanel, { wh: w1, level: "detail", onEdit: () => undefined }));
    expect(detail.match(/架空のさくら銀行/g)?.length).toBeGreaterThanOrEqual(2);
    expect(detail).not.toContain(`id="${`sav/${a.id}/label`}"`);
  });
});

describe("名前の欄の「キャンセル」と、何も入れずに離れたとき（0223 の追記 2026-11-24）", () => {
  it("キャンセル（Esc も同じ）: 保存した名前が無ければ欄を閉じて「名前を付ける」に戻す。名前があれば欄は閉じない（保存した名前に戻す）", () => {
    expect(accountLabelCloses("", null)).toBe(true);
    // 空白だけの名前（前の版・取り込みから）も名前なしと同じ
    expect(accountLabelCloses("  ", null)).toBe(true);
    expect(accountLabelCloses("架空のさくら銀行", null)).toBe(false);
  });

  it("離れたとき: 何も入れていない（空・空白・改行だけ）なら閉じる。名前があった口座を空にしたときも閉じる（名前を外す）。何か入れたら閉じない", () => {
    for (const t of ["", " ", "　", "\n\t "]) {
      expect(accountLabelCloses("", t)).toBe(true);
      expect(accountLabelCloses("架空のさくら銀行", t)).toBe(true);
    }
    expect(accountLabelCloses("", "架空のさくら銀行")).toBe(false);
    expect(accountLabelCloses("架空のさくら銀行", "架空のさくら銀行")).toBe(false);
    expect(accountLabelCloses("架空のさくら銀行", "架空のもみじ銀行")).toBe(false);
    // 書けない名前（番号らしき数字・長すぎる）は閉じない（理由を欄の下に出したまま、前の名前のまま）
    expect(accountLabelCloses("", "架空の銀行 1234567")).toBe(false);
    expect(accountLabelCloses("", "あ".repeat(ACCOUNT_LABEL_MAX + 1))).toBe(false);
  });

  it("口座の表: 名前のある口座は、打っていない間は「キャンセル」を出さない（名前の無い口座は欄を開くまで欄も「キャンセル」も無い）", () => {
    const wh = open();
    const [a, b] = financial(wh) as [Account, Account];
    const html = renderToString(h(SavingsPanel, { wh, level: "simple", onEdit: () => undefined }));
    expect(html).not.toContain("data-account-label-cancel=");
    const w1 = named(wh, a.id, "架空のさくら銀行");
    const html1 = renderToString(h(SavingsPanel, { wh: w1, level: "detail", onEdit: () => undefined }));
    expect(html1).toContain(`data-account-label="${a.id}"`);
    expect(html1).not.toContain(`data-account-label-cancel="${a.id}"`);
    expect(html1).not.toContain(`data-account-label-cancel="${b.id}"`);
  });

  it("「キャンセル」の言葉と置き場所: 欄の右に控えめのリンクで置き、押しても欄から離れない（離れると打ちかけが決まる）", () => {
    const src = readFileSync(join(REPO_DIR, "app", "src", "workspace", "input", "savings", "SavingsPanel.tsx"), "utf-8");
    const body = src.slice(src.indexOf("function AccountLabel("), src.indexOf("function AccountsTable("));
    expect(body).toMatch(/class="link-btn sv-lbl-cancel"/);
    expect(body).toMatch(/>\s*キャンセル\s*</);
    expect(body).not.toMatch(/>\s*やめる\s*</);
    expect(body).toMatch(/onMouseDown=\{\(e\) => e\.preventDefault\(\)\}/);
    // 欄とキャンセルは同じ行（.sv-lbl-row）。キャンセルは欄の後ろ（右）
    expect(body.indexOf('class="sv-lbl-row"')).toBeLessThan(body.indexOf("<input"));
    expect(body.indexOf("<input")).toBeLessThan(body.indexOf("sv-lbl-cancel"));
  });
});

describe("名前が出る所（0223）", () => {
  it("まとまりの見出し・取り崩す順番・決済口座の選択肢・利回りの段階・資産運用の配分の項目に名前。無ければ今までどおり", () => {
    const wh = open();
    const [dep, inv] = [financial(wh).find((a) => a.kind === "deposit")!, financial(wh).find((a) => a.kind !== "deposit")!];
    const groups0 = buildStage("savings", wh).sections.flatMap((s) => s.groups);
    const title0 = groups0.find((g) => g.key === `sav/${inv.id}`)!.title!;
    expect(title0).toMatch(/^[^（]+（[^・）]+）$/);
    const w1 = named(named(wh, inv.id, "架空のみどり証券"), dep.id, "架空のさくら銀行");
    const groups = buildStage("savings", w1).sections.flatMap((s) => s.groups);
    expect(groups.find((g) => g.key === `sav/${inv.id}`)!.title).toBe(`架空のみどり証券（${title0.slice(0, title0.indexOf("（"))}・${title0.slice(title0.indexOf("（") + 1, -1)}）`);
    // 取り崩す順番（accountName）
    const owner = (a: Account) => (a.owner === w1.request.input.household.members.find((m) => m.kind === "self")!.id ? "ご本人" : "x");
    expect(accountName(accOf(w1, inv.id), owner(inv))).toMatch(/^架空のみどり証券（.+・.+）$/);
    const view = withdrawViewOf(w1.request);
    expect([...view.included, ...view.excluded].some((a) => a.id === inv.id)).toBe(true);
    // 資産運用の配分の項目（結果の対策）
    const cat = buildCatalog(w1, w1.request.input.household.members.find((m) => m.kind === "self")!.id, null);
    const mix = cat.items.find((x) => x.key === `mix:${inv.id}`);
    if (mix !== undefined) expect(mix.label).toContain("架空のみどり証券・");
    // 名前の無い口座の見出しは変わらない
    const other = financial(wh).filter((a) => a.id !== inv.id && a.id !== dep.id)[0];
    if (other !== undefined) expect(groups.find((g) => g.key === `sav/${other.id}`)!.title).toBe(groups0.find((g) => g.key === `sav/${other.id}`)!.title);
  });

  it("決済口座の選択肢: 同じ呼び名の預金が2つ以上のときだけ番号。名前を付ければ名前で見分ける", () => {
    let wh = open("salariedCoupleTwoKids");
    const self = wh.request.input.household.members.find((m) => m.kind === "self")!.id;
    wh = mutate(wh, (hh) => {
      hh.accounts = [
        ...(hh.accounts ?? []).filter((a) => a.kind !== "deposit"),
        { id: "00000000-0000-4000-8000-00000000d001", kind: "deposit", owner: self, marketValue: { value: 1000000, state: "confirmed", origin: { kind: "manual" } }, asOf: wh.request.input.baseMonth, contributions: [] },
        { id: "00000000-0000-4000-8000-00000000d002", kind: "deposit", owner: self, marketValue: { value: 2000000, state: "confirmed", origin: { kind: "manual" } }, asOf: wh.request.input.baseMonth, contributions: [] },
      ];
    });
    const opts = (w: WorkingHousehold) => {
      const f = fieldsOf(w).get("sav/settlement");
      return f?.kind === "select" ? f.options.map((o) => o.label) : [];
    };
    expect(opts(wh)).toEqual(["預金（ご本人） 1", "預金（ご本人） 2"]);
    const w1 = named(wh, "00000000-0000-4000-8000-00000000d002", "架空のさくら銀行");
    expect(opts(w1)).toEqual(["預金（ご本人）", "架空のさくら銀行（預金・ご本人）"]);
  });

  it("年間収支の取り崩しの行（子の行）: 「うち 名前（ご本人のNISA）から払った分」。名前が無ければ今までどおり", () => {
    const req = modelHousehold("nisaWithdrawal");
    const years = displayYears(req);
    const kids = (r: EngineRequest) => {
      const t = cashflowTable(r, preview(r).table, years, "表");
      const net = t.rows.find((x) => x.key === "net")!;
      return net.kind === "total" ? (net.children ?? []).map((k) => k.label) : [];
    };
    const before = kids(req);
    const nisa = (req.input.household.accounts ?? []).find((a) => a.kind === "nisa")!;
    const labelled = structuredClone(req);
    ((labelled.input.household.accounts ?? []).find((a) => a.id === nisa.id) as { label?: string }).label = "架空のみどり証券";
    const after = kids(labelled);
    expect(after.length).toBe(before.length);
    const row = before.find((l) => l.includes("のNISAから"))!;
    expect(after).toContain(row.replace(/^うち (.+)から払った分/, "うち 架空のみどり証券（$1）から払った分"));
    // 空白だけの名前は名前なしと同じ
    ((labelled.input.household.accounts ?? []).find((a) => a.id === nisa.id) as { label?: string }).label = "   ";
    expect(kids(labelled)).toEqual(before);
  });
});

describe("計算の結果は変わらない（0223）", () => {
  it.each(MODEL_IDS)("%s: すべての口座に名前を付けても、表・要約・お知らせが同じ", (id) => {
    const req = modelHousehold(id);
    const a = preview(req);
    const b = preview(labelAll(req));
    expect(b.table).toEqual(a.table);
    expect(b.summary).toEqual(a.summary);
    expect((b as { notices?: unknown }).notices).toEqual((a as { notices?: unknown }).notices);
  });

  it("入れ方を合計にして口座ごとに戻しても、名前は残る。合計の入れ方の計算も名前で変わらない", () => {
    const wh = open();
    const a = financial(wh)[0]!;
    const w1 = named(wh, a.id, "架空のさくら銀行");
    const total = switchMethod(w1, "total");
    expect(accOf(total, a.id)?.label).toBe("架空のさくら銀行");
    const unnamed = switchMethod(wh, "total");
    // 合計の器の ID は切り替えるたびに新しく振るので、ID を除いて比較する
    const amounts = (r: EngineRequest) => preview(r).table.map((c) => ({ ...c, object: undefined }));
    expect(amounts(total.request)).toEqual(amounts(unnamed.request));
    const back = switchMethod(total, "accounts");
    expect(accOf(back, a.id).label).toBe("架空のさくら銀行");
  });
});

describe("持ち帰り用のレポート・前回との違い・世帯ファイル（0223）", () => {
  it("持ち帰り用のレポートの計算の要求に名前を残す（お客さまが自分の口座を見分ける名前）", () => {
    const req = labelAll(modelHousehold("investmentCouple"));
    const out = JSON.stringify(sanitizeRequest(req, new IdMap()));
    expect(out).toContain("架空の銀行1");
  });

  it("前回（控え）との違い: 名前だけ変えると、その口座の「名前」の1行（なし → 名前）。計算の結果の違いは無い", () => {
    const wh = open();
    const a = financial(wh)[0]!;
    const w1 = named(wh, a.id, "架空のさくら銀行");
    const rows = inputChanges(wh.request, w1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ card: "savings", before: "なし", after: "架空のさくら銀行" });
    expect(rows[0]!.label).toMatch(/^架空のさくら銀行（.+）: 名前$/);
    // 名前を変えた・外した
    const w2 = named(w1, a.id, "架空のみどり銀行");
    expect(inputChanges(w1.request, w2).map((r) => [r.before, r.after])).toEqual([["架空のさくら銀行", "架空のみどり銀行"]]);
    expect(inputChanges(w1.request, named(w1, a.id, "")).map((r) => [r.before, r.after])).toEqual([["架空のさくら銀行", "なし"]]);
    expect(preview(w1.request).table).toEqual(preview(wh.request).table);
  });

  it("0.81 の見本の世帯ファイルは名前を読み、書き戻しても同じ。0.80 の見本は名前なし（今までの見え方）", () => {
    const b81 = fromBody(readFileSync(join(FIXTURES, "0.81", "body.json"), "utf8"));
    const labels = accountsOf(b81.wh).map((a) => accountLabelOf(a)).filter((x) => x !== null);
    expect(labels).toEqual(["架空のさくら銀行（給与振込）", "架空のみどり証券", "架空のみどり証券"]);
    const again = fromBody(JSON.stringify(bodyObject(b81)));
    expect(accountsOf(again.wh).map((a) => a.label ?? null)).toEqual(accountsOf(b81.wh).map((a) => a.label ?? null));
    const b80 = fromBody(readFileSync(join(FIXTURES, "0.80", "body.json"), "utf8"));
    expect(accountsOf(b80.wh).every((a) => !("label" in a))).toBe(true);
    // 同じ世帯で、名前のほかは同じ口座。計算の結果も同じ
    expect(accountsOf(b81.wh).map((a) => ({ ...a, label: undefined }))).toEqual(accountsOf(b80.wh).map((a) => ({ ...a, label: undefined })));
    expect(preview(b81.wh.request).table).toEqual(preview(b80.wh.request).table);
  });

  it("見本の世帯（モデル世帯）には名前が無く、口座の見出しは今までの「種類（名義）」", () => {
    for (const id of MODEL_IDS) {
      const wh = open(id);
      expect(accountsOf(wh).every((a) => a.label === undefined), id).toBe(true);
      const groups = buildStage("savings", wh).sections.flatMap((s) => s.groups);
      for (const a of financial(wh)) expect(groups.find((g) => g.key === `sav/${a.id}`)?.title, id).toMatch(/^[^（]+（[^・）]+）$/);
    }
  });
});
