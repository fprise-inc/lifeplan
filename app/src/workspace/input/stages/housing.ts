// 6. 住まい・ローン: 住まいの期間（賃貸・持ち家・購入の予定と援助）、住宅ローン（借入額・金利・返済期間・今の残高・団信）、ほかのローン
import type { Debt, Household, Residence } from "../../../engine/types.ts";
import { addMonths } from "../../levers.ts";
import { byId, field, getPath, plain, removeAction, timepointField, yenBox, type ActionDef, type FieldDef, type Finder, type GroupDef, type SectionDef, type StageDef } from "../form.ts";
import { confirmedBox, mutate, newId, type WorkingHousehold } from "../household.ts";
import { BUILDING_STRUCTURES, DEBT_KINDS, donorOptions, HOUSING_EXEMPTION, memberLabel, memberOptions, RATE_TYPES, REPAYMENT_METHODS, RESIDENCE_KINDS, TAX_METHODS, VALUATION_DEFAULTS } from "../labels.ts";

const residences = (h: Household) => h.residences;
const debts = (h: Household) => h.debts;

function residenceGroups(wh: WorkingHousehold, r: Residence, i: number): GroupDef[] {
  const find = byId(residences, r.id);
  const k = `housing/res/${r.id}`;
  const self = wh.request.input.household.members.find((m) => m.kind === "self");
  const ageOf = self !== undefined ? { ageOf: (h: Household) => h.members.find((m) => m.id === self.id) } : {};
  const fields: FieldDef[] = [
    plain({
      key: `${k}/kind`,
      item: "residence.kind",
      label: "住まい",
      level: "simple",
      kind: "select",
      options: RESIDENCE_KINDS,
      structural: true,
      find,
      path: ["kind"],
      after: (h, t, v) => {
        const res = t as Residence;
        if (v === "rent") {
          delete res.propertyTax;
          delete res.maintenance;
          delete res.ownership;
          delete res.purchase;
          delete res.valuation;
          delete res.sale;
          res.rent ??= { monthly: confirmedBox(80000) };
        } else {
          delete res.rent;
          const selfId = h.members.find((m) => m.kind === "self")?.id;
          res.propertyTax ??= { annual: confirmedBox(120000) };
          res.maintenance ??= { monthly: confirmedBox(15000) };
          if (selfId !== undefined) res.ownership ??= [{ member: selfId, share: "1" }];
        }
      },
    }),
    timepointField({ key: `${k}/from`, item: "residence.from", label: "住み始め", level: "detail", find, path: ["from"], ...ageOf }),
    timepointField({ key: `${k}/to`, item: "residence.to", label: "住み終わり", level: "detail", find, path: ["to"], optional: true, nullText: "最後まで", ...ageOf }),
  ];
  if (r.kind === "rent") {
    fields.push(
      yenBox({ key: `${k}/rent`, item: "residence.rent", label: "家賃（管理費込み）", level: "simple", basis: "monthly", find, path: ["rent", "monthly"] }),
      plain({ key: `${k}/rentGrowth`, item: "residence.rent", label: "家賃の変動率（年）", level: "detail", kind: "pct", find, path: ["rent", "growth"], optional: true }),
      plain({ key: `${k}/renewalFee`, item: "residence.rent", label: "更新料（家賃の何か月分）", level: "detail", kind: "decimal", suffix: "か月分", find, path: ["rent", "renewalFee"], optional: true }),
    );
  } else {
    fields.push(
      yenBox({ key: `${k}/tax`, item: "residence.propertyTax", label: "固定資産税・都市計画税", level: "simple", basis: "annual", find, path: ["propertyTax", "annual"] }),
      yenBox({ key: `${k}/maint`, item: "residence.maintenance", label: "修繕費・管理費", level: "simple", basis: "monthly", find, path: ["maintenance", "monthly"] }),
      plain({ key: `${k}/maintGrowth`, item: "residence.maintenance", label: "修繕費の変動率（年）", level: "detail", kind: "pct", find, path: ["maintenance", "growth"], optional: true }),
    );
  }
  const groups: GroupDef[] = [
    {
      key: k,
      title: `住まい ${i + 1}（${r.kind === "rent" ? "賃貸" : "持ち家"}）`,
      level: "simple",
      fields,
      actions: [removeAction(`${k}/remove`, "外す", "simple", (h) => void (h.residences = (h.residences ?? []).filter((x) => x.id !== r.id)))],
    },
  ];
  if (r.kind === "own") groups.push(...valuationGroups(wh, r, k));
  if (r.purchase !== undefined) {
    const kp = `${k}/purchase`;
    groups.push({
      key: kp,
      title: "住宅の購入",
      level: "simple",
      fields: [
        timepointField({ key: `${kp}/at`, item: "residence.purchase", label: "購入の年月", level: "simple", find, path: ["purchase", "at"], ...ageOf }),
        plain({ key: `${kp}/price`, item: "residence.purchase", label: "物件の価格", level: "simple", kind: "yen", basis: "once", find, path: ["purchase", "price"] }),
        plain({ key: `${kp}/down`, item: "residence.purchase", label: "頭金", level: "simple", kind: "yen", basis: "once", find, path: ["purchase", "downPayment"], optional: true }),
        plain({ key: `${kp}/costs`, item: "residence.purchase", label: "諸費用", level: "simple", kind: "yen", basis: "once", find, path: ["purchase", "costs"], optional: true, help: "目安は新築で価格の3〜7%、中古で6〜10%" }),
      ],
      actions: [],
    });
    (r.purchase.gifts ?? []).forEach((g, j) => {
      const findG: Finder = (h, w) => (getPath(find(h, w), ["purchase", "gifts", String(j)]) as Record<string, unknown> | undefined) ?? undefined;
      const kg = `${kp}/gift/${j}`;
      groups.push({
        key: kg,
        title: `住宅資金の援助 ${j + 1}`,
        ...(g.donor !== undefined ? { note: "贈与する人から出すので、援助の額は世帯の資産から出しません" } : {}),
        level: "simple",
        fields: [
          plain({ key: `${kg}/donor`, item: "residence.purchase", label: "贈与する人", level: "simple", kind: "select", options: donorOptions(wh), find: findG, path: ["donor"], optional: true, fallback: "", help: "家族の段階で登録した親・祖父母から選びます" }),
          plain({ key: `${kg}/recipient`, item: "residence.purchase", label: "受け取る人", level: "simple", kind: "select", options: memberOptions(wh, (m) => m.kind === "self" || m.kind === "spouse"), find: findG, path: ["recipient"] }),
          plain({ key: `${kg}/amount`, item: "residence.purchase", label: "援助の額", level: "simple", kind: "yen", basis: "once", find: findG, path: ["amount"] }),
          plain({ key: `${kg}/tax`, item: "residence.purchase", label: "贈与税の課税方法", level: "detail", kind: "select", options: TAX_METHODS, find: findG, path: ["taxMethod"], optional: true, fallback: "calendar" }),
          plain({ key: `${kg}/exempt`, item: "residence.purchase", label: "住宅取得等資金の非課税", level: "detail", kind: "select", options: HOUSING_EXEMPTION, find: findG, path: ["housingExemption"], optional: true, fallback: "none" }),
        ],
        actions: [
          removeAction(`${kg}/remove`, "外す", "simple", (h, w) => {
            const res = find(h, w) as Residence | undefined;
            if (res?.purchase?.gifts !== undefined) {
              res.purchase.gifts = res.purchase.gifts.filter((_, x) => x !== j);
              if (res.purchase.gifts.length === 0) delete res.purchase.gifts;
            }
          }),
        ],
      });
    });
    groups.push({
      key: `${kp}/addGift`,
      level: "simple",
      fields: [],
      actions: [
        {
          key: `${kp}/addGiftAction`,
          label: "＋ 親・祖父母からの住宅資金の援助",
          level: "simple",
          run: (w) =>
            mutate(w, (h) => {
              const res = find(h, w) as Residence | undefined;
              const self = h.members.find((m) => m.kind === "self");
              const donor = (h.donors ?? [])[0];
              if (res?.purchase === undefined || self === undefined) return;
              (res.purchase.gifts ??= []).push({ recipient: self.id, giver: donor?.kind ?? "parent", ...(donor !== undefined ? { donor: donor.id } : {}), amount: 5000000, housingExemption: "energySaving" });
            }),
        },
      ],
    });
  }
  return groups;
}

