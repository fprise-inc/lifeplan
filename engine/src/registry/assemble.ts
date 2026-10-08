// 0006 の2〜4: 組み立て役。計算のはじめに部品IDごとに実装を1つだけ決める
import { EngineError } from "../errors.ts";
import { isTestId } from "../ids/ids.ts";
import type { ComponentDefinition } from "./define.ts";
import { SLOTS } from "./slots.ts";
import { contractMajor, satisfiesRange } from "../regulation/versions.ts";

export type Origin = "official" | "replacement" | "extension";

export interface Impl {
  readonly def: ComponentDefinition;
  readonly hash: string;
  readonly origin: Origin;
  readonly slot?: string;
}

export interface OfficialComponent {
  readonly def: ComponentDefinition;
  readonly hash: string;
}

/** 差し替え（公式部品の置き換え）。0016 のマニフェストの { type: "replace", target, contract } に当たる */
export interface Replacement {
  readonly type: "replace";
  readonly target: string;
  readonly contract: string;
  readonly component: ComponentDefinition;
  readonly hash: string;
}

/** 追加（差し込み口への足し算） */
export interface Extension {
  readonly type: "extend";
  readonly extensionPoint: string;
  readonly contract: string;
  readonly component: ComponentDefinition;
  readonly hash: string;
}

export interface ComponentRef {
  readonly id: string;
  readonly contract: string;
  readonly revision: number;
  readonly hash: string;
  readonly origin: Origin;
  readonly slot?: string;
}

export interface Assembly {
  readonly impls: ReadonlyMap<string, Impl>;
  readonly extensions: ReadonlyMap<string, readonly Impl[]>;
  readonly refs: readonly ComponentRef[];
}

export interface AssembleOptions {
  readonly replacements?: readonly Replacement[];
  readonly extensions?: readonly Extension[];
}

export function assemble(official: readonly OfficialComponent[], options: AssembleOptions = {}): Assembly {
  const impls = new Map<string, Impl>();
  for (const o of official) {
    if (impls.has(o.def.id)) throw new EngineError("E_COMPONENT_DUPLICATE", [o.def.id]);
    impls.set(o.def.id, { def: o.def, hash: o.hash, origin: "official" });
  }

  for (const r of options.replacements ?? []) {
    const target = impls.get(r.target);
    if (target === undefined) throw new EngineError("E_COMPONENT_UNKNOWN", [r.target]);
    if (target.origin !== "official") throw new EngineError("E_COMPONENT_DUPLICATE", [r.target]);
    if (target.def.replaceable !== true) throw new EngineError("E_NOT_REPLACEABLE", [r.target]);
    if (r.component.id !== r.target) throw new EngineError("E_COMPONENT_DEFINITION", [r.target, "id"]);
    // 公式の MAJOR が上がったら差し替えは使わない。黙って公式に戻さず、計算を止めて知らせる
    const officialMajor = contractMajor(target.def.contract);
    if (Number(r.contract) !== officialMajor || contractMajor(r.component.contract) !== officialMajor) {
      throw new EngineError("E_CONTRACT_MISMATCH", [r.target]);
    }
    impls.set(r.target, { def: r.component, hash: r.hash, origin: "replacement" });
  }

  const extensions = new Map<string, Impl[]>();
  for (const x of options.extensions ?? []) {
    const slot = SLOTS.get(x.extensionPoint);
    if (slot === undefined) throw new EngineError("E_SLOT_UNKNOWN", [x.extensionPoint]);
    if (!slot.open) throw new EngineError("E_SLOT_CLOSED", [x.extensionPoint]);
    if (Number(x.contract) !== contractMajor(slot.contract) || contractMajor(x.component.contract) !== contractMajor(slot.contract)) {
      throw new EngineError("E_CONTRACT_MISMATCH", [x.extensionPoint, x.component.id]);
    }
    const id = x.component.id;
    if (!id.startsWith("ext.") && !isTestId(id)) throw new EngineError("E_COMPONENT_DEFINITION", [id, "extensionId"]);
    if (impls.has(id) || [...extensions.values()].some((l) => l.some((i) => i.def.id === id))) {
      throw new EngineError("E_COMPONENT_DUPLICATE", [id]);
    }
    const list = extensions.get(slot.id) ?? [];
    list.push({ def: x.component, hash: x.hash, origin: "extension", slot: slot.id });
    extensions.set(slot.id, list);
  }
  // 差し込み口の中の順番は部品IDの順（足した順に依らない）
  for (const list of extensions.values()) list.sort((a, b) => (a.def.id < b.def.id ? -1 : a.def.id > b.def.id ? 1 : 0));

  checkRequires(impls);
  const refs: ComponentRef[] = [];
  for (const i of [...impls.values(), ...[...extensions.values()].flat()]) {
    refs.push({
      id: i.def.id,
      contract: i.def.contract,
      revision: i.def.revision,
      hash: i.hash,
      origin: i.origin,
      ...(i.slot !== undefined ? { slot: i.slot } : {}),
    });
  }
  refs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { impls, extensions, refs };
}

/** 使う部品があり、約束の MAJOR が合い、依存が循環していないこと */
function checkRequires(impls: ReadonlyMap<string, Impl>): void {
  for (const i of impls.values()) {
    for (const [dep, range] of Object.entries(i.def.requires)) {
      const d = impls.get(dep);
      if (d === undefined) throw new EngineError("E_COMPONENT_UNKNOWN", [i.def.id, dep]);
      if (!satisfiesRange(contractMajor(d.def.contract), range)) throw new EngineError("E_CONTRACT_MISMATCH", [i.def.id, dep]);
    }
  }
  const state = new Map<string, "visiting" | "done">();
  const visit = (id: string, path: readonly string[]): void => {
    const s = state.get(id);
    if (s === "done") return;
    if (s === "visiting") throw new EngineError("E_COMPONENT_CYCLE", [...path, id]);
    state.set(id, "visiting");
    for (const dep of Object.keys((impls.get(id) as Impl).def.requires)) visit(dep, [...path, id]);
    state.set(id, "done");
  };
  for (const id of impls.keys()) visit(id, []);
}
