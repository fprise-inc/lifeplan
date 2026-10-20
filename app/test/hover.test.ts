// 主画面の直し（2026-10-18）: グラフの年は線の上の○で選び、クリックで固定する・点線の枠をやめて薄いグレーの実線にする・金額のスライダーは1万円の刻み
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { MainChart } from "../src/presentation/MainChart.tsx";
import { CashflowTable, Headline, ResultCard } from "../src/presentation/MainView.tsx";
import { PlanBand } from "../src/presentation/PlanBand.tsx";
import { estimateWidth, indexAt, placeTip, shownYear, stepYear, togglePin } from "../src/presentation/yearPick.ts";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { DisplaySettingsPanel } from "../src/workspace/DisplaySettingsPanel.tsx";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { LeverCard, type LeverRow } from "../src/workspace/LeverPanel.tsx";
import { bandModel, CURRENT, planLetters } from "../src/workspace/plans/band.ts";
import { ItemRow, manInputText, parseManInput } from "../src/workspace/plans/ItemControls.tsx";
import { AMOUNT_STEP, amountRange, buildCatalog, fieldAmountRange, leverSteps, type Catalog } from "../src/workspace/plans/items.ts";
import { applyValues, savePlan, type Values } from "../src/workspace/plans/plans.ts";
import { toPresentation } from "../src/workspace/present.ts";
import { readLevers } from "../src/workspace/levers.ts";
import { roles } from "../src/workspace/roles.ts";
import { DEFAULT_DISPLAY_SETTINGS } from "../src/workspace/settings.ts";
import { REPO_DIR } from "../scripts/lib.ts";
import { modelHousehold, preview } from "./helpers.ts";

const noop = () => undefined;
const NOW = "2026-10-18T10:00:00.000Z";

function openDemo(): { wh: WorkingHousehold; cat: Catalog; selfId: string } {
  const req = modelHousehold("salariedCoupleTwoKids");
  const self = roles(req).find((r) => r.key === "self")!.member;
  const demo = demoHousehold("salariedCoupleTwoKids")!;
  const re = demo.reemployment!;
  const wh = fromRequest(req, { postRetirement: { [self.id]: { ...re, type: re.type as "contract" } } });
  return { wh, cat: buildCatalog(wh, self.id, demo), selfId: self.id };
}

const demo = openDemo();
const valuesB: Values = { "lever:retireAge": 65, "lever:livingMonthly": 280000 };
const rA = preview(demo.wh.request);
const rB = preview(applyValues(demo.wh, valuesB, demo.cat));
const model = (selectedYear: number | null = null) =>
  toPresentation({ base: demo.wh.request, proposal: applyValues(demo.wh, valuesB, demo.cat), current: rA, proposed: rB, targetAge: 95, selectedYear, provisional: false, names: { selected: "プランB", base: "プランA", same: false } });

