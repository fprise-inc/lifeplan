// 8. 貯蓄・運用: 口座・資産の種類ごとの残高（時価）と名義、毎月の積立。取得価額・資産配分・時点は詳細で
import type { Account, Household } from "../../../engine/types.ts";
import { ageReachedMonth } from "../../levers.ts";
import { byId, field, getPath, plain, removeAction, resolveTimepoint, timepointField, yenBox, type FieldDef, type Finder, type GroupDef, type StageDef } from "../form.ts";
import { confirmedBox, mutate, newId, type WorkingHousehold } from "../household.ts";
import { ACCOUNT_KINDS, ASSET_CLASSES, memberLabel, memberOptions } from "../labels.ts";
import { defaultPayoutAge, editPayout, payoutAgeOf, rateOf, retireAgeOf, setStopAge, stopAgeOf } from "../savings/model.ts";

const accounts = (h: Household) => h.accounts;
const WITH_COST = new Set(["taxable", "nisa", "legacyNisa", "juniorNisa", "childNisa"]);
/** 金融資産でない器（不動産・その他の資産）。評価額と増減率だけを入れる */
const NON_FINANCIAL = new Set(["realEstate", "otherAsset"]);

/** 不動産（住まい以外）・その他の資産（貴金属・美術品・貸付金など）: 評価額・時点・増減率 */
function otherAssetGroups(wh: WorkingHousehold, a: Account): GroupDef[] {
  const find = byId(accounts, a.id);
  const k = `sav/${a.id}`;
  const label = a.kind === "realEstate" ? "不動産（住まい以外）" : "その他の資産";
  return [
    {
      key: k,
      title: `${label}（${memberLabel(wh, a.owner)}）`,
      level: "simple",
      fields: [
        plain({ key: `${k}/kind`, item: "account.kind", label: "種類", level: "simple", kind: "select", options: ACCOUNT_KINDS, find, path: ["kind"], structural: true }),
        plain({ key: `${k}/owner`, item: "account.owner", label: "名義", level: "simple", kind: "select", options: memberOptions(wh), find, path: ["owner"] }),
        yenBox({ key: `${k}/value`, item: "account.marketValue", label: "今の評価額", level: "simple", basis: "once", find, path: ["marketValue"] }),
        plain({ key: `${k}/asOf`, item: "account.asOf", label: "評価額の時点", level: "detail", kind: "ym", find, path: ["asOf"] }),
        plain({
          key: `${k}/growth`,
          item: "account.valueGrowth",
          label: "評価額の増減率（年）",
          level: "simple",
          kind: "pct",
          find,
          path: ["valueGrowth"],
          optional: true,
          help: a.kind === "realEstate" ? "空欄なら前提条件の不動産の利回り（入れていなければ0）。マイナスも入れられます" : "空欄なら0（評価額のまま）。値下がりするものはマイナスで入れます",
        }),
      ],
      actions: [removeAction(`${k}/remove`, "外す", "simple", (h) => void (h.accounts = (h.accounts ?? []).filter((x) => x.id !== a.id)))],
    },
  ];
}

