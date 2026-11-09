// AI接続口の「数字の根拠」（explain_value。0183）: 接続口に同梱する読み方（src/connector/explain.ts）が、画面の根拠のパネル（buildEvidence）と同じ中身を返すこと。
// 接続口のテスト（crates/lifeplan/tests/mcp_connector.rs の explain_value_matches_the_screen）は、ここで作る見本（画面の関数の答え）と、
// 接続口が quickjs-ng で動かした答えを1文字ずつ比べる。見本を作り直すときは LIFEPLAN_UPDATE_FIXTURES=1 で流す
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { explain } from "../src/connector/explain.ts";
import type { EngineRequest, FullResult } from "../src/engine/types.ts";
import { buildEvidence } from "../src/workspace/evidence.ts";
import { displayYears, rowDefs } from "../src/workspace/present.ts";
import { full, modelHousehold, preview } from "./helpers.ts";

const REPO = join(import.meta.dirname, "..", "..");
const FIXTURE = join(REPO, "crates", "lifeplan", "tests", "fixtures", "explain-value", "expected.json");

/** 接続口と同じ形の要求（見本の世帯の input に変更を当てた物。trace は full） */
function request(id: string, changes: { path: string[]; value: unknown }[] = []): EngineRequest {
  const req = structuredClone(modelHousehold(id));
  for (const c of changes) {
    let o = req.input as unknown as Record<string, unknown>;
    for (const k of c.path.slice(0, -1)) o = o[k] as Record<string, unknown>;
    o[c.path[c.path.length - 1]!] = c.value;
  }
  return { trace: "full", input: req.input } as EngineRequest;
}

function ask(out: FullResult, req: EngineRequest, args: object): Record<string, unknown> {
  return JSON.parse(explain(JSON.stringify(out), JSON.stringify(req), JSON.stringify(args))) as Record<string, unknown>;
}

/** 接続口のテストと同じ見本の問い（見本の世帯・変更・行・年）。changes は接続口の JSON Patch の replace と同じ場所 */
const CASES: { name: string; sample: string; changes?: { op: "replace"; path: string; value: unknown }[]; row: string; year: number; member?: string; depth?: number; maxParams?: number }[] = [
  { name: "年金", sample: "salariedCoupleTwoKids", row: "pension:self", year: 2047 },
  { name: "税・社会保険料", sample: "salariedCoupleTwoKids", row: "taxSi", year: 2030 },
  { name: "教育費", sample: "salariedCoupleTwoKids", row: "education", year: 2035 },
  { name: "金融資産", sample: "salariedCoupleTwoKids", row: "financial", year: 2040 },
  { name: "給付・手当", sample: "salariedCoupleTwoKids", row: "benefit", year: 2027 },
  { name: "住居費", sample: "housingPurchase", row: "housing", year: 2030 },
  { name: "iDeCo の一時金（行ID で選ぶ）", sample: "idecoPayout", row: "cf.income.lumpSum.ideco", year: 2038 },
  { name: "プラン（物価の想定を変える）", sample: "salariedCoupleTwoKids", changes: [{ op: "replace", path: "/assumptions/inflation", value: { default: "0.02" } }], row: "living", year: 2040 },
  { name: "直接使った値だけ", sample: "salariedCoupleTwoKids", row: "taxSi", year: 2030, depth: 0, maxParams: 5 },
];

function caseRequest(c: (typeof CASES)[number]): EngineRequest {
  return request(
    c.sample,
    (c.changes ?? []).map((x) => ({ path: x.path.slice(1).split("/"), value: x.value })),
  );
}

