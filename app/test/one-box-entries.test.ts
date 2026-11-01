// 足した物1件 = 1つの枠（0077 の 2026-10-31 の追記）: 「＋」で1件足しても、その物の中のまとまり（課税の扱い・受け取る人・保障・金利の段階など）は
// 物の枠の中に見出しだけで描き、別の枠を重ねない
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { entryParts } from "../src/workspace/input/FieldViews.tsx";
import type { ActionDef, Level } from "../src/workspace/input/form.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { InputPanel } from "../src/workspace/input/InputPanel.tsx";
import { itemStage } from "../src/workspace/input/items.ts";
import { STAGE_ORDER } from "../src/workspace/input/stages/index.ts";
import { APP_DIR } from "../scripts/lib.ts";
import { modelHousehold } from "./helpers.ts";

const noop = () => undefined;
const allOpen = { isOpen: () => true, toggle: noop };
const panel = (wh: WorkingHousehold, item: string, level: Level) => renderToString(h(InputPanel, { wh, itemId: item, level, onLevel: noop, onSave: noop, onClose: noop, groupOpen: allOpen }));

/** 描いたまとまり（in-group）の並び: 外の枠か、ほかの物の枠（まとまり・貯蓄・運用の表の口座の行）の中か */
interface Box {
  key: string;
  sub: boolean;
  /** ほかの物の枠の中にあるか */
  inside: boolean;
}
function boxes(html: string): Box[] {
  const out: Box[] = [];
  const stack: boolean[] = [];
  let depth = 0;
  const re = /<(\/?)(div|tr)\b([^>]*)>/g;
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    if (m[1] === "/") {
      if (stack.pop() === true) depth--;
      continue;
    }
    const attrs = m[3] ?? "";
    const cls = /class="([^"]*)"/.exec(attrs)?.[1] ?? "";
    const box = m[2] === "div" && /(^| )in-group( |$)/.test(cls);
    // 口座の行の「▸ 詳しく」で開く行（sv-more-row）は、その口座の枠
    const frame = box || (m[2] === "tr" && /(^| )sv-more-row( |$)/.test(cls));
    if (box) out.push({ key: /data-group="([^"]*)"/.exec(attrs)?.[1] ?? "", sub: /(^| )in-sub( |$)/.test(cls), inside: depth > 0 });
    if (frame) depth++;
    stack.push(frame);
  }
  return out;
}
const outerCount = (html: string) => boxes(html).filter((b) => !b.inside).length;

function actionOf(wh: WorkingHousehold, item: string, label: string): ActionDef {
  const st = itemStage(wh, item);
  const a = st?.sections.flatMap((s) => [...s.actions, ...s.groups.flatMap((g) => g.actions)]).find((x) => x.label === label);
  if (a === undefined) throw new Error(`${item}: ${label} がありません`);
  return a;
}

describe("物1件の中のまとまり（entryParts）", () => {
  it("キーが直前の物のキー＋「/」で始まり、続いているまとまりだけを中に入れる", () => {
    const parts = entryParts([{ key: "in/a" }, { key: "in/a/tax" }, { key: "in/a/who" }, { key: "in/b" }, { key: "in/b/who" }, { key: "x/c" }, { key: "in/a/late" }]);
    expect(parts.get("in/a/tax")).toBe("in/a");
    expect(parts.get("in/a/who")).toBe("in/a");
    expect(parts.get("in/b/who")).toBe("in/b");
    expect(parts.has("in/a")).toBe(false);
    // 間に別の物が入った後は、前の物の枠に戻さない（並びの順番を変えない）
    expect(parts.has("in/a/late")).toBe(false);
  });
  it("入れ子もそのまま（中のまとまりの中のまとまり）", () => {
    const parts = entryParts([{ key: "r/1" }, { key: "r/1/buy" }, { key: "r/1/buy/gift" }, { key: "r/1/value" }]);
    expect(parts.get("r/1/buy")).toBe("r/1");
    expect(parts.get("r/1/buy/gift")).toBe("r/1/buy");
    expect(parts.get("r/1/value")).toBe("r/1");
  });
  it("キーの形が別でも partOf の物の中（直後に続けて並べたときだけ）", () => {
    const parts = entryParts([{ key: "family/s" }, { key: "family/relation/1", partOf: "family/s" }, { key: "family/relation/2", partOf: "family/s" }, { key: "family/c" }, { key: "family/relation/3", partOf: "family/s" }]);
    expect(parts.get("family/relation/1")).toBe("family/s");
    expect(parts.get("family/relation/2")).toBe("family/s");
    expect(parts.has("family/relation/3")).toBe(false);
  });
  it("自分の枠に描く物（ownBox）は中に入れず、続くまとまりも前の枠に戻さない", () => {
    const parts = entryParts([{ key: "e/1" }, { key: "e/1/stage/0", ownBox: true }, { key: "e/1/stage/0/x" }, { key: "e/1/out" }]);
    expect(parts.has("e/1/stage/0")).toBe(false);
    expect(parts.get("e/1/stage/0/x")).toBe("e/1/stage/0");
    expect(parts.has("e/1/out")).toBe(false);
  });
});