/**
 * 持ち家の評価（資産と負債の推移・提案書のバランスシートに使う）と売却。土地は前提の上昇率で、建物は構造の耐用年数で減らす（計算エンジンの housing.valuation）。
 * 購入の予定がある持ち家は物件の価格から、今住んでいる持ち家は評価額（または購入の価格と時点）から評価する
 */
function valuationGroups(wh: WorkingHousehold, r: Residence, k: string): GroupDef[] {
  const find = byId(residences, r.id);
  const kv = `${k}/valuation`;
  const bought = r.purchase !== undefined;
  const base = wh.request.input.baseMonth;
  const setting = wh.request.input.assumptions?.realEstateValuation;
  const asOf = r.valuation?.asOf ?? r.purchase?.at?.at ?? base;
  const groups: GroupDef[] = [
    {
      key: kv,
      title: "持ち家の評価（資産と負債の推移に使う）",
      level: bought ? "detail" : "simple",
      ...(!bought && r.valuation?.value === undefined ? { note: "評価額を入れると、資産と負債の推移・提案書のバランスシートに不動産として入ります" } : {}),
      fields: [
        yenBox({
          key: `${kv}/value`,
          item: "residence.valuation",
          label: bought ? "評価の基にする額" : "評価額（わからなければ購入の価格）",
          level: bought ? "detail" : "simple",
          basis: "once",
          find,
          path: ["valuation", "value"],
          optional: true,
          help: bought ? "空欄なら物件の価格を購入の月の評価額にします" : "土地と建物の合計。購入の価格を入れたときは、時点に購入の年月を入れます",
        }),
        plain({ key: `${kv}/asOf`, item: "residence.valuation", label: bought ? "その額の時点" : "その額の時点（購入の年月）", level: "detail", kind: "ym", find, path: ["valuation", "asOf"], optional: true, fallback: asOf }),
        plain({ key: `${kv}/structure`, item: "residence.valuation", label: "建物の構造", level: bought ? "detail" : "simple", kind: "select", options: BUILDING_STRUCTURES, find, path: ["valuation", "structure"], optional: true, fallback: "wood", help: "建物を耐用年数（木造22年・軽量鉄骨19年・重量鉄骨34年・鉄筋コンクリート47年）で減らします" }),
        plain({ key: `${kv}/builtYear`, item: "residence.valuation", label: "建物が建った年", level: bought ? "detail" : "simple", kind: "int", suffix: "年", min: 1900, max: 2200, find, path: ["valuation", "builtYear"], optional: true, fallback: Number(asOf.slice(0, 4)), help: "空欄なら新築とみなします（その額の時点の年）" }),
        plain({ key: `${kv}/landShare`, item: "residence.valuation", label: "土地の割合", level: "detail", kind: "pct", find, path: ["valuation", "landShare"], optional: true, fallback: setting?.landShare ?? VALUATION_DEFAULTS.landShare, help: "空欄なら前提条件の目安。土地は前提条件の上昇率（空欄なら物価上昇率）で動きます" }),
      ],
      actions: [],
    },
  ];
  if (r.to !== null) {
    const ks = `${k}/sale`;
    const fields: FieldDef[] = [
      field({
        key: `${ks}/on`,
        item: "residence.sale",
        label: "住み終わりの月に売る",
        level: "simple",
        kind: "bool",
        structural: true,
        help: "売ると、売却価格から売却の費用を引いた手取りが預金に入り、その年から不動産は無くなります。譲渡所得の税は計算しません",
        get: (w) => ({ value: (find(w.request.input.household, w) as Residence | undefined)?.sale !== undefined }),
        set: (w, v) =>
          mutate(w, (h) => {
            const x = find(h, w) as Residence | undefined;
            if (x === undefined) return;
            if (v === true) x.sale ??= {};
            else delete x.sale;
          }),
      }),
    ];
    if (r.sale !== undefined)
      fields.push(
        plain({ key: `${ks}/price`, item: "residence.sale", label: "売却価格", level: "simple", kind: "yen", basis: "once", find, path: ["sale", "price"], optional: true, help: "空欄ならその年の評価額で売るとみなします" }),
        plain({ key: `${ks}/cost`, item: "residence.sale", label: "売却の費用（売却価格に対する割合）", level: "detail", kind: "pct", find, path: ["sale", "costRate"], optional: true, fallback: setting?.saleCostRate ?? VALUATION_DEFAULTS.saleCostRate, help: "仲介手数料・印紙税など。住宅ローンが残るときは、売る月の繰上返済で返します" }),
      );
    groups.push({ key: ks, title: "売却", level: "simple", fields, actions: [] });
  }
  return groups;
}

