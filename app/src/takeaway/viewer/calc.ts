// 持ち帰り用のレポートの中の計算（0030）: ファイルに埋め込んだ計算エンジン（開発用の webview の計算と同じまとめた JS）を、
// ファイルに埋め込んだ制度データで動かす。プランごとに枠を1つ持ち、変わった枠だけを計算し直す（セッションが部品の結果を使い回す）
import type { EngineRequest, PreviewResult } from "../../engine/types.ts";

/** まとめた JS がグローバルに置くもの（engine/src/entry.ts。使うところだけ） */
export interface EngineLike {
  createSession(packsJson: string, optionsJson?: string): {
    set(slotsJson: string): string;
    compute(idsJson?: string, optionsJson?: string): string;
  };
}

export type CalcResult = { ok: true; result: PreviewResult } | { ok: false; code: string };

export class TakeawayCalc {
  private readonly session: ReturnType<EngineLike["createSession"]>;
  private readonly last = new Map<string, string>();
  private readonly results = new Map<string, CalcResult>();

  constructor(engine: EngineLike, packs: readonly unknown[]) {
    this.session = engine.createSession(JSON.stringify(packs));
  }

  /** 枠（プランの文字 → 要求）を置き、変わった枠だけ計算する。全部の枠の結果を返す */
  run(requests: Record<string, EngineRequest>): Record<string, CalcResult> {
    const changed: string[] = [];
    const slots: string[] = [];
    for (const [id, req] of Object.entries(requests)) {
      const text = JSON.stringify(req);
      if (this.last.get(id) === text && this.results.has(id)) continue;
      this.last.set(id, text);
      changed.push(id);
      slots.push(`${JSON.stringify(id)}:${text}`);
    }
    if (changed.length > 0) {
      try {
        this.session.set(`{${slots.join(",")}}`);
        const out = JSON.parse(this.session.compute(JSON.stringify(changed), '{"preview":true}')) as Record<string, { result?: unknown }> & { error?: { code?: string } };
        for (const id of changed) {
          const r = out.error !== undefined ? out : (out[id]?.result as (PreviewResult & { error?: { code?: string } }) | undefined);
          if (r === undefined || r.error !== undefined) this.results.set(id, { ok: false, code: r?.error?.code ?? "E_TAKEAWAY_COMPUTE" });
          else this.results.set(id, { ok: true, result: r as PreviewResult });
        }
      } catch {
        for (const id of changed) this.results.set(id, { ok: false, code: "E_TAKEAWAY_COMPUTE" });
      }
    }
    const all: Record<string, CalcResult> = {};
    for (const id of Object.keys(requests)) all[id] = this.results.get(id) ?? { ok: false, code: "E_TAKEAWAY_COMPUTE" };
    return all;
  }
}
