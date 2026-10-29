// 8. 貯蓄・運用: 口座・資産の種類ごとの残高（時価）と名義、毎月の積立。取得価額・資産配分・時点・運用の費用・引き出せない期間は詳細で。
// お金の行き先（取り崩す順番・取り崩さない口座・決済口座・預金に残しておく額）は詳細の区画（取り崩す順番の並べ替えは画面の部品。SavingsPanel）
import type { Account, Household } from "../../../engine/types.ts";
import type { Address } from "../../store/readings.ts";
import { ageAt, ageReachedMonth } from "../../levers.ts";
import { byId, field, getPath, plain, removeAction, resolveTimepoint, timepointField, yenBox, type ActionDef, type FieldDef, type Finder, type GroupDef, type SectionDef, type StageDef } from "../form.ts";
import { confirmedBox, mutate, newId, standardBox, type WorkingHousehold } from "../household.ts";
import { putRow } from "../rows.ts";
import { ACCOUNT_KINDS, ASSET_CLASSES, memberLabel, memberOptions } from "../labels.ts";
import { isRentalProperty, UNENTERED_RENT } from "./rental.ts";
import { accountName, UNENTERED_BALANCE, defaultPayoutAge, editPayout, INVEST_KINDS, methodOf, payoutAgeOf, rateOf, reservePreset, setSettlement, settlementOf, setStopAge, stopAgeOf, stopEstimateOf } from "../savings/model.ts";
import { allocationStageGroups, returnStageGroups } from "../staged.ts";

const accounts = (h: Household) => h.accounts;
const UNENTERED_VALUE = "未入力（評価額を入れてください。0円で計算中）";
/** 欄の当て先（口座の中の入力項目） */
const onAccount = (id: string, item: string, at: string[] = []) => (): Address => ({ target: { object: id }, item, at });
const withAddress = (f: FieldDef, a: () => Address): FieldDef => ({ ...f, address: a });
const WITH_COST = new Set(["taxable", "nisa", "legacyNisa", "juniorNisa", "childNisa"]);
/** 金融資産でない器（不動産・その他の資産）。評価額と増減率だけを入れる */
const NON_FINANCIAL = new Set(["realEstate", "otherAsset"]);

/**
 * 貸していない不動産（土地・別荘など。評価額だけ）・その他の資産（貴金属・美術品・貸付金など）: 評価額・時点・増減率。
 * 貸している不動産（中身 property を持つ不動産の器）は「収益不動産」の項目で入れる（0079。stages/rental.ts）
 */
