// 車の購入の月の決まり（0101）。計算エンジンの部品（expense.car・asset.car）と、画面（車の一生の費用・この世帯の予定）・提案書が、
// 同じ決まりで読む純粋な関数（月は通しの月の番号。年×12＋月−1 でも、ほかの数え方でも、1か月が1つずれる数なら同じに読める）。
// - 購入は最初の購入の月（今の車は次の買い替えの月）から周期ごと
// - 手放す月には買わない（手放す月より前の月だけ。前は手放す月にも買っていた）
// - 買い替え（replace）: repeat（省略）は周期ごとに買い替え続ける。none は買い替えない（これから買う車は1回だけ買う、今の車は買わずに
//   乗り続ける）。until は最後に買える月（lastAt。「○歳まで買い替える」の、その年齢になる前の月）まで買い替え、その後は手放す月まで乗る
// - 表の最後の月より後は数えない。周期が1年より短い（0以下）ときは最初の1回だけ

/** 買い替えの決まり（解いた形。lastAt は最後に買える月） */
export type CarReplaceRule = "repeat" | "none" | { readonly lastAt: number };

export interface CarPurchaseMonthsInput<M extends number> {
  /** 最初の購入の月（今の車〔owned〕は次の買い替えの月） */
  readonly first: M;
  readonly everyYears: number;
  /** 今の車（最初の購入の月より前から持っている） */
  readonly owned?: boolean;
  /** 手放す月（null は最後まで乗る） */
  readonly release: M | null;
  /** 表の最後の月 */
  readonly end: M;
  /** 買い替え（省略は repeat） */
  readonly replace?: CarReplaceRule;
}

/** 車の購入の月（古い順。計算基準月より前の月も含む。下取りを引くかどうかは、呼ぶ側が何回目かで決める） */
export function carPurchaseMonths<M extends number>(o: CarPurchaseMonthsInput<M>): M[] {
  const rule = o.replace ?? "repeat";
  const out: M[] = [];
  const ok = (m: number) => (o.release === null || m < o.release) && m <= o.end;
  if (rule === "none") {
    if (o.owned !== true && ok(o.first)) out.push(o.first);
    return out;
  }
  const lastAt = rule === "repeat" ? null : rule.lastAt;
  const step = 12 * o.everyYears;
  for (let m: number = o.first; ok(m) && (lastAt === null || m <= lastAt); m += step) {
    out.push(m as M);
    if (step <= 0) break;
  }
  return out;
}

/**
 * 最後に買った車を手放す月まで乗る決まりか（none・until）。評価額は、最後に買った車をその後の買い替えの下取りではなく、手放す月に0まで下げる。
 * repeat は前のまま（次の買い替えの月の下取りの額まで下げる）
 */
export const carKeptToRelease = (replace: CarReplaceRule | undefined): boolean => replace !== undefined && replace !== "repeat";

/** リースの月額に含まれる物の既定（カーリースは税・自賠責と車検・メンテを含み保険は含まない、長期レンタルは全部を含む） */
export const CAR_LEASE_INCLUDES: Readonly<Record<"carLease" | "longRental", { readonly taxAndCompulsory: boolean; readonly inspectionMaintenance: boolean; readonly insurance: boolean }>> = {
  carLease: { taxAndCompulsory: true, inspectionMaintenance: true, insurance: false },
  longRental: { taxAndCompulsory: true, inspectionMaintenance: true, insurance: true },
};

/** リースの月額に含まれる物（書いていない物は種類の既定） */
export function carLeaseIncludes(lease: { readonly type: "carLease" | "longRental"; readonly includes?: { readonly taxAndCompulsory?: boolean; readonly inspectionMaintenance?: boolean; readonly insurance?: boolean } }): { taxAndCompulsory: boolean; inspectionMaintenance: boolean; insurance: boolean } {
  const d = CAR_LEASE_INCLUDES[lease.type] ?? CAR_LEASE_INCLUDES.carLease;
  const i = lease.includes ?? {};
  return { taxAndCompulsory: i.taxAndCompulsory ?? d.taxAndCompulsory, inspectionMaintenance: i.inspectionMaintenance ?? d.inspectionMaintenance, insurance: i.insurance ?? d.insurance };
}
