// 0113 の8: 計算部品は互換モード（calcConventions.compatibility）を読まない。互換モードの項目はエンジンの決まった1か所
// （src/engine/compatibility.ts）でだけ読み、部品が互換モードを見て自分で分かれることはしない。
// ctx.conventions は互換モードを持たない（型と値の両方で外す）が、名前で読もうとする書き方もここで止める
/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: { description: "計算部品は互換モード compatibility を読まない（0113 の8）" },
    messages: { compat: "計算部品は互換モード compatibility を読まない（0113 の8。互換モードの項目はエンジンの1か所でだけ読む）" },
    schema: [],
  },
  create(context) {
    const NAME = "compatibility";
    const report = (node) => context.report({ node, messageId: "compat" });
    return {
      // ctx.conventions.compatibility・x["compatibility"]
      MemberExpression(node) {
        const p = node.property;
        if ((!node.computed && p.type === "Identifier" && p.name === NAME) || (p.type === "Literal" && p.value === NAME)) report(p);
      },
      // const { compatibility } = ctx.conventions
      Property(node) {
        if (node.parent?.type !== "ObjectPattern") return;
        const k = node.key;
        if ((k.type === "Identifier" && k.name === NAME) || (k.type === "Literal" && k.value === NAME)) report(k);
      },
      // "compatibility" in x・Reflect.get(x, "compatibility") など、名前を文字で書くもの
      Literal(node) {
        if (node.value !== NAME) return;
        const parent = node.parent;
        if (parent?.type === "MemberExpression" && parent.property === node) return;
        if (parent?.type === "Property" && parent.key === node) return;
        report(node);
      },
    };
  },
};
