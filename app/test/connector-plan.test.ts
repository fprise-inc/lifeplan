// AI接続口のプランの動かす項目（0195）: 接続口に同梱する入口（src/connector/plan.ts）が、画面の結果のタブのプランと同じ関数で、
// プランの候補と同じ書き方（対象・入力項目ID・値）の変更を当て、画面でつまみを動かしたときと同じ計算の要求を作ること。
// 接続口のテスト（crates/lifeplan/tests/mcp_connector.rs の plan_changes_match_the_screen）は、ここで作る見本（変更と画面の数字・根拠）を、
// 本物の接続口に MCP で計算させて比べる。見本を作り直すときは LIFEPLAN_UPDATE_FIXTURES=1 で流す
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyPlan, listPlanItems } from "../src/connector/plan.ts";
import { forEngine } from "../src/engine/moneyRows.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import { candidateRows, itemName } from "../src/workspace/ai/model.ts";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { buildEvidence } from "../src/workspace/evidence.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { buildCatalog, type Catalog, type ItemValue } from "../src/workspace/plans/items.ts";
import { applyValues } from "../src/workspace/plans/plans.ts";
import { roles } from "../src/workspace/roles.ts";
import { full, modelHousehold, preview, screenTotals, screenYears } from "./helpers.ts";

const REPO = join(import.meta.dirname, "..", "..");
const FIXTURE = join(REPO, "crates", "lifeplan", "tests", "fixtures", "plan", "expected.json");
const ALLOWLIST = (JSON.parse(readFileSync(join(REPO, "crates", "ai-share", "data", "reduced-allowlist.json"), "utf8")) as { items: string[] }).items;

interface Listed {
  target: string;
  item: string;
  label: string;
  group: string;
  value: ItemValue;
  kind: string;
  min?: number;
  max?: number;
  proposable: boolean;
}
interface Row {
  target: string;
  item: string;
  label: string;
  status: "applied" | "same" | "rejected";
  reason?: string;
}

const list = (req: EngineRequest, args: Record<string, unknown>) => JSON.parse(listPlanItems(JSON.stringify(req), JSON.stringify(args), "null")) as { status: string; items: Listed[]; total: number; count: number };
const apply = (req: EngineRequest, changes: { target: string; item: string; value: unknown }[], sampleId?: string) =>
  JSON.parse(applyPlan(JSON.stringify(req), JSON.stringify(changes), JSON.stringify({ args: sampleId !== undefined ? { sampleId } : {}, office: null }))) as { status: string; request?: EngineRequest; changes: Row[] };

/** 画面と同じく見本の世帯を開いたときの作業中の世帯と動かす項目の一覧（App.tsx の見本を開く所: 見本の定年後の働き方・目盛り） */
function screen(id: string): { req: EngineRequest; wh: WorkingHousehold; cat: Catalog } {
  const req = modelHousehold(id);
  const self = roles(req).find((r) => r.key === "self")!.member.id;
  const demo = demoHousehold(id) ?? null;
  const re = demo?.reemployment;
  const wh = fromRequest(req, re !== undefined ? { postRetirement: { [self]: { ...re, type: re.type as "contract" } } } : {});
  return { req, wh, cat: buildCatalog(wh, self, demo) };
}

/** 画面でつまみを動かしたときの要求（結果のタブの動かした値 → applyValues）と、接続口に渡す同じ変更（一覧の対象・入力項目ID） */
function both(id: string, moves: Record<string, (now: ItemValue) => ItemValue>) {
  const s = screen(id);
  const listed = list(s.req, { sampleId: id, fields: true }).items;
  const values: Record<string, ItemValue> = {};
  const changes: { target: string; item: string; value: unknown }[] = [];
  for (const [key, f] of Object.entries(moves)) {
    // 物の ID の所は * で書く（例 loan:*:prepay）
    const re = new RegExp(`^${key.split("*").map((p) => p.replace(/[.:/]/g, "\\$&")).join("[^:]+")}$`);
    const it = s.cat.items.find((x) => re.test(x.key));
    expect(it, `${id} に ${key} がありません`).toBeDefined();
    const v = f(it!.read(s.wh));
    values[it!.key] = v;
    const l = listed.find((x) => x.label === it!.label && x.item === it!.item);
    expect(l, `${id} の一覧に ${it!.label} がありません`).toBeDefined();
    changes.push({ target: l!.target, item: l!.item, value: v });
  }
  return { s, changes, screenRequest: applyValues(s.wh, values, s.cat) };
}



