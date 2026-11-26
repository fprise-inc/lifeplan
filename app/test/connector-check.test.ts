// AI接続口の入力の確かめ（check_inputs。0210）: 接続口に同梱する checkInputs（src/connector/check.ts）が、画面の入力のタブの確かめの一覧
// （input/checkRows.ts の checkList）と同じ行・同じ並びを返し、行ごとに「お客さまに聞くこと」の案を添えること。決まりの表（RULES）の
// 決まりが、当たるはずの世帯で当たること。接続口のテスト（crates/lifeplan/tests/mcp_connector.rs の check_inputs_match_the_screen）は、
// ここで作る見本（画面の関数の答え）と、本物の接続口が quickjs-ng で動かした答えを比較する。見本を作り直すときは LIFEPLAN_UPDATE_FIXTURES=1 で流す
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkInputs, DEFAULT_MAX, firstSentence, NOT_STARTED_QUESTIONS, premiseWithClient, RULES, type CheckItem } from "../src/connector/check.ts";
import { screenNoticeRows } from "../src/connector/notices.ts";
import { workingOf } from "../src/connector/working.ts";
import { forEngine } from "../src/engine/moneyRows.ts";
import type { EngineRequest, PreviewResult } from "../src/engine/types.ts";
import { CHECK_KIND_LABELS, checkList, DEFAULT_KINDS, ZERO_DOWN_PAYMENT_TEXT } from "../src/workspace/input/checkRows.ts";
import { STAGE_ORDER } from "../src/workspace/input/stageOrder.ts";
import { assumptionsStage } from "../src/workspace/input/stages/assumptions.ts";
import { modelHousehold, preview } from "./helpers.ts";
import { applyPatch, type PatchOp } from "./patch.ts";

const REPO = join(import.meta.dirname, "..", "..");
const FIXTURE = join(REPO, "crates", "lifeplan", "tests", "fixtures", "check", "expected.json");

/** 接続口のテストと同じ見本の問い（見本の世帯・変更・選び方）と、当たるはずの決まり */
const CASES: { name: string; sample: string; changes?: PatchOp[]; kinds?: string[]; max?: number; rules: string[] }[] = [
  { name: "会社員の夫婦子2人（今のまま）", sample: "salariedCoupleTwoKids", rules: ["notStarted", "adultCare"] },
  { name: "子がいるのに教育の進路が無い", sample: "salariedCoupleTwoKids", changes: [{ op: "replace", path: "/household/goals", value: [] }], rules: ["educationPlan"] },
  { name: "年金の加入記録が無い", sample: "salariedCoupleTwoKids", changes: [{ op: "replace", path: "/household/pensionRecords", value: [] }], rules: ["pensionRecord"] },
  {
    name: "家を買うのに頭金と住宅ローンが無い",
    sample: "housingPurchase",
    changes: [
      { op: "replace", path: "/household/residences/1/purchase/downPayment", value: 0 },
      { op: "replace", path: "/household/debts", value: [] },
    ],
    rules: ["downPayment", "unfundedPurchase"],
  },
  {
    name: "範囲の外の値（物価上昇率）",
    sample: "salariedCoupleTwoKids",
    changes: [{ op: "replace", path: "/assumptions/inflation", value: { default: "0.2" } }],
    rules: ["outOfRange"],
  },
  { name: "親の介護（推定・介護の目安・計算のお知らせ）", sample: "sampleParentsCare", rules: ["pensionRecord", "careDefault"] },
  { name: "推定だけ・3行まで", sample: "sampleParentsCare", kinds: ["estimated"], max: 3, rules: [] },
  { name: "前提条件（お客さまと確かめる前提と、FP が決める前提）", sample: "salariedCoupleTwoKids", kinds: ["premise"], max: 60, rules: [] },
];

interface Answer {
  status: string;
  total: number;
  counts: Record<string, number>;
  groups: { kind: string; items: CheckItem[] }[];
  truncated: boolean;
}

