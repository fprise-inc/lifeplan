// カスタム層の名前の差し替え（settings/terms.json）・入力の欄の隠す・並べ替え（settings/fields.json）・推定の根拠の文（estimate:…）。
// 0016 の 2026-11-02 の追記「名前の差し替え・隠す・並べ替え・推定の根拠の文」。読み書き・検査・指紋・承認の台帳・既定の値を受け付けないことは
// 本体（crates/custom-layer）のテスト。ここは、一覧を画面の定義から作ること・承認した中身を画面と提示用の値・提案書・持ち帰り用のレポートに当てること
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import type { CustomTextsStatus } from "../src/engine/host.ts";
import { ROW_LABELS } from "../src/generated/labels.ts";
import { Field, Group } from "../src/workspace/input/FieldViews.tsx";
import type { FieldDef, GroupDef } from "../src/workspace/input/form.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { buildStage, STAGE_ORDER } from "../src/workspace/input/stages/index.ts";
import { estimateTextId, fieldTextId } from "../src/workspace/input/textIds.ts";
import { fieldStatus, hasFieldValue } from "../src/workspace/input/valueState.ts";
import { arrangeFields, NO_OFFICE_NAMES, officeFieldsFrom, officeTextsFrom, rowNamesOf, type OfficeTextEntry } from "../src/workspace/office/customTexts.ts";
import { OfficeFieldsContext, OfficeNamesContext, OfficeTextsContext } from "../src/workspace/office/customTextsContext.ts";
import { customCenterNotice } from "../src/workspace/office/customNotice.ts";
import { CustomTextsSection, rowTextLabel } from "../src/workspace/office/CustomTextsSection.tsx";
import { CURRENT } from "../src/workspace/plans/band.ts";
import { rowDefs, toPresentation } from "../src/workspace/present.ts";
import { DEFAULT_CHAPTERS, planReport, reportInput } from "../src/workspace/report/assemble.ts";
import { buildPayload } from "../src/workspace/takeaway/build.ts";
import { fillName, ROW_NAMES, rowName } from "../../report/src/rowNames.ts";
import { buildFieldsCatalog, buildTermsCatalog, buildTextsCatalog, FIELDS_CATALOG_PATH, FIELDS_CATALOG_SCHEMA, TERMS_CATALOG_PATH, TERMS_CATALOG_SCHEMA } from "../scripts/textsCatalog.ts";
import { modelHousehold, preview } from "./helpers.ts";
import { setOfficeEstimates } from "../../hearing/src/statistics.ts";
import { choiceFor, openHousehold } from "./takeawayFixture.ts";

const sha = (s: string) => `sha256:${createHash("sha256").update(s, "utf8").digest("hex")}`;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const noop = () => undefined;
const entry = (id: string, text: string | null, official: string, op: OfficeTextEntry["do"] = "replace", order?: number): OfficeTextEntry => ({ id, do: op, text, official, officialChanged: false, ...(order !== undefined ? { order } : {}) });
const HH = "salariedCoupleTwoKids";