/** 団信の事由（スキーマの並び） */
const CL_EVENTS = ["death", "highDisability", "cancer", "threeMajor", "eightMajor", "incapacity"] as const;
const DISEASE_RIDERS = [
  { value: "", label: "なし" },
  { value: "cancer", label: "がんの特約" },
  { value: "threeMajor", label: "3大疾病の特約" },
  { value: "eightMajor", label: "8大疾病の特約" },
];

/**
 * 住宅ローンの団信の欄（対象・事由（特約）・保障割合・夫婦連生・就業不能の特約の月数）。住まい・ローンの段階と、万一の画面の「団信」で同じ欄を使う
 * （欄のキーが同じなので、どちらで直しても同じ世帯データが変わる）
 */
export function creditLifeFields(wh: WorkingHousehold, d: Debt): FieldDef[] {
  const find = byId(debts, d.id);
  const k = `housing/debt/${d.id}`;
  const cl = (h: Household, w: WorkingHousehold) => (find(h, w) as Debt | undefined)?.creditLife;
  const events = (h: Household, w: WorkingHousehold): string[] => (cl(h, w)?.events as string[] | undefined) ?? ["death"];
  const setEvent = (w: WorkingHousehold, ev: string, on: boolean) =>
    mutate(w, (h) => {
      const c = cl(h, w);
      if (c === undefined) return;
      const cur = new Set((c.events as string[] | undefined) ?? ["death"]);
      if (on) cur.add(ev);
      else cur.delete(ev);
      c.events = CL_EVENTS.filter((e) => cur.has(e));
    });
  const fields: FieldDef[] = [
    field({
      key: `${k}/creditLife`,
      item: "debt.creditLife",
      label: "団体信用生命保険（団信）の対象",
      level: "simple",
      kind: "select",
      options: [{ value: "", label: "入っていない・未確認" }, ...memberOptions(wh, (m) => d.debtors.some((x) => x.member === m.id))],
      help: "亡くなったとき・高度障害のとき、この人の負担分の残高が消えます",
      get: (w) => ({ value: (find(w.request.input.household, w) as Debt | undefined)?.creditLife?.covered[0] ?? "", ...(((find(w.request.input.household, w) as Debt | undefined)?.creditLife?.covered.length ?? 0) > 1 ? { derived: "夫婦連生（2人とも対象）" } : {}) }),
      set: (w, v) =>
        mutate(w, (h) => {
          const x = find(h, w) as Debt | undefined;
          if (x === undefined) return;
          if (v === "" || v === null) delete x.creditLife;
          else x.creditLife = { ...(x.creditLife ?? { events: ["death", "highDisability"] }), covered: [String(v)] };
        }),
    }),
  ];
  if (d.creditLife === undefined) return fields;
  const implicitEvents = (w: WorkingHousehold) => cl(w.request.input.household, w)?.events === undefined;
  fields.push(
    field({
      key: `${k}/clHigh`,
      item: "debt.creditLife",
      label: "高度障害も対象",
      level: "detail",
      kind: "bool",
      get: (w) => ({ value: events(w.request.input.household, w).includes("highDisability"), ...(implicitEvents(w) ? { implicit: true } : {}) }),
      set: (w, v) => setEvent(w, "highDisability", v === true),
    }),
    field({
      key: `${k}/clIncapacity`,
      item: "debt.creditLife",
      label: "就業不能の特約",
      level: "detail",
      kind: "bool",
      help: "働けない状態が決まった月数続くと残高が消えます（障害・就業不能の想定で使います）",
      get: (w) => ({ value: events(w.request.input.household, w).includes("incapacity"), ...(implicitEvents(w) ? { implicit: true } : {}) }),
      set: (w, v) => setEvent(w, "incapacity", v === true),
    }),
    field({
      key: `${k}/clDisease`,
      item: "debt.creditLife",
      label: "疾病の特約",
      level: "detail",
      kind: "select",
      options: DISEASE_RIDERS,
      help: "記録として持ちます（万一のときの想定は死亡・障害・就業不能なので、疾病の特約はまだ計算に使いません）",
      get: (w) => ({ value: events(w.request.input.household, w).find((e) => e === "cancer" || e === "threeMajor" || e === "eightMajor") ?? "", ...(implicitEvents(w) ? { implicit: true } : {}) }),
      set: (w, v) =>
        mutate(w, (h) => {
          const c = cl(h, w);
          if (c === undefined) return;
          const cur = new Set(((c.events as string[] | undefined) ?? ["death"]).filter((e) => e !== "cancer" && e !== "threeMajor" && e !== "eightMajor"));
          if (v !== "" && v !== null) cur.add(String(v));
          c.events = CL_EVENTS.filter((e) => cur.has(e));
        }),
    }),
  );
  if (events(wh.request.input.household, wh).includes("incapacity"))
    fields.push(plain({ key: `${k}/clMonths`, item: "debt.creditLife", label: "就業不能の特約: 残高が消えるまでの月数", level: "detail", kind: "int", suffix: "か月", min: 0, max: 120, find, path: ["creditLife", "incapacityMonths"], optional: true, fallback: 12 }));
  fields.push(
    plain({ key: `${k}/clRatio`, item: "debt.creditLife", label: "保障割合", level: "detail", kind: "pct", find, path: ["creditLife", "ratio"], optional: true, fallback: "1", help: "連帯債務などで、残高のうち保障される割合" }),
    plain({ key: `${k}/clJoint`, item: "debt.creditLife", label: "夫婦連生（どちらかの万一で全額）", level: "detail", kind: "bool", find, path: ["creditLife", "spouseJoint"], optional: true, fallback: false }),
  );
  return fields;
}

