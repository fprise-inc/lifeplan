// 0002・0006: lint の禁止が効いていること（禁止したものを書いたファイルで lint が失敗する）
import { join } from "node:path";
import { ESLint } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";
import financia, { componentRules, engineRules } from "../eslint-plugin/index.js";
import { ENGINE_DIR } from "../scripts/lib.ts";

const FIXTURES = join(ENGINE_DIR, "test", "lint-fixtures");

async function lint(file: string) {
  const eslint = new ESLint({
    cwd: ENGINE_DIR,
    overrideConfigFile: true,
    ignore: false,
    overrideConfig: [
      {
        files: ["**/*.ts"],
        languageOptions: { parser: tseslint.parser, parserOptions: { project: join(FIXTURES, "tsconfig.json"), tsconfigRootDir: FIXTURES } },
        plugins: { financia },
        rules: { ...engineRules, ...componentRules(join(FIXTURES, "components"), join(ENGINE_DIR, "src", "sdk")) },
      },
    ],
  });
  const [result] = await eslint.lintFiles([join(FIXTURES, "components", file)]);
  return result?.messages ?? [];
}

describe("lint の禁止", () => {
  it("禁止した関数・演算子・リテラル・直接の呼び出しを止める", async () => {
    const messages = await lint("test.fixture.bad/index.ts");
    expect(messages.filter((m) => m.fatal)).toEqual([]);
    const at = (rule: string) => messages.filter((m) => m.ruleId === rule).map((m) => m.line);
    // 部品のフォルダの外の import（他の部品・SDK 以外のエンジンの中身）
    expect(at("financia/component-boundaries")).toEqual([3, 4]);
    expect(at("financia/no-module-state")).toEqual([6]);
    // 0113 の8: 互換モードを読む書き方（分割代入・点・角括弧・in）
    expect(at("financia/no-compatibility")).toEqual([23, 24, 24, 24]);
    // Yen への * と /
    expect(at("financia/no-money-arithmetic")).toEqual([13, 14]);
    const props = messages.filter((m) => m.ruleId === "no-restricted-properties").map((m) => m.message);
    for (const name of ["Math.pow", "toFixed", "Math.random", "Math.round", "Math.exp"]) expect(props.some((p) => p.includes(name)), name).toBe(true);
    const syntax = messages.filter((m) => m.ruleId === "no-restricted-syntax").map((m) => m.line);
    expect(syntax).toContain(10); // 1.01
    expect(syntax).toContain(11); // **
    const globals = messages.filter((m) => m.ruleId === "no-restricted-globals").map((m) => m.message);
    expect(globals.some((g) => g.includes("Date"))).toBe(true);
    expect(globals.some((g) => g.includes("parseFloat"))).toBe(true);
  });

  it("正しい書き方の部品は通る", async () => {
    expect(await lint("test.fixture.good/index.ts")).toEqual([]);
  });
});