describe("名前の一覧・欄の一覧（画面の定義から作る）", () => {
  const terms = buildTermsCatalog();
  const fields = buildFieldsCatalog();

  it("prepare-assets が書いた一覧は、今の画面の定義から作った物と同じ（本体はこのファイルを埋め込む）", () => {
    expect(JSON.parse(readFileSync(TERMS_CATALOG_PATH, "utf8"))).toEqual(JSON.parse(JSON.stringify(terms)));
    expect(JSON.parse(readFileSync(FIELDS_CATALOG_PATH, "utf8"))).toEqual(JSON.parse(JSON.stringify(fields)));
  });

  it("名前の一覧: 入力の欄の名前と表の行の名前。名前は消せない（書き換えだけ）。表の行はお客さまにも見える", () => {
    expect(terms.schema).toBe(TERMS_CATALOG_SCHEMA);
    const ids = new Set<string>();
    for (const e of terms.entries) {
      expect(e.id).not.toMatch(UUID);
      expect(e.hash).toBe(sha(e.text));
      expect(e.ops).toEqual(["replace"]);
      expect(e.audience).toBe(e.kind === "row" ? "customer" : "fp");
      expect(ids.has(e.id)).toBe(false);
      ids.add(e.id);
    }
    expect(terms.entries.filter((e) => e.kind === "field").length).toBeGreaterThan(100);
    // 表の行は report/src/rowNames.ts の表のすべて。人ごとの行は {person} を差し込める
    expect(terms.entries.filter((e) => e.kind === "row").map((e) => e.id.slice(4)).sort()).toEqual(Object.keys(ROW_NAMES).sort());
    expect(terms.entries.find((e) => e.id === "row:salary")?.vars).toEqual(["person"]);
  });

  it("表の行の公式の名前は、画面の表の行の名前と同じ（登録簿の名前とも）", () => {
    const req = modelHousehold(HH);
    for (const d of rowDefs(req)) {
      const key = d.key.includes(":") ? (d.key.split(":")[0] as string) : d.key;
      expect(ROW_NAMES[key], d.key).toBeDefined();
      if (!d.key.includes(":")) expect(d.label).toBe(ROW_NAMES[key]);
    }
    expect(ROW_NAMES.living).toBe(ROW_LABELS["cf.expense.living"]);
  });

  it("欄の一覧: 隠す・並べ替えのできる欄。text は公式の名前", () => {
    expect(fields.schema).toBe(FIELDS_CATALOG_SCHEMA);
    expect(fields.entries.length).toBeGreaterThan(100);
    for (const e of fields.entries) {
      expect(e.id.startsWith("field:")).toBe(true);
      expect(e.ops).toEqual(["hide", "order"]);
    }
  });

  it("推定の根拠の文は説明の一覧に載る。消せない（書き換える・足すだけ）。公式の文は {basis}、事務所の文には {basis}・{value} を差し込める", () => {
    const est = buildTextsCatalog().entries.filter((e) => e.kind === "estimate");
    expect(est.length).toBeGreaterThan(5);
    for (const e of est) {
      expect(e.id).toMatch(/^estimate:[a-zA-Z]/);
      expect(e.id).not.toMatch(UUID);
      expect(e.ops).toEqual(["replace", "append"]);
      expect(e.text).toBe("{basis}");
      expect(e.vars).toEqual(["basis", "value"]);
    }
  });
});

/** 名前の一覧にある、説明の無い欄（入力の画面の1つ目のまとまりから探す） */
function namedField(wh: WorkingHousehold): { f: FieldDef; id: string } {
  for (const st of STAGE_ORDER)
    for (const s of buildStage(st.id, wh).sections)
      for (const g of s.groups)
        for (const f of g.fields) {
          const id = fieldTextId(f, wh);
          if (id !== null && f.kind === "yen" && f.readOnly === undefined) return { f, id };
        }
  throw new Error("欄がありません");
}