describe("グラフの年: カーソルで○と表示、クリックで固定", () => {
  const years = [2026, 2027, 2028, 2029, 2030];

  it("クリック: 固定していなければ固定、同じ年なら外す、別の年なら移る", () => {
    expect(togglePin(null, 2028)).toBe(2028);
    expect(togglePin(2028, 2028)).toBeNull();
    expect(togglePin(2028, 2030)).toBe(2030);
  });

  it("固定中はカーソルを動かしても○と表示が動かない（固定を外すとカーソルの年に戻る）", () => {
    expect(shownYear(2028, 2030)).toBe(2028);
    expect(shownYear(2028, null)).toBe(2028);
    expect(shownYear(null, 2030)).toBe(2030);
    expect(shownYear(null, null)).toBeNull();
  });

  it("← → は固定した年を1年ずつ動かす。固定していなければカーソルの年か既定の年から。端より先は動かない", () => {
    expect(stepYear(years, 2028, null, 2030, 1)).toBe(2029);
    expect(stepYear(years, 2028, 2026, 2030, -1)).toBe(2027);
    expect(stepYear(years, 2030, null, 2026, 1)).toBeUndefined();
    expect(stepYear(years, null, 2027, 2030, 1)).toBe(2028);
    expect(stepYear(years, null, null, 2029, 1)).toBe(2029);
    expect(stepYear(years, null, null, 1999, 1)).toBe(2026);
  });

  it("カーソルの x から年の位置を読む（描く範囲の外は読まない）", () => {
    const f = { width: 600, height: 300, left: 50, right: 50, top: 20, bottom: 40 };
    expect(indexAt(49, f, 5)).toBeNull();
    expect(indexAt(551, f, 5)).toBeNull();
    expect(indexAt(50, f, 5)).toBe(0);
    expect(indexAt(149.9, f, 5)).toBe(0);
    expect(indexAt(150, f, 5)).toBe(1);
    expect(indexAt(550, f, 5)).toBe(4);
    expect(indexAt(300, f, 0)).toBeNull();
  });

  it("表示はグラフの端で見切れない（右の端に近ければ○の左に、上に入らなければ下に出す）", () => {
    const W = 1000;
    const H = 500;
    const mid = placeTip(400, 200, 260, 220, 60, W, H);
    expect(mid.side).toBe("right");
    expect(mid.left).toBeGreaterThan(400);
    expect(mid.top + 60).toBeLessThanOrEqual(200);
    const right = placeTip(980, 200, 260, 220, 60, W, H);
    expect(right.side).toBe("left");
    expect(right.left + 220).toBeLessThanOrEqual(980);
    const top = placeTip(400, 10, 30, 220, 60, W, H);
    expect(top.top).toBeGreaterThanOrEqual(30);
    // どこに置いても枠の中に収まる
    for (const x of [0, 5, 500, 995, 1000])
      for (const y of [0, 250, 499]) {
        const p = placeTip(x, y, y, 300, 70, W, H);
        expect(p.left).toBeGreaterThanOrEqual(0);
        expect(p.left + 300).toBeLessThanOrEqual(W);
        expect(p.top).toBeGreaterThanOrEqual(0);
        expect(p.top + 70).toBeLessThanOrEqual(H);
      }
    expect(estimateWidth(["2053年", "プランB 3,771万円"], 10)).toBeGreaterThan(estimateWidth(["2053年"], 10));
  });

  it("縦長の帯は出さない。固定した年は2本の線の上に○（選んだ案＝塗り、基準の案＝白抜き）と表示（固定中）", () => {
    const m = model();
    const html = renderToString(h(MainChart, { model: m, mode: "assets", explain: null, ageMark: null, pinnedYear: 2053, onSelectYear: noop }));
    expect(html).not.toContain("selband");
    expect(html).toContain('data-pinned-year="2053"');
    expect(html).toContain('class="hv-dot sel"');
    expect(html).toContain('class="hv-dot base"');
    expect(html).toContain("data-year-tip");
    expect(html).toContain("2053年（ご主人72歳）");
    expect(html).toContain("固定中");
    const i = m.chart.years.indexOf(2053);
    const man = (n: number) => `${n < 0 ? "▲" : ""}${Math.round(Math.abs(n) / 10000).toLocaleString("en-US")}万円`;
    expect(html).toContain(man(m.chart.proposal[i]!));
    expect(html).toContain(man(m.chart.current[i]!));
    // 年を選ぶための見えない枠は1つ（年ごとの帯は作らない）
    expect(html.match(/data-hit-area/g)).toHaveLength(1);
  });

  it("固定していなければ○も表示も出さない（カーソルを合わせたときだけ出す）。表は光らない", () => {
    const m = model();
    const html = renderToString(h(MainChart, { model: m, mode: "assets", explain: null, ageMark: null, pinnedYear: null, onSelectYear: noop }));
    expect(html).not.toContain("hv-dot");
    expect(html).not.toContain("data-year-tip");
    expect(html).not.toContain("data-pinned-year");
    const t = renderToString(h(CashflowTable, { model: m.table, selectedYear: null, onSelectYear: noop, onEvidence: noop }));
    expect(t).not.toMatch(/<th[^>]*class="[^"]*\bsel\b/);
    const t2 = renderToString(h(CashflowTable, { model: m.table, selectedYear: 2041, onSelectYear: noop, onEvidence: noop }));
    expect(t2).toMatch(/<th[^>]*class=" sel" data-year="2041"/);
  });

  it("表示する年の外の年は固定しない（○も表示も出さない）", () => {
    const html = renderToString(h(MainChart, { model: model(), mode: "assets", explain: null, ageMark: null, pinnedYear: 1990, onSelectYear: noop }));
    expect(html).not.toContain("hv-dot");
  });

  it("収支の推移でも、固定した年に印（年間収支の線の上の○）と表示", () => {
    const m = model();
    const flows = renderToString(h(MainChart, { model: m, mode: "flows", explain: null, ageMark: null, pinnedYear: 2041, onSelectYear: noop }));
    expect(flows).toContain('class="hv-dot sel"');
    expect(flows).toContain('class="hv-dot base"');
    expect(flows).toContain("年間収支");
    expect(flows).toMatch(/収入 [\d,▲]+万円・支出 [\d,▲]+万円（プランB）/);
  });

  it("年を選ぶ見えない枠の上に、ポインタを受ける層を重ねない（○・縦の線・小さな表示・浮かせた枠の案内はポインタを通す）", () => {
    // ○と表示が出ている状態でも、SVG の中で見えない枠より後ろ（上）にあるのはイベントの丸だけ
    const html = renderToString(h(MainChart, { model: model(), mode: "assets", explain: null, ageMark: null, pinnedYear: 2053, onSelectYear: noop }));
    const svg = html.slice(html.indexOf("<svg"), html.indexOf("</svg>"));
    expect(svg.replace(/^[\s\S]*data-hit-area[^>]*>(<\/rect>)?/, "")).toMatch(/^<g class="evs">/);
    const css = ["src/styles/app.css"].map((f) => readFileSync(join(REPO_DIR, "app", f), "utf-8")).join("\n");
    const rule = (sel: string) => css.match(new RegExp(`(^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`))?.[2] ?? "";
    for (const sel of [".chart .hv-dots", ".chart .hv-guide", ".year-tip"]) expect(rule(sel)).toContain("pointer-events: none");
    // 付いてくるグラフの箱は高さ0（付いてきていないときに元のグラフを覆わない）
    expect(rule(".chart-dock")).toContain("height: 0");
  });

  it("説明モードでは年を選ばない（○・表示・選ぶ枠を出さない）", () => {
    const html = renderToString(
      h(MainChart, { model: model(), mode: "assets", explain: { model: { title: "説明", years: [], ages: [], steps: [{ key: "income", title: "収入", sentence: [] }], work: [], pension: [], living: [], education: [], housing: [], financial: [] }, step: 0 }, ageMark: null, pinnedYear: 2041, onSelectYear: noop }),
    );
    expect(html).not.toContain("hv-dot");
    expect(html).not.toContain("data-hit-area");
  });
});