function accountGroups(wh: WorkingHousehold, a: Account): GroupDef[] {
  const find = byId(accounts, a.id);
  const k = `sav/${a.id}`;
  const firstContribution: Finder = (h, w) => (getPath(find(h, w), ["contributions", "0"]) as Record<string, unknown> | undefined) ?? undefined;
  const owner = wh.request.input.household.members.find((m) => m.id === a.owner);
  const fields: FieldDef[] = [
    plain({ key: `${k}/kind`, item: "account.kind", label: "種類", level: "simple", kind: "select", options: ACCOUNT_KINDS, find, path: ["kind"], structural: true }),
    plain({ key: `${k}/owner`, item: "account.owner", label: "名義", level: "simple", kind: "select", options: memberOptions(wh), find, path: ["owner"] }),
    yenBox({ key: `${k}/value`, item: "account.marketValue", label: "今の残高（時価）", level: "simple", basis: "once", find, path: ["marketValue"] }),
    plain({ key: `${k}/asOf`, item: "account.asOf", label: "残高の時点", level: "detail", kind: "ym", find, path: ["asOf"] }),
  ];
  if (WITH_COST.has(a.kind)) fields.push(yenBox({ key: `${k}/cost`, item: "account.costBasis", label: "取得価額（元本）", level: "detail", basis: "once", find, path: ["costBasis"], optional: true, help: "空欄なら時価と同じ。NISA の枠・課税口座の税の計算に使います" }));
  fields.push(
    field({
      key: `${k}/monthly`,
      item: "account.contributions",
      label: "毎月の積立",
      level: "simple",
      kind: "yen",
      basis: "monthly",
      optional: true,
      help: a.kind === "nisa" ? "結果の対策「NISAの積立額」でも動かせます" : undefined,
      get: (w) => ({ value: (firstContribution(w.request.input.household, w)?.monthly as number | undefined) ?? null, ...(((find(w.request.input.household, w) as Account | undefined)?.contributions?.length ?? 0) > 1 ? { derived: "積立の期間が複数あります（最初の期間を見せています）" } : {}) }),
      set: (w, v) =>
        mutate(w, (h) => {
          const x = find(h, w) as Account | undefined;
          if (x === undefined) return;
          x.contributions ??= [];
          if (v === null) {
            x.contributions.splice(0, 1);
            return;
          }
          const c0 = x.contributions[0];
          if (c0 !== undefined) c0.monthly = Number(v);
          // 終わりは空（退職の年まで・推定。0026）
          else x.contributions.push({ from: { at: w.request.input.baseMonth }, to: null, monthly: Number(v) });
        }),
    }),
  );
  if (a.kind !== "deposit" || a.expectedReturn !== undefined)
    fields.push(
      field({
        key: `${k}/rate`,
        item: "account.expectedReturn",
        label: "利回り（年）",
        level: "simple",
        kind: "pct",
        optional: true,
        help: "空欄なら資産の配分と前提条件の利回り",
        get: (w) => {
          const x = find(w.request.input.household, w) as Account | undefined;
          return { value: x?.expectedReturn ?? null, ...(x !== undefined && x.expectedReturn === undefined ? { hint: `空欄: 年${(Number(rateOf(w.request, x)) * 100).toFixed(1)}%` } : {}) };
        },
        set: (w, v) =>
          mutate(w, (h) => {
            const x = find(h, w) as Account | undefined;
            if (x === undefined) return;
            if (v === null) delete x.expectedReturn;
            else x.expectedReturn = String(v);
          }),
      }),
    );
  if (DC_KIND.has(a.kind)) fields.push(...payoutFields(wh, a, k));
  if ((a.contributions ?? []).length > 0)
    fields.push(timepointField({ key: `${k}/until`, item: "account.contributions", label: "積立の終わり（最後の月）", level: "detail", find: firstContribution, path: ["to"], optional: true, nullText: "退職の年まで（推定）", ...(owner !== undefined ? { ageOf: (h: Household) => h.members.find((m) => m.id === owner.id) } : {}) }));
  const groups: GroupDef[] = [
    {
      key: k,
      title: `${ACCOUNT_KINDS.find((o) => o.value === a.kind)?.label ?? "口座"}（${memberLabel(wh, a.owner)}）`,
      level: "simple",
      fields,
      actions: [removeAction(`${k}/remove`, "外す", "simple", (h) => void (h.accounts = (h.accounts ?? []).filter((x) => x.id !== a.id)))],
    },
  ];
  (a.assetMix ?? []).forEach((_, j) => {
    const findMix: Finder = (h, w) => (getPath(find(h, w), ["assetMix", String(j)]) as Record<string, unknown> | undefined) ?? undefined;
    groups.push({
      key: `${k}/mix/${j}`,
      title: `資産の配分 ${j + 1}`,
      level: "detail",
      fields: [
        plain({ key: `${k}/mix/${j}/class`, item: "account.assetMix", label: "資産の種類", level: "detail", kind: "select", options: ASSET_CLASSES, find: findMix, path: ["assetClass"] }),
        plain({ key: `${k}/mix/${j}/share`, item: "account.assetMix", label: "割合", level: "detail", kind: "pct", find: findMix, path: ["share"] }),
      ],
      actions: [
        removeAction(`${k}/mix/${j}/remove`, "外す", "detail", (h, w) => {
          const x = find(h, w) as Account | undefined;
          if (x?.assetMix === undefined) return;
          x.assetMix = x.assetMix.filter((__, n) => n !== j);
          if (x.assetMix.length === 0) delete x.assetMix;
        }),
      ],
    });
  });
  groups.push({
    key: `${k}/addMix`,
    level: "detail",
    note: (a.assetMix ?? []).length === 0 ? "資産の配分を入れないときは、預金・外貨預金は預金の利回り、ほかは前提条件の運用利回りで計算します" : undefined,
    fields: [],
    actions: [{ key: `${k}/addMixRow`, label: "＋ 資産の配分", level: "detail", run: (w) => mutate(w, (h) => void ((find(h, w) as Account).assetMix ??= []).push({ assetClass: "equity.global", share: (a.assetMix ?? []).length === 0 ? "1" : "0" })) }],
  });
  return groups;
}

