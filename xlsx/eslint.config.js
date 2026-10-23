// lint の設定。src/ は画面（WebView）からも読み込むので、Node の組み込みを使わない。
// 返ってきたファイルは PC の中だけで読み、外に送らない（0018 の6・0034 の2）
import js from "@eslint/js";
import tseslint from "typescript-eslint";

const root = import.meta.dirname;

export default tseslint.config(
  { ignores: ["node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: root } },
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group: ["node:*", "fs", "path", "crypto", "zlib", "http", "https"], message: "src/ は画面からも読むので Node の組み込みを使わない" }] }],
      "no-restricted-globals": [
        "error",
        { name: "eval", message: "取り込んだファイルの中身を実行しない" },
        { name: "fetch", message: "読んだファイルを外に送らない" },
        { name: "XMLHttpRequest", message: "読んだファイルを外に送らない" },
        { name: "WebSocket", message: "読んだファイルを外に送らない" },
      ],
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
  {
    files: ["scripts/**/*.ts", "test/**/*.ts", "*.js", "*.ts"],
    languageOptions: { globals: { process: "readonly", console: "readonly", URL: "readonly" } },
  },
);