describe("「＋」で1件足すと、外の枠は1つだけ増える", () => {
  const wh = fromRequest(modelHousehold("salariedCoupleTwoKids"), {});
  // 入力項目・足すボタン・増える外の枠（物の中に足す物は 0）
  const cases: [string, string, number][] = [
    ["education", "＋ 教育資金の援助を受ける", 1],
    ["education", "＋ 留学", 1],
    ["family", "＋ 手当・給付金", 1],
    ["work", "＋ 副業・雑所得", 1],
    ["pension", "＋ 外国の年金", 1],
    ["living", "＋ 帰省", 1],
    ["housing", "＋ 住宅購入の予定", 1],
    ["housing", "＋ 持ち家（今住んでいる）", 1],
    ["housing", "＋ 金利の段階", 0],
    ["insurance", "＋ 医療保険", 1],
    ["insurance", "＋ 保障", 0],
    ["savings", "＋ NISA", 1],
    ["events", "＋ 結婚のお祝い", 1],
    ["events", "＋ 特別な旅行", 1],
    ["car", "＋ カーシェア・レンタカー", 1],
    ["care", "＋ 援助・仕送りを受ける", 1],
    ["inheritance", "＋ 相続・遺贈", 1],
    ["inheritance", "＋ あげる贈与", 1],
    ["assumptions", "＋ FP顧問料の契約", 1],
  ];
  for (const level of ["detail", "simple"] as const)
    for (const [item, label, n] of cases)
      it(`${level === "detail" ? "詳細" : "標準（詳しくを開いて）"}: ${item} の「${label}」`, () => {
        const before = panel(wh, item, level);
        const after = panel(actionOf(wh, item, label).run(wh), item, level);
        // 標準で出ない物（詳細だけの足すボタン）は増えない
        expect(outerCount(after) - outerCount(before)).toBe(level === "simple" && outerCount(after) === outerCount(before) ? 0 : n);
      });

  it("配偶者・パートナーを足すと外の枠は1つ。「夫婦の関係」は配偶者の枠の中", () => {
    const single = fromRequest(modelHousehold("single25"), {});
    for (const label of ["＋ 配偶者", "＋ パートナー（事実婚）"])
      for (const level of ["detail", "simple"] as const) {
        const after = actionOf(single, "family", label).run(single);
        expect(outerCount(panel(after, "family", level)) - outerCount(panel(single, "family", level))).toBe(1);
        const spouse = after.request.input.household.members.find((m) => m.kind === "spouse");
        const rel = boxes(panel(after, "family", "detail")).filter((b) => b.key.startsWith("family/relation/"));
        expect(rel.length).toBeGreaterThan(0);
        for (const b of rel) expect(b).toMatchObject({ inside: true, sub: true });
        expect(panel(after, "family", "detail")).toMatch(new RegExp(`data-group="family/${spouse?.id ?? ""}"[\\s\\S]*?<h4>夫婦の関係`));
      }
  });

  it("収益不動産の「申告」は物件の枠の外で、持ち主ごとの欄だと見出しで分かる", () => {
    const html = panel(actionOf(wh, "rental", "＋ 物件を足す").run(wh), "rental", "detail");
    const tax = boxes(html).find((b) => b.key.startsWith("rental/taxReturn/"));
    expect(tax).toMatchObject({ inside: false, sub: false });
    expect(html).toContain("<h4>申告（ご本人）: 持ち主ごと・その人の物件をまとめて");
  });

  it("収益不動産の物件1件: 土地と建物・家賃収入・経費・売却は物件の枠の中", () => {
    const html = panel(actionOf(wh, "rental", "＋ 物件を足す").run(wh), "rental", "detail");
    const bs = boxes(html);
    const head = bs.find((b) => /^sav\/[^/]+$/.test(b.key) && !b.inside);
    expect(head).toBeDefined();
    for (const part of ["building", "rental", "expenses", "sale"]) {
      const b = bs.find((x) => x.key === `${head?.key ?? ""}/property/${part}`);
      expect(b?.inside).toBe(true);
      expect(b?.sub).toBe(true);
    }
  });
});

describe("どの入力項目でも、まとまりの中のまとまりは枠を付けない（in-sub）", () => {
  for (const m of ["salariedCoupleTwoKids", "parentMoney", "sampleSelfEmployedFamily"]) {
    // 足せる物をひととおり足した世帯
    let wh = fromRequest(modelHousehold(m), {});
    for (const s of STAGE_ORDER) {
      const st = itemStage(wh, s.id);
      for (const a of st?.sections.flatMap((x) => [...x.actions, ...x.groups.flatMap((g) => g.actions)]) ?? []) if (a.label.startsWith("＋") && a.danger !== true) wh = a.run(wh);
    }
    for (const s of STAGE_ORDER)
      for (const level of ["detail", "simple"] as const)
        it(`${m}: ${s.label}（${level === "detail" ? "詳細" : "標準"}）`, () => {
          const bs = boxes(panel(wh, s.id, level));
          expect(bs.filter((b) => b.inside && !b.sub).map((b) => b.key)).toEqual([]);
          // 外の枠に in-sub を付けない（枠が消えて、どの物か分からなくなる）
          expect(bs.filter((b) => !b.inside && b.sub && b.key !== "").map((b) => b.key)).toEqual([]);
        });
  }
});

describe("中のまとまりの見た目（app.css）", () => {
  const css = readFileSync(join(APP_DIR, "src", "styles", "app.css"), "utf8");
  it("中のまとまりは枠と地の色を付けず、上の薄い区切りの線だけ", () => {
    const rule = /\.in-group \.in-group, \.in-group\.in-sub \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toContain("border: 0");
    expect(rule).toContain("border-top: 1px dashed");
    expect(rule).toContain("background: transparent");
  });
});
