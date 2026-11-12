// カスタム層の説明の文の差し替え（0016 の 2026-11-01・2026-11-02 の追記）: 説明の一覧を画面の定義から作る・承認した事務所の文を画面に当てる・
// 消せない知らせは画面でも隠さない・事務所の既定値の画面の承認の区画。読み書き・検査・指紋・承認の台帳は本体（crates/custom-layer）のテスト
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import type { CustomTextsStatus } from "../src/engine/host.ts";
import type { PreviewResult } from "../src/engine/types.ts";
import { CalcNotices } from "../src/workspace/CalcNotices.tsx";
import { noticeRows, noticeTextTable } from "../src/workspace/engineNotices.ts";
import { Field } from "../src/workspace/input/FieldViews.tsx";
import type { FieldDef } from "../src/workspace/input/form.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { fieldTextId } from "../src/workspace/input/textIds.ts";
import { applyOfficeText, OfficeTextsContext, officeTextsFrom, type OfficeTextEntry } from "../src/workspace/office/customTexts.ts";
import { customCenterNotice } from "../src/workspace/office/customNotice.ts";
import { CustomTextsSection, customStateLine, rowTextLabel } from "../src/workspace/office/CustomTextsSection.tsx";
import { buildTextsCatalog, CATALOG_PATH, CATALOG_SCHEMA } from "../scripts/textsCatalog.ts";
import { modelHousehold } from "./helpers.ts";

const sha = (s: string) => `sha256:${createHash("sha256").update(s, "utf8").digest("hex")}`;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const noop = () => undefined;

describe("説明の一覧（画面の定義から作る）", () => {
  const cat = buildTextsCatalog();

  it("prepare-assets が書いた一覧は、今の画面の定義から作った物と同じ（本体はこのファイルを埋め込む）", () => {
    expect(JSON.parse(readFileSync(CATALOG_PATH, "utf8"))).toEqual(JSON.parse(JSON.stringify(cat)));
  });

  it("形: id に物の ID を入れない・指紋は文の SHA-256・id は重ならない", () => {
    expect(cat.schema).toBe(CATALOG_SCHEMA);
    expect(cat.entries.length).toBeGreaterThan(200);
    const ids = new Set<string>();
    for (const e of cat.entries) {
      expect(e.id, e.id).not.toMatch(UUID);
      expect(e.id.startsWith(`${e.kind}:`)).toBe(true);
      expect(e.hash).toBe(sha(e.text));
      // 結果の画面の文（result:…）はお客さまと一緒に見る画面の文（0212）。ほかは FP 向け
      expect(e.audience).toBe(e.kind === "result" ? "customer" : "fp");
      expect(ids.has(e.id)).toBe(false);
      ids.add(e.id);
    }
    expect(cat.summary.fields).toBe(cat.entries.filter((e) => e.kind === "field").length);
    expect(cat.summary.fields).toBeGreaterThan(100);
  });

  it("計算の知らせは文の表のすべて。「入力が足りない」「計算に入れていない」は消せない（言い方は変えられる）", () => {
    const notices = cat.entries.filter((e) => e.kind === "notice");
    expect(notices.length).toBe(noticeTextTable().length);
    for (const e of notices) {
      const hideable = e.noticeKind === "outside" || e.noticeKind === "assumed" || e.noticeKind === "data";
      expect(e.ops.includes("hide"), e.id).toBe(hideable);
      expect(e.ops).toEqual(expect.arrayContaining(["replace", "append"]));
    }
    expect(notices.some((e) => e.noticeKind === "missing")).toBe(true);
    expect(notices.some((e) => e.noticeKind === "input")).toBe(true);
  });

  it("欄の説明は、画面に出る文そのまま（同じ id で世帯によって文が違う所は載せない）", () => {
    const wh = fromRequest(modelHousehold("salariedCoupleTwoKids"), {});
    const fields = buildStage("savings", wh).sections.flatMap((s) => s.groups.flatMap((g) => g.fields));
    const byId = new Map(cat.entries.map((e) => [e.id, e]));
    let hit = 0;
    for (const f of fields) {
      const id = fieldTextId(f, wh);
      const e = id === null ? undefined : byId.get(id);
      if (e === undefined || f.help === undefined) continue;
      expect(e.text).toBe(f.help);
      hit++;
    }
    expect(hit).toBeGreaterThan(3);
    expect(cat.summary.fieldsVarying).toBeGreaterThan(0);
  });
});

const entry = (id: string, op: OfficeTextEntry["do"], text: string | null, official: string, officialChanged = false): OfficeTextEntry => ({ id, do: op, text, official, officialChanged });

