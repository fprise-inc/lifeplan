// scripts/bench-js.js の型（Node と Bun で同じ JS を使うため、本体は JS で書く）
export function measure(
  engine: unknown,
  packsJson: string,
  data: { requests: readonly unknown[]; sliders: Readonly<Record<string, readonly (readonly unknown[])[]>> },
  repeat: number,
): Record<string, { median: number; min: number }>;