describe("金額のスライダーは1万円の刻み", () => {
  it("NISAの積立額・生活費は月1万円の刻み。範囲は目盛りの最小から最大まで（今の考え方のまま）", () => {
    const steps = leverSteps(demoHousehold("salariedCoupleTwoKids")!, readLevers(demo.wh.request, demo.selfId));
    for (const k of ["nisaMonthly", "livingMonthly"] as const) {
      const c = demo.cat.byKey.get(`lever:${k}`)!.control;
      expect(c.kind).toBe("range");
      if (c.kind !== "range") continue;
      expect(c.step).toBe(10_000);
      expect(c.per).toBe("月");
      expect(c.min).toBe(Math.floor(Math.min(...steps[k]) / 10_000) * 10_000);
      expect(c.max).toBe(Math.ceil(Math.max(...steps[k]) / 10_000) * 10_000);
    }
  });

  it("年齢の項目（働く最後の年齢・年金の受け取り開始）は1歳ずつ。範囲は今の目盛りの最小〜最大、目盛りの数字は今の段", () => {
    const steps = leverSteps(demoHousehold("salariedCoupleTwoKids")!, readLevers(demo.wh.request, demo.selfId));
    for (const k of ["retireAge", "pensionAge"] as const) {
      const c = demo.cat.byKey.get(`lever:${k}`)!.control;
      expect(c.kind).toBe("age");
      if (c.kind !== "age") continue;
      expect(c.min).toBe(Math.min(...steps[k]));
      expect(c.max).toBe(Math.max(...steps[k]));
      expect(c.ticks).toEqual(steps[k]);
    }
  });

  it("どのモデル世帯でも、金額のスライダー（借入額・繰上返済・金額の欄）は1万円の刻み。割合・年はそのまま", () => {
    const ids = readdirSync(join(REPO_DIR, "data", "modelHouseholds")).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
    let ranges = 0;
    let yenFields = 0;
    for (const id of ids) {
      const req = modelHousehold(id);
      const self = roles(req).find((r) => r.key === "self");
      if (self === undefined) continue;
      const cat = buildCatalog(fromRequest(req), self.member.id, null);
      for (const it of cat.items) {
        const c = it.control;
        if (c.kind === "range") {
          ranges++;
          expect(c.step, it.key).toBe(AMOUNT_STEP);
          expect(c.min % AMOUNT_STEP, it.key).toBe(0);
          expect(c.max % AMOUNT_STEP, it.key).toBe(0);
        }
        if (c.kind === "field" && c.field.kind === "yen") {
          yenFields++;
          expect(c.slider?.step, it.key).toBe(AMOUNT_STEP);
          expect(c.slider?.per, it.key).toBe(c.field.basis === "monthly" ? "月" : c.field.basis === "annual" ? "年" : "");
        }
        if (c.kind === "field" && c.field.kind !== "yen") expect(c.slider, it.key).toBeUndefined();
        if (c.kind === "rate") expect(c.step).toBe("0.0005");
      }
    }
    expect(ranges).toBeGreaterThan(0);
    expect(yenFields).toBeGreaterThan(0);
  });

  it("範囲は1万円の倍数にそろえ、今の値・基準の値を含める。金額の欄は0から今の値の2倍まで", () => {
    expect(amountRange(253_000, 287_000)).toEqual({ min: 250_000, max: 290_000 });
    expect(amountRange(0, 50_000, 80_000)).toEqual({ min: 0, max: 80_000 });
    expect(amountRange(200_000, 260_000, 185_000, null)).toEqual({ min: 180_000, max: 260_000 });
    expect(fieldAmountRange("monthly", null)).toEqual({ min: 0, max: 100_000 });
    expect(fieldAmountRange("annual", 1_200_000)).toEqual({ min: 0, max: 2_400_000 });
    expect(fieldAmountRange("once", 300_000)).toEqual({ min: 0, max: 1_000_000 });
  });

  it("数値の欄: 万円で入れ、1万円単位に丸める（全角・カンマも可。マイナス・文字は読まない）", () => {
    expect(parseManInput("28")).toBe(280_000);
    expect(parseManInput("２８")).toBe(280_000);
    expect(parseManInput("1,200")).toBe(12_000_000);
    expect(parseManInput("3.4")).toBe(30_000);
    expect(parseManInput("3.5")).toBe(40_000);
    expect(parseManInput("-3")).toBeNull();
    expect(parseManInput("abc")).toBeNull();
    expect(parseManInput("")).toBeNull();
    expect(manInputText(280_000)).toBe("28");
    expect(manInputText(253_000)).toBe("25.3");
  });

  it("対策の欄: 金額はスライダー（step=10000）と横の数値の欄、年齢は1歳ずつのスライダーと値の位置の目盛り", () => {
    const rows: LeverRow[] = [
      { key: "retireAge", label: "ご主人が働く最後の年齢", slider: { kind: "age", min: 60, max: 70, value: 63, base: 60, ticks: [60, 65, 70], stepText: String }, valueText: "63歳まで", baseText: "60歳まで", note: null },
      { key: "nisaMonthly", label: "NISAの積立額（月）", slider: { kind: "amount", min: 0, max: 50_000, step: 10_000, value: 30_000, base: 10_000, per: "月", tick: (v) => `${v / 10000}万` }, valueText: "月3万円", baseText: "月1万円", note: null },
    ];
    const html = renderToString(h(LeverCard, { selected: "プランB", baseLetter: "A", locked: null, modified: false, levers: rows, fee: null, onSlide: noop, onRelease: noop, onReset: noop, onOverwrite: null, onSaveNew: noop, suggested: "", changes: [], onAck: null, onDrop: null }));
    expect(html).toMatch(/<input id="lv-nisaMonthly" type="range" min="0" max="50000" step="10000" value="30000"/);
    expect(html).toContain("data-amount-input");
    expect(html).toContain('value="3"');
    expect(html).toMatch(/<input id="lv-retireAge" type="range" min="60" max="70" step="1" value="63"/);
    // 目盛りの数字は今の段だけ、値の位置（65 は線の真ん中）に置く。63 は目盛りに無いので光らない
    expect(html.match(/class="tick( [^"]*)?"/g)).toHaveLength(3);
    expect(html).toContain("(100% - var(--thumb, 16px)) * 0.5000");
    expect(html).not.toContain("tick is-on");
    expect(html).toContain('class="tick is-base"');
    expect(html).toContain("基準（A）: 月1万円");
  });

  it("足した金額の項目（借入額・繰上返済・金額の欄）にも、1万円の刻みのスライダーと数値の欄", () => {
    const loan = demo.cat.items.find((x) => /^loan:.*:(principal|prepay)$/.test(x.key));
    expect(loan).toBeDefined();
    const html = renderToString(h(ItemRow, { item: loan!, value: loan!.read(demo.wh), base: loan!.read(demo.wh), wh: demo.wh, onSlide: noop, onRelease: noop, onRemove: noop }));
    expect(html).toMatch(/type="range"[^>]*step="10000"/);
    expect(html).toContain("data-amount-input");
    const fee = demo.cat.items.find((x) => x.control.kind === "field" && x.control.field.kind === "yen")!;
    const fh = renderToString(h(ItemRow, { item: fee, value: fee.read(demo.wh), base: fee.read(demo.wh), wh: demo.wh, onSlide: noop, onRelease: noop, onRemove: noop }));
    expect(fh).toMatch(/type="range"[^>]*step="10000"/);
  });
});

