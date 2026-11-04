// 入力のホームの手直し（0077）: 説明は「?」の中・プランを選んでも配置が動かない・全部のカードの入れ方の一括の切り替えを外す・
// カードは4列の大きさ・入れ方の言葉は「標準／詳細」・専用の絵
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { Help, HELP_CLOSED, helpNext, helpOpen, type HelpEvent, type HelpState } from "../src/presentation/Help.tsx";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { ILLUSTRATIONS } from "../src/workspace/input/illustrations.ts";
import { InputPanel } from "../src/workspace/input/InputPanel.tsx";
import { InputView } from "../src/workspace/input/InputView.tsx";
import type { PlanEditProps } from "../src/workspace/input/PlanEdit.tsx";
import { addCar } from "../src/workspace/input/stages/cars.ts";
import { buildCatalog, type Catalog } from "../src/workspace/plans/items.ts";
import { planView, recordPlanEdit } from "../src/workspace/plans/planEdit.ts";
import type { Proposal } from "../src/workspace/plans/plans.ts";
import { roles } from "../src/workspace/roles.ts";
import { APP_DIR } from "../scripts/lib.ts";
import { modelHousehold } from "./helpers.ts";

const CSS = readFileSync(join(APP_DIR, "src", "styles", "app.css"), "utf8") + readFileSync(join(APP_DIR, "src", "styles", "wire.css"), "utf8");
const noop = () => undefined;
const plan = (id: string): Proposal => ({ id, name: `プラン${id}`, createdAt: "2026-10-26T00:00:00Z", updatedAt: "2026-10-26T00:00:00Z", base: null, tags: [], diffs: [] });

/** 見本の世帯とプランB。withDiff ならプランB に1か所の差分（車を足す）を入れる（カードに「プランB: 1か所」が出る） */
function setup(withDiff = true): { wh: WorkingHousehold; cat: Catalog } {
  const req = modelHousehold("salariedCoupleTwoKids");
  const self = roles(req).find((r) => r.key === "self")!.member;
  const wh0 = { ...fromRequest(req, {}), proposals: [plan("B")] };
  const cat = buildCatalog(wh0, self.id, null);
  if (!withDiff) return { wh: wh0, cat };
  const v0 = planView(wh0, cat, "B");
  return { wh: recordPlanEdit(wh0, cat, "B", v0, addCar(v0)), cat };
}

function plansProps(cat: Catalog, sel: string | null): PlanEditProps {
  return { list: [{ id: "B", label: "プランB", name: "プランB 65歳まで働く", color: "#0072c6" }], sel, onSelect: noop, onNew: noop, onCopy: noop, cat, onSavePlan: noop, lock: null, onResults: noop };
}

/** 色だけを変える状態の class（配置は変えない。下の CSS の確かめで、色だけであることを見る） */
const STATE_CLASSES = new Set(["on", "sel", "off"]);

/**
 * 配置の骨組み（要素の名前と class の並び）。文字・属性の値は見ない。配置に関わらない物（読み上げだけの文・絵に重ねた札・選んだ状態の class）は除く
 */
function skeleton(html: string): string[] {
  const out: string[] = [];
  let skip = 0;
  for (const m of html.matchAll(/<(\/?)([a-z0-9]+)([^>]*)>/g)) {
    const close = m[1] === "/";
    const tag = m[2] ?? "";
    const attrs = m[3] ?? "";
    const cls = /class="([^"]*)"/.exec(attrs)?.[1] ?? "";
    const outOfFlow = /\b(vh|on-card)\b/.test(cls);
    if (["input", "img", "br", "option"].includes(tag)) continue;
    if (close) {
      if (skip > 0) skip--;
      else out.push(`/${tag}`);
      continue;
    }
    if (skip > 0 || outOfFlow) {
      skip++;
      continue;
    }
    out.push(`${tag}.${cls.split(/\s+/).filter((c) => c !== "" && !STATE_CLASSES.has(c)).join(".")}`);
  }
  return out;
}

