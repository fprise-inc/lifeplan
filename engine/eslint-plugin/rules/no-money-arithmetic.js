// 0002: 金額（Yen 型）に * / % ** を直接使わない。掛け算・割り算は ctx.money の丸め関数を通す
const OPS = new Set(["*", "/", "%", "**", "*=", "/=", "%=", "**="]);
const BRANDS = new Set(["Yen"]);

function isMoneyType(checker, type, at) {
  if (type.isUnion()) return type.types.some((t) => isMoneyType(checker, t, at));
  const brand = type.getProperty("__brand");
  if (brand === undefined) return false;
  const bt = checker.getTypeOfSymbolAtLocation(brand, at);
  return bt.isStringLiteral() && BRANDS.has(bt.value);
}

/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: { description: "金額に * / % ** を直接使わない（0002）" },
    messages: { money: "金額（{{brand}}）に {{op}} を直接使わず、ctx.money の丸め関数（規則IDつき）を使う（0002）" },
    schema: [],
  },
  create(context) {
    const services = context.sourceCode.parserServices;
    if (!services?.program) throw new Error("financia/no-money-arithmetic は型情報（projectService）が要ります");
    const checker = services.program.getTypeChecker();
    const check = (node, op, operands) => {
      if (!OPS.has(op)) return;
      for (const o of operands) {
        const tsNode = services.esTreeNodeToTSNodeMap.get(o);
        if (isMoneyType(checker, checker.getTypeAtLocation(tsNode), tsNode)) {
          context.report({ node, messageId: "money", data: { brand: "Yen", op } });
          return;
        }
      }
    };
    return {
      BinaryExpression: (node) => check(node, node.operator, [node.left, node.right]),
      AssignmentExpression: (node) => check(node, node.operator, [node.left, node.right]),
    };
  },
};
