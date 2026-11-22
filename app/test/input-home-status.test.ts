// 入力のホームの状態の見せ方（0242）: 「入力済み」は緑・状態の行を横にそろえる（subgrid は @supports の中）・
// 未入力（0円の所あり）とまだ入れていないに点線の枠が無い・未入力は絵の左上の印「未入力」で見せ、状態の行は出さない（読み上げの名前には状態が残る）
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { APP_DIR } from "../scripts/lib.ts";
import type { StageDef } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { InputView } from "../src/workspace/input/InputView.tsx";
import { inputItems, itemStage, type InputItem } from "../src/workspace/input/items.ts";
import { MISSING_MARK, STATUS_TEXT } from "../src/workspace/input/StatusBadge.tsx";
import { modelHousehold, modelWithGaps } from "./helpers.ts";

const CSS = readFileSync(join(APP_DIR, "src", "styles", "app.css"), "utf8");
const esc = (s: string) => s.replace(/[.[\]()>:*+]/g, "\\$&");
/** 行の頭から始まる決まりの中身（@supports の中の決まりは字下げしてあるので入らない） */
const rule = (sel: string) => new RegExp(`(^|\\n)${esc(sel)} \\{([^}]*)\\}`).exec(CSS)?.[2] ?? "";
/** セレクタにその文字を含む決まりの中身を全部 */
const rulesWith = (part: string) => [...CSS.matchAll(/(?:^|\n)\s*([^{}\n]+) \{([^}]*)\}/g)].filter((m) => (m[1] ?? "").includes(part)).map((m) => m[2] ?? "");

/** 横そろえの決まりのまとまり（@supports の波かっこの中） */
function alignBlock(): string {
  const at = CSS.indexOf("@supports (grid-template-rows: subgrid)");
  if (at < 0) return "";
  let depth = 0;
  for (let i = CSS.indexOf("{", at); i < CSS.length; i++) {
    if (CSS[i] === "{") depth++;
    else if (CSS[i] === "}" && --depth === 0) return CSS.slice(at, i + 1);
  }
  return "";
}

const seq = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};
const render = (wh: WorkingHousehold) => renderToString(h(InputView, { wh, onSave: () => undefined, level: "simple" }));
/** 入力項目1つ分の HTML（開くボタンから下の帯の手前まで） */
function cardHtml(html: string, id: string): string {
  const at = html.indexOf(`data-card="${id}"`);
  const from = html.lastIndexOf('<div class="ih-card ', at);
  return html.slice(from, html.indexOf('<span class="ih-band"', at));
}
/** 開くボタンの中の文字（タグを外して、画面に出る順に） */
function openText(card: string): string {
  const from = card.indexOf(">", card.indexOf('class="ih-open"')) + 1;
  return card.slice(from, card.indexOf("</button>", from)).replace(/<[^>]*>/g, "").trim();
}
/** 住まい・ローンを入れ始める（ローンを足す。額が空の所が残るので未入力になる） */
function startHousing(wh: WorkingHousehold): WorkingHousehold {
  const st = itemStage(wh, "housing") as StageDef;
  const a = st.sections.flatMap((x) => [...x.actions, ...x.groups.flatMap((g) => g.actions)]).find((x) => x.key.endsWith("add/cardLoan"));
  if (a === undefined) throw new Error("add/cardLoan");
  return a.run(wh);
}

