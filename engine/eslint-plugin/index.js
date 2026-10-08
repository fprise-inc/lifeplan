// ファイナンシアの計算エンジン・計算部品のための lint の規則（0002・0005・0006）
// 公式もカスタム部品も同じ設定を使う（SDK に同梱する。0019）
import componentBoundaries from "./rules/component-boundaries.js";
import noModuleState from "./rules/no-module-state.js";
import noMoneyArithmetic from "./rules/no-money-arithmetic.js";

const plugin = {
  meta: { name: "eslint-plugin-financia", version: "0.1.0" },
  rules: {
    "no-money-arithmetic": noMoneyArithmetic,
    "component-boundaries": componentBoundaries,
    "no-module-state": noModuleState,
  },
};
export default plugin;

// 0002 の4: 結果がエンジンやOSで変わる Math の関数。0005: 乱数も使わない
const BANNED_MATH = [
  "pow", "exp", "expm1", "log", "log1p", "log2", "log10", "sqrt", "cbrt", "hypot",
  "sin", "cos", "tan", "asin", "acos", "atan", "atan2", "sinh", "cosh", "tanh", "asinh", "acosh", "atanh",
  "round", "fround", "random",
];

/** 計算エンジンと計算部品に掛ける規則 */
export const engineRules = {
  "no-restricted-properties": [
    "error",
    ...BANNED_MATH.map((property) => ({ object: "Math", property, message: "0002・0005: この Math の関数は使わない（率は ratePow・rateDiv、丸めは規則IDつき関数）" })),
    { object: "Number", property: "parseFloat", message: "0002: parseFloat は使わない（率は rate(\"0.01\") で文字列から作る）" },
    { property: "toFixed", message: "0002: toFixed で丸めない（規則IDつきの丸め関数を使う）" },
    { property: "toPrecision", message: "0002: toPrecision で丸めない（規則IDつきの丸め関数を使う）" },
    { property: "localeCompare", message: "結果が実行環境の言語設定で変わるので使わない（< と > で比べる）" },
    { property: "toLocaleString", message: "結果が実行環境の言語設定で変わるので使わない" },
  ],
  "no-restricted-globals": [
    "error",
    { name: "parseFloat", message: "0002: parseFloat は使わない" },
    { name: "Date", message: "0003・0005: エンジンは時計を持たない（計算基準月は入力で渡す）" },
    { name: "Intl", message: "結果が実行環境の言語設定で変わるので使わない" },
    { name: "eval", message: "0005: 実行時にコードを作らない" },
    { name: "Function", message: "0005: 実行時にコードを作らない" },
    { name: "console", message: "0005: エンジンにログの出口はない（顧客データを外に出さない）" },
    { name: "globalThis", message: "0005: グローバルな状態に頼らない" },
  ],
  "no-restricted-syntax": [
    "error",
    { selector: "BinaryExpression[operator='**']", message: "0002: ** は使わない（率は ratePow）" },
    { selector: "AssignmentExpression[operator='**=']", message: "0002: **= は使わない（率は ratePow）" },
    {
      selector: "Literal[raw=/^[0-9_]*\\.[0-9_]*([eE][-+]?[0-9_]+)?$|^[0-9_]+[eE][-+]?[0-9_]+$/]",
      message: "0002: 小数・指数表記の数値リテラルは使わない（率は rate(\"0.007\") のように文字列から作る）",
    },
  ],
  "financia/no-money-arithmetic": "error",
};

/** 計算部品のフォルダだけに掛ける規則 */
export function componentRules(componentsDir, sdkDir) {
  return {
    "financia/component-boundaries": ["error", { componentsDir, sdkDir }],
    "financia/no-module-state": "error",
  };
}
