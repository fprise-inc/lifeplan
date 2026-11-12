// AI接続口の計算のお知らせ（calculate の notices。0210）: 接続口に同梱する noticesOf（src/connector/notices.ts）が、画面の結果のタブの
// 「計算のお知らせ」（engineNotices.ts の noticeRows）と同じ行・同じ文・同じ種類の言葉・同じ入力項目の名前を返すこと。
// 接続口のテスト（crates/lifeplan/tests/mcp_connector.rs の calculate_notices_match_the_screen）は、ここで作る見本（画面の関数の答え）と、
// 本物の接続口が quickjs-ng で動かした答えを比較する。見本を作り直すときは LIFEPLAN_UPDATE_FIXTURES=1 で流す
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { KIND_SHORT, noticesOf } from "../src/connector/notices.ts";
import { summarize } from "../src/connector/summary.ts";
import { forEngine } from "../src/engine/moneyRows.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import { NOTICE_KINDS, noticeRows, noticeTextTable } from "../src/workspace/engineNotices.ts";
import { fromRequest } from "../src/workspace/input/household.ts";
import { STAGE_ORDER } from "../src/workspace/input/stageOrder.ts";
import { modelHousehold, preview } from "./helpers.ts";
import { applyPatch, type PatchOp } from "./patch.ts";

const REPO = join(import.meta.dirname, "..", "..");
const FIXTURE = join(REPO, "crates", "lifeplan", "tests", "fixtures", "notices", "expected.json");

/** 接続口のテストと同じ見本の問い（見本の世帯・変更）。changes は接続口の JSON Patch と同じ */
const CASES: { name: string; sample: string; changes?: PatchOp[] }[] = [
  { name: "会社員の夫婦子2人", sample: "salariedCoupleTwoKids" },
  { name: "親の介護（世帯の外の家族・介護の目安）", sample: "sampleParentsCare" },
  { name: "収益不動産", sample: "rentalSample" },
  { name: "家を買う", sample: "housingPurchase" },
];

/** 接続口と同じ要求（見本の世帯の input に変更を当てた物。計算の前の処理を当てる前） */
function caseRequest(c: (typeof CASES)[number]): EngineRequest {
  const input = applyPatch(modelHousehold(c.sample).input, c.changes ?? []);
  return { trace: "none", input } as EngineRequest;
}

describe("AI接続口の計算のお知らせ（0210）", () => {
  it("画面の結果のタブの知らせの行と同じ文・種類・対象・年・内訳で、入力項目は入力のホームの名前", () => {
    for (const c of CASES) {
      const req = caseRequest(c);
      const result = preview(forEngine(req));
      const screen = noticeRows(fromRequest(req), [{ label: "現状", result, request: req }]);
      const got = noticesOf(req, result);
      expect(got.length, c.name).toBe(screen.length);
      expect(got.length, c.name).toBeGreaterThan(0);
      screen.forEach((r, i) => {
        const g = got[i]!;
        expect(g.text, c.name).toBe(r.text);
        expect(g.kind, c.name).toBe(NOTICE_KINDS.find((k) => k.id === r.kind)?.short);
        expect(g.subjects ?? [], c.name).toEqual(r.subjects);
        expect(g.years ?? null, c.name).toBe(r.years);
        expect(g.parts ?? [], c.name).toEqual(r.parts);
        expect(g.item ?? null, c.name).toBe(r.card === null ? null : (STAGE_ORDER.find((s) => s.id === r.card)?.label ?? null));
      });
      // 世帯の物の ID は返さない
      expect(JSON.stringify(got), c.name).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    }
  });

  it("文は画面の文の表だけから来る（接続口に写した文は無い）", () => {
    const texts = new Set(noticeTextTable().map((t) => t.text));
    for (const c of CASES) {
      const req = caseRequest(c);
      for (const n of noticesOf(req, preview(forEngine(req)))) expect(texts.has(n.text ?? ""), `${c.name}: ${n.text}`).toBe(true);
    }
    expect(Object.values(KIND_SHORT)).toEqual(NOTICE_KINDS.map((k) => k.short));
  });

  it("brief は文と内訳を省き、種類と鍵を残す（同じ行の数）", () => {
    const req = caseRequest(CASES[0]!);
    const result = preview(forEngine(req));
    const full = noticesOf(req, result);
    const brief = noticesOf(req, result, true);
    expect(brief.length).toBe(full.length);
    for (const b of brief) {
      expect(b.text).toBeUndefined();
      expect(b.parts).toBeUndefined();
      expect(typeof b.key).toBe("string");
    }
    // 答えの大きさ（UTF-8 のバイト）は半分より小さい
    expect(Buffer.byteLength(JSON.stringify(brief))).toBeLessThan(Buffer.byteLength(JSON.stringify(full)) / 2);
  });

  it("summarize は、頼まれたときだけ知らせを足す（主な数字は変えない）", () => {
    const req = caseRequest(CASES[0]!);
    const res = JSON.stringify(preview(forEngine(req)));
    const plain = JSON.parse(summarize(res, JSON.stringify(req), "{}")) as Record<string, unknown>;
    const withN = JSON.parse(summarize(res, JSON.stringify(req), JSON.stringify({ notices: "full" }))) as Record<string, unknown>;
    expect(plain.notices).toBeUndefined();
    expect(withN.keyFigures).toEqual(plain.keyFigures);
    expect(withN.notices).toEqual(noticesOf(req, preview(forEngine(req))));
  });

  it("接続口のテストの見本（画面の関数の答え）が今の答えと同じ", () => {
    const expected = CASES.map((c) => {
      const req = caseRequest(c);
      const result = preview(forEngine(req));
      return { ...c, expected: { notices: noticesOf(req, result), brief: noticesOf(req, result, true) } };
    });
    const text = `${JSON.stringify(expected, null, 2)}\n`;
    if (process.env.LIFEPLAN_UPDATE_FIXTURES !== undefined) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, text);
    }
    expect(readFileSync(FIXTURE, "utf8"), "計算のお知らせの文か行が変わりました。LIFEPLAN_UPDATE_FIXTURES=1 で見本を作り直し、接続口のテスト（cargo test -p lifeplan）も流してください").toBe(text);
  });
});