function otherAssetGroups(wh: WorkingHousehold, a: Account): GroupDef[] {
  const find = byId(accounts, a.id);
  const k = `sav/${a.id}`;
  const estate = a.kind === "realEstate";
  const fields: FieldDef[] = [
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
      help: estate ? "空欄なら前提条件の不動産の利回り（入れていなければ0）。マイナスも入れられます" : "空欄なら0（評価額のまま）。値下がりするものはマイナスで入れます",
    }),
  ];
  const actions: ActionDef[] = [
    removeAction(`${k}/remove`, "外す", "simple", (h) => {
      h.accounts = (h.accounts ?? []).filter((x) => x.id !== a.id);
      for (const d of h.debts ?? []) if (d.property === a.id) delete d.property;
    }),
  ];
  // 貸している不動産なら、収益不動産へ移す（中身を持たせる。家賃は未入力の印で始める）
  if (estate)
    actions.unshift({
      key: `${k}/toRental`,
      label: "収益不動産へ移す",
      level: "simple",
      help: "人に貸している物件なら、収益不動産の項目へ移します。家賃収入・経費・ローン・売却と、建物の減価償却を入れられるようになります（評価額と名義はそのまま）",
      run: (w) =>
        mutate(w, (h) => {
          const x = (h.accounts ?? []).find((y) => y.id === a.id);
          if (x !== undefined) x.property ??= { rental: { monthly: standardBox(0, UNENTERED_RENT) } };
        }),
    });
  return [
    {
      key: k,
      title: `${estate ? "貸していない不動産" : "その他の資産"}（${memberLabel(wh, a.owner)}）`,
      ...(estate ? { note: "評価額だけで持つ不動産（貸していない土地・別荘など）です。人に貸している物件は「収益不動産」で入れます（「収益不動産へ移す」で移せます）" } : {}),
      level: "simple",
      fields,
      actions,
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
    // 預貯金の名義は詳細（NISA・iDeCo などは枠と税で名義が効くので標準。0078）
    plain({ key: `${k}/owner`, item: "account.owner", label: "名義", level: a.kind === "deposit" ? "detail" : "simple", kind: "select", options: memberOptions(wh), find, path: ["owner"] }),
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
        help: "1年あたりの見込みの利回りを、信託報酬などの費用を引いた後で入れます。空欄なら、資産の配分や前提条件の目安の利回りで計算します（費用を別に入れる形は詳細で）",
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
  // 運用の費用（口座の入れ方の運用する口座。資産配分の入れ方は配分の信託報酬を使う）
  if (methodOf(wh.request) === "accounts" && INVEST_KINDS.has(a.kind))
    fields.push(
      withAddress(
        plain({ key: `${k}/fee`, item: "account.fee", label: "運用の費用（年）", level: "detail", kind: "pct", find, path: ["fee"], optional: true, help: "信託報酬など。ここに費用を入れると、上の利回りから費用を引いて計算します（そのときは上の利回りを費用を引く前の見込みにします）。空欄は0で、上の利回りを費用を引いた後の見込みとして使います（税は計算で引きます）" }),
        onAccount(a.id, "account.fee"),
      ),
    );
  if (DC_KIND.has(a.kind)) fields.push(...payoutFields(wh, a, k));
  if (a.kind === "smallBusinessMutualAid") fields.push(...mutualAidFields(wh, a, k));
  // 積立の終わり（口座ごと）: いちばん後の期間の終わり。NISA で成長投資枠の積立もあるときは枠ごとに終わりが違うので、積立の表の期間で直す
  const own = (a.contributions ?? []).filter((c) => c.payer !== "employer" || a.kind === "corporateDc");
  const oneTranche = new Set(own.map((c) => (c.tranche === "growth" ? "growth" : "tsumitate"))).size <= 1;
  if (own.length > 0 && oneTranche) {
    const lastContribution: Finder = (h, w) => {
      const list = ((find(h, w) as Account | undefined)?.contributions ?? []).filter((c) => c.payer !== "employer" || a.kind === "corporateDc");
      return list.reduce<(typeof list)[number] | undefined>((x, y) => (x === undefined || (resolveTimepoint(h, y.from) ?? "") >= (resolveTimepoint(h, x.from) ?? "") ? y : x), undefined) as Record<string, unknown> | undefined;
    };
    fields.push(timepointField({ key: `${k}/until`, item: "account.contributions", label: own.length > 1 ? "積立の終わり（最後の月）" : "積立の終わり（最後の月）", level: "detail", find: lastContribution, path: ["to"], startPath: ["from"], ageMeans: "before", optional: true, nullText: "退職の年まで（推定）", ...(owner !== undefined ? { ageOf: (h: Household) => h.members.find((m) => m.id === owner.id) } : {}) }));
  }
  // 引き出せない期間の終わり（その月まで取り崩さない）。iDeCo・企業型DC・小規模企業共済は受け取りの決まりで預金に入るので出さない
  if (!DC_KIND.has(a.kind) && a.kind !== "smallBusinessMutualAid")
    fields.push(
      withAddress(
        timepointField({
          key: `${k}/lock`,
          item: "account.withdrawalLockedUntil",
          label: "引き出せない期間の終わり",
          level: "detail",
          find,
          path: ["withdrawalLockedUntil"],
          optional: true,
          absentWhenEmpty: true,
          nullText: "いつでも引き出せる",
          help: "その月まで取り崩しません。定期預金の満期・財形の払い出しの条件などで、その月まで取り崩しに使わない口座に入れます。ずっと取り崩さない口座は、お金の行き先の「取り崩さない」で決めます",
          ...(owner !== undefined ? { ageOf: (h: Household) => h.members.find((m) => m.id === owner.id) } : {}),
        }),
        onAccount(a.id, "account.withdrawalLockedUntil"),
      ),
    );
  const groups: GroupDef[] = [
    {
      key: k,
      title: `${ACCOUNT_KINDS.find((o) => o.value === a.kind)?.label ?? "口座"}（${memberLabel(wh, a.owner)}）`,
      level: "simple",
      fields,
      actions: [removeAction(`${k}/remove`, "外す", "simple", (h) => void (h.accounts = (h.accounts ?? []).filter((x) => x.id !== a.id)))],
    },
  ];
  if (a.kind === "legacyNisa" || a.kind === "juniorNisa") groups.push(...lotGroups(a, k));
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
  { value: "annuity", label: "年金" },
  { value: "mixed", label: "併用（一時金と年金）" },
];
const MUTUAL_AID_OPTIONS = [
  { value: "lumpSum", label: "一括" },
  { value: "annuity", label: "分割" },
  { value: "mixed", label: "併用（一括と分割）" },
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
      blankEstimate: () => "lumpSum",
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
      blankEstimate: (w) => {
        const x = acc(w);
        return x === undefined ? null : defaultPayoutAge(w.request, x);
      },
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
    ...payoutDetailFields(a, k, { years: "年金で受け取る年数", share: "一時金で受け取る割合", min: 5, max: 20 }),
    enrolledField(a, k, "加入者期間の始まり", "受け取りを始められる年齢の判定に使います（加入者等期間が10年に満たないと、60歳からは受け取れません）。空欄は残高の時点から"),
  ];
}

