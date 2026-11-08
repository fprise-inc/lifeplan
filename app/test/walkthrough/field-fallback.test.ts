// 空欄の既定の見張り（0164）: 箱でない値の欄（plain）が空欄のときに見せる既定の値（fallback）と、その値を世帯に直接書いた計算が同じか。
// 違うと、欄に見せている値で計算していないうえに、見せている値を打っても「省略」に戻るので、その値で計算させる方法が無い（建物附属設備の耐用年数で起きた）。
// モデル世帯と、各入力項目の「＋ 足す」のボタンで足した物の欄を見る。同じ形の欄は4件まで。CI の通しの入力のジョブで流す（FINANCIA_WALKTHROUGH=1）
import { describe, expect, it, vi } from "vitest";

/** 作った欄の元の指定（欄の鍵ごと。段階を組み立て直すたびに入れ直す） */
const specs = new Map<string, Record<string, unknown>>();
vi.mock("../../src/workspace/input/form.ts", async (orig) => {
  const m = (await orig()) as Record<string, unknown>;
  const plain = m.plain as (o: Record<string, unknown>) => object;
  return {
    ...m,
    plain: (o: Record<string, unknown>) => {
      if (o.fallback !== undefined) specs.set(o.key as string, o);
      return plain(o);
    },
  };
});

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { REPO_DIR } from "../../scripts/lib.ts";
import { forEngine } from "../../src/engine/moneyRows.ts";
import type { EngineRequest } from "../../src/engine/types.ts";
import { allFields, getPath, setPath } from "../../src/workspace/input/form.ts";
import { fromRequest, type WorkingHousehold } from "../../src/workspace/input/household.ts";
import { buildStage, STAGE_ORDER } from "../../src/workspace/input/stages/index.ts";
import { modelHousehold, preview } from "../helpers.ts";
import { WALKTHROUGH } from "./fieldEffect.ts";

/**
 * 食い違っても良い欄（形の末尾 → 理由）。どれも、見せている値を書く道が無いか、書いても同じ意味になる物
 */
const ALLOWED: readonly [RegExp, string][] = [
  [/\|fb=""$/, "選択肢の「指定しない」「（世帯の）」など。空の文字は書かず省略にする（書くと形が合わない）"],
  [/\/(cohabiting|dependent)\|/, "扶養・同居の欄は、書くときに支えの欄の物をまとめて作る（片方だけを書く道が無い）"],
  [/^savings:sav\/\*\/subtype\|/, "不動産・その他の資産の中身の「その他」は省略として書く（スキーマの選択肢に無い）"],
  [/^rental:sav\/\*\/property\/landShare\|.*fb="0\.\d{6}"$/, "内訳の土地の割合は、見せる値を小数6桁に丸める。打つと省略に戻り、計算は内訳から出した割合のまま"],
];

const IDS: readonly string[] = readdirSync(join(REPO_DIR, "data", "modelHouseholds"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""))
  .sort();
type Obj = Record<string, unknown>;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const sig = (req: EngineRequest): string => {
  try {
    return JSON.stringify(preview(forEngine(req)).table.map((c) => [c.row, c.year, c.member ?? "", c.amount]));
  } catch (e) {
    return `ERR ${String(e)}`;
  }
};

describe.skipIf(!WALKTHROUGH)("空欄の既定の値＝エンジンの省略のときの値（0164）", () => {
  it("見せている既定の値を直接書いても、計算は空欄のときと同じ", { timeout: 1_800_000 }, () => {
    const cases: { id: string; wh: WorkingHousehold; only?: string }[] = [];
    for (const id of IDS) {
      const wh = fromRequest(modelHousehold(id));
      cases.push({ id, wh });
      for (const s of STAGE_ORDER)
        for (const a of buildStage(s.id, wh).sections.flatMap((x) => [...x.actions, ...x.groups.flatMap((g) => g.actions)])) {
          if (a.danger === true) continue;
          try {
            cases.push({ id: `${id}+${a.key}`, wh: a.run(wh), only: s.id });
          } catch {
            // 押せないボタンは見ない
          }
        }
    }
    const seen = new Map<string, number>();
    const bad: string[] = [];
    for (const { id, wh, only } of cases) {
      let base: string | null = null;
      for (const s of STAGE_ORDER) {
        if (only !== undefined && s.id !== only) continue;
        specs.clear();
        for (const f of allFields(buildStage(s.id, wh))) {
          const o = specs.get(f.key) as { find: (h: unknown, w: unknown) => Obj | undefined; path: string[]; fallback: unknown } | undefined;
          if (o === undefined) continue;
          const target = o.find(wh.request.input.household, wh);
          if (target === undefined) continue;
          const raw = getPath(target, o.path);
          if (raw !== undefined && raw !== null) continue;
          const shape = `${s.id}:${f.key.replace(UUID, "*").replace(/\/\d+(?=\/|$)/g, "/#")}|${f.label}|fb=${JSON.stringify(o.fallback)}`;
          if (ALLOWED.some(([re]) => re.test(shape))) continue;
          if ((seen.get(shape) ?? 0) >= 4) continue;
          const req = structuredClone(wh.request);
          const t2 = o.find(req.input.household, { ...wh, request: req });
          if (t2 === undefined) continue;
          setPath(t2, o.path, o.fallback);
          base ??= sig(wh.request);
          if (base.startsWith("ERR")) break;
          seen.set(shape, (seen.get(shape) ?? 0) + 1);
          const after = sig(req);
          if (after !== base) bad.push(`${shape}（${id}${after.startsWith("ERR") ? `: ${after.slice(0, 100)}` : ""}）`);
        }
      }
    }
    expect(bad).toEqual([]);
    // 見た欄の形がある（掃引そのものが空回りしていない）
    expect(seen.size).toBeGreaterThan(150);
  });
});
