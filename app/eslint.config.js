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
  { ignores: ["dist/**", "dist-hearing-form/**", "public/**", "src/generated/**", "src-tauri/**", "node_modules/**"] },
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
    // 0183: AI接続口に同梱する「数字の根拠」の読み方は、画面の根拠のパネルの関数（evidence）と表の行の決まり（present）だけを読む。
    // 0184: 計算の前の処理（prepare）は、エンジンへ渡す前の処理（engine/moneyRows）と事務所の推定の値の読み方（office/estimates）を読む。
    // 0194: 計算の答えの主な数字（summary）は、プランを比較する表の数え方（plans/compare）と構成員の呼び方（roles）を読む。
    // 0195: プランの動かす項目（plan）は、画面の結果のタブのプランの部品（plans/candidates・items・plans）と、作業中の世帯を作る所
    // （input/household）・役割（roles）・見本の目盛り（catalog）を読む。画面の状態（帯・選んだプラン）を持つ部品は読まない。
    // 0199: 見本の世帯の一覧（samples）は、見本の棚と同じ名前と絞り込みの項目（catalog・store/numbering）を読む。
    // 0210: 計算のお知らせ（notices）は、画面の知らせの文の表（engineNotices）と入力項目の名前（input/stageOrder）を、入力の確かめ（check）は
    // 画面の確かめの一覧（input/checkRows）と、入力項目の名前（input/items）を読む。
    // 画面の部品（preact）・本体の命令・画面の大枠は読み込めない（まとめる道具 scripts/build-explain.ts も、外の部品が入ったら止める）
    files: ["src/connector/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { regex: "(^|/)workspace/(?!(evidence|present|engineNotices|office/estimates|catalog|roles|store/numbering|input/(household|pensionLines|stageOrder|checkRows|items)|invest/present|plans/(candidates|items|plans|compare|decimal))\\.ts$)", message: "AI接続口の根拠の読み方・計算の前の処理・プランの動かす項目・主な数字・グラフは、作業の層のうち evidence・present・office/estimates・catalog・roles・input/household・input/pensionLines・invest/present・plans/candidates・plans/items・plans/plans・plans/compare・plans/decimal・store/numbering・engineNotices・input/stageOrder・input/checkRows・input/items だけを読める（0183・0184・0194・0195・0199・0203・0210）" },
            { regex: "^preact", message: "AI接続口の根拠の読み方は、画面の部品を読めない（0183）" },
            { regex: "(^|/)engine/(host|dual)(\\.ts)?$", message: "AI接続口の根拠の読み方は、本体の命令・二本立ての部品を読めない（0183）" },
            { regex: "(^|/)App(\\.tsx)?$", message: "AI接続口の根拠の読み方は、画面の大枠を読み込めない（0183）" },
            { regex: "^@tauri-apps/", message: "AI接続口の根拠の読み方は、本体の命令を呼べない（0183）" },
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
    // 0125: お客さまの画面（お客さまのブラウザで開く Web のヒアリングのページ）は、作業の層・本体の命令・エンジンを読めない。
    // FP のアプリの見本からも同じ部品（Form.tsx）を使うので、保存の決まり（0016）はそのまま。下書きを端末に暗号化して置くのは入口（main.tsx）だけ
    files: ["src/hearingForm/**/*.ts", "src/hearingForm/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { regex: "(^|/)(workspace|engine|generated|presentation)(/|$)", message: "お客さまの画面は、作業の層・エンジン・提示層を読み込めない（hearing/src/web の部品だけ。0125）" },
            { regex: "^@tauri-apps/", message: "お客さまの画面は本体の命令を呼べない（0125）" },
          ],
        },
      ],
    },
  },
  {
    // 0125: お客さまのページの入口だけ、下書き（依頼の鍵から導いた鍵で暗号化したもの）をお客さまのブラウザの保存機能に置く（FP のアプリの画面ではない）
    files: ["src/hearingForm/main.tsx"],
    rules: { "no-restricted-properties": ["error", { object: "document", property: "cookie", message: "クッキーを使わない" }, { object: "window", property: "open", message: "新しいウィンドウを開かない" }] },
  },
  {
    files: ["scripts/**/*.ts", "test/**/*.ts", "test/**/*.tsx", "*.js", "*.ts"],
    languageOptions: { globals: { process: "readonly", console: "readonly", URL: "readonly", Buffer: "readonly", setTimeout: "readonly", structuredClone: "readonly", performance: "readonly" } },
  },
);