/** 受け取りの詳細の欄（年金・分割で受け取る年数、併用の一時金の割合）。受け取り方を選んでいるときだけ */
function payoutDetailFields(a: Account, k: string, o: { years: string; share: string; min: number; max: number; options?: { value: string; label: string }[] }): FieldDef[] {
  const find = byId(accounts, a.id);
  const method = a.payout?.method;
  const out: FieldDef[] = [];
  if (method === "annuity" || method === "mixed")
    out.push(
      withAddress(
        o.options !== undefined
          ? field({
              key: `${k}/payoutYears`,
              item: "account.payout",
              label: o.years,
              level: "detail",
              kind: "select",
              options: o.options,
              get: (w) => {
                const y = (find(w.request.input.household, w) as Account | undefined)?.payout?.annuityYears;
                return { value: String(y ?? 10), ...(y === undefined ? { implicit: true } : {}) };
              },
              set: (w, v) =>
                mutate(w, (h) => {
                  const x = find(h, w) as Account | undefined;
                  if (x?.payout === undefined) return;
                  if (v === null || v === "") delete x.payout.annuityYears;
                  else x.payout.annuityYears = Number(v);
                }),
            })
          : plain({ key: `${k}/payoutYears`, item: "account.payout", label: o.years, level: "detail", kind: "int", suffix: "年", min: o.min, max: o.max, find, path: ["payout", "annuityYears"], fallback: 10 }),
        onAccount(a.id, "account.payout", ["annuityYears"]),
      ),
    );
  if (method === "mixed")
    out.push(withAddress(plain({ key: `${k}/lumpShare`, item: "account.payout", label: o.share, level: "detail", kind: "pct", find, path: ["payout", "lumpShare"], fallback: "0.5", help: "残りを年金（分割）で受け取ります" }), onAccount(a.id, "account.payout", ["lumpShare"])));
  return out;
}