/** 万一の画面に出す団信のまとまり（住宅ローンごと。欄は住まい・ローンの段階と同じ） */
export function creditLifeGroups(wh: WorkingHousehold): GroupDef[] {
  const list = (wh.request.input.household.debts ?? []).filter((d) => d.kind === "mortgage");
  return list.map((d, i) => {
    const debtor = d.debtors.find((x) => x.role === "primary") ?? d.debtors[0];
    return { key: `cg/creditLife/${d.id}`, title: `住宅ローン ${i + 1}（${memberLabel(wh, debtor?.member)}）の団信`, level: "simple", fields: creditLifeFields(wh, d), actions: [] };
  });
}

function loanFields(wh: WorkingHousehold, d: Debt, k: string): FieldDef[] {
  const find = byId(debts, d.id);
  const firstRate: Finder = (h, w) => (getPath(find(h, w), ["rateSchedule", "0"]) as Record<string, unknown> | undefined) ?? undefined;
  const self = wh.request.input.household.members.find((m) => m.kind === "self");
  const ageOf = self !== undefined ? { ageOf: (h: Household) => h.members.find((m) => m.id === self.id) } : {};
  const fields: FieldDef[] = [
    plain({ key: `${k}/principal`, item: "debt.principal", label: "借入額", level: "simple", kind: "yen", basis: "once", find, path: ["principal"] }),
    timepointField({ key: `${k}/start`, item: "debt.start", label: "借入の年月", level: "simple", find, path: ["start"], ...ageOf }),
    plain({ key: `${k}/rate`, item: "debt.rateSchedule", label: "金利（当初・年）", level: "simple", kind: "pct", find: firstRate, path: ["rate"] }),
    plain({ key: `${k}/rateType`, item: "debt.rateSchedule", label: "金利の種類", level: "simple", kind: "select", options: RATE_TYPES, find: firstRate, path: ["type"] }),
    field({
      key: `${k}/term`,
      item: "debt.repayment",
      label: "返済期間",
      level: "simple",
      kind: "int",
      suffix: "年",
      min: 1,
      max: 50,
      get: (w) => {
        const t = (find(w.request.input.household, w) as Debt | undefined)?.repayment.termMonths;
        return t === undefined ? { value: null } : { value: Math.round(t / 12), derived: t % 12 !== 0 ? `${t}か月（年に直すとずれる）` : null };
      },
      set: (w, v) =>
        mutate(w, (h) => {
          const x = find(h, w) as Debt | undefined;
          if (x !== undefined && v !== null) x.repayment.termMonths = Number(v) * 12;
        }),
    }),
    plain({ key: `${k}/method`, item: "debt.repayment", label: "返済方法", level: "simple", kind: "select", options: REPAYMENT_METHODS, find, path: ["repayment", "method"] }),
    yenBox({ key: `${k}/balance`, item: "debt.balance", label: "今の残高", level: "simple", basis: "once", find, path: ["balance"], optional: true, help: "返済予定表の残高。空欄なら借入額と金利から計算します" }),
    plain({ key: `${k}/balanceAsOf`, item: "debt.balanceAsOf", label: "残高の時点", level: "detail", kind: "ym", find, path: ["balanceAsOf"], optional: true }),
    plain({ key: `${k}/bonus`, item: "debt.repayment", label: "ボーナス返済の割合", level: "detail", kind: "pct", find, path: ["repayment", "bonusShare"], optional: true, fallback: "0" }),
  ];
  if (d.kind === "mortgage") {
    fields.push(
      plain({ key: `${k}/fiveYear`, item: "debt.repayment", label: "5年ルール（返済額を5年ごとに見直す）", level: "detail", kind: "bool", find, path: ["repayment", "variableRules", "fiveYear"], optional: true, fallback: false }),
      plain({ key: `${k}/cap125`, item: "debt.repayment", label: "125%ルール（見直しの上限）", level: "detail", kind: "bool", find, path: ["repayment", "variableRules", "cap125"], optional: true, fallback: false }),
      ...creditLifeFields(wh, d),
    );
  }
  if (d.pairWith !== undefined) fields.push(field({ key: `${k}/pair`, item: "debt.pairWith", label: "ペアローン", level: "simple", kind: "text", readOnly: "もう1本のローンは、そのローンの欄で入れます", get: () => ({ value: "もう1本のローンと組（ペアローン）" }), set: (w) => w }));
  return fields;
}

