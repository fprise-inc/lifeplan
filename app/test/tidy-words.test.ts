// 入力画面の名前のかっこの見直し（0077 の追記）: 「＋」のボタン・欄の名前・選択肢・まとまりと区画の見出しのかっこには、説明の文を書かない。
// 要る説明はボタンの横（足した後の行）の「?」の中へ。単位や区別に要る短い言葉（月額・税込み・誰の物か）は残す
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { ActionHelp } from "../src/workspace/input/FieldViews.tsx";
import type { StageId } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { REPO_DIR } from "../scripts/lib.ts";
import { modelHousehold } from "./helpers.ts";

const STAGES: StageId[] = ["family", "work", "retirement", "pension", "living", "education", "housing", "insurance", "savings", "events", "car", "care", "inheritance", "fee", "assumptions"];

/** 見本の世帯と空の世帯の全部の項目の、名前の文字（「＋」を1回押した後の画面も） */
function names(): { kind: string; text: string; help?: string }[] {
  const out: { kind: string; text: string; help?: string }[] = [];
  const walk = (wh: WorkingHousehold, depth: number) => {
    for (const st of STAGES) {
      const s = buildStage(st, wh);
      for (const sec of s.sections) {
        out.push({ kind: "区画", text: sec.title });
        for (const a of [...sec.actions, ...sec.groups.flatMap((g) => g.actions)]) {
          out.push({ kind: "ボタン", text: a.label, ...(a.help !== undefined ? { help: a.help } : {}) });
          if (depth > 0 && a.label.startsWith("＋")) walk(a.run(wh), depth - 1);
        }
        for (const g of sec.groups) {
          if (g.title !== undefined) out.push({ kind: "まとまり", text: g.title });
          for (const f of g.fields) {
            out.push({ kind: "欄", text: f.label });
            if (f.kind === "select") for (const o of f.options) out.push({ kind: "選択肢", text: o.label });
          }
        }
      }
    }
  };
  let n = 0;
  walk(blankHousehold("2026-10", () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`), 1);
  for (const id of readdirSync(join(REPO_DIR, "data", "modelHouseholds")).filter((f) => f.endsWith(".json")).slice(0, 12)) walk(fromRequest(modelHousehold(id.replace(/\.json$/, ""))), 1);
  return out;
}

describe("入力画面の名前のかっこ", () => {
  const all = names();

  it("かっこの中に説明の文（「。」や「〜ます」）を書かない", () => {
    const bad = [...new Set(all.filter((x) => /（[^（）]*(。|ます)[^（）]*）/.test(x.text)).map((x) => `${x.kind}: ${x.text}`))];
    expect(bad).toEqual([]);
  });

  it("使う人が挙げた例は、かっこを外して説明を「?」へ移した", () => {
    const texts = new Set(all.map((x) => x.text));
    for (const old of ["＋ 教育訓練給付などの額（失業給付は働き方の期間で計算します）", "＋ その他の働く収入（給与。社会保険なし）"]) expect(texts.has(old), old).toBe(false);
    const edu = all.find((x) => x.text === "＋ 教育訓練給付など");
    expect(edu?.help).toContain("失業給付（基本手当）は、働き方の期間の辞め方から計算します");
    expect(all.find((x) => x.text === "＋ その他の働く収入")?.help).toContain("社会保険料はかけません");
    expect(texts.has("＋ 副業・雑所得")).toBe(true);
  });

  it("単位や区別に要る短い言葉は残す（月額・税込み・誰の物か）", () => {
    const texts = new Set(all.map((x) => x.text));
    expect(texts.has("年収（税込み・賞与込み）")).toBe(true);
    expect([...texts].some((t) => t.startsWith("通勤手当（非課税・月額）"))).toBe(true);
  });
});

describe("ボタンの横の「?」", () => {
  it("説明のあるボタンだけ、横に「?」を出す（名前は「＋」を除いた物）", () => {
    const html = renderToString(h(ActionHelp, { action: { key: "k", label: "＋ 教育訓練給付など", level: "simple", run: (w) => w, help: "失業給付は働き方の期間で計算します" } }));
    expect(html).toContain('aria-label="教育訓練給付などの説明"');
    expect(html).toContain("失業給付は働き方の期間で計算します");
    expect(renderToString(h(ActionHelp, { action: { key: "k", label: "＋ 留学", level: "simple", run: (w) => w } }))).toBe("");
  });
});
