// 0006 の2: 部品のファイルの一番外側に、書き換えられる変数（let・var）を置かない（部品は純粋な関数）
/** @type {import("eslint").Rule.RuleModule} */
export default {
  meta: {
    type: "problem",
    docs: { description: "部品のファイルの一番外側に let・var を置かない（0006）" },
    messages: { state: "部品のファイルの一番外側に書き換えられる変数（{{kind}}）を置かない（0006）" },
    schema: [],
  },
  create(context) {
    return {
      "Program > VariableDeclaration, Program > ExportNamedDeclaration > VariableDeclaration"(node) {
        if (node.kind !== "const") context.report({ node, messageId: "state", data: { kind: node.kind } });
      },
    };
  },
};