describe("入力のホームの状態の色と枠（0242）", () => {
  it("「入力済み」は緑（状態の印と、進み具合の帯の四角）。藍は使わない", () => {
    expect(rule(".ih-st.done")).toBe(" color: var(--good); ");
    expect(rule(".ih-st.done::before")).toContain("background: var(--good);");
    expect(rule(".ih-prog-bar i.done")).toBe(" background: var(--good); border-color: var(--good); ");
    for (const body of [...rulesWith(".ih-st.done"), ...rulesWith(".ih-prog-bar i.done")]) expect(body).not.toContain("var(--prop)");
  });

  it("未入力（0円の所あり）とまだ入れていないに、点線の枠・別の地・影なしの指定が無い（ふつうの入力項目と同じ枠・地・影）", () => {
    const bodies = [...rulesWith(".ih-card.s-missing"), ...rulesWith(".ih-card.s-empty")];
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      expect(body).not.toContain("dashed");
      expect(body).not.toMatch(/(^|[ ;])border(-[a-z]+)?:/);
      expect(body).not.toContain("box-shadow");
      expect(body).not.toContain("--wash");
    }
    // 絵の所は灰色の地、絵は色を抜いて薄く。下の帯は出さない
    expect(rule(".ih-card.s-missing .ih-ill, .ih-card.s-empty .ih-ill")).toBe(" background: var(--base-bg); ");
    expect(rule(".ih-card.s-missing .ih-ill img, .ih-card.s-empty .ih-ill img")).toBe(" filter: grayscale(1); opacity: 0.45; ");
    expect(rule(".ih-card.s-missing .ih-band, .ih-card.s-empty .ih-band")).toBe(" display: none; ");
  });

  it("進み具合の帯: まだ入れていないは細い実線、未入力は赤い枠・薄い赤の地のまま", () => {
    expect(rule(".ih-prog-bar i.empty")).toBe(" border: 1.5px solid var(--line); background: var(--card); ");
    expect(rule(".ih-prog-bar i.missing")).toBe(" border: 2px solid var(--short); background: var(--short-bg); ");
    for (const body of rulesWith(".ih-prog-bar")) expect(body).not.toContain("dashed");
  });

  it("変えない所: 該当なしは入力項目の全体が灰色、「探して開く」は点線の枠、進み具合の左の未入力の数は赤い枠", () => {
    expect(rule(".ih-card.s-na")).toBe(" border: 1.5px solid var(--line); box-shadow: none; background: var(--base-bg); ");
    expect(rule(".ih-card.ih-find")).toContain("border: 2px dashed var(--field);");
    expect(rule(".ih-prog-miss.on")).toBe(" border: 2px solid var(--short); background: var(--short-bg); ");
  });

  it("印「未入力」は絵の左上（右上はプランで直した所の数の場所）。薄い赤の地・赤い文字・赤い枠", () => {
    const chip = rule(".ih-miss");
    for (const part of ["position: absolute;", "top: 10px;", "left: 10px;", "font-size: 0.8rem;", "font-weight: 700;", "border-radius: 6px;", "background: var(--short-bg);", "color: var(--short-ink);", "border: 1.5px solid var(--short);"]) expect(chip).toContain(part);
    expect(chip).not.toMatch(/(^|[ ;])right:/);
    expect(rule(".plan-count.on-card")).toContain("right: 8px;");
    expect(rule(".plan-count.on-card")).not.toMatch(/(^|[ ;])left:/);
  });
});

describe("状態の行を横にそろえる決まりは @supports の中（0242）", () => {
  const block = alignBlock();
  const outside = CSS.replace(block, "");

  it("入力のホームの subgrid は @supports の中にだけある（知らない環境では今までの並びのまま）", () => {
    expect(block).toContain("@supports (grid-template-rows: subgrid)");
    expect(block).toMatch(/\.ih-cards > \.ih-card:not\(\.ih-find\) \{[^}]*grid-template-rows: subgrid;[^}]*\}/);
    expect(outside).not.toMatch(/\.ih-[^{}]*\{[^}]*subgrid/);
    // 今までの並び（縦に積む・開くボタンが伸びる）は @supports の外に残す
    expect(outside).toMatch(/\n\.ih-card \{[^}]*display: flex; flex-direction: column;/);
    expect(outside).toMatch(/\n\.ih-open \{[^}]*flex: 1;/);
    expect(outside).toContain(".ih-cards { display: grid; gap: 18px; grid-template-columns: repeat(5, minmax(0, 1fr)); }");
  });

  it("段の高さは中身で決まる（ボタン・状態の行の高さを px で持たない）", () => {
    expect(block).not.toMatch(/[ ;{](min-|max-)?height: \d+(\.\d+)?px/);
    expect(block).not.toMatch(/grid-(template|auto)-rows: [^;]*\d+px/);
    // 状態の行は1段目の下端に、案内の文と1押しは2段目に
    expect(block).toMatch(/\.ih-body > \.ih-st \{[^}]*margin-top: auto;/);
    expect(block).toMatch(/\.ih-card > \.ih-hint \{[^}]*grid-area: 2 \/ 1;/);
  });

  it("推定で計算中の印は開くボタンに重ねて置くが、印のほかの所は押すと入力項目が開く", () => {
    expect(block).toMatch(/\.ih-card > \.ih-est-tip \{[^}]*pointer-events: none;/);
    expect(block).toMatch(/\.ih-card > \.ih-est-tip > \* \{[^}]*pointer-events: auto;/);
  });
});

