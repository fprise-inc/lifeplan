// 構成員の iDeCo・企業型DC の器の ID の一覧（判定だけを返す小さな部品。0006 の追記）。
// iDeCo・企業型DC の部品はこれで器を決めてから ctx.get でその器だけを読む（NISA などほかの器の積立を変えても、iDeCo・企業型DC と
// それを読む税の部品を計算し直さない）。iDeCo・企業型DC が無い構成員の税の部品は、iDeCo の部品を呼ばない
import { defineComponent } from "../../sdk/index.ts";

export default defineComponent<{ member: string }, { ids: string[] }>({
  id: "account.dcList",
  title: "iDeCo・企業型DCの器の一覧",
  contract: "1.0",
  revision: 1,
  requires: {},
  params: [],
  reads: ["account.kind", "account.owner"],
  memberScope: ["account"],
  input: "member.input",
  output: "account.dcList.output",
  compute(_input, ctx) {
    return { ids: ctx.list<{ id: string; kind: string }>("account").filter((a) => a.kind === "ideco" || a.kind === "corporateDc").map((a) => a.id) };
  },
});