function loanGroups(wh: WorkingHousehold, d: Debt, i: number): GroupDef[] {
  const k = `housing/debt/${d.id}`;
  const debtor = d.debtors.find((x) => x.role === "primary") ?? d.debtors[0];
  const title = d.kind === "mortgage" ? `住宅ローン ${i + 1}（${memberLabel(wh, debtor?.member)}）` : `${DEBT_KINDS.find((o) => o.value === d.kind)?.label ?? "ローン"}（${memberLabel(wh, debtor?.member)}）`;
  const groups: GroupDef[] = [
    {
      key: k,
      title,
      level: d.kind === "mortgage" ? "simple" : "detail",
      fields: loanFields(wh, d, k),
      actions: [removeAction(`${k}/remove`, "外す", "simple", (h) => void (h.debts = (h.debts ?? []).filter((x) => x.id !== d.id)))],
    },
  ];
  d.rateSchedule.slice(1).forEach((_, j) => {
    const idx = j + 1;
    const findR: Finder = (h) => (getPath((h.debts ?? []).find((x) => x.id === d.id), ["rateSchedule", String(idx)]) as Record<string, unknown> | undefined) ?? undefined;
    groups.push({
      key: `${k}/rate/${idx}`,
      title: `金利の段階 ${idx + 1}`,
      level: "detail",
      fields: [
        timepointField({ key: `${k}/rate/${idx}/from`, item: "debt.rateSchedule", label: "この金利になる年月", level: "detail", find: findR, path: ["from"] }),
        plain({ key: `${k}/rate/${idx}/rate`, item: "debt.rateSchedule", label: "金利（年）", level: "detail", kind: "pct", find: findR, path: ["rate"] }),
        plain({ key: `${k}/rate/${idx}/type`, item: "debt.rateSchedule", label: "金利の種類", level: "detail", kind: "select", options: RATE_TYPES, find: findR, path: ["type"] }),
      ],
      actions: [removeAction(`${k}/rate/${idx}/remove`, "外す", "detail", (h) => void ((h.debts ?? []).find((x) => x.id === d.id) as Debt).rateSchedule.splice(idx, 1))],
    });
  });
  (d.prepayments ?? []).forEach((_, j) => {
    const findP: Finder = (h) => (getPath((h.debts ?? []).find((x) => x.id === d.id), ["prepayments", String(j)]) as Record<string, unknown> | undefined) ?? undefined;
    groups.push({
      key: `${k}/prepay/${j}`,
      title: `繰上返済 ${j + 1}`,
      level: "detail",
      fields: [
        timepointField({ key: `${k}/prepay/${j}/at`, item: "debt.prepayments", label: "年月", level: "detail", find: findP, path: ["at"] }),
        plain({ key: `${k}/prepay/${j}/amount`, item: "debt.prepayments", label: "額", level: "detail", kind: "yen", basis: "once", find: findP, path: ["amount"] }),
        plain({
          key: `${k}/prepay/${j}/mode`,
          item: "debt.prepayments",
          label: "方法",
          level: "detail",
          kind: "select",
          options: [
            { value: "shortenTerm", label: "期間短縮型" },
            { value: "reducePayment", label: "返済額軽減型" },
          ],
          find: findP,
          path: ["mode"],
        }),
      ],
      actions: [removeAction(`${k}/prepay/${j}/remove`, "外す", "detail", (h) => void ((h.debts ?? []).find((x) => x.id === d.id) as Debt).prepayments?.splice(j, 1))],
    });
  });
  const more: ActionDef[] = [
    {
      key: `${k}/addRate`,
      label: "＋ 金利の段階",
      level: "detail",
      run: (w) =>
        mutate(w, (h) => {
          const x = (h.debts ?? []).find((y) => y.id === d.id) as Debt;
          const last = x.rateSchedule.at(-1);
          const from = addMonths(w.request.input.baseMonth, 60);
          x.rateSchedule.push({ from: { at: from }, type: last?.type ?? "variable", rate: last?.rate ?? "0.01" });
        }),
    },
    {
      key: `${k}/addPrepay`,
      label: "＋ 繰上返済",
      level: "detail",
      run: (w) => mutate(w, (h) => void (((h.debts ?? []).find((y) => y.id === d.id) as Debt).prepayments ??= []).push({ at: { at: addMonths(w.request.input.baseMonth, 60) }, amount: 1000000, mode: "shortenTerm" })),
    },
  ];
  groups.push({ key: `${k}/more`, level: "detail", fields: [], actions: more });
  return groups;
}