/** 渡された世帯の定年後の働き方の条件（60歳で定年・再雇用で年収300万円） */
const SHARED_POST = { fromAge: 60, type: "contract" as const, annualSalary: 3000000 };

/** 見本に入れる変更（世帯・動かす項目のキー → 値の作り方） */
const CASES: { name: string; sample: string; moves: Record<string, (now: ItemValue) => ItemValue>; ask?: { row: string; year: number } }[] = [
  { name: "働く最後の年齢を63歳に", sample: "salariedCoupleTwoKids", moves: { "lever:retireAge": () => 63 }, ask: { row: "salary:self", year: 2043 } },
  { name: "年金の受け取りを68歳から・生活費を月28万円・NISA を月3万円", sample: "salariedCoupleTwoKids", moves: { "lever:pensionAge": () => 68, "lever:livingMonthly": () => 280000, "lever:nisaMonthly": () => 30000 } },
  {
    name: "配偶者を正社員の年収300万円に・繰上返済300万円・変動金利を2030年から1%上げる",
    sample: "salariedCoupleTwoKids",
    moves: { "spouse:*:work": () => ({ type: "regular", annual: 3000000 }), "loan:*:prepay": () => 3000000, "rates:shift": () => ({ add: "0.01", from: "2030-01" }) },
  },
  { name: "物価上昇率を1.5%に（入力の欄から作った項目）", sample: "sampleSelfEmployedFamily", moves: { "field:assume/inflation": () => "0.015" } },
  { name: "FP顧問料を入れない", sample: "advisoryFeeProposal", moves: { "lever:fee": () => false } },
  { name: "働く最後の年齢を65歳に（定年後の働き方のある見本）", sample: "reemployment", moves: { "lever:retireAge": () => 65 } },
];