/** 加入の始まり（年月。iDeCo・企業型DC は受け取りを始められる年齢、小規模企業共済は一括の退職所得の勤続期間に使う） */
function enrolledField(a: Account, k: string, label: string, help: string): FieldDef {
  return withAddress(plain({ key: `${k}/enrolled`, item: "account.enrolledSince", label, level: "detail", kind: "ym", find: byId(accounts, a.id), path: ["enrolledSince"], optional: true, help }), onAccount(a.id, "account.enrolledSince"));
}

/**
 * 小規模企業共済の受け取り（0026。エンジンの account.mutualAid）: 受け取り方（一括・分割・併用）と受け取りの始まり。
 * 始まりが空なら受け取らずに残高のまま持つ（廃業・退職の時期を入れてもらう）
 */
function mutualAidFields(wh: WorkingHousehold, a: Account, k: string): FieldDef[] {
  const find = byId(accounts, a.id);
  const acc = (w: WorkingHousehold) => find(w.request.input.household, w) as Account | undefined;
  const owner = wh.request.input.household.members.find((m) => m.id === a.owner);
  const fields: FieldDef[] = [
    field({
      key: `${k}/payout`,
      item: "account.payout",
      label: "受け取り方",
      level: "simple",
      kind: "select",
      options: MUTUAL_AID_OPTIONS,
      optional: true,
      structural: true,
      get: (w) => ({ value: acc(w)?.payout?.method ?? null }),
      set: (w, v) =>
        mutate(w, (h) => {
          const x = find(h, w) as Account | undefined;
          if (x === undefined) return;
          if (v === null || v === "") {
            delete x.payout;
            return;
          }
          editPayout(h, x, { method: v as "lumpSum" | "annuity" | "mixed" });
        }),
    }),
  ];
  if (a.payout !== undefined)
    fields.push(
      withAddress(
        timepointField({
          key: `${k}/payoutAt`,
          item: "account.payout",
          label: "受け取りを始める時期", help: "廃業・退職などで受け取りを始める月です",
          level: "simple",
          find,
          path: ["payout", "start"],
          optional: true,
          absentWhenEmpty: true,
          nullText: "受け取らない（残高のまま持つ）",
          ...(owner !== undefined ? { ageOf: (h: Household) => h.members.find((m) => m.id === owner.id) } : {}),
        }),
        onAccount(a.id, "account.payout", ["start"]),
      ),
      ...payoutDetailFields(a, k, { years: "分割で受け取る年数", share: "一括で受け取る割合", min: 10, max: 15, options: [{ value: "10", label: "10年" }, { value: "15", label: "15年" }] }),
    );
  fields.push(enrolledField(a, k, "加入した年月", "一括で受け取るときの退職所得の勤続期間（掛金を納めた期間の近似）に使います。空欄は残高の時点から"));
  return fields;
}

