// シート定義の検査: JSON Schema・中身の決まり・入力項目ID の登録簿・配置・聞かない項目の欄が無いこと（0018・0004・0012）
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { checkDefinition, OFFICIAL_SHEETS, type SheetDefinition } from "../src/index.ts";
import { buildLayoutRows } from "../src/layout.ts";
import { HEARING_DIR, REPO_DIR } from "./helpers.ts";

const schema = JSON.parse(readFileSync(join(HEARING_DIR, "schema", "sheet-definition.schema.json"), "utf8")) as object;
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validate = ajv.compile(schema);

function allDefinitionFiles(): { file: string; def: SheetDefinition }[] {
  const root = join(HEARING_DIR, "sheets");
  return readdirSync(root).flatMap((id) =>
    readdirSync(join(root, id))
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({ file: `${id}/${f}`, def: JSON.parse(readFileSync(join(root, id, f), "utf8")) as SheetDefinition })),
  );
}

describe("シート定義", () => {
  const files = allDefinitionFiles();

  it("すべての版がアプリに同梱されている（公開したすべての版を残し続ける。0018 の7）", () => {
    expect(OFFICIAL_SHEETS.map((d) => `${d.sheetId}/${d.version}.json`).sort()).toEqual(files.map((f) => f.file).sort());
  });

  for (const { file, def } of files) {
    describe(file, () => {
      it("JSON Schema に合う", () => {
        const ok = validate(def);
        expect(validate.errors ?? [], JSON.stringify(validate.errors)).toEqual([]);
        expect(ok).toBe(true);
      });

      it("ファイルの場所とシートID・版が合う", () => {
        expect(file).toBe(`${def.sheetId}/${def.version}.json`);
      });

      it("中身の決まり（キーの重なり・配置の漏れ・軸）に合う", () => {
        expect(checkDefinition(def)).toEqual([]);
      });

      it("変換表の入力項目ID が登録簿（registry/items.yaml）にあり、廃止されていない", () => {
        const reg = parse(readFileSync(join(REPO_DIR, "registry", "items.yaml"), "utf8")) as { entries: { id: string; status: string }[] };
        const active = new Set(reg.entries.filter((e) => e.status === "active").map((e) => e.id));
        const missing = def.items.flatMap((i) => i.inputItems.filter((x) => !active.has(x)).map((x) => `${i.key} → ${x}`));
        expect(missing).toEqual([]);
      });

      it("計算に使う項目は変換表を持ち、メモ・同意の項目は持たない", () => {
        for (const i of def.items) {
          if (i.destination === undefined) expect(i.inputItems.length, i.key).toBeGreaterThan(0);
          else expect(i.inputItems, i.key).toEqual([]);
        }
      });

      it("開発中の版は、配置が項目の並びから作ったものと同じ（npm run layout）", () => {
        if (def.status !== "draft") return;
        expect(def.layout.rows).toEqual(buildLayoutRows(def));
      });

      it("名前の欄・番号類・口座番号・健康の情報を聞く欄が無い（0012・0018 の4）", () => {
        const forbidden = /氏名|お名前|名前|マイナンバー|個人番号|基礎年金番号|口座番号|証券番号|病歴|病名|既往|健康状態|通院|住所|電話/;
        for (const i of def.items) expect(i.label, i.key).not.toMatch(forbidden);
        // 1枚目の注意書きに「お名前は書かない」「聞かないこと」を明記している
        expect(def.intro.notes.some((n) => n.includes("お名前は書かないでください"))).toBe(true);
        expect(def.intro.notes.some((n) => n.includes("お聞きしません") && n.includes("マイナンバー") && n.includes("口座番号") && n.includes("健康"))).toBe(true);
      });

      it("同意の欄（利用目的・家族の情報・外部AI）が1枚目にある（0014）", () => {
        expect(def.intro.consentItems).toEqual(["hs.consent.purpose", "hs.consent.familyInfo", "hs.consent.externalAi"]);
      });
    });
  }
});