describe("名前の差し替え: どこでも同じ名前・公式の名前をいつでも見られる", () => {
  const wh = fromRequest(modelHousehold(HH), {});

  it("入力の欄: 事務所の名前で出し、「?」で公式の名前を見られる。承認した物が無ければ公式の名前のまま", () => {
    const { f, id } = namedField(wh);
    const render = (list: OfficeTextEntry[]) => renderToString(h(OfficeNamesContext.Provider, { value: officeTextsFrom(list) }, h(Field, { f, wh, onEdit: noop })));
    const plain = render([]);
    expect(plain).toContain(f.label);
    expect(plain).not.toContain("公式の名前");
    const html = render([entry(id, "事務所の<呼び名>", f.label)]);
    expect(html).toContain("事務所の&lt;呼び名>");
    expect(html).toContain(`data-official-name="${f.label}"`);
    expect(html).toContain(`公式の名前: ${f.label}`);
    // 承認したときの公式の名前が今の名前と違えば当てない
    expect(render([entry(id, "事務所の呼び名", "前の名前")])).not.toContain("事務所の呼び名");
  });

  const o = openHousehold(HH);
  const names = rowNamesOf(officeTextsFrom([entry("row:living", "毎月の暮らしの費用", "基本生活費"), entry("row:salary", "{person}のお給料", "{person}の給与"), entry("field:x", "入力の欄", "欄")]));

  it("表の行: 名前の一覧の row:… だけを渡す（事務所の名前である印は持たない）", () => {
    expect(names).toEqual({ "row:living": { name: "毎月の暮らしの費用", official: "基本生活費" }, "row:salary": { name: "{person}のお給料", official: "{person}の給与" } });
    expect(rowNamesOf(NO_OFFICE_NAMES)).toBeUndefined();
    expect(rowName(names, "salary", { person: "ご本人" })).toBe("ご本人のお給料");
    expect(rowName({ "row:living": { name: "x", official: "前の名前" } }, "living")).toBe("基本生活費");
    expect(fillName("{{字}}{person}", { person: "配偶者" })).toBe("{字}配偶者");
  });

  it("お客さまに見せる画面（提示用の値）の表に同じ名前が出る", () => {
    const req = o.wh.request;
    const res = preview(req);
    const m = toPresentation({ base: req, proposal: req, current: res, proposed: res, targetAge: 95, selectedYear: null, provisional: false, rowNames: names });
    const labels = m.table.rows.map((r) => r.label);
    expect(labels).toContain("毎月の暮らしの費用");
    expect(labels).not.toContain("基本生活費");
    expect(labels.some((l) => l.endsWith("のお給料"))).toBe(true);
    expect(JSON.stringify(m)).not.toContain("事務所の");
  });

  it("提案書（帳票の入力）の表と、同じ名前の内訳に同じ名前が出る", () => {
    const plan = planReport(o.ctx, { proposal: o.b, compare: [CURRENT, o.b], base: CURRENT, chapters: DEFAULT_CHAPTERS, targetAge: 95, issuedOn: "2026-11-02", preparedBy: "" });
    const results = Object.fromEntries(Object.entries(plan.requests).map(([k, r]) => [k, preview(r)]));
    const plainInput = reportInput(plan.bundle(results));
    const input = reportInput({ ...plan.bundle(results), names });
    const rows = input.cashflow.proposal.rows.map((r) => r.label);
    expect(rows).toContain("毎月の暮らしの費用");
    expect(rows).not.toContain("基本生活費");
    expect(input.basics.expense.map((x) => x.label)).toContain("毎月の暮らしの費用");
    expect(plainInput.cashflow.proposal.rows.map((r) => r.label)).toContain("基本生活費");
    // 数字は変わらない（名前だけ）
    expect(input.cashflow.proposal.rows.map((r) => r.cells)).toEqual(plainInput.cashflow.proposal.rows.map((r) => r.cells));
  });

  it("持ち帰り用のレポート: 名前を中身に入れ、レポートの中の表（同じ部品）にも同じ名前が出る", () => {
    const payload = buildPayload(o.ctx, choiceFor(o, { names }));
    expect(payload.names).toEqual(names);
    expect(buildPayload(o.ctx, choiceFor(o)).names).toBeUndefined();
    // レポートの中は、同じ toPresentation に payload.names を渡す（TakeawayView）
    const req = payload.plans[0]!.request;
    const res = preview(req);
    const m = toPresentation({ base: req, proposal: req, current: res, proposed: res, targetAge: payload.targetAge, selectedYear: null, provisional: false, ...(payload.names !== undefined ? { rowNames: payload.names } : {}) });
    expect(m.table.rows.map((r) => r.label)).toContain("毎月の暮らしの費用");
  });
});

/** 値の入った欄と値の無い欄を2つ以上持つまとまり */
function mixedGroup(wh: WorkingHousehold): { g: GroupDef; withValue: FieldDef; empty: FieldDef } {
  for (const st of STAGE_ORDER)
    for (const s of buildStage(st.id, wh).sections)
      for (const g of s.groups) {
        if (g.info !== undefined || g.chips === true || g.fields.length < 3) continue;
        const ided = g.fields.filter((f) => fieldTextId(f, wh) !== null);
        const withValue = ided.find((f) => hasFieldValue(f, wh));
        const empty = ided.find((f) => !hasFieldValue(f, wh));
        if (withValue !== undefined && empty !== undefined) return { g, withValue, empty };
      }
  throw new Error("まとまりがありません");
}