const DC_KIND = new Set(["ideco", "corporateDc"]);
const PAYOUT_OPTIONS = [
  { value: "lumpSum", label: "一時金" },
  { value: "annuity", label: "年金（10年）" },
  { value: "mixed", label: "併用（半分ずつ）" },
];
const DEST_OPTIONS = [
  { value: "deposit", label: "預金に入れる" },
  { value: "invest", label: "運用を続ける（NISA・課税口座）" },
];

/** iDeCo・企業型DC の受け取り方・始める年齢・受け取ったお金の行き先（空欄は退職の年に一時金・推定。0026） */
function payoutFields(wh: WorkingHousehold, a: Account, k: string): FieldDef[] {
  const find = byId(accounts, a.id);
  const acc = (w: WorkingHousehold) => find(w.request.input.household, w) as Account | undefined;
  return [
    field({
      key: `${k}/payout`,
      item: "account.payout",
      label: "受け取り方",
      level: "simple",
      kind: "select",
      options: PAYOUT_OPTIONS,
      optional: true,
      structural: true,
      get: (w) => {
        const x = acc(w);
        return x?.payout === undefined ? { value: null, estimated: "空欄は退職の年に一時金で受け取る計算（推定）" } : { value: x.payout.method };
      },
      set: (w, v) => (v === null && acc(w)?.payout === undefined ? w : mutate(w, (h) => editPayout(h, find(h, w) as Account, { method: v === null || v === "" ? null : (v as "lumpSum" | "annuity" | "mixed") }))),
    }),
    field({
      key: `${k}/payoutAge`,
      item: "account.payout",
      label: "受け取りを始める年齢",
      level: "simple",
      kind: "int",
      suffix: "歳",
      min: 60,
      max: 75,
      optional: true,
      get: (w) => {
        const x = acc(w);
        if (x === undefined) return { value: null };
        const age = payoutAgeOf(w.request.input.household, x);
        if (age === null) return { value: null, estimated: `空欄は退職の年（${defaultPayoutAge(w.request, x)}歳。60〜65歳）`, hint: `${defaultPayoutAge(w.request, x)}歳（推定）` };
        const at = resolveTimepoint(w.request.input.household, x.payout?.start);
        const owner = w.request.input.household.members.find((m) => m.id === x.owner);
        const exact = owner === undefined || at === null || at === ageReachedMonth(owner, age);
        return exact ? { value: age } : { value: age, derived: `受け取りの始まりは ${at?.slice(0, 4)}年${Number(at?.slice(5))}月です。年齢を入れ直すと、その年齢に達する月からになります` };
      },
      set: (w, v) => (v === null && payoutAgeOf(w.request.input.household, acc(w) as Account) === null ? w : mutate(w, (h) => editPayout(h, find(h, w) as Account, { age: typeof v === "number" ? v : null }))),
    }),
    field({
      key: `${k}/payoutDest`,
      item: "account.payout",
      label: "受け取ったお金",
      level: "detail",
      kind: "select",
      options: DEST_OPTIONS,
      get: (w) => ({ value: acc(w)?.payout?.destination ?? "deposit", implicit: acc(w)?.payout?.destination === undefined }),
      set: (w, v) => mutate(w, (h) => editPayout(h, find(h, w) as Account, { destination: v === "invest" ? "invest" : "deposit" })),
    }),
  ];
}

