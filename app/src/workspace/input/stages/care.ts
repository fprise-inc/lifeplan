// 12. 介護・親: 親の世代と介護を1枚に集める。物の形と欄は今のまま（構成員は family.ts の memberGroup、介護の費用は events.ts の careGroup）で、
// 見せるカードだけをここにした。
// - 世帯の外の家族（親・祖父母と、世帯の外の印のある人。家計を1つにする期間・その人のお金の欄も、構成員のまとまりの中）
// - 介護の費用（親・本人・配偶者。今まではライフイベントと「＋ 項目を追加」の2か所だった）
// - 親とのお金（親からの援助・親への仕送りのお金の行。moneyRows.ts の区画「care」）
// - 介護休業は働き方の期間の物なので、働き方と収入のカードで入れる（ここは読むだけの1行）
import type { Household } from "../../../engine/types.ts";
import { addMonths, ageReachedMonth } from "../../levers.ts";
import { resolveTimepoint, type SectionDef, type StageDef } from "../form.ts";
import { mutate, newId, type WorkingHousehold } from "../household.ts";
import { memberLabel } from "../labels.ts";
import { readGroup, readLine } from "../readLines.ts";
import { roles } from "../../roles.ts";
import { formatYearMonth } from "../units.ts";
import { moneySections } from "../moneyRows.ts";
import { careGroup, NONE_CLAIMED } from "./events.ts";
import { addOutsideActions, memberGroup, outsidePerson } from "./family.ts";

/** 介護・親のカードに出す人（世帯の外の家族。並びは家族の役の順） */
export function outsideMembers(wh: WorkingHousehold) {
  const h = wh.request.input.household;
  const order = roles(wh.request).map((r) => r.member);
  const rest = h.members.filter((m) => !order.includes(m));
  return [...order, ...rest].filter(outsidePerson);
}

/** 介護休業の働き方の期間（読むだけの1行） */
function careLeaves(wh: WorkingHousehold, h: Household) {
  return (h.employmentPeriods ?? [])
    .filter((p) => p.type === "leave" && p.leaveKind === "care")
    .map((p) => {
      const from = resolveTimepoint(h, p.from);
      const to = p.to !== null ? resolveTimepoint(h, p.to) : null;
      return readLine(`care/leave/${p.id}`, `${memberLabel(wh, p.member)}の介護休業`, `${from !== null ? formatYearMonth(from) : "—"}〜${to !== null ? formatYearMonth(to) : ""}`, "働き方と収入");
    });
}

export function careStage(wh: WorkingHousehold): StageDef {
  const h = wh.request.input.household;
  const base = wh.request.input.baseMonth;
  const leaves = readGroup("care/leaves", undefined, careLeaves(wh, h));
  const sections: SectionDef[] = [
    {
      key: "care/outside",
      title: "世帯の外の家族",
      note: "親（両家）・祖父母など、家計が別の家族です。年金などの収入は世帯に入れません。同居して家計を1つにする期間は、その人の欄の「詳細」で入れます",
      level: "simple",
      groups: outsideMembers(wh).map((m) => memberGroup(wh, m)),
      actions: addOutsideActions(),
    },
    {
      key: "care/costs",
      title: "介護の費用",
      note: "親・本人・配偶者の介護を、介護を受ける人ごとに入れます",
      level: "simple",
      groups: (h.careExpenses ?? []).map((c) => careGroup(wh, c)),
      actions: [
        {
          key: "ev/addCare",
          label: "＋ 介護の費用",
          level: "simple",
          run: (w) =>
            mutate(w, (hh) => {
              const self = hh.members.find((m) => m.kind === "self");
              const who = hh.members.find((m) => m.kind === "parent") ?? self;
              if (who === undefined) return;
              const at = who.kind === "self" ? ageReachedMonth(who, 80) : addMonths(base, 60);
              (hh.careExpenses ??= []).push({ id: newId(), member: who.id, from: { at }, months: 61, place: "home" });
            }),
        },
      ],
    },
    // 親とのお金（援助・家に入れるお金＝入る、仕送り＝出る。お金の行。0044）
    ...moneySections(wh, "care", { claimed: NONE_CLAIMED, inTitle: "親からの援助・仕送り（入るお金）", outTitle: "親への仕送り（出るお金）" }),
    ...(leaves !== null ? [{ key: "care/leaves", title: "介護で働き方が変わる", level: "simple" as const, groups: [leaves], actions: [] }] : []),
  ];
  return { id: "care", label: "介護・親", lead: "親の世代（世帯の外の家族）と、介護の費用。", sections };
}
