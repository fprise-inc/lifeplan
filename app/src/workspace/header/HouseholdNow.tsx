// 世帯の選択のメニューの頭: 開いている世帯の状態（構成と年齢・計算の基準・保存の状態・AIとの共有）。
// 上の帯からは外した状態の表示を、ここでまとめて見る
export interface HouseholdNowProps {
  /** 顧客番号、または見本の名前 */
  title: string;
  /** 例: 「ご主人 45歳・奥さま 43歳」 */
  members: string | null;
  /** 例: 「2026年10月時点」 */
  asOf: string | null;
  save: { text: string; cls: string; state: string };
  /** AIとの共有（事務所でAIを使わない設定のときは null） */
  ai: { text: string; sharing: boolean; onOpen: (() => void) | null } | null;
}

export function HouseholdNow(p: HouseholdNowProps) {
  return (
    <section class="card hh-now" aria-label="開いている世帯の状態" data-household-now>
      <dl>
        <div>
          <dt>開いている世帯</dt>
          <dd>
            <b>{p.title}</b>
            {p.members !== null ? <span class="hh-now-members">{p.members}</span> : null}
            {p.asOf !== null ? <span class="tag">{p.asOf}の計算</span> : null}
          </dd>
        </div>
        <div>
          <dt>保存</dt>
          <dd class={`save-state ${p.save.cls}`} role="status" data-save-state={p.save.state}>
            {p.save.text}
          </dd>
        </div>
        {p.ai !== null ? (
          <div>
            <dt>AIとの共有</dt>
            <dd class={p.ai.sharing ? "hh-now-ai on" : "hh-now-ai"} data-ai-now={p.ai.sharing ? "sharing" : "idle"}>
              <span>{p.ai.text}</span>
              {p.ai.onOpen !== null ? (
                <button type="button" class="link-btn" onClick={p.ai.onOpen} data-open-ai-share>
                  この世帯の同意と共有
                </button>
              ) : null}
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

/** 結果・万一のときの画面の頭: 計算の前提の世帯の年齢と基準の月（顧客と一緒に見るときに、何時点のだれの計算かが分かるように小さく） */
export function BasisLine({ members, asOf }: { members: string; asOf: string }) {
  return (
    <p class="basis-line" data-basis>
      <span>{members}</span>
      <span class="tag">{asOf}</span>
    </p>
  );
}
