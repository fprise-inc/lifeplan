// カードのパネルの手直し（0077）: 欄の説明は名前の横の「?」の中・推定の根拠は印を押したとき・区画の説明の状態の言葉だけを画面に・
// 確かめの一覧の推定の根拠は行を開いたとき
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { CheckList } from "../src/workspace/input/CheckList.tsx";
import { checkList } from "../src/workspace/input/checkRows.ts";
import { splitNote, StateMark } from "../src/workspace/input/FieldViews.tsx";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { InputPanel } from "../src/workspace/input/InputPanel.tsx";
import { STAGE_ORDER } from "../src/workspace/input/stages/index.ts";
import { REPO_DIR } from "../scripts/lib.ts";
import { modelHousehold } from "./helpers.ts";

const noop = () => undefined;
const MODELS = readdirSync(join(REPO_DIR, "data", "modelHouseholds"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.slice(0, -5));
const open = (m: string): WorkingHousehold => fromRequest(modelHousehold(m), {});
const panel = (wh: WorkingHousehold, card: string, level: "simple" | "detail" = "detail") => renderToString(h(InputPanel, { wh, itemId: card, level, onLevel: noop, onSave: noop, onClose: noop }));

/** 画面に常に出ている部分（「?」の中の隠した説明を除く） */
const visiblePart = (html: string) => html.replace(/<span id="help-[^"]*" role="tooltip"[\s\S]*?<\/span><\/span>/g, "");

describe("欄の説明は「?」の中", () => {
  it.each(MODELS)("%s: どのパネルにも、欄の下の説明の行（fld-help の説明・推定の根拠の1行）と区画の下の説明の段落が無い", (m) => {
    const wh = open(m);
    for (const s of STAGE_ORDER) {
      const html = panel(wh, s.id);
      // 欄の下に残すのは、入れた文字の問題・注意・時点の読み・出来事の状態だけ（fld-help bad / warn / when-read / 選べる出来事が無い）
      const helps = [...html.matchAll(/<div class="fld-help([^"]*)"[^>]*>([^<]*)/g)].map((x) => ({ cls: (x[1] ?? "").trim(), text: x[2] ?? "" }));
      const plain = helps.filter((x) => x.cls === "" && x.text !== "選べる出来事がまだありません");
      expect(plain, `${s.label}`).toEqual([]);
      expect(html).not.toContain('class="fld-help est-basis"');
      expect(html).not.toContain('class="ip-lead"');
    }
  });

  it("パネルの見出しの「?」に、カードの説明と推定・確定の決まり", () => {
    const html = panel(open("salariedCoupleTwoKids"), "work", "simple");
    expect(html).toContain('data-help="panel"');
    expect(html).toMatch(/data-help="panel"[\s\S]*「この値にする」/);
  });
});

describe("推定の根拠は印を押したとき", () => {
  it("根拠のある「推定」の印は押せるボタンで、根拠は隠して置く", () => {
    const html = renderToString(h(StateMark, { status: "estimated", basis: "統計の平均", text: "推定", label: "年収" }));
    expect(html).toContain('class="help-btn help-mark badge est"');
    expect(html).toContain('data-state="estimated"');
    expect(html).toMatch(/role="tooltip"[^>]*hidden[^>]*><p class="est-basis" data-basis="true">推定: 統計の平均<\/p>/);
  });
  it("根拠の無い印（該当なしなど）はただの札", () => {
    const html = renderToString(h(StateMark, { status: "notApplicable", basis: null, text: "該当なし", label: "年収" }));
    expect(html).toBe('<span class="badge na" data-state="notApplicable">該当なし</span>');
  });
  it("パネルの欄の「推定」の印は、根拠を押して開く形", () => {
    const html = panel(open("salariedCoupleTwoKids"), "assumptions");
    expect(html).toContain('class="help-btn help-mark badge est"');
  });
});

describe("区画・まとまりの説明", () => {
  it("「まだありません」は画面に、続きの説明は「?」の中", () => {
    expect(splitNote("まだありません。旅行・家電の買い替えなど")).toEqual({ state: "まだありません", help: "旅行・家電の買い替えなど" });
    expect(splitNote("まだありません（受け取っていれば、通知書の年額を入れます）")).toEqual({ state: "まだありません", help: "受け取っていれば、通知書の年額を入れます" });
    expect(splitNote("まだありません")).toEqual({ state: "まだありません", help: null });
    expect(splitNote("住居費はここで入れます")).toEqual({ state: null, help: "住居費はここで入れます" });
    expect(splitNote("該当なし。退職金・企業年金は無いとしています")).toEqual({ state: "該当なし", help: "退職金・企業年金は無いとしています" });
    expect(splitNote(undefined)).toEqual({ state: null, help: null });
  });
  it("パネルの区画の説明は見出しの「?」の中（画面の段落には出さない）", () => {
    const html = panel(open("salariedCoupleTwoKids"), "housing", "simple");
    expect(html).toContain("基本生活費には含めません");
    expect(visiblePart(html)).not.toContain("基本生活費には含めません");
  });
});

describe("確かめの一覧", () => {
  it("推定の行の根拠は「根拠」で開く（閉じた形では出さない）。未入力の行の文は状態の知らせなので出したまま", () => {
    const wh = open("salariedCoupleTwoKids");
    const rows = checkList(wh);
    const est = rows.find((r) => (r.kind === "estimated" || r.kind === "premise") && r.detail !== null);
    const miss = rows.find((r) => r.kind === "missing" && r.detail !== null);
    expect(est).toBeDefined();
    expect(miss).toBeDefined();
    const html = renderToString(h(CheckList, { wh, onEdit: noop, onOpen: noop }));
    expect(html).toContain(`data-ck-basis="${est!.id}"`);
    const estLi = /<li[^>]*data-ck-row="([^"]*)"[\s\S]*?<\/li>/g;
    const byId = new Map([...html.matchAll(estLi)].map((x) => [x[1] ?? "", x[0]]));
    expect(byId.get(est!.id)).not.toContain('class="ck-detail"');
    expect(byId.get(miss!.id)).toContain('class="ck-detail"');
    expect(html).toContain('data-help="checklist"');
  });
});