function caseRequest(c: (typeof CASES)[number]): EngineRequest {
  return { trace: "none", input: applyPatch(modelHousehold(c.sample).input, c.changes ?? []) } as EngineRequest;
}

/** 接続口と同じ問い（計算した結果を渡す。見本の世帯の ID を添える） */
function ask(c: (typeof CASES)[number]): { req: EngineRequest; result: PreviewResult; got: Answer } {
  const req = caseRequest(c);
  const result = preview(forEngine(req));
  const args = { sampleId: c.sample, ...(c.kinds !== undefined ? { kinds: c.kinds } : {}), ...(c.max !== undefined ? { max: c.max } : {}) };
  const got = JSON.parse(checkInputs(JSON.stringify(req), JSON.stringify(result), JSON.stringify({ args, office: null }))) as Answer;
  return { req, result, got };
}

const items = (a: Answer): CheckItem[] => a.groups.flatMap((g) => g.items);

describe("AI接続口の入力の確かめ（0210）", () => {
  it("画面の確かめの一覧と同じ行・同じ並び（種類・入力項目・欄・今の値）", () => {
    for (const c of CASES.filter((x) => x.kinds === undefined)) {
      const { req, result, got } = ask(c);
      expect(got.status, c.name).toBe("ok");
      const w = workingOf(req, { sampleId: c.sample });
      const screen = checkList(w!.wh, screenNoticeRows(req, result)).filter((r) => DEFAULT_KINDS.includes(r.kind));
      const flat = got.groups.flatMap((g) => g.items.map((i) => ({ kind: g.kind, ...i })));
      // 接続口は行を足さない（画面の一覧の行だけ）
      expect(flat.map((i) => [i.kind, i.item, i.field, i.value ?? null]), c.name).toEqual(screen.slice(0, DEFAULT_MAX).map((r) => [CHECK_KIND_LABELS[r.kind], r.cardLabel, r.label, r.value ?? null]));
      expect(got.total, c.name).toBe(Object.values(got.counts).reduce((a, n) => a + n, 0));
    }
  });

  it("当たるはずの決まりが当たる（子の教育・頭金・購入の払い方・年金の加入記録・範囲の外の値・介護の目安）", () => {
    for (const c of CASES) {
      const { got } = ask(c);
      const hit = new Set(items(got).map((i) => i.rule));
      for (const r of c.rules) expect(hit.has(r), `${c.name}: ${r} が当たりません（${[...hit].join("・")}）`).toBe(true);
    }
    // 決まりの名前は重ならない。まだ入れていない項目の文は、入力のホームの入力項目ごと
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
    for (const k of Object.keys(NOT_STARTED_QUESTIONS)) expect(STAGE_ORDER.some((s) => s.id === k), k).toBe(true);
  });

  it("どの行にも理由と丁寧な聞く文があり、物の ID を返さない", () => {
    for (const c of CASES) {
      const { got } = ask(c);
      expect(items(got).length, c.name).toBeGreaterThan(0);
      for (const i of items(got)) {
        expect(i.reason.length, `${c.name}: ${i.field}`).toBeGreaterThan(0);
        expect(i.question, `${c.name}: ${i.field}`).toMatch(/(ますか|ですか|でしょうか)[。（].*$|(ますか|ですか)。$/);
        expect(i.question, `${c.name}: ${i.field}`).not.toMatch(/比べ/);
      }
      expect(JSON.stringify(got), c.name).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    }
  });

  it("子の教育・年金の加入記録の聞く文には、その人の呼び名が入る", () => {
    const edu = items(ask(CASES[1]!).got).filter((i) => i.rule === "educationPlan");
    expect(edu.map((i) => i.question.slice(0, 3))).toEqual(["第1子", "第2子"]);
    const pen = items(ask(CASES[2]!).got).find((i) => i.rule === "pensionRecord");
    expect(pen?.subjects).toEqual(["ご本人", "配偶者"]);
    expect(pen?.question.startsWith("ご本人・配偶者の")).toBe(true);
  });

  it("種類と行の数で絞れる（超えた分は truncated と counts で分かる）", () => {
    const c = CASES.find((x) => x.kinds?.includes("estimated") === true)!;
    const { got } = ask(c);
    expect(got.groups.map((g) => g.kind)).toEqual([CHECK_KIND_LABELS.estimated]);
    expect(items(got).length).toBe(3);
    expect(got.truncated).toBe(true);
    expect(got.counts[CHECK_KIND_LABELS.estimated]).toBeGreaterThan(3);
  });

  it("画面の確かめの一覧: これから買う家の頭金が0円なら確かめの注意に出す（もう買った家・頭金のある家には出さない）", () => {
    const rowsOf = (changes: PatchOp[]) => {
      const req = caseRequest({ name: "", sample: "housingPurchase", changes, rules: [] });
      return checkList(workingOf(req, { sampleId: "housingPurchase" })!.wh).filter((r) => r.id.startsWith("notice:zeroDownPayment:"));
    };
    const zero = rowsOf([{ op: "replace", path: "/household/residences/1/purchase/downPayment", value: 0 }]);
    expect(zero.map((r) => [r.kind, r.cardLabel, r.label, r.value, r.detail, r.fieldKey?.endsWith("/purchase/down")])).toEqual([["notice", "住まい・ローン", "住宅の購入: 頭金", "0円", ZERO_DOWN_PAYMENT_TEXT, true]]);
    // 頭金のある家・もう買った家（買う月が計算基準月より前）には出ない
    expect(rowsOf([])).toEqual([]);
    expect(rowsOf([{ op: "replace", path: "/household/residences/1/purchase/downPayment", value: 0 }, { op: "replace", path: "/household/residences/1/from", value: { at: "2020-04" } }])).toEqual([]);
    // 接続口の入力の確かめは同じ行に聞く文を添える
    const got = items(ask(CASES[3]!).got).filter((i) => i.field === "住宅の購入: 頭金");
    expect(got.map((i) => i.rule)).toEqual(["downPayment"]);
  });

  it("前提条件の行は、画面の標準に出す欄がお客さまと確かめる側、詳細だけの欄が FP が決める側（0260）", () => {
    const c = CASES.find((x) => x.kinds?.includes("premise") === true)!;
    const { req, got } = ask(c);
    const rows = items(got);
    expect(got.truncated).toBe(false);
    // どの前提条件の行にも印がある（事務所の既定値に従っている欄。この世帯だけの値は行に出ない）
    expect(rows.length).toBeGreaterThan(4);
    expect(rows.every((i) => i.premise === "client" || i.premise === "fp")).toBe(true);
    // お客さまと確かめる側は、画面の標準に出す前提の欄（物価の上昇率・給与の上昇率・表を何歳まで見るか。運用の利回りは画面から外した）
    const w = workingOf(req, { sampleId: c.sample })!.wh;
    const simple = assumptionsStage(w)
      .sections.filter((x) => x.level === "simple")
      .flatMap((x) => x.groups.filter((g) => g.level === "simple").flatMap((g) => g.fields.filter((f) => f.level === "simple").map((f) => ({ x, g, f }))));
    const simpleLabels = simple.map(({ x, g, f }) => `${g.where ?? g.title ?? x.title}: ${f.label}`);
    expect(simpleLabels).toEqual(expect.arrayContaining(["計算の期間: 表を何歳まで見るか", "経済の前提: 物価の上昇率", "経済の前提: 給与の上昇率"]));
    const client = rows.filter((i) => i.premise === "client").map((i) => i.field);
    // 事務所の既定値どおりの前提条件の行に出るのは2つの率（表を何歳まで見るかは、画面の確かめの一覧でも前提条件の行にしない）
    expect(client).toEqual(["経済の前提: 物価の上昇率", "経済の前提: 給与の上昇率"]);
    expect(client.every((f) => simpleLabels.includes(f))).toBe(true);
    // 見分けは欄の入れ方で決める（表を何歳まで見るかの欄も、行になれば確かめる側。詳細だけの欄は FP の側）
    const endYear = simple.find(({ f }) => f.label === "表を何歳まで見るか")!.f;
    const asRow = (level: "simple" | "detail") => ({ id: `field:${endYear.key}`, kind: "premise" as const, card: "assumptions", cardLabel: "前提条件", label: "", detail: null, fieldKey: endYear.key, level, impact: 0, actions: [] });
    expect(premiseWithClient(asRow("simple"))).toBe(true);
    expect(premiseWithClient(asRow("detail"))).toBe(false);
    expect(premiseWithClient({ ...asRow("simple"), card: "savings" })).toBe(false);
    for (const i of rows.filter((x) => x.premise === "client")) expect(i.question, i.field).toMatch(/この見込みでよろしいですか（お客さまと確かめる前提です。事務所の既定値）。$/);
    // ほかの前提条件（預金の利回り・年金の調整率・不動産の評価・資産の種類ごとの利回りなど）は、今までどおり FP が決める側
    const fp = rows.filter((i) => i.premise === "fp");
    expect(fp.length).toBeGreaterThan(0);
    expect(fp.some((i) => i.field === "経済の前提: 預金の利回り")).toBe(true);
    expect(fp.every((i) => !client.includes(i.field))).toBe(true);
    for (const i of fp) expect(i.question, i.field).toMatch(/は、事務所の既定値のままでよろしいですか（FP が決める前提です）。$/);
    // 運用の利回りは画面に出さないので、事務所の既定値どおりなら行にもならない
    expect(rows.some((i) => i.field.includes("運用の利回り") || i.field.includes("配分も利回りも入れていない"))).toBe(false);
    // 前提条件の行でない行には印を付けない
    expect(items(ask(CASES[0]!).got).every((i) => i.premise === undefined)).toBe(true);
  });

  it("お客さまと確かめる前提でも、この世帯だけの値にした欄は前提条件の行に出ない。ほかの率は事務所の既定値に従ったまま確かめる側", () => {
    const own = { name: "", sample: "salariedCoupleTwoKids", changes: [{ op: "replace" as const, path: "/assumptions/inflation", value: { default: "0.017" } }], kinds: ["premise"], max: 60, rules: [] };
    const rows = items(ask(own).got);
    const client = rows.filter((i) => i.premise === "client").map((i) => i.field);
    expect(client.some((f) => f.endsWith(": 物価の上昇率"))).toBe(false);
    expect(client).toEqual(["経済の前提: 給与の上昇率"]);
  });

  it("短い理由は、かっこの中の「。」では切らない", () => {
    expect(firstSentence("未入力（保障の額を入れてください。0円で計算しています）。次の文")).toBe("未入力（保障の額を入れてください。0円で計算しています）");
    expect(firstSentence(null)).toBeNull();
    expect(firstSentence("文だけ")).toBe("文だけ");
  });

  it("本人がいない・読めない形の入力は、行を作らずに理由の符号を返す", () => {
    const req = caseRequest(CASES[0]!);
    const noSelf = { ...req, input: { ...req.input, household: { ...req.input.household, members: req.input.household.members.filter((m) => m.kind !== "self") } } };
    expect(JSON.parse(checkInputs(JSON.stringify(noSelf), "null", "{}")).status).toBe("noSelf");
  });

  it("接続口のテストの見本（画面の関数の答え）が今の答えと同じ", () => {
    const expected = CASES.map((c) => ({ ...c, expected: ask(c).got }));
    const text = `${JSON.stringify(expected, null, 2)}\n`;
    if (process.env.LIFEPLAN_UPDATE_FIXTURES !== undefined) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, text);
    }
    expect(readFileSync(FIXTURE, "utf8"), "入力の確かめの行か聞く文が変わりました。LIFEPLAN_UPDATE_FIXTURES=1 で見本を作り直し、接続口のテスト（cargo test -p lifeplan）も流してください").toBe(text);
  });
});