describe("承認した文を当てる", () => {
  it("書き換える・足す・消す。公式の文が違えば当てない。{{ }} は字の { }", () => {
    const t = officeTextsFrom([entry("field:a", "replace", "事務所の {{例}}", "公式"), entry("field:b", "append", "足した", "公式B"), entry("field:c", "hide", null, "公式C")]);
    expect(applyOfficeText(t, "field:a", "公式").text).toBe("事務所の {例}");
    expect(applyOfficeText(t, "field:b", "公式B").text).toBe("公式B\n足した");
    expect(applyOfficeText(t, "field:c", "公式C")).toEqual({ text: null, office: t.get("field:c") });
    expect(applyOfficeText(t, "field:a", "別の世帯の文")).toEqual({ text: "別の世帯の文", office: null });
    expect(applyOfficeText(t, null, "公式")).toEqual({ text: "公式", office: null });
  });

  const wh = (): WorkingHousehold => fromRequest(modelHousehold("salariedCoupleTwoKids"), {});
  const cat = buildTextsCatalog();
  const byId = new Map(cat.entries.map((e) => [e.id, e]));
  const helpField = (w: WorkingHousehold): { f: FieldDef; id: string } => {
    for (const s of buildStage("savings", w).sections)
      for (const g of s.groups)
        for (const f of g.fields) {
          const id = fieldTextId(f, w);
          if (id !== null && byId.has(id) && f.help !== undefined && f.readOnly === undefined) return { f, id };
        }
    throw new Error("説明のある欄がありません");
  };
  const render = (w: WorkingHousehold, f: FieldDef, list: OfficeTextEntry[]) => renderToString(h(OfficeTextsContext.Provider, { value: officeTextsFrom(list) }, h(Field, { f, wh: w, onEdit: noop })));

  it("欄の「?」: 承認した文を文字として出し、「事務所の文」と公式の文を添える。HTML として読まない", () => {
    const w = wh();
    const { f, id } = helpField(w);
    const official = f.help as string;
    const plain = render(w, f, []);
    expect(plain).toContain(official);
    expect(plain).not.toContain("事務所の文");
    const html = render(w, f, [entry(id, "replace", "<b>太字</b>は字のまま", official)]);
    expect(html).toContain("&lt;b>太字&lt;/b>は字のまま");
    expect(html).not.toContain("<b>太字</b>");
    expect(html).toContain("事務所の文・公式の文を見る");
    expect(html).toContain(`data-help-office="${id}"`);
    // 公式の説明が変わった行は札を変える
    expect(render(w, f, [entry(id, "append", "足した段落", official, true)])).toContain("事務所の文（公式の説明が変わりました）");
    // 消すと「?」ごと出さない
    const hidden = render(w, f, [entry(id, "hide", null, official)]);
    expect(hidden).not.toContain(official);
    expect(hidden).not.toContain(`aria-label="${f.label}の説明"`);
  });

  const result = (notices: { code: string; ids: string[] }[]): PreviewResult => ({ header: { engine: { version: "x", sourceDigest: "x" }, baseMonth: "2026-10", endYear: 2080, notices }, table: [], summary: null });
  const MISSING = { code: "N_NOT_SUPPORTED", ids: ["x", "transfers"] };
  const ASSUMED = { code: "N_NOT_SUPPORTED", ids: ["x", "residentTax.designatedCityAllocation"] };
  const official = (key: string) => noticeTextTable().find((n) => n.key === key)?.text as string;

  it("計算の知らせ: 言い方を変えられる。隠せるのは前提の外・仮の値・制度データの知らせだけで、一覧の最後から開ける", () => {
    const w = wh();
    const texts = officeTextsFrom([
      entry("notice:N_NOT_SUPPORTED|transfers", "hide", null, official("N_NOT_SUPPORTED|transfers")),
      entry("notice:N_NOT_SUPPORTED|residentTax.designatedCityAllocation", "hide", null, official("N_NOT_SUPPORTED|residentTax.designatedCityAllocation")),
    ]);
    const rows = noticeRows(w, [{ label: "現状", result: result([MISSING, ASSUMED]) }], texts);
    const missing = rows.find((r) => r.kind === "missing");
    const assumed = rows.find((r) => r.kind === "assumed");
    expect(missing?.hidden).toBeUndefined();
    expect(missing?.text).toBe(official("N_NOT_SUPPORTED|transfers"));
    expect(assumed?.hidden).toBe(true);
    const html = renderToString(h(CalcNotices, { rows, initialOpen: true }));
    expect(html).toContain("事務所の設定で隠している知らせ（1件）");
    expect(html).toContain(official("N_NOT_SUPPORTED|transfers"));
    // 書き換え
    const re = noticeRows(w, [{ label: "現状", result: result([MISSING]) }], officeTextsFrom([entry("notice:N_NOT_SUPPORTED|transfers", "replace", "口座の移し替えは、この試算に入れていません", official("N_NOT_SUPPORTED|transfers"))]));
    expect(re[0]?.text).toBe("口座の移し替えは、この試算に入れていません");
    expect(renderToString(h(CalcNotices, { rows: re, initialOpen: true }))).toContain("事務所の文・公式の文を見る");
    // 事務所の文が無ければ今までと同じ
    expect(noticeRows(w, [{ label: "現状", result: result([MISSING]) }])[0]).not.toHaveProperty("office");
  });
});