describe("説明の「?」の部品", () => {
  const run = (evs: HelpEvent[], s: HelpState = HELP_CLOSED) => evs.reduce(helpNext, s);
  it("カーソル・フォーカス・押すのどれでも開く", () => {
    expect(helpOpen(run(["enter"]))).toBe(true);
    expect(helpOpen(run(["focus"]))).toBe(true);
    expect(helpOpen(run(["press"]))).toBe(true);
  });
  it("カーソルを外すと閉じる。押して開いたものは、カーソルを外しても開いたまま", () => {
    expect(helpOpen(run(["enter", "leave"]))).toBe(false);
    expect(helpOpen(run(["enter", "press", "leave"]))).toBe(true);
  });
  it("Esc・外を押す・もう一度押す・フォーカスが外へ出ると閉じる", () => {
    expect(helpOpen(run(["press", "escape"]))).toBe(false);
    expect(helpOpen(run(["enter", "focus", "escape"]))).toBe(false);
    expect(helpOpen(run(["press", "outside"]))).toBe(false);
    expect(helpOpen(run(["focus", "press", "press"]))).toBe(false);
    expect(helpOpen(run(["focus", "press", "blur"]))).toBe(false);
  });
  it("閉じた形: ボタンに読み上げの名前・開閉の状態・説明の文の参照。説明の文は隠して置く（読み上げには渡る）", () => {
    const html = renderToString(h(Help, { label: "編集の対象" }, h("p", null, "説明の文")));
    expect(html).toContain('aria-label="編集の対象の説明"');
    expect(html).toContain('aria-expanded="false"');
    const id = /aria-controls="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`aria-describedby="${id}"`);
    expect(html).toMatch(new RegExp(`id="${id}" role="tooltip"[^>]*hidden`));
    expect(html).toContain("説明の文");
  });
  it("印を押して開く形（「推定」の札など）は、札の文字がボタンの名前", () => {
    const html = renderToString(h(Help, { label: "根拠", mark: "推定", markClass: "badge est" }, "統計の目安"));
    expect(html).toContain('class="help-btn help-mark badge est"');
    expect(html).not.toContain("aria-label=");
  });
  it("開いた説明は画面に重ねる（周りの配置を動かさない）", () => {
    expect(CSS).toMatch(/\.help-pop \{ position: fixed;/);
  });
});

describe("入力のホームの上部", () => {
  it("説明の段落・小さな結果・全部のカードの入れ方の一括の切り替えを出さない。説明は「?」の中に1回だけ", () => {
    const { wh, cat } = setup();
    const html = renderToString(h(InputView, { wh, onSave: noop, level: "simple", plans: plansProps(cat, null), imports: h("span", null, "x") }));
    expect(html).not.toContain("ih-lead");
    expect(html).not.toContain("data-mini-result");
    expect(html).not.toContain("data-home-level");
    expect(html).toContain('data-help="home"');
    expect(html).toContain('data-help="plan-target"');
    // 「現状を直すと、保存したプランにも反映されます」は編集の対象の「?」の中だけ
    expect(html.split("保存したプランにも反映されます").length - 1).toBe(1);
    expect(html.split("暗号化して自動で保存します").length - 1).toBe(1);
  });

  it("プランを選んでも、上部とカードの骨組みは同じ（配置が動かない）", () => {
    // 中身が同じプラン（差分なし）で、選ぶことそのものが配置を変えないことを見る
    const { wh, cat } = setup(false);
    const props = { wh, onSave: noop, level: "simple" as const, tools: h("span", { class: "hs-tools" }, "道具"), imports: h("span", null, "x") };
    const cur = renderToString(h(InputView, { ...props, plans: plansProps(cat, null) }));
    const pl = renderToString(h(InputView, { ...props, plans: plansProps(cat, "B") }));
    const upTo = (s: string) => s.slice(0, s.indexOf('class="ih-pins"') > 0 ? s.indexOf('class="ih-pins"') : undefined);
    expect(skeleton(upTo(pl))).toEqual(skeleton(upTo(cur)));
    expect(skeleton(upTo(pl)).length).toBeGreaterThan(100);
    // 骨組みで見ない状態の class は、色だけを変える
    expect(/\.ih-imports\.off \{([^}]*)\}/.exec(CSS)?.[1]?.trim()).toBe("color: var(--ink-2);");
  });

  it("カードの「プランB: 1か所」は絵の上に重ねる札（カードの高さを変えない）", () => {
    const { wh, cat } = setup();
    const pl = renderToString(h(InputView, { wh, onSave: noop, level: "simple", plans: plansProps(cat, "B") }));
    expect(pl).toContain('<span class="plan-count on-card" data-plan-count="1">プランB: 1か所</span>');
  });

  it("プランの色は編集の対象の箱の枠と点だけ。画面全体の色・左の帯は無い", () => {
    expect(CSS).not.toContain(".ih.plan-mode");
    // 枠の太さは現状とプランで同じ（色だけ変える）
    const on = /\.ih-target\.on \{([^}]*)\}/.exec(CSS)?.[1] ?? "";
    expect(on.trim()).toBe("border-color: var(--plan-c);");
    expect(CSS).toMatch(/\.plan-count\.on-card \{ position: absolute;/);
    const { wh, cat } = setup();
    const pl = renderToString(h(InputView, { wh, onSave: noop, level: "simple", plans: plansProps(cat, "B") }));
    expect(pl).toMatch(/<div class="ih">/);
    expect(pl).toContain('class="ih-target on" style="--plan-c:#0072c6;"');
  });

  it("カードの1押し（当てはまらない・目安で入れる）は、プランの編集中も出したまま押せない形にする", () => {
    const { wh, cat } = setup();
    const pl = renderToString(h(InputView, { wh, onSave: noop, level: "simple", plans: plansProps(cat, "B") }));
    const cur = renderToString(h(InputView, { wh, onSave: noop, level: "simple", plans: plansProps(cat, null) }));
    const btn = (s: string) => /<button[^>]*data-card-na="care"[^>]*>/.exec(s)?.[0] ?? "";
    expect(btn(cur)).not.toContain("disabled");
    expect(btn(pl)).toContain("disabled");
  });

  it("入力項目は5列（15項目と「探して開く」で5列×4段目に1個。1339px 以下で3列）、文字を大きくしたときは3列（1180px 以下で2列）", () => {
    expect(CSS).toContain(".ih-cards { display: grid; gap: 18px; grid-template-columns: repeat(5, minmax(0, 1fr)); }");
    expect(CSS).toContain("@media (max-width: 1339px) { .ih-cards { grid-template-columns: repeat(3, minmax(0, 1fr)); } }");
    // 5列のときも絵の高さは4列のときと同じくらい（少し縦長にし、200px まで）。文字の大きさは変えない
    expect(CSS).toContain("html:not(.big) .ih-ill { max-height: 200px; }");
    expect(CSS).toMatch(/@media \(min-width: 1340px\) \{ html:not\(\.big\) \.ih-ill \{ aspect-ratio: 10 \/ 7; \}/);
    expect(CSS).toContain("html.big .ih-cards { grid-template-columns: repeat(3, minmax(0, 1fr)); }");
    expect(CSS).toContain("@media (max-width: 1180px) { html.big .ih-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); } }");
  });
});

describe("入れ方（標準／詳細）はカードごと", () => {
  it("パネルの切り替えの言葉は「標準」「詳細」", () => {
    const { wh } = setup();
    const html = renderToString(h(InputPanel, { wh, itemId: "work", level: "simple", onLevel: noop, onSave: noop, onClose: noop }));
    expect(html).toMatch(/aria-pressed="true"[^>]*>\s*標準\s*</);
    expect(html).not.toMatch(/>\s*簡易\s*</);
  });
  it("初めの入れ方（#level=detail）で開いたカードは詳細", () => {
    const { wh } = setup();
    const html = renderToString(h(InputView, { wh, onSave: noop, level: "detail", initialOpen: "work" }));
    expect(html).toMatch(/aria-pressed="true"[^>]*>\s*詳細\s*</);
  });
});

describe("カードの絵", () => {
  it("退職金・企業年金・介護・相続は専用の絵（ほかのカードの絵を借りない）", () => {
    const seen = new Map<string, string>();
    for (const [art, src] of Object.entries(ILLUSTRATIONS)) {
      expect(seen.get(src), `${art} と ${seen.get(src) ?? ""} が同じ絵`).toBeUndefined();
      seen.set(src, art);
    }
  });
});
