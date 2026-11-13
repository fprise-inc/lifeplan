// AI接続口（crates/lifeplan）に同梱する部品が、世帯の要求から画面と同じく作業中の世帯を作る所（0195。入力の確かめ check.ts と共有するため
// plan.ts から分けた。0210）。見本の世帯では画面と同じく見本の目盛りと定年後の働き方を使い、渡された世帯では縮約版の定年後の働き方の条件を、
// 画面で保存した世帯を開いたときと同じくそのまま使う（store/body.ts の fromBody と同じ）
import type { EngineRequest } from "../engine/types.ts";
import { demoHousehold, type DemoHousehold } from "../workspace/catalog.ts";
import { fromRequest, type PostRetirement, type WorkingHousehold } from "../workspace/input/household.ts";
import { roles } from "../workspace/roles.ts";

/** 接続口から渡す世帯の添え書き（JSON の文字の一部） */
export interface WorkingArgs {
  /** 見本の世帯の ID（見本の目盛り・定年後の働き方を画面と同じに使う。見本でなければ省く） */
  sampleId?: string;
  /**
   * 渡された世帯の定年後の働き方の条件（縮約版の postRetirement。構成員の ID → 条件）。あれば、画面で保存した世帯を開いたときと同じく
   * これをそのまま使う（無い構成員は条件なし。入力の働き方の期間から推し量らない）。見本の世帯・AI が組み立てた入力では省く
   */
  postRetirement?: Record<string, PostRetirement>;
}

/** 作業中の世帯と、本人の構成員の ID・見本の世帯（見本でなければ null）。本人がいなければ null */
export function workingOf(req: EngineRequest, a: WorkingArgs): { wh: WorkingHousehold; self: string; demo: DemoHousehold | null } | null {
  const self = roles(req).find((r) => r.key === "self");
  if (self === undefined) return null;
  const demo = a.sampleId === undefined ? null : (demoHousehold(a.sampleId) ?? null);
  const re = demo?.reemployment;
  const wh0 = fromRequest(req, re !== undefined ? { postRetirement: { [self.member.id]: { ...re, type: re.type as "contract" } } } : {});
  const wh = a.postRetirement !== undefined ? { ...wh0, postRetirement: { ...a.postRetirement } } : wh0;
  return { wh, self: self.member.id, demo };
}