/** まとめた金融資産（合計の入れ方・まだ口座に分けていない分）: 合計の残高と平均の利回り */
function pooledGroups(wh: WorkingHousehold, a: Account): GroupDef[] {
  const find = byId(accounts, a.id);
  const k = `sav/${a.id}`;
  return [
    {
      key: k,
      title: "まとめた金融資産（合計の入れ方）",
      level: "simple",
      fields: [
        yenBox({ key: `${k}/value`, item: "account.marketValue", label: "金融資産の合計", level: "simple", basis: "once", find, path: ["marketValue"] }),
        plain({ key: `${k}/rate`, item: "account.expectedReturn", label: "平均の利回り（年）", level: "simple", kind: "pct", find, path: ["expectedReturn"], optional: true }),
      ],
      actions: [],
    },
  ];
}

/** 運用の期間: 積立をやめる年齢（空欄は退職の年まで・推定。0026） */
function periodGroup(): GroupDef {
  return {
    key: "sav/period",
    title: "運用の期間",
    level: "simple",
    fields: [
      field({
        key: "sav/stopAge",
        item: "account.contributions",
        label: "積立をやめる年齢（本人）",
        level: "simple",
        kind: "int",
        suffix: "歳",
        min: 20,
        max: 90,
        optional: true,
        get: (w) => {
          const h = w.request.input.household;
          const age = stopAgeOf(h);
          if (age !== null) return { value: age };
          const r = retireAgeOf(w.request);
          return { value: null, estimated: `空欄は退職の年（${r ?? 65}歳）まで積み立てる計算`, hint: `${r ?? 65}歳（推定）` };
        },
        set: (w, v) => (v === null && stopAgeOf(w.request.input.household) === null ? w : mutate(w, (h, req) => setStopAge(h, req.input.baseMonth, typeof v === "number" ? v : null))),
        sideEffects: "すべての積立（iDeCo・企業型DC を除く）の最後の期間の終わりを、この年齢にそろえます",
      }),
    ],
    actions: [],
  };
}

export function savingsStage(wh: WorkingHousehold): StageDef {
  const h = wh.request.input.household;
  const self = h.members.find((m) => m.kind === "self");
  const add = (kind: string, label: string) => ({
    key: `sav/add/${kind}`,
    label: `＋ ${label}`,
    level: (kind === "deposit" || kind === "nisa" || kind === "ideco" || kind === "taxable" ? "simple" : "detail") as "simple" | "detail",
    run: (w: WorkingHousehold) =>
      mutate(w, (hh) => {
        if (self === undefined) return;
        const a: Account = { id: newId(), kind, owner: self.id, marketValue: confirmedBox(0), asOf: w.request.input.baseMonth, contributions: [] };
        if (kind === "nisa" || kind === "taxable") {
          a.costBasis = confirmedBox(0);
          a.assetMix = [{ assetClass: "equity.global", share: "1" }];
        }
        (hh.accounts ??= []).push(a);
      }),
  });
  return {
    id: "savings",
    label: "貯蓄・運用",
    lead: "口座・資産の種類ごとの今の残高と、毎月の積立。",
    sections: [
      {
        key: "sav/accounts",
        title: "金融資産",
        level: "simple",
        groups: [
          ...(h.accounts ?? []).filter((a) => !NON_FINANCIAL.has(a.kind) && a.kind !== "pooled").flatMap((a) => accountGroups(wh, a)),
          ...(h.accounts ?? []).filter((a) => a.kind === "pooled").flatMap((a) => pooledGroups(wh, a)),
          ...((h.accounts ?? []).some((a) => !NON_FINANCIAL.has(a.kind) && (a.contributions ?? []).length > 0) ? [periodGroup()] : []),
        ],
        actions: [add("deposit", "預貯金"), add("nisa", "NISA"), add("ideco", "iDeCo"), add("taxable", "課税口座"), add("zaikei", "財形貯蓄"), add("corporateDc", "企業型DC"), add("fxDeposit", "外貨預金")],
      },
      {
        key: "sav/others",
        title: "不動産（住まい以外）・その他の資産",
        note: "資産と負債の推移・提案書のバランスシートに入ります（金融資産には入れず、取り崩しにも使いません）。住まいは「住まい・ローン」で、車は「車」で入れます",
        level: (h.accounts ?? []).some((a) => NON_FINANCIAL.has(a.kind)) ? "simple" : "detail",
        groups: (h.accounts ?? []).filter((a) => NON_FINANCIAL.has(a.kind)).flatMap((a) => otherAssetGroups(wh, a)),
        actions: [add("realEstate", "不動産（住まい以外）"), add("otherAsset", "その他の資産")],
      },
    ],
  };
}