describe("入力の欄の隠す・並べ替え（見せ方だけ）", () => {
  const wh = fromRequest(modelHousehold(HH), {});
  const { g, withValue, empty } = mixedGroup(wh);
  const idOf = (f: FieldDef) => fieldTextId(f, wh) as string;
  const render = (list: OfficeTextEntry[]) => renderToString(h(OfficeFieldsContext.Provider, { value: officeFieldsFrom(list) }, h(Group, { group: g, wh, level: "detail", onEdit: noop })));
  const order = (html: string) => [...html.matchAll(/data-field="([^"]+)"/g)].map((m) => m[1]);

  it("値の無い欄は隠せる。値の入った欄は、隠す設定でも出す", () => {
    const plain = render([]);
    expect(plain).toContain(`data-field="${withValue.key}"`);
    expect(plain).toContain(`data-field="${empty.key}"`);
    const html = render([entry(idOf(withValue), null, withValue.label, "hide"), entry(idOf(empty), null, empty.label, "hide")]);
    expect(html).toContain(`data-field="${withValue.key}"`);
    expect(html).not.toContain(`data-field="${empty.key}"`);
  });

  it("隠しても計算は変わらない（世帯の値も計算の要求もそのまま）", () => {
    const before = JSON.stringify(wh);
    const res = preview(wh.request);
    render([entry(idOf(empty), null, empty.label, "hide")]);
    expect(JSON.stringify(wh)).toBe(before);
    expect(preview(wh.request)).toEqual(res);
  });

  it("並べ替え: order はまとまりの中で何番目に出すか。書いていない欄は今の並び、同じ番号なら書いた欄が先", () => {
    const plain = order(render([]));
    const last = g.fields.filter((f) => plain.includes(f.key) && fieldTextId(f, wh) !== null).at(-1)!;
    const moved = order(render([entry(idOf(last), null, last.label, "order", 1)]));
    expect(moved[0]).toBe(last.key);
    expect(moved.slice(1)).toEqual(plain.filter((k) => k !== last.key));
    // 純粋な並べ方
    const xs = ["a", "b", "c", "d"];
    const layout = officeFieldsFrom([entry("c", null, "", "order", 2), entry("a", null, "", "order", 99), entry("d", null, "", "hide")]);
    expect(arrangeFields(xs, (x) => x, (x) => x === "d" && false, layout)).toEqual(["c", "b", "a"]);
    expect(arrangeFields(xs, (x) => x, () => true, layout)).toEqual(["c", "b", "d", "a"]);
  });
});

describe("推定の根拠の文（estimate:…）", () => {
  const wh = fromRequest(modelHousehold(HH), {});
  const est = (() => {
    for (const st of STAGE_ORDER)
      for (const s of buildStage(st.id, wh).sections)
        for (const g of s.groups)
          for (const f of g.fields) {
            const id = estimateTextId(f, wh);
            if (id !== null && fieldStatus(f, wh).status === "estimated") return { f, id, basis: fieldStatus(f, wh).basis as string };
          }
    throw new Error("推定の欄がありません");
  })();
  const render = (list: OfficeTextEntry[]) => renderToString(h(OfficeTextsContext.Provider, { value: officeTextsFrom(list) }, h(Field, { f: est.f, wh, onEdit: noop })));

  it("書き換え: {basis}（公式の根拠の文）と {value}（推定の値）を差し込み、公式の文を開ける", () => {
    expect(render([])).toContain(`推定: ${est.basis}`);
    const html = render([entry(est.id, "事務所の見方です。{basis}（{value}）", "{basis}")]);
    expect(html).toContain(`推定: 事務所の見方です。${est.basis}（`);
    expect(html).not.toContain("{value}");
    expect(html).toContain(`data-help-office="${est.id}"`);
  });

  it("事務所の推定の値（0111）の根拠の文とまったく同じ根拠には書き換えを当てず、公式の根拠にはこれまでどおり当てる（短い文で取り違えない）", () => {
    const rule = [entry(est.id, "事務所の見方です。{basis}", "{basis}")];
    try {
      // 公式の根拠の一部（短い語）を事務所の文にしても、公式の根拠には書き換えが当たる
      setOfficeEstimates({ "care.statistics.months": { value: 55, basis: est.basis.slice(0, 2) } });
      expect(render(rule)).toContain(`推定: 事務所の見方です。${est.basis}`);
      // 根拠の文が事務所の文とまったく同じ（事務所の値から作った推定）なら、書き換えを当てずにそのまま出す
      setOfficeEstimates({ "care.statistics.months": { value: 55, basis: est.basis } });
      const html = render(rule);
      expect(html).toContain(`推定: ${est.basis}`);
      expect(html).not.toContain("事務所の見方です。");
    } finally {
      setOfficeEstimates({});
    }
  });

  it("消す行は効かない（本体も承認しない）。足すは公式の文の後ろ", () => {
    expect(render([entry(est.id, null, "{basis}", "hide")])).toContain(`推定: ${est.basis}`);
    expect(render([entry(est.id, "事務所の補足", "{basis}", "append")])).toContain("事務所の補足");
  });
});