/** 旧NISA・ジュニアNISA の買付の年ごとの内訳（非課税期間が終わった年の年末に課税口座へ移す。空なら全部を残高の時点の年に買ったとみなす） */
function lotGroups(a: Account, k: string): GroupDef[] {
  const find = byId(accounts, a.id);
  const lots = (a.lots as { vintageYear: number; regime: string; costBasis: number; marketValue: number }[] | undefined) ?? [];
  const regimes = a.kind === "juniorNisa" ? [{ value: "junior", label: "ジュニアNISA" }] : [{ value: "general", label: "一般NISA" }, { value: "tsumitate", label: "つみたてNISA" }];
  const groups: GroupDef[] = lots.map((_, j) => {
    const findLot: Finder = (h, w) => (getPath(find(h, w), ["lots", String(j)]) as Record<string, unknown> | undefined) ?? undefined;
    return {
      key: `${k}/lot/${j}`,
      title: `買付の年 ${j + 1}`,
      level: "detail",
      fields: [
        plain({ key: `${k}/lot/${j}/year`, item: "account.lots", label: "買った年", level: "detail", kind: "int", suffix: "年", min: 2014, max: 2023, find: findLot, path: ["vintageYear"] }),
        plain({ key: `${k}/lot/${j}/regime`, item: "account.lots", label: "制度", level: "detail", kind: "select", options: regimes, find: findLot, path: ["regime"] }),
        plain({ key: `${k}/lot/${j}/cost`, item: "account.lots", label: "取得価額", level: "detail", kind: "yen", basis: "once", find: findLot, path: ["costBasis"] }),
        plain({ key: `${k}/lot/${j}/value`, item: "account.lots", label: "時価", level: "detail", kind: "yen", basis: "once", find: findLot, path: ["marketValue"] }),
      ],
      actions: [
        removeAction(`${k}/lot/${j}/remove`, "外す", "detail", (h, w) => {
          const x = find(h, w) as Account | undefined;
          const list = (x?.lots as unknown[] | undefined) ?? [];
          if (x === undefined) return;
          const next = list.filter((__, n) => n !== j);
          if (next.length === 0) delete x.lots;
          else x.lots = next;
        }),
      ],
    };
  });
  const year = Number(a.asOf?.slice(0, 4) ?? "2023");
  groups.push({
    key: `${k}/addLot`,
    level: "detail",
    note: lots.length === 0 ? "買付の年ごとの内訳が無いときは、全部を残高の時点の年に買ったとみなして、非課税期間の終わりを決めます" : "内訳の時価・取得価額の合計を、口座の残高・取得価額にそろえてください",
    fields: [],
    actions: [
      {
        key: `${k}/addLotRow`,
        label: "＋ 買付の年の内訳",
        level: "detail",
        run: (w) =>
          mutate(w, (h) => {
            const x = find(h, w) as Account | undefined;
            if (x === undefined) return;
            const list = ((x.lots as unknown[] | undefined) ?? []).slice();
            list.push({ vintageYear: Math.min(2023, year), regime: a.kind === "juniorNisa" ? "junior" : "general", costBasis: 0, marketValue: 0 });
            x.lots = list;
          }),
      },
    ],
  });
  return groups;
}

/** まとめた金融資産（合計の入れ方・まだ口座に分けていない分）: 合計の残高と平均の利回り */
function pooledGroups(wh: WorkingHousehold, a: Account): GroupDef[] {
  const find = byId(accounts, a.id);
  const k = `sav/${a.id}`;
  return [
    {
      key: k,
      title: "まとめた金融資産",
      level: "simple",
      fields: [
        yenBox({ key: `${k}/value`, item: "account.marketValue", label: "金融資産の合計", level: "simple", basis: "once", find, path: ["marketValue"] }),
        plain({ key: `${k}/rate`, item: "account.expectedReturn", label: "平均の利回り（年）", level: "simple", kind: "pct", find, path: ["expectedReturn"], optional: true }),
        withAddress(plain({ key: `${k}/uninvested`, item: "account.uninvested", label: "運用しない分", level: "detail", kind: "yen", basis: "once", find, path: ["uninvested"], optional: true }), onAccount(a.id, "account.uninvested")),
      ],
      actions: [],
    },
  ];
}

