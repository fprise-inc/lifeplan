// lint の設定（画面）。0016 の約束を書いた時点で止める:
// - 提示層（src/presentation/）は、作業の層・エンジン・本体の命令を読み込めない（PresentationModel だけを受け取る）
// - 持ち帰り用のレポート（src/takeaway/）は、許可した値と純粋な部品だけを読む（0030）
// - 画面の保存機能・文字列からのコードの実行を使わない
import js from "@eslint/js";
import tseslint from "typescript-eslint";

const root = import.meta.dirname;

const browserGlobals = {
  window: "readonly",
  document: "readonly",
  navigator: "readonly",
  location: "readonly",
  performance: "readonly",
  fetch: "readonly",
  console: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  structuredClone: "readonly",
  getComputedStyle: "readonly",
  requestAnimationFrame: "readonly",
  cancelAnimationFrame: "readonly",
  ResizeObserver: "readonly",
  Event: "readonly",
  KeyboardEvent: "readonly",
  HTMLElement: "readonly",
  HTMLInputElement: "readonly",
  HTMLButtonElement: "readonly",
  HTMLSelectElement: "readonly",
  HTMLDialogElement: "readonly",
  Element: "readonly",
  DOMException: "readonly",
};

export default tseslint.config(
  { ignores: ["dist/**", "public/**", "src/generated/**", "src-tauri/**", "node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    languageOptions: { globals: browserGlobals, parserOptions: { projectService: true, tsconfigRootDir: root } },
    rules: {
      // 0016 の1: 画面に保存しない（起動時のスクリプトでも止めている）・文字列からコードを作らない
      "no-restricted-globals": [
        "error",
        { name: "localStorage", message: "画面に保存しない（0016）" },
        { name: "sessionStorage", message: "画面に保存しない（0016）" },
        { name: "indexedDB", message: "画面に保存しない（0016）" },
        { name: "caches", message: "画面に保存しない（0016）" },
        { name: "WebAssembly", message: "画面では WebAssembly を使わない（0016）" },
      ],
      "no-restricted-properties": [
        "error",
        { object: "document", property: "cookie", message: "画面に保存しない（0016）" },
        { object: "window", property: "localStorage", message: "画面に保存しない（0016）" },
        { object: "window", property: "open", message: "新しいウィンドウを開かない（0016）" },
      ],
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // 0016 の2: 提示層は内部情報を構造的に受け取らない
    files: ["src/presentation/**/*.ts", "src/presentation/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { regex: "(^|/)(workspace|engine|generated)(/|$)", message: "提示層は作業の層・エンジン・登録簿を読み込めない。PresentationModel（./model.ts）だけを受け取る（0016 の2）" },
            { regex: "(^|/)App(\\.tsx)?$", message: "提示層は画面の大枠を読み込めない（0016 の2）" },
            { regex: "^@tauri-apps/", message: "提示層は本体の命令を呼べない（0016 の2）" },
          ],
        },
      ],
    },
  },
  {
    // 0030: 持ち帰り用のレポート（顧客に渡すファイルの中の画面）は、許可した値（takeaway/model.ts）と、計算結果から提示用の値を作る純粋な部品だけを読む。
    // 本体の命令・保存・AI・事務所・世帯ファイルの部品は読み込めない
    files: ["src/takeaway/**/*.ts", "src/takeaway/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { regex: "(^|/)workspace/(?!(levers|present|roles|balanceTab|moneyThree)\\.ts$)", message: "持ち帰り用のレポートは、作業の層のうち levers・present・roles・balanceTab・moneyThree だけを読める（0030・0032）" },
            { regex: "(^|/)engine/(host|dual)(\\.ts)?$", message: "持ち帰り用のレポートは本体の命令・二本立ての部品を読めない（0030）" },
            { regex: "(^|/)App(\\.tsx)?$", message: "持ち帰り用のレポートは画面の大枠を読み込めない（0030）" },
            { regex: "^@tauri-apps/", message: "持ち帰り用のレポートは本体の命令を呼べない（0030）" },
          ],
        },
      ],
    },
  },
  {
    files: ["scripts/**/*.ts", "test/**/*.ts", "test/**/*.tsx", "*.js", "*.ts"],
    languageOptions: { globals: { process: "readonly", console: "readonly", URL: "readonly", Buffer: "readonly", setTimeout: "readonly", structuredClone: "readonly", performance: "readonly" } },
  },
);
