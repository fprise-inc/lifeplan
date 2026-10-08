// 0003 の6: 時点の型（絶対・年齢・イベントから）と名前つきイベントの解決
import { EngineError } from "../errors.ts";
import { resolveAgeSwitch, type AgeSwitch, type Birth } from "./ageSwitch.ts";
import { addMonths, formatYm, parseYm, type MonthIndex } from "./month.ts";

export type Timepoint =
  | { readonly at: string }
  | {
      readonly memberAge: {
        readonly member: string;
        readonly years: number;
        readonly months?: number;
        readonly ageSwitch?: AgeSwitch;
      };
    }
  | { readonly event: string; readonly offset?: { readonly years?: number; readonly months?: number } };

export interface MemberLike {
  readonly id: string;
  readonly birth: Birth;
  readonly sex?: "female" | "male";
}

export interface EventLike {
  readonly id: string;
  readonly kind: string;
  readonly at: Timepoint;
}

/** 解決の記録（根拠の記録に残す） */
export interface TimepointResolution {
  readonly timepoint: Timepoint;
  readonly ym: string;
  readonly rule?: AgeSwitch;
}

export class TimeResolver {
  private readonly members = new Map<string, MemberLike>();
  private readonly events = new Map<string, EventLike>();
  private readonly resolvedEvents = new Map<string, MonthIndex>();

  constructor(members: readonly MemberLike[], events: readonly EventLike[]) {
    for (const m of members) this.members.set(m.id, m);
    for (const e of events) this.events.set(e.id, e);
  }

  /** すべてのイベントを先に解決する（循環はここでエラーになる） */
  resolveAllEvents(): ReadonlyMap<string, MonthIndex> {
    for (const id of this.events.keys()) this.resolveEvent(id, []);
    return this.resolvedEvents;
  }

  eventKind(id: string): string {
    const e = this.events.get(id);
    if (e === undefined) throw new EngineError("E_TIMEPOINT_UNKNOWN", [id]);
    return e.kind;
  }

  birthOf(memberId: string): Birth {
    const m = this.members.get(memberId);
    if (m === undefined) throw new EngineError("E_TIMEPOINT_UNKNOWN", [memberId]);
    return m.birth;
  }

  sexOf(memberId: string): "female" | "male" | undefined {
    const m = this.members.get(memberId);
    if (m === undefined) throw new EngineError("E_TIMEPOINT_UNKNOWN", [memberId]);
    return m.sex;
  }

  resolveEvent(id: string, stack: readonly string[]): MonthIndex {
    const done = this.resolvedEvents.get(id);
    if (done !== undefined) return done;
    if (stack.includes(id)) throw new EngineError("E_TIMEPOINT_CYCLE", [...stack, id]);
    const e = this.events.get(id);
    if (e === undefined) throw new EngineError("E_TIMEPOINT_UNKNOWN", [id]);
    const m = this.resolve(e.at, [...stack, id]);
    this.resolvedEvents.set(id, m);
    return m;
  }

  resolve(tp: Timepoint, stack: readonly string[] = []): MonthIndex {
    if ("at" in tp) return parseYm(tp.at);
    if ("memberAge" in tp) {
      const a = tp.memberAge;
      return resolveAgeSwitch(this.birthOf(a.member), { years: a.years, months: a.months ?? 0 }, a.ageSwitch ?? "reachMonth");
    }
    const base = this.resolveEvent(tp.event, stack);
    const off = (tp.offset?.years ?? 0) * 12 + (tp.offset?.months ?? 0);
    return addMonths(base, off);
  }

  describe(tp: Timepoint, m: MonthIndex): TimepointResolution {
    if ("memberAge" in tp) return { timepoint: tp, ym: formatYm(m), rule: tp.memberAge.ageSwitch ?? "reachMonth" };
    return { timepoint: tp, ym: formatYm(m) };
  }
}