/** 運用の期間: 積立をやめる年齢（空欄は退職の年まで・推定。0026） */
function periodGroup(wh: WorkingHousehold): GroupDef {
  const h = wh.request.input.household;
  const self = h.members.find((m) => m.kind === "self");
  const stop = stopAgeOf(h);
  const now = self === undefined ? null : ageAt(self, wh.request.input.baseMonth);
  // 積立をやめる年齢が今の年齢以下: 積立は1か月も計算に入らない
  const past = stop !== null && now !== null && stop <= now;
  return {
    key: "sav/period",
    title: "運用の期間",
    ...(past ? { note: `積立をやめる年齢（${stop}歳）が今の年齢（${now}歳）以下なので、積立は計算に入っていません。続けるなら、今より後の年齢を入れるか空欄にしてください` } : {}),
    level: "simple",
    fields: [
      field({
        key: "sav/stopAge",
        item: "account.contributions",
        label: "積立をやめる年齢（ご本人）",
        // 空欄は退職の月まで（推定）でほぼ当たるので詳細（0078）
        level: "detail",
        kind: "int",
        suffix: "歳",
        min: 20,
        max: 90,
        optional: true,
        get: (w) => {
          const h = w.request.input.household;
          const age = stopAgeOf(h);
          if (age !== null) return { value: age };
          const e = stopEstimateOf(w.request);
          if (e.retired) return { value: null, estimated: `退職の年はもう過ぎているので、空欄は${e.until}まで積み立てる計算`, hint: e.until === "最後" ? "最後まで（推定）" : `${e.age}歳（推定）` };
          return { value: null, estimated: `空欄は${e.until}まで積み立てる計算`, hint: `${e.age}歳（推定）` };
        },
        set: (w, v) => (v === null && stopAgeOf(w.request.input.household) === null ? w : mutate(w, (h, req) => setStopAge(h, req.input.baseMonth, typeof v === "number" ? v : null))),
        // 空欄の推定は「口座ごとに持ち主の退職の年まで」の決まりで、年齢を書くと全部の積立を本人の年齢にそろえる（結果が変わる）ので、
        // 推定の値を書く確定はしない（blankEstimate を持たない。「この値にする」と「推定の値をまとめて使う」の数に入らない）
        sideEffects: "すべての積立（iDeCo・企業型DC を除く）の最後の期間の終わりを、この年齢にそろえます",
      }),
    ],
    actions: [],
  };
}

/**
 * 利回りの段階・例外の年（0040。詳細）: 口座ごとの利回りの段階（利回りか資産の配分）と例外の年。資産配分の入れ方では、運用する口座は
 * 共通の資産配分の段階（口座ごとの段階は計算に使わない）、運用しない口座（預金など）は口座ごと
 */
export function returnStagesSection(wh: WorkingHousehold): SectionDef {
  const h = wh.request.input.household;
  const method = methodOf(wh.request);
  const self = h.members.find((m) => m.kind === "self");
  const list = (h.accounts ?? []).filter((a) => !NON_FINANCIAL.has(a.kind) && a.kind !== "insurance" && (method === "total" ? a.kind === "pooled" : a.kind !== "pooled") && !(method === "allocation" && INVEST_KINDS.has(a.kind)));
  const groups: GroupDef[] = [];
  if (method === "allocation") groups.push(...allocationStageGroups(wh, self !== undefined ? { ageOf: (hh: Household) => hh.members.find((m) => m.id === self.id) } : {}));
  for (const a of list) {
    const owner = h.members.find((m) => m.id === a.owner);
    groups.push(
      ...returnStageGroups(wh, {
        key: `sav/${a.id}`,
        find: byId(accounts, a.id),
        accountId: a.id,
        name: `${a.kind === "pooled" ? "金融資産の合計" : (ACCOUNT_KINDS.find((o) => o.value === a.kind)?.label ?? "口座")}（${memberLabel(wh, a.owner)}）`,
        ...(owner !== undefined ? { ageOf: (hh: Household) => hh.members.find((m) => m.id === owner.id) } : {}),
        rate: (hh) => {
          const x = (hh.accounts ?? []).find((y) => y.id === a.id);
          return x === undefined ? null : rateOf({ ...wh.request, input: { ...wh.request.input, household: hh } }, x);
        },
      }),
    );
  }
  return {
    key: "sav/returns",
    title: "利回りの変化",
    note: "利回り（資産の配分）を、年齢・時期から先ずっと変えるとき（この年から先）や、特定の年だけ変えるとき（この年だけ）に使います。年の初めから変わり、運用の費用はこの後に引きます",
    level: "detail",
    groups,
    actions: [],
  };
}