export function housingStage(wh: WorkingHousehold): StageDef {
  const h = wh.request.input.household;
  const selfId = h.members.find((m) => m.kind === "self")?.id;
  const base = wh.request.input.baseMonth;
  const resSection: SectionDef = {
    key: "housing/residences",
    title: "住まい",
    note: "住居費（家賃・固定資産税・修繕費・ローン）はここで入れ、基本生活費には含めません",
    level: "simple",
    groups: (h.residences ?? []).flatMap((r, i) => residenceGroups(wh, r, i)),
    actions: [
      { key: "housing/addRent", label: "＋ 賃貸", level: "simple", run: (w) => mutate(w, (hh) => void (hh.residences ??= []).push({ id: newId(), kind: "rent", from: { at: base }, to: null, rent: { monthly: confirmedBox(80000) } })) },
      {
        key: "housing/addOwn",
        label: "＋ 持ち家（今住んでいる）",
        level: "simple",
        run: (w) =>
          mutate(w, (hh) => void (hh.residences ??= []).push({ id: newId(), kind: "own", from: { at: base }, to: null, propertyTax: { annual: confirmedBox(120000) }, maintenance: { monthly: confirmedBox(15000) }, ...(selfId !== undefined ? { ownership: [{ member: selfId, share: "1" }] } : {}) })),
      },
      {
        key: "housing/addPurchase",
        label: "＋ 住宅購入の予定",
        level: "simple",
        run: (w) =>
          mutate(w, (hh) => {
            const at = addMonths(base, 24);
            // 今の賃貸は購入の前の月で終える
            for (const r of hh.residences ?? []) if (r.kind === "rent" && r.to === null) r.to = { at: addMonths(at, -1) };
            (hh.residences ??= []).push({
              id: newId(),
              kind: "own",
              from: { at },
              to: null,
              purchase: { at: { at }, price: 40000000, downPayment: 4000000, costs: 2000000 },
              propertyTax: { annual: confirmedBox(120000) },
              maintenance: { monthly: confirmedBox(15000) },
              ...(selfId !== undefined ? { ownership: [{ member: selfId, share: "1" }] } : {}),
            });
          }),
      },
    ],
  };
  const mortgages = (h.debts ?? []).filter((d) => d.kind === "mortgage");
  const others = (h.debts ?? []).filter((d) => d.kind !== "mortgage");
  const newLoan = (kind: string, w: WorkingHousehold) =>
    mutate(w, (hh) => {
      if (selfId === undefined) return;
      const own = (hh.residences ?? []).find((r) => r.kind === "own");
      const start = own?.purchase?.at?.at ?? base;
      (hh.debts ??= []).push({
        id: newId(),
        kind,
        debtors: [{ member: selfId, role: "primary" }],
        principal: kind === "mortgage" ? 30000000 : 2000000,
        start: { at: start },
        rateSchedule: [{ from: { at: start }, type: kind === "mortgage" ? "variable" : "fixed", rate: kind === "mortgage" ? "0.008" : "0.02" }],
        repayment: { method: "equalPayment", termMonths: kind === "mortgage" ? 420 : 60, ...(kind === "mortgage" ? { variableRules: { fiveYear: true, cap125: true } } : {}) },
        ...(kind === "mortgage" ? { creditLife: { covered: [selfId], events: ["death", "highDisability"] } } : {}),
      });
    });
  const loanSection: SectionDef = {
    key: "housing/loans",
    title: "住宅ローン",
    level: "simple",
    groups: mortgages.flatMap((d, i) => loanGroups(wh, d, i)),
    actions: [{ key: "housing/addMortgage", label: "＋ 住宅ローン", level: "simple", run: (w) => newLoan("mortgage", w) }],
  };
  const otherSection: SectionDef = {
    key: "housing/otherDebts",
    title: "住宅ローン以外のローン（車・奨学金など）",
    level: "detail",
    groups: others.flatMap((d, i) => loanGroups(wh, d, i)),
    actions: [
      { key: "housing/addCarLoan", label: "＋ 自動車ローン", level: "detail", run: (w) => newLoan("car", w) },
      { key: "housing/addScholarship", label: "＋ 奨学金", level: "detail", run: (w) => newLoan("scholarship", w) },
    ],
  };
  return { id: "housing", label: "住まい・ローン", lead: "賃貸か持ち家か、購入の予定、住宅ローン。", sections: [resSection, loanSection, otherSection] };
}