describe("AI接続口の数字の根拠（0183）", () => {
  it("どの行・どの年でも、画面の根拠のパネルと同じ中身を返す（モデル世帯のいくつか）", () => {
    for (const id of ["salariedCoupleTwoKids", "housingPurchase", "idecoPayout", "rentalSample", "sampleSelfEmployedFamily", "protectionNeed"]) {
      const req = request(id);
      const out = full(req);
      const years = displayYears(req);
      const pick = [years[0]!, years[Math.floor(years.length / 3)]!, years[Math.floor((years.length * 2) / 3)]!];
      let ok = 0;
      for (const d of rowDefs(req).filter((x) => x.evidence))
        for (const y of pick) {
          const screen = buildEvidence(out, req, d.key, y);
          const got = ask(out, req, { row: d.key, year: y });
          if (screen === null) expect(got.status, `${id} ${d.key} ${y}`).toBe("noValue");
          else {
            expect(got.status, `${id} ${d.key} ${y}`).toBe("ok");
            expect(got.evidence, `${id} ${d.key} ${y}`).toEqual(screen);
            ok++;
          }
        }
      expect(ok, id).toBeGreaterThan(5);
    }
  });

  it("合計は表のマスの合計と同じ。制度の値ID は params と同じ並びで、世帯の物の ID は返さない", () => {
    const req = request("salariedCoupleTwoKids");
    const got = ask(full(req), req, { row: "taxSi", year: 2030 }) as { evidence: { total: number; params: unknown[]; formulas: string[] }; ids: { regulation: string[]; formulas: string[] } };
    const cell = preview(req)
      .table.filter((c) => c.row.startsWith("cf.taxSi") && c.year === 2030)
      .reduce((s, c) => s + c.amount, 0);
    expect(got.evidence.total).toBe(cell);
    expect(got.ids.regulation.length).toBe(got.evidence.params.length);
    expect(got.ids.formulas.length).toBe(got.evidence.formulas.length);
    const text = JSON.stringify(got);
    for (const m of req.input.household.members) expect(text).not.toContain(m.id);
  });

  it("行ID（cf.）と人で選べる・行の一覧・知らない年・合計の行", () => {
    const req = request("salariedCoupleTwoKids");
    const out = full(req);
    const self = req.input.household.members[0]!;
    const byId = ask(out, req, { row: "cf.income.pension", member: self.id, year: 2047 });
    expect(byId.row).toMatchObject({ key: "pension:self" });
    expect(byId.evidence).toEqual(buildEvidence(out, req, "pension:self", 2047));
    const list = ask(out, req, {}) as { status: string; rows: { key: string }[] };
    expect(list.status).toBe("chooseRow");
    expect(list.rows.map((r) => r.key)).toContain("taxSi");
    expect(list.rows.map((r) => r.key)).not.toContain("incomeTotal");
    expect(ask(out, req, { row: "taxSi", year: 1999 }).status).toBe("chooseYear");
    expect(ask(out, req, { row: "incomeTotal", year: 2030 }).status).toBe("totalRow");
    expect(ask(out, req, { row: "nope", year: 2030 })).toMatchObject({ status: "chooseRow", unknownRow: "nope" });
  });

  it("接続口のテストの見本（画面の関数の答え）が今の答えと同じ", () => {
    const expected = CASES.map((c) => {
      const req = caseRequest(c);
      const got = ask(full(req), req, { row: c.row, year: c.year, ...(c.member !== undefined ? { member: c.member } : {}), ...(c.depth !== undefined ? { depth: c.depth } : {}), ...(c.maxParams !== undefined ? { maxParams: c.maxParams } : {}) });
      expect(got.status, c.name).toBe("ok");
      if (c.depth === undefined && c.maxParams === undefined) expect(got.evidence, c.name).toEqual(buildEvidence(full(req), req, (got.row as { key: string }).key, c.year));
      return { ...c, expected: { row: got.row, evidence: got.evidence, ids: got.ids } };
    });
    const text = `${JSON.stringify(expected, null, 2)}\n`;
    if (process.env.LIFEPLAN_UPDATE_FIXTURES !== undefined) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, text);
    }
    expect(readFileSync(FIXTURE, "utf8"), "根拠の中身が変わりました。LIFEPLAN_UPDATE_FIXTURES=1 で見本を作り直し、接続口のテスト（cargo test -p lifeplan）も流してください").toBe(text);
  });
});