const status = (over: Partial<CustomTextsStatus>): CustomTextsStatus => ({
  dir: "~/Documents/lifeplan-custom",
  isDefaultDir: true,
  folderExists: true,
  file: "present",
  fingerprint: `sha256:${"a".repeat(64)}`,
  state: "none",
  errors: [],
  warnings: [],
  unused: [],
  approved: null,
  ledgerReset: false,
  approvedMissing: false,
  rows: [],
  updates: [],
  effective: [],
  catalogSize: 285,
  ...over,
});

describe("事務所の既定値の画面の「説明の文（カスタム層）」", () => {
  const host = { status: noop, approve: noop, decline: noop, revert: noop, rows: noop, resetLedger: noop, chooseDir: noop, resetDir: noop, createDir: noop } as never;
  const row = { id: "field:a", where: "貯蓄・運用の「取得価額（元本）」の「?」", audience: "fp", official: "公式の文", current: null, next: { do: "replace" as const, text: "新しい文" }, changed: true, unused: false };

  it("承認待ち: 公式の文／今の事務所の文／新しい文を並べ、承認する・承認しないを出す", () => {
    const html = renderToString(h(CustomTextsSection, { host, status: status({ state: "pending", rows: [row] }), onStatus: noop }));
    expect(html).toContain("承認待ち");
    expect(html).toContain("公式の文");
    expect(html).toContain("新しい文");
    expect(html).toMatch(/<button[^>]*data-custom-approve[^>]*>承認する/);
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*data-custom-approve/);
    expect(html).toContain("承認しない（今のまま）");
    expect(html).toContain("~/Documents/lifeplan-custom");
  });

  it("誤りがあれば承認できない（誤りの文を出す）", () => {
    const html = renderToString(h(CustomTextsSection, { host, status: status({ state: "pending", rows: [row], errors: [{ row: 0, id: "notice:N_X", code: "E_TEXTS_NOT_HIDEABLE", message: "この知らせは消せません" }] }), onStatus: noop }));
    expect(html).toContain("1行目（notice:N_X）: この知らせは消せません");
    expect(html).toMatch(/<button[^>]*disabled[^>]*data-custom-approve/);
  });

  it("更新で公式の文が変わった行は、前と新しい公式の文と事務所の文を並べ、このまま使う・公式の文に戻すを出す", () => {
    const up = { id: "field:a", nowId: "field:a", where: "場所", before: "前の文", official: "新しい公式の文", office: { do: "replace" as const, text: "事務所の文" }, stopped: true, reason: "meaning" as const };
    const html = renderToString(h(CustomTextsSection, { host, status: status({ state: "approved", updates: [up], approved: { fingerprint: "x", approvedAt: 1_793_000_000 } }), onStatus: noop }));
    expect(html).toContain("公式の説明が 1 か所変わりました");
    expect(html).toContain("前の文");
    expect(html).toContain("意味が変わったため");
    expect(html).toContain("このまま使う");
    expect(html).toContain("公式の文に戻す");
  });

  it("台帳を確かめられなかったときは知らせる。お知らせの一覧にも事務所の知らせとして出す", () => {
    const st = status({ ledgerReset: true, state: "pending" });
    expect(renderToString(h(CustomTextsSection, { host, status: st, onStatus: noop }))).toContain("承認の記録を確かめられませんでした");
    const items = customCenterNotice(st);
    expect(items.map((i) => i.category)).toEqual(["office", "office"]);
    expect(items[1]?.title).toContain("承認待ち");
    expect(customCenterNotice(status({}))).toEqual([]);
  });

  it("様子の1行と行の文の見せ方", () => {
    expect(customStateLine(status({}))).toContain("285 か所");
    expect(rowTextLabel({ do: "hide", text: null })).toBe("（出さない）");
    expect(rowTextLabel({ do: "append", text: "足す" })).toBe("（公式の文の後ろに足す）\n足す");
    expect(rowTextLabel(null)).toBe("（公式の文）");
  });
});
