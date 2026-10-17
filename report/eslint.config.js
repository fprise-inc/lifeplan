// lint の設定（帳票の入力を組み立てる部品・道具・テスト）
import js from "@eslint/js";
import tseslint from "typescript-eslint";

const root = import.meta.dirname;

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: root } },
  },
  {
    files: ["scripts/**/*.ts", "test/**/*.ts", "*.js", "*.ts"],
    languageOptions: { globals: { process: "readonly", console: "readonly", URL: "readonly" } },
  },
);