describe("AI接続口のプランの動かす項目（0195）", () => {
  it("どの見本の世帯でも、一覧の項目をそのまま当てはめると同じ項目に当たり、入力項目は縮約版で AI に渡る項目", () => {
    const dir = join(REPO, "data", "modelHouseholds");
    const ids = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
    expect(ids.length).toBeGreaterThan(40);
    let levers = 0;
    for (const id of ids) {
      const req = modelHousehold(id);
      const got = list(req, { sampleId: id, fields: true });
      expect(got.status, id).toBe("ok");
      expect(got.count, id).toBe(got.total);
      for (const it of got.items) {
        expect(ALLOWLIST, `${id} ${it.label}`).toContain(it.item);
        // 今の値のまま当てると「今と同じ値」で、要求は変わらない
        if (it.value === null) continue;
        const r = apply(req, [{ target: it.target, item: it.item, value: it.value }], id);
        expect(r.status, `${id} ${it.label} ${JSON.stringify(r.changes)}`).toBe("ok");
        expect(r.changes[0]!.label, `${id}`).toBe(it.label);
        expect(r.changes[0]!.status, `${id} ${it.label}`).toBe("same");
        expect(r.request, `${id} ${it.label}`).toEqual(req);
      }
      // 既定の一覧は対策・資産運用・貯まり方・よく使う項目だけ
      const short = list(req, { sampleId: id });
      expect(short.items.every((x) => ["対策", "資産運用", "貯まり方", "よく使う"].includes(x.group)), id).toBe(true);
      levers += short.items.filter((x) => x.label.includes("働く最後の年齢")).length;
    }
    expect(levers).toBeGreaterThan(30);
  });

  it("画面でつまみを動かしたときと同じ計算の要求を作り、関係する欄も一緒に動く", () => {
    for (const c of CASES) {
      const { s, changes, screenRequest } = both(c.sample, c.moves);
      const got = apply(s.req, changes, c.sample);
      expect(got.status, `${c.name} ${JSON.stringify(got.changes)}`).toBe("ok");
      expect(got.changes.every((r) => r.status === "applied"), c.name).toBe(true);
      expect(got.request!.input, c.name).toEqual(screenRequest.input);
      expect(got.request!.trace).toBe(s.req.trace);
    }
    // 働く最後の年齢: 雇用の終わりだけでなく、生活費の退職の段階・積立の終わりも動く（欄を1つだけ動かす JSON Pointer の変更とは違う）
    const { s, changes } = both("salariedCoupleTwoKids", { "lever:retireAge": () => 63 });
    const out = apply(s.req, changes, "salariedCoupleTwoKids").request!.input.household;
    const before = s.req.input.household;
    const stage = (h: typeof before) => (h.livingExpenses ?? [])[0]!.stages!.map((x) => JSON.stringify(x.at));
    expect(stage(out)).not.toEqual(stage(before));
    expect(JSON.stringify(out.accounts)).not.toBe(JSON.stringify(before.accounts));
  });

  it("当てはまらない変更（対象・入力項目ID の違い・値の形・範囲の外）があれば、何も当てずに理由を返す", () => {
    const S = "salariedCoupleTwoKids";
    const req = modelHousehold(S);
    const items = list(req, { sampleId: S }).items;
    const retire = items.find((x) => x.label.includes("働く最後の年齢"))!;
    const ok = { target: retire.target, item: retire.item, value: 63 };
    for (const bad of [
      { target: retire.target, item: retire.item, value: 40 },
      { target: retire.target, item: retire.item, value: "六十三" },
      { target: "00000000-0000-4000-8000-000000000000", item: retire.item, value: 63 },
      { target: retire.target, item: "member.sex", value: "male" },
    ]) {
      const r = apply(req, [ok, bad], S);
      expect(r.status, JSON.stringify(bad)).toBe("rejected");
      expect(r.request).toBeUndefined();
      expect(r.changes[0]!.status).toBe("applied");
      expect(r.changes[1]!.status).toBe("rejected");
      expect(r.changes[1]!.reason).toBeTruthy();
    }
    // 本人のいない入力
    const none = { ...req, input: { ...req.input, household: { ...req.input.household, members: [] } } } as EngineRequest;
    expect(apply(none, [ok]).status).toBe("noSelf");
    expect(list(none, {}).status).toBe("noSelf");
    // 画面の部品が読めない形の入力
    for (const input of [{}, { household: "x" }]) {
      const bad = { trace: "none", input } as unknown as EngineRequest;
      expect(apply(bad, [ok]).status).toBe("badInput");
      expect(list(bad, {}).status).toBe("badInput");
    }
  });

  it("画面の「AIからの候補」も同じ当てはめ: 対策の固定の項目（働く最後の年齢など）に当たり、範囲の外の年齢は取り込まない", () => {
    const s = screen("salariedCoupleTwoKids");
    const self = roles(s.req).find((r) => r.key === "self")!.member.id;
    const rows = candidateRows(
      {
        diffs: [
          { id: "d1", target: { object: self }, item: "employment.to", value: 63, note: null },
          { id: "d2", target: { object: self }, item: "employment.to", value: 40, note: null },
          { id: "d3", target: { object: self }, item: "pensionRecord.claim", value: 70, note: null },
        ],
      },
      s.wh,
      s.cat,
    );
    expect(rows.map((r) => r.key)).toEqual(["lever:retireAge", null, "lever:pensionAge"]);
    expect(rows[1]!.reason).toContain("範囲");
  });

  it("渡された世帯の定年後の働き方の条件（縮約版）を、画面で保存した世帯を開いたときと同じくそのまま使う", () => {
    const S = "salariedCoupleTwoKids";
    const req = modelHousehold(S);
    const self = roles(req).find((r) => r.key === "self")!.member.id;
    // 画面: 保存した世帯を開くと、保存した条件をそのまま使う（store/body.ts の fromBody）
    const screenWh = { ...fromRequest(req), postRetirement: { [self]: SHARED_POST } };
    const cat = buildCatalog(screenWh, self, null);
    const screenReq = applyValues(screenWh, { "lever:retireAge": 65 }, cat);
    const withPost = (post: unknown) => JSON.parse(applyPlan(JSON.stringify(req), JSON.stringify([{ target: self, item: "employment.to", value: 65 }]), JSON.stringify({ args: { postRetirement: post }, office: null }))) as { status: string; request: EngineRequest };
    const got = withPost({ [self]: SHARED_POST });
    expect(got.status).toBe("ok");
    expect(got.request.input).toEqual(screenReq.input);
    // 条件が無い（{}）ときは、入力の働き方の期間から推し量らない（画面で条件の無い保存した世帯を開いたときと同じ）
    const none = withPost({});
    const screenNone = { ...fromRequest(req), postRetirement: {} };
    expect(none.request.input).toEqual(applyValues(screenNone, { "lever:retireAge": 65 }, buildCatalog(screenNone, self, null)).input);
    expect(none.request.input).not.toEqual(got.request.input);
    // 共有の画面・記録の「渡す項目」の名前
    expect(itemName("postRetirement")).toBe("定年後の働き方の条件");
    // 一覧の補足も同じ条件で書く
    const items = JSON.parse(listPlanItems(JSON.stringify(req), JSON.stringify({ postRetirement: { [self]: SHARED_POST } }), "null")) as { items: { label: string; note?: string }[] };
    expect(items.items.find((x) => x.label.includes("働く最後の年齢"))!.note).toContain("300万円");
  });

  it("接続口のテストの見本（変更と画面の数字・根拠）が今の答えと同じ", () => {
    const cases = CASES.map((c) => {
      const { changes, screenRequest } = both(c.sample, c.moves);
      const sent = forEngine(screenRequest);
      const r = preview(sent);
      const out: Record<string, unknown> = { name: c.name, sample: c.sample, changes, screen: { years: screenYears(r, screenRequest), totals: screenTotals(r, screenRequest) } };
      if (c.ask !== undefined) {
        // 画面の根拠のパネル: 根拠の記録「全部」で計算するのは前処理の後の要求、読み方に渡すのは前の要求（プランを当てた要求）
        const fullReq = { ...screenRequest, trace: "full" as const };
        const view = buildEvidence(full(forEngine(fullReq)), fullReq, c.ask.row, c.ask.year);
        expect(view, c.name).not.toBeNull();
        out.evidence = { ...c.ask, evidence: view };
      }
      return out;
    });
    // 渡された世帯の定年後の働き方の条件（接続口のテストは、この条件を持つ世帯を渡し、縮約版を通して計算させる）
    const S = "salariedCoupleTwoKids";
    const req = modelHousehold(S);
    const self = roles(req).find((r) => r.key === "self")!.member.id;
    const wh = { ...fromRequest(req), postRetirement: { [self]: SHARED_POST } };
    const sharedReq = applyValues(wh, { "lever:retireAge": 65 }, buildCatalog(wh, self, null));
    const sr = preview(forEngine(sharedReq));
    const shared = { sample: S, postRetirement: { [self]: SHARED_POST }, retireAge: 65, screen: { years: screenYears(sr, sharedReq), totals: screenTotals(sr, sharedReq) } };
    const text = `${JSON.stringify({ cases, shared }, null, 2)}\n`;
    if (process.env.LIFEPLAN_UPDATE_FIXTURES !== undefined) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, text);
    }
    expect(readFileSync(FIXTURE, "utf8"), "画面の数字か根拠が変わりました。LIFEPLAN_UPDATE_FIXTURES=1 で見本を作り直し、接続口のテスト（cargo test -p lifeplan）も流してください").toBe(text);
  });
});
