// lint の設定。計算エンジン（src/）には 0002・0005・0006 の禁止を掛ける
import { join } from "node:path";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import financia, { componentRules, engineRules } from "./eslint-plugin/index.js";

const root = import.meta.dirname;

export default tseslint.config(
  { ignores: ["dist/**", "src/generated/**", "test/lint-fixtures/**", "node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: root } },
    plugins: { financia },
    rules: engineRules,
  },
  {
    files: ["src/components/**/*.ts"],
    rules: componentRules(join(root, "src", "components"), join(root, "src", "sdk")),
  },
  // 0113 の8: 部品が使う SDK も互換モードを読まない（互換モードは src/engine/compatibility.ts の1か所でだけ読む）
  {
    files: ["src/sdk/**/*.ts"],
    rules: { "financia/no-compatibility": "error" },
  },
  {
    files: ["scripts/**/*.ts", "scripts/**/*.js", "test/**/*.ts", "eslint-plugin/**/*.js", "*.js", "*.ts"],
    languageOptions: { globals: { process: "readonly", console: "readonly", URL: "readonly" } },
  },
);
