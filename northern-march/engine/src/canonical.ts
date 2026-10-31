// Canonical JSON: sorted keys, integers only. Hashes of logs and saves are taken over this form,
// so key insertion order, locale and float formatting cannot change a hash (A2, G-01).
import { createHash } from "node:crypto";

export function canonicalJson(v: unknown): string {
  if (v === null) return "null";
  switch (typeof v) {
    case "number":
      if (!Number.isSafeInteger(v)) throw new Error(`non-integer number in sim data: ${v}`);
      return String(v);
    case "boolean":
      return v ? "true" : "false";
    case "string":
      return JSON.stringify(v);
    case "object": {
      if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
      const keys = Object.keys(v as object).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort();
      return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson((v as Record<string, unknown>)[k])).join(",") + "}";
    }
    default:
      throw new Error(`unsupported value in sim data: ${typeof v}`);
  }
}

export function sha256(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

export function hashOf(v: unknown): string {
  return sha256(canonicalJson(v));
}