// ---- 点線の枠が残っていないこと ----

/** app.css の規則（選択子と宣言）を読む。@media の中も読む */
function cssRules(css: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const sel = (m[1] as string).replace(/@media[^{]*\{/g, "").trim();
    for (const s of sel.split(",")) out.push({ selector: s.trim(), body: m[2] as string });
  }
  return out;
}

/** 点線・破線の枠（border・outline）か下線か */
const dashedDecl = (body: string) => /(border[a-z-]*|outline[a-z-]*|text-decoration[a-z-]*)\s*:[^;]*\b(dashed|dotted)\b/.test(body);

/** 描いた HTML に出てくるクラスの名前 */
function classesOf(html: string): Set<string> {
  const out = new Set<string>();
  for (const m of html.matchAll(/class="([^"]*)"/g)) for (const c of (m[1] as string).split(/\s+/)) if (c !== "") out.add(c);
  return out;
}

describe("主画面の点線の枠は、薄いグレーの実線にする", () => {
  const css = readFileSync(join(import.meta.dirname, "..", "src", "styles", "app.css"), "utf8");
  const rules = cssRules(css);
  // 主画面の部品を描く（案の帯・グラフ・確定前の札・対策・足した項目・表示の設定・表）
  let wh = demo.wh;
  const ids: string[] = [];
  for (const [i, v] of [valuesB, { "lever:nisaMonthly": 50000 }].entries()) {
    const r = savePlan(wh, demo.cat, { name: `${"BC"[i]}案 案${i + 1}`, base: null, values: v, now: NOW });
    wh = r.wh;
    ids.push(r.id);
  }
  const m = model(2041);
  const band = bandModel({ req: wh.request, slots: [CURRENT, ...ids], letters: planLetters(wh.proposals), results: new Map([[CURRENT, rA], [ids[0]!, rB]]), modified: new Set([ids[0]!]), base: CURRENT, selected: ids[0]!, settings: DEFAULT_DISPLAY_SETTINGS, colors: new Map() });
  const rows: LeverRow[] = [{ key: "nisaMonthly", label: "NISA", slider: { kind: "amount", min: 0, max: 50_000, step: 10_000, value: 30_000, base: 10_000, per: "月", tick: String }, valueText: "月3万円", baseText: "月1万円", note: "注" }];
  const lever = (locked: string | null) =>
    h(LeverCard, { selected: "プランB", baseLetter: "A", locked, modified: true, levers: rows, fee: { on: true, inBase: false, note: "単発", onToggle: noop }, onSlide: noop, onRelease: noop, onReset: noop, onOverwrite: noop, onSaveNew: noop, suggested: "", changes: [{ key: "k", label: "生活費", from: "月30万円", to: "月28万円", state: "ok", inherited: true, reviewNote: null }], onAck: null, onDrop: null, initialSave: true }, h("div", { class: "add-row" }, h("button", { type: "button", class: "add-item-btn" }, "＋ 動かす項目を追加")));
  const added = demo.cat.items.filter((x) => !x.builtin && x.control.kind !== "field").slice(0, 4);
  const html = renderToString(
    h(
      "div",
      null,
      h(PlanBand, { model: band, onSelect: noop, onBase: noop, onAdd: noop }),
      h(Headline, { model: m.headline, provisional: true }),
      h(ResultCard, { model: m, verdict: m.result, provisional: true, mode: "assets", onMode: noop, explain: null, onExplain: noop, ageMark: null, pinnedYear: 2041, onSelectYear: noop }),
      h(DisplaySettingsPanel, { value: DEFAULT_DISPLAY_SETTINGS, feeAvailable: false, onChange: noop, onClose: noop }),
      lever(null),
      lever("基準のプランは動かせません"),
      ...added.map((it) => h(ItemRow, { item: it, value: it.read(demo.wh), base: it.read(demo.wh), wh: demo.wh, onSlide: noop, onRelease: noop, onRemove: noop, baseLabel: "基準（A）" })),
      h(CashflowTable, { model: m.table, selectedYear: 2041, onSelectYear: noop, onEvidence: noop }),
    ),
  );
  const used = classesOf(html);

  it("主画面に出る部品のクラスに、点線・破線の枠の規則が当たらない（凡例の線の見本と、表の押せるマスの下線は除く）", () => {
    // 凡例の「灰の点線」はグラフの線の種類の見本（枠ではない）。表のマスの点線の下線は「押すと根拠が出る」印（枠ではない）
    const allowed = new Set([".lg.base i", ".cf .cellbtn"]);
    const hits = rules
      .filter((r) => dashedDecl(r.body) && !allowed.has(r.selector))
      .filter((r) => {
        const cls = [...r.selector.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((x) => x[1] as string);
        return cls.length > 0 && cls.every((c) => used.has(c));
      })
      .map((r) => r.selector);
    expect(hits).toEqual([]);
    // 描いた部品に、確かめたいクラスが入っている（点検が空振りしていない）
    for (const c of ["plan", "is-base", "p-letter", "p-line", "p-tag", "base", "plan-add", "base-tag", "base-mark", "provisional", "lv-lock", "add-item-btn", "ds-item", "year-tip"]) expect(used.has(c), c).toBe(true);
  });

  it("基準の案のカード・札・選択欄は薄いグレーの実線（基準は「基準」の札と背景の色で分かる）", () => {
    const body = (sel: string) => rules.filter((r) => r.selector === sel).map((r) => r.body).join(";");
    for (const sel of [".plan.is-base", ".p-tag.base", ".base-tag", ".base-mark", ".band-head select", ".plan-add", ".lv-lock", ".provisional", ".add-item-btn"]) {
      expect(body(sel), sel).toMatch(/border:\s*[\d.]+px solid var\(--line\)/);
      expect(dashedDecl(body(sel)), sel).toBe(false);
    }
    expect(body(".plan.is-base")).toMatch(/background:\s*var\(--base-bg\)/);
    expect(body(".plan.is-base .p-letter")).not.toMatch(/dashed/);
    expect(body(".plan.is-base .p-line")).not.toMatch(/dashed/);
    // 「変えたこと」の一覧の「元の案から」の札も実線（一覧を開いたときだけ出るので規則で確かめる）
    expect(dashedDecl(body(".pb-tag"))).toBe(false);
    expect(html).toContain('<span class="p-tag base">基準</span>');
  });

  it("グラフの基準の案の線（灰の点線）はそのまま点線（線の種類で案を区別する）", () => {
    const body = rules.filter((r) => r.selector === ".chart .line-base").map((r) => r.body).join(";");
    expect(body).toMatch(/stroke-dasharray/);
    expect(rules.filter((r) => r.selector === ".chart .net-base").map((r) => r.body).join(";")).toMatch(/stroke-dasharray/);
  });
});
