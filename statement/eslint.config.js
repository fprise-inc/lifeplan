// lint の設定。src/ は画面（WebView）からも読み込むので、Node の組み込みを使わない（0034。明細はすべて PC の中で読み、外に送らない）
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
        { name: "fetch", message: "明細は外に送らない（0034 の2）" },
        { name: "XMLHttpRequest", message: "明細は外に送らない（0034 の2）" },
        { name: "WebSocket", message: "明細は外に送らない（0034 の2）" },
      ],
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
  {
    files: ["scripts/**/*.ts", "test/**/*.ts", "*.js", "*.ts"],
    languageOptions: { globals: { process: "readonly", console: "readonly", URL: "readonly" } },
  },
);