describe("事務所の既定値の画面の「名前」「入力の欄の見せ方」の区画", () => {
  const host = { status: noop, approve: noop, decline: noop, revert: noop, rows: noop, resetLedger: noop, chooseDir: noop, resetDir: noop, createDir: noop } as never;
  const st = (over: Partial<CustomTextsStatus>): CustomTextsStatus => ({ dir: "~/Documents/lifeplan-custom", isDefaultDir: true, folderExists: true, file: "present", fingerprint: "sha256:x", state: "none", errors: [], warnings: [], unused: [], approved: null, ledgerReset: false, approvedMissing: false, rows: [], updates: [], effective: [], catalogSize: 276, ...over });

  it("名前: 承認待ちを並べ（お客さまにも見える名前と分かる）、承認するまで効かないと書く。使っている名前と公式の名前をいつでも見られる", () => {
    const row = { id: "row:living", where: "キャッシュフロー表の行「基本生活費」の名前", audience: "customer", official: "基本生活費", current: null, next: { do: "replace" as const, text: "毎月の暮らしの費用" }, changed: true, unused: false };
    const html = renderToString(h(CustomTextsSection, { host, kind: "terms", status: st({ kind: "terms", state: "pending", rows: [row] }), onStatus: noop }));
    expect(html).toContain("名前（カスタム層）");
    expect(html).toContain("お客さまにも見える名前");
    expect(html).toContain("公式の名前");
    expect(html).toContain("承認するまで画面に出ません");
    expect(html).toMatch(/<button[^>]*data-custom-approve[^>]*>承認する/);
    expect(html).not.toContain("data-custom-dir");
    const used = renderToString(h(CustomTextsSection, { host, kind: "terms", status: st({ kind: "terms", state: "approved", approved: { fingerprint: "x", approvedAt: 1_793_000_000 }, rows: [{ ...row, current: row.next, changed: false }], effective: [entry("row:living", "毎月の暮らしの費用", "基本生活費")] }), onStatus: noop }));
    expect(used).toContain("data-official-names");
    expect(used).toContain("使っている事務所の名前と公式の名前を見る（1 か所）");
  });

  it("入力の欄の見せ方: 隠す・何番目の書き方。既定の値は事務所の既定値の画面で変えると書く", () => {
    const html = renderToString(h(CustomTextsSection, { host, kind: "fields", status: st({ kind: "fields", state: "pending" }), onStatus: noop }));
    expect(html).toContain("入力の欄の見せ方（カスタム層）");
    expect(html).toContain("値が入っている欄は、隠す設定でも出します");
    expect(html).toContain("既定の値は、この画面の上の事務所の既定値で変えます");
    expect(rowTextLabel({ do: "hide", text: null }, "fields")).toBe("隠す（値が入っていれば出します）");
    expect(rowTextLabel({ do: "order", text: null, order: 3 }, "fields")).toBe("まとまりの中で 3 番目に出す");
  });

  it("承認待ちはお知らせの一覧にも出る", () => {
    expect(customCenterNotice(st({ kind: "terms", state: "pending" }))[0]?.title).toBe("カスタム層の名前が変わりました（承認待ち）");
    expect(customCenterNotice(st({ kind: "fields", state: "pending" }))[0]?.title).toBe("カスタム層の入力の欄の見せ方が変わりました（承認待ち）");
    expect(customCenterNotice(st({ kind: "terms", state: "approved" }))).toEqual([]);
  });
});