/** 「＋ 口座を足す」の主な4つ（簡易）。ほかは「そのほか」（SavingsPanel が簡易からも開ける） */
export const MAIN_ADD_KINDS: ReadonlySet<string> = new Set(["deposit", "nisa", "ideco", "taxable"]);
/** お子さまの名義で作る器 */
const CHILD_KINDS: ReadonlySet<string> = new Set(["childNisa", "juniorNisa"]);

/** 預金に残しておく額（エンジンの assumptions.withdrawal.minimumDeposit。決済口座の年末の残高がこれを下回ると、ほかの口座から取り崩す） */
const MIN_ADDRESS = (): Address => ({ target: { plan: "assumptions" }, item: "assumptions.withdrawal", at: ["minimumDeposit"] });
function writeMinimum(w: WorkingHousehold, v: number | null, basis: string | null): WorkingHousehold {
  return mutate(w, (_h, req) => {
    const a = (req.input.assumptions ??= { investmentReturn: { default: "0.01" } });
    const wd = { ...(a.withdrawal ?? {}) };
    if (v === null || v <= 0) delete wd.minimumDeposit;
    else wd.minimumDeposit = Math.round(v);
    if (Object.keys(wd).length === 0) delete a.withdrawal;
    else a.withdrawal = wd;
    // 目安のボタンで入れた額は、根拠つきの推定の行にする（打った額は行を外す。0041）
    putRow(req.input as unknown as Record<string, unknown>, MIN_ADDRESS(), basis !== null && v !== null && v > 0 ? { state: "estimated", origin: { kind: "auto" }, estimate: { method: "standard", basis } } : undefined);
  });
}

/** 区画「お金の行き先」の欄（取り崩す順番の並べ替えと「取り崩さない」は画面の部品で描く。SavingsPanel の FlowSection） */
export function flowSection(wh: WorkingHousehold): SectionDef {
  const h = wh.request.input.household;
  const deposits = (h.accounts ?? []).filter((a) => a.kind === "deposit");
  const own = (id: string) => memberLabel(wh, (h.accounts ?? []).find((a) => a.id === id)?.owner ?? "");
  const fields: FieldDef[] = [];
  if (deposits.length > 1)
    fields.push(
      field({
        key: "sav/settlement",
        item: "account.settlement",
        label: "収支が入る口座（決済口座）",
        level: "detail",
        kind: "select",
        options: deposits.map((a, i) => ({ value: a.id, label: `${accountName(a, own(a.id))}${deposits.filter((x) => x.owner === a.owner).length > 1 ? ` ${i + 1}` : ""}` })),
        help: "給与・年金が入り、生活費・ローンを払う預金。ここが足りなくなると、下の順番でほかの口座から取り崩します。空欄なら最初の預金",
        get: (w) => {
          const st = settlementOf(w.request.input.household);
          return { value: st?.id ?? null, ...(st?.settlement !== true ? { implicit: true } : {}) };
        },
        set: (w, v) => (typeof v === "string" && v !== "" ? mutate(w, (hh) => setSettlement(hh, v)) : w),
      }),
    );
  const min = wh.request.input.assumptions?.withdrawal?.minimumDeposit;
  fields.push({
    ...field({
      key: "sav/withdraw/min",
      item: "assumptions.withdrawal",
      label: "預金に残しておく額",
      level: "detail",
      kind: "yen",
      basis: "once",
      help: "収支が入る口座の年末の残高がこの額を下回ると、上の順番でほかの口座から取り崩します。その年の年末の額です（今の値段ではありません）。0円なら、預金を使い切ってからほかの口座を取り崩します。手を付けたくないお金があれば入れます",
      get: (w) => {
        const v = w.request.input.assumptions?.withdrawal?.minimumDeposit;
        return { value: v ?? 0, ...(v === undefined ? { implicit: true } : {}) };
      },
      set: (w, v) => writeMinimum(w, typeof v === "number" ? v : null, null),
    }),
    address: MIN_ADDRESS,
  });
  const preset = (months: 6 | 12): ActionDef | null => {
    const p = reservePreset(h, months);
    if (p === null) return null;
    return { key: `sav/withdraw/min/preset${months}`, label: `目安: 生活費の${months === 6 ? "6か月分" : "1年分"}（${(p.value / 10000).toLocaleString("ja-JP")}万円）`, level: "detail", pressed: min === p.value, title: "押した時の基本生活費から額を出します（後で生活費を変えても、この額は変わりません）", run: (w) => writeMinimum(w, p.value, p.basis) };
  };
  return {
    key: "sav/flow",
    title: "お金の行き先",
    level: "detail",
    groups: [{ key: "sav/flow/main", level: "detail", fields, actions: [preset(6), preset(12)].filter((x): x is ActionDef => x !== null) }],
    actions: [],
  };
}

