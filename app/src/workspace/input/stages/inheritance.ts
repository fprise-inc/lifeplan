// 13. 相続・贈与: 世代をまたぐお金を1枚に集める。
// - 受け取る予定の相続・贈与（入るお金の行と、相続で受け継ぐ借金）、あげる贈与（出るお金の行）: moneyRows.ts の区画「inherit」。今ある援助の物（子への援助 goals.education.gifts・
//   住宅資金の援助 residences.purchase.gifts）は物の形を変えず、子ども・教育／住まい・ローンのカードで入れ、ここには読むだけで並べる
// - 贈与する人（親・祖父母）: 物（donors）と欄は今のまま（family.ts の donorGroups）で、見せるカードだけをここにした
// - 相続税の目安は計算の結果から読むだけの1行（inheritanceLine.ts。表示だけで、お金の流れには入れない）
import type { Household } from "../../../engine/types.ts";
import { resolveTimepoint, type FieldDef, type GroupDef, type SectionDef, type StageDef } from "../form.ts";
import type { WorkingHousehold } from "../household.ts";
import { GIFT_PURPOSES, memberLabel } from "../labels.ts";
import { manYen, readGroup, readLine } from "../readLines.ts";
import { formatYearMonth } from "../units.ts";
import { addInheritedDebt, addOutsideGrandchild, inheritedDebtGroups, moneySections } from "../moneyRows.ts";
import { NONE_CLAIMED } from "./events.ts";
import { addDonorActions, donorGroups } from "./family.ts";

const purposeText = (p: string) => GIFT_PURPOSES.find((o) => o.value === p)?.label ?? "援助";
const whenText = (h: Household, at: Parameters<typeof resolveTimepoint>[1]) => {
  const ym = resolveTimepoint(h, at);
  return ym !== null ? `（${formatYearMonth(ym)}）` : "";
};

/** 今ある援助の物（子への援助・住宅資金の援助）を、受け取る側とあげる側に分けた読むだけの1行 */
export function giftLines(wh: WorkingHousehold): { receive: FieldDef[]; give: FieldDef[] } {
  const h = wh.request.input.household;
  const receive: FieldDef[] = [];
  const give: FieldDef[] = [];
  for (const goal of h.goals ?? []) {
    if (goal.kind !== "education") continue;
    (goal.education?.gifts ?? []).forEach((g, i) => {
      const who = memberLabel(wh, goal.owner);
      const line = readLine(`inherit/edu/${goal.id}/${i}`, `${who}への援助（${purposeText(g.purpose)}）${g.donor !== undefined ? "・贈与する人から" : ""}`, `${manYen(g.amount)}${whenText(h, g.at)}`, "子ども・教育");
      // 贈与する人（親・祖父母）から出す援助は受け取る側、世帯から出す援助はあげる贈与
      (g.donor !== undefined ? receive : give).push(line);
    });
  }
  for (const r of h.residences ?? [])
    (r.purchase?.gifts ?? []).forEach((g, i) => {
      receive.push(readLine(`inherit/housing/${r.id}/${i}`, `住宅資金の援助（${memberLabel(wh, g.recipient)}が受け取る）`, `${manYen(g.amount)}${r.purchase !== undefined ? whenText(h, r.purchase.at) : ""}`, "住まい・ローン"));
    });
  return { receive, give };
}

export function inheritanceStage(wh: WorkingHousehold): StageDef {
  const lines = giftLines(wh);
  const groupsOf = (g: GroupDef | null): GroupDef[] => (g !== null ? [g] : []);
  // 受け取る予定の相続・贈与（入るお金）と、あげる贈与（出るお金）の行（moneyRows.ts の区画「inherit」。0044）。今ある援助の物は読むだけの1行を後ろに足す
  const money = moneySections(wh, "inherit", {
    claimed: NONE_CLAIMED,
    level: "simple",
    inTitle: "受け取る予定の相続・贈与（入るお金）",
    outTitle: "あげる贈与（出るお金）",
    note: "孫などへの贈与。贈与税は受け取る人が払うので、世帯からは出さず、結果の要約に出します",
  });
  const moneyIn = money.find((x) => x.key.endsWith("/in"));
  const moneyOut = money.find((x) => x.key.endsWith("/out"));
  const sections: SectionDef[] = [
    {
      key: "inherit/receive",
      title: moneyIn?.title ?? "受け取る予定の相続・贈与",
      note: "見込みが「不確か」の受け取る相続・贈与は、基本の計算に入れません（行は残ります）。相手は世帯の外の家族（介護・親のカード）から選びます",
      level: "simple",
      groups: [...(moneyIn?.groups ?? []), ...inheritedDebtGroups(wh), ...groupsOf(readGroup("inherit/receive", undefined, lines.receive))],
      actions: [...(moneyIn?.actions ?? []), { key: "money/inherit/addDebt", label: "＋ 相続で受け継ぐ借金", level: "detail", run: (w: WorkingHousehold) => addInheritedDebt(w) }],
    },
    {
      key: "inherit/give",
      title: moneyOut?.title ?? "あげる贈与",
      ...(moneyOut?.note !== undefined ? { note: moneyOut.note } : {}),
      level: "simple",
      groups: [...(moneyOut?.groups ?? []), ...groupsOf(readGroup("inherit/give", undefined, lines.give))],
      actions: [...(moneyOut?.actions ?? []), { key: "money/inherit/addGrandchild", label: "＋ 孫（世帯の外の家族）を足す", level: "detail", run: (w: WorkingHousehold) => addOutsideGrandchild(w) }],
    },
    {
      key: "family/donors",
      title: "贈与する人（親・祖父母）",
      note: "世帯の外の親・祖父母をここでまとめて登録すると、住宅資金・教育資金などの援助で選べます。同じ人からの贈与は、贈与税の基礎控除・相続時精算課税の特別控除を合わせて数えます",
      level: "simple",
      groups: donorGroups(wh),
      actions: addDonorActions(wh),
    },
  ];
  return { id: "inheritance", label: "相続・贈与", lead: "世代をまたぐお金（受け取る予定の相続・贈与、あげる贈与、贈与する人）と、相続税の目安。", sections };
}
