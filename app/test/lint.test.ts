// 0016 の2: 提示層が作業の層・エンジン・本体の命令を読み込もうとしたら lint で止まること
import { ESLint } from "eslint";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_DIR } from "../scripts/lib.ts";

// ここで確かめる決まりは型の情報を使わないので、型の情報を作る準備（projectService。画面のコード全体を読み込む）を外して流す。
// 外さないと最初の1回に数秒、並べて流したときには時間の上限を超えるほどかかっていた
const eslint = new ESLint({ cwd: APP_DIR, overrideConfig: { languageOptions: { parserOptions: { projectService: false } } } });
const lint = async (file: string, code: string) => {
  const [r] = await eslint.lintText(code, { filePath: join(APP_DIR, file) });
  return (r?.messages ?? []).map((m) => m.ruleId);
};

describe("lint の約束", () => {
  it("提示層は作業の層・エンジン・本体の命令を読み込めない", async () => {
    const rules = await lint(
      "src/presentation/format.ts",
      'import { applyLevers } from "../workspace/levers.ts";\nimport { DualEngine } from "../engine/dual.ts";\nimport { invoke } from "@tauri-apps/api/core";\nexport const x = [applyLevers, DualEngine, invoke];\n',
    );
    expect(rules.filter((r) => r === "no-restricted-imports")).toHaveLength(3);
  });
  it("持ち帰り用のレポートは本体の命令・世帯ファイル・AI の部品を読み込めない（0030）", async () => {
    const bad = await lint(
      "src/takeaway/viewer/calc.ts",
      'import { bodyOf } from "../../workspace/store/body.ts";\nimport { tauriHost } from "../../engine/host.ts";\nimport { invoke } from "@tauri-apps/api/core";\nimport { aiModel } from "../../workspace/ai/model.ts";\nexport const x = [bodyOf, tauriHost, invoke, aiModel];\n',
    );
    expect(bad.filter((r) => r === "no-restricted-imports")).toHaveLength(4);
    const ok = await lint("src/takeaway/viewer/calc.ts", 'import { applyLevers } from "../../workspace/levers.ts";\nimport { toPresentation } from "../../workspace/present.ts";\nexport const x = [applyLevers, toPresentation];\n');
    expect(ok).toEqual([]);
  });
  it("作業の層は提示層の型を読み込める", async () => {
    const rules = await lint("src/workspace/roles.ts", 'import type { Yen } from "../presentation/model.ts";\nexport const y: Yen = 1;\n');
    expect(rules).toEqual([]);
  });
  it("画面の保存機能・文字列からのコードの実行は使えない", async () => {
    const rules = await lint("src/workspace/roles.ts", "export const a = localStorage;\nexport const b = document.cookie;\nexport const c = new Function('return 1');\n");
    expect(rules).toEqual(expect.arrayContaining(["no-restricted-globals", "no-restricted-properties", "no-new-func"]));
  });
});