export function savingsStage(wh: WorkingHousehold): StageDef {
  const h = wh.request.input.household;
  const self = h.members.find((m) => m.kind === "self");
  const child = h.members.find((m) => m.kind === "child" && m.outside === undefined);
  // 貸している不動産（中身を持つ不動産の器）は収益不動産の項目に出す（0079）
  const others = (h.accounts ?? []).filter((a) => NON_FINANCIAL.has(a.kind) && !isRentalProperty(a));
  const add = (kind: string, label: string) => ({
    key: `sav/add/${kind}`,
    label: `＋ ${label}`,
    level: (MAIN_ADD_KINDS.has(kind) ? "simple" : "detail") as "simple" | "detail",
    run: (w: WorkingHousehold) =>
      mutate(w, (hh) => {
        if (self === undefined) return;
        const owner = CHILD_KINDS.has(kind) && child !== undefined ? child.id : self.id;
        // 残高は「未入力（0円で計算中）」の印で始める（打つと確定。0041）
        const a: Account = { id: newId(), kind, owner, marketValue: standardBox(0, NON_FINANCIAL.has(kind) ? UNENTERED_VALUE : UNENTERED_BALANCE), asOf: w.request.input.baseMonth, contributions: [] };
        if (kind === "nisa" || kind === "taxable" || kind === "childNisa") {
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
          ...((h.accounts ?? []).some((a) => !NON_FINANCIAL.has(a.kind) && (a.contributions ?? []).length > 0) ? [periodGroup(wh)] : []),
        ],
        actions: [
          add("deposit", "預貯金"),
          add("nisa", "NISA"),
          add("ideco", "iDeCo"),
          add("taxable", "課税口座"),
          add("zaikei", "財形貯蓄"),
          add("corporateDc", "企業型DC"),
          add("fxDeposit", "外貨預金"),
          add("esop", "持株会"),
          add("smallBusinessMutualAid", "小規模企業共済"),
          add("legacyNisa", "旧NISA"),
          add("juniorNisa", "ジュニアNISA"),
          add("childNisa", "こどもNISA"),
        ],
      },
      {
        key: "sav/others",
        title: "その他の資産",
        note: "貸していない土地・別荘などの不動産と、貴金属・美術品・貸付金など。資産と負債の推移・提案書のバランスシートに入ります（金融資産には入れず、取り崩しにも使いません）。人に貸している不動産は「収益不動産」、住まいは「住まい・ローン」、車は「車」で入れます",
        level: others.length > 0 ? "simple" : "detail",
        groups: others.flatMap((a) => otherAssetGroups(wh, a)),
        actions: [add("realEstate", "貸していない不動産"), add("otherAsset", "その他の資産")],
      },
      returnStagesSection(wh),
      ...(methodOf(wh.request) === "total" ? [] : [flowSection(wh)]),
    ],
  };
}