describe("未入力（0円の所あり）の入力項目は印で見せる（0242）", () => {
  const cards = (wh: WorkingHousehold) => ({ items: inputItems(wh), html: render(wh) });
  const check = (items: InputItem[], html: string) => {
    for (const i of items) {
      const part = cardHtml(html, i.id);
      expect(part, i.id).toContain(`class="ih-card s-${i.status}"`);
      if (i.status === "missing") {
        // 印は開くボタンの中の最後（名前・数字の後ろ。見た目は絵の左上）。状態の行は出さない。すぐ下の案内の文は残す
        expect(part, i.id).toContain(`</span><span class="ih-miss">${MISSING_MARK}</span></button>`);
        expect(part, i.id).not.toContain("ih-st missing");
        expect(i.hint, i.id).not.toBeNull();
        expect(part, i.id).toContain(`<p>${i.hint ?? ""}</p>`);
      } else expect(part, i.id).not.toContain("ih-miss");
      // 開くボタンの中の文字は、どの状態でも入力項目の名前から始まる（画面の文字で入力項目を探して押せる。通しの操作のテストもこの探し方）
      expect(openText(part), i.id).toMatch(new RegExp(`^${i.label}`));
      // 読み上げ用の名前も、どの状態でも入力項目の名前から始まり、状態の言葉が入る
      expect(part, i.id).toMatch(new RegExp(`aria-label="${i.label}（${STATUS_TEXT[i.status].replace(/[（）]/g, "\\$&")}`));
    }
    expect((html.match(/class="ih-miss"/g) ?? []).length).toBe(items.filter((i) => i.status === "missing").length);
  };

  it("印の言葉は「未入力」。状態の名前（読み上げ・進み具合）は「未入力（0円の所あり）」のまま", () => {
    expect(MISSING_MARK).toBe("未入力");
    expect(STATUS_TEXT.missing).toBe("未入力（0円の所あり）");
  });

  it("未入力の入力項目に印が出て、状態の行は出ない。読み上げ用の名前に状態が残る。ほかの状態の入力項目に印は出ない", () => {
    const { items, html } = cards(fromRequest(modelWithGaps("salariedCoupleTwoKids"), { memo: [] }));
    expect(items.some((i) => i.status === "missing")).toBe(true);
    check(items, html);
    // 進み具合の左の「未入力（0円の所あり）n 項目」は今までどおり
    expect(html).toContain('<span class="ih-st missing mini">未入力（0円の所あり）</span>');
  });

  it("どの状態（入力済み・推定で計算中・未入力・まだ入れていない・該当なし・事務所の既定値どおり）の入力項目も、開くボタンの中の文字と読み上げ用の名前が入力項目の名前から始まる", () => {
    const seen = new Set<string>();
    const whs = [blankHousehold("2026-10", seq()), startHousing(blankHousehold("2026-10", seq())), fromRequest(modelWithGaps("salariedCoupleTwoKids"), { memo: [] }), fromRequest(modelHousehold("salariedCoupleTwoKids"), { memo: [] })];
    for (const wh of whs) {
      const { items, html } = cards(wh);
      check(items, html);
      for (const i of items) seen.add(i.status);
    }
    expect([...seen].sort()).toEqual(["done", "empty", "est", "missing", "na", "std"]);
  });

  it("まだ入れていない入力項目に印は付けない（「まだ入っていません」の文だけ）", () => {
    const { items, html } = cards(blankHousehold("2026-10", seq()));
    expect(items.some((i) => i.status === "empty")).toBe(true);
    expect(items.some((i) => i.status === "missing")).toBe(false);
    check(items, html);
    expect(html).not.toContain("ih-miss");
    expect(cardHtml(html, "insurance")).toContain("まだ入っていません");
  });

  it("計算の基準の月が1〜3月・誕生月の前後でも、状態と見せ方の対応は同じ（状態の決め方は変えていない）", () => {
    // 新しい世帯のご本人は4月生まれ（基準の月の40年前の4月）
    for (const base of ["2026-10", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05"]) {
      const fresh = cards(blankHousehold(base, seq()));
      check(fresh.items, fresh.html);
      const started = cards(startHousing(blankHousehold(base, seq())));
      expect(started.items.find((i) => i.id === "housing")?.status, base).toBe("missing");
      check(started.items, started.html);
      expect(started.items.map((i) => i.status), base).toEqual(cards(startHousing(blankHousehold("2026-10", seq()))).items.map((i) => i.status));
    }
  });
});
