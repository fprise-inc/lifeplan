// 0006 の2: 部品どうしの直接の呼び出しを禁止する。部品が import してよいのは自分のフォルダの中と公式SDKだけ
import { dirname, relative, resolve, sep } from "node:path";

const inside = (child, parent) => {
  const r = relative(parent, child);
  return r === "" || (!r.startsWith("..") && !r.startsWith(sep) && !/^[A-Za-z]:/.test(r));
};

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: { description: "部品のフォルダをまたぐ import を禁止する（0006）" },
    messages: {
      cross: "部品のフォルダの外（{{source}}）を直接 import しない。他の部品は ctx.call で部品表を通して呼ぶ（0006）",
    },
    schema: [
      {
        type: "object",
        properties: { componentsDir: { type: "string" }, sdkDir: { type: "string" } },
        required: ["componentsDir", "sdkDir"],
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const { componentsDir, sdkDir } = context.options[0];
    const file = context.filename;
    if (!inside(file, componentsDir)) return {};
    const rel = relative(componentsDir, file).split(sep);
    if (rel.length < 2) return {}; // 部品の一覧（components/index.ts）は対象外
    const own = resolve(componentsDir, rel[0]);
    const checkSource = (node, source) => {
      const ok = source.startsWith(".") && (() => {
        const target = resolve(dirname(file), source);
        return inside(target, own) || inside(target, sdkDir);
      })();
      if (!ok) context.report({ node, messageId: "cross", data: { source } });
    };
    return {
      ImportDeclaration: (n) => checkSource(n, n.source.value),
      ExportNamedDeclaration: (n) => n.source && checkSource(n, n.source.value),
      ExportAllDeclaration: (n) => checkSource(n, n.source.value),
      ImportExpression: (n) => checkSource(n, n.source.type === "Literal" ? n.source.value : "(動的な import)"),
      'CallExpression[callee.name="require"]': (n) => checkSource(n, n.arguments[0]?.value ?? "(require)"),
    };
  },
};
