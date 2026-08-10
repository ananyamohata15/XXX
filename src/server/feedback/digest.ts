/**
 * Fact fingerprinting for adjudicability (XXX-33; decision 001 addendum
 * 2026-08-09).
 *
 * An evidence row must be adjudicable against WHAT WAS DISPLAYED, and
 * the displayed hours / status / price are Google content that may not
 * be persisted. So we store a sha256 of the value's canonical JSON: a
 * one-way, non-reconstructible fingerprint whose only capability is
 * change detection ("what you saw then differs from what we fetch now").
 * That is the entire adjudication need, and it stores no value.
 *
 * Canonical means key-sorted recursively, so a digest is stable against
 * the serialization order of whatever produced the object. Without that
 * the fingerprint would compare two runs' JSON.stringify habits rather
 * than two runs' facts.
 */

import { createHash } from "node:crypto";
import type { JsonValue } from "@/shared/day-grammar/types";

export function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  }
  const record = value as { readonly [key: string]: JsonValue };
  const entries = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${entries.join(",")}}`;
}

export function factDigest(value: JsonValue): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
