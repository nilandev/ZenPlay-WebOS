import type { KidsContentKind, ParentCategoryDecision, ParentItemDecision, ParentSourceRules } from "@core";
import { hashPin, verifyPin, type PinHash } from "./pin-hash.js";

/**
 * Parental settings, persisted in localStorage (docs/kids-profile.md §2.2
 * and §4):
 *
 * - `iptv.parental.v1` — the household's optional parent PIN (hashed; no
 *   PIN means trust mode), the wrong-PIN lockout, and when a parent
 *   acknowledged the Parental Discretion Disclaimer.
 * - `iptv.kids-rules.v1` — each Kids profile's content decisions, per
 *   playlist: approved/rejected categories and force-included/excluded
 *   titles, plus the "kid-friendly titles from other categories" switch.
 *
 * Every write takes effect at once (no Save step) and notifies
 * subscribers, so an open Kids screen re-filters without a resync.
 */

const PARENTAL_KEY = "iptv.parental.v1";
const KIDS_RULES_KEY = "iptv.kids-rules.v1";

/** Wrong PINs allowed before the cooldown. */
export const MAX_PIN_ATTEMPTS = 5;
export const PIN_LOCKOUT_MS = 60_000;
export const PIN_LENGTH = 4;

interface ParentalState {
  pin: PinHash | null;
  disclaimerAcknowledgedAt?: string;
  failedAttempts: number;
  /** Epoch ms. Persisted, so relaunching the app doesn't reset a lockout. */
  lockedUntil?: number;
}

export interface KidsProfileRules {
  /** §3.3 step 5 — off unless a parent turns it on. */
  allowOtherCategories?: boolean;
  sources: Record<string, ParentSourceRules>;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or unavailable — the change still applies for this session through the notification below.
  }
}

// --- Change notification (same pattern as profile-store.ts's favourites) ---

let revision = 0;
const listeners = new Set<() => void>();

function changed(): void {
  revision += 1;
  for (const listener of listeners) listener();
}

export function subscribeParental(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Increments on every parental change — use as a memo dependency (see useParentalRevision). */
export function getParentalRevision(): number {
  return revision;
}

// --- PIN ---

function readState(): ParentalState {
  const stored = readJson<Partial<ParentalState>>(PARENTAL_KEY, {});
  return { failedAttempts: 0, ...stored, pin: stored.pin ?? null };
}

function writeState(state: ParentalState): void {
  writeJson(PARENTAL_KEY, state);
  changed();
}

export function hasPin(): boolean {
  return readState().pin !== null;
}

/**
 * The one check every PIN gate uses (docs/kids-profile.md §2.3): true in
 * locked mode, false in trust mode — where no action ever shows the keypad.
 */
export function requiresPin(): boolean {
  return hasPin();
}

/** Sets or replaces the PIN (trust → locked, or Change PIN — the caller has already verified the current one). */
export async function setPin(pin: string): Promise<void> {
  const hashed = await hashPin(pin);
  writeState({ ...readState(), pin: hashed, failedAttempts: 0, lockedUntil: undefined });
}

/** Remove PIN: back to trust mode. */
export function removePin(): void {
  writeState({ ...readState(), pin: null, failedAttempts: 0, lockedUntil: undefined });
}

/** Milliseconds left on a wrong-PIN lockout, or 0. */
export function getLockoutRemainingMs(now = Date.now()): number {
  const { lockedUntil } = readState();
  return lockedUntil && lockedUntil > now ? lockedUntil - now : 0;
}

export type PinCheckResult = { ok: true } | { ok: false; lockedForMs: number; attemptsLeft: number };

/**
 * Verifies a PIN attempt. In trust mode there's nothing to check, so any
 * attempt passes. MAX_PIN_ATTEMPTS wrong ones in a row start a
 * PIN_LOCKOUT_MS cooldown, during which every attempt fails unchecked.
 */
export async function checkPin(pin: string, now = Date.now()): Promise<PinCheckResult> {
  const state = readState();
  if (!state.pin) return { ok: true };
  if (state.lockedUntil && state.lockedUntil > now) return { ok: false, lockedForMs: state.lockedUntil - now, attemptsLeft: 0 };

  if (await verifyPin(pin, state.pin)) {
    if (state.failedAttempts !== 0 || state.lockedUntil) writeState({ ...state, failedAttempts: 0, lockedUntil: undefined });
    return { ok: true };
  }
  // A lockout that has run out starts a fresh count.
  const failedAttempts = (state.lockedUntil && state.lockedUntil <= now ? 0 : state.failedAttempts) + 1;
  if (failedAttempts >= MAX_PIN_ATTEMPTS) {
    writeState({ ...state, failedAttempts: 0, lockedUntil: now + PIN_LOCKOUT_MS });
    return { ok: false, lockedForMs: PIN_LOCKOUT_MS, attemptsLeft: 0 };
  }
  writeState({ ...state, failedAttempts, lockedUntil: undefined });
  return { ok: false, lockedForMs: 0, attemptsLeft: MAX_PIN_ATTEMPTS - failedAttempts };
}

// --- Disclaimer ---

export function getDisclaimerAcknowledgedAt(): string | undefined {
  return readState().disclaimerAcknowledgedAt;
}

export function acknowledgeDisclaimer(now = new Date()): void {
  writeState({ ...readState(), disclaimerAcknowledgedAt: now.toISOString() });
}

// --- Kids profile rules ---

function readAllRules(): Record<string, KidsProfileRules> {
  return readJson<Record<string, KidsProfileRules>>(KIDS_RULES_KEY, {});
}

function writeAllRules(all: Record<string, KidsProfileRules>): void {
  writeJson(KIDS_RULES_KEY, all);
  changed();
}

/** A Kids profile's rules — a new Kids profile has none, so it starts from the bundled defaults. */
export function loadKidsProfileRules(profileId: string): KidsProfileRules {
  return readAllRules()[profileId] ?? { sources: {} };
}

export function getParentSourceRules(profileId: string, sourceId: string): ParentSourceRules | undefined {
  return readAllRules()[profileId]?.sources[sourceId];
}

function updateSourceRules(profileId: string, sourceId: string, update: (rules: ParentSourceRules) => ParentSourceRules): void {
  const all = readAllRules();
  const profileRules = all[profileId] ?? { sources: {} };
  const next = update(profileRules.sources[sourceId] ?? {});
  writeAllRules({ ...all, [profileId]: { ...profileRules, sources: { ...profileRules.sources, [sourceId]: next } } });
}

function withEntry<V>(map: Record<string, V> | undefined, key: string, value: V | null): Record<string, V> {
  const next = { ...(map ?? {}) };
  if (value === null) delete next[key];
  else next[key] = value;
  return next;
}

/** Approve/reject a category for one Kids profile; null clears the decision (back to the automatic verdict). */
export function setCategoryDecision(profileId: string, sourceId: string, kind: KidsContentKind, categoryId: string, decision: ParentCategoryDecision | null): void {
  updateSourceRules(profileId, sourceId, (rules) => ({
    ...rules,
    categories: { ...rules.categories, [kind]: withEntry(rules.categories?.[kind], categoryId, decision) },
  }));
}

/** Force-include/exclude one title or channel; null clears it (back to the category's rules). */
export function setItemDecision(profileId: string, sourceId: string, kind: KidsContentKind, itemId: string, decision: ParentItemDecision | null): void {
  updateSourceRules(profileId, sourceId, (rules) => ({
    ...rules,
    items: { ...rules.items, [kind]: withEntry(rules.items?.[kind], itemId, decision) },
  }));
}

export function setAllowOtherCategories(profileId: string, allow: boolean): void {
  const all = readAllRules();
  const profileRules = all[profileId] ?? { sources: {} };
  writeAllRules({ ...all, [profileId]: { ...profileRules, allowOtherCategories: allow } });
}

/** Drops a deleted profile's rules. */
export function removeKidsProfileRules(profileId: string): void {
  const all = readAllRules();
  if (!(profileId in all)) return;
  const { [profileId]: _removed, ...rest } = all;
  writeAllRules(rest);
}

/** Drops a removed playlist's rules from every Kids profile. */
export function removeSourceKidsRules(sourceId: string): void {
  const all = readAllRules();
  let touched = false;
  const next: Record<string, KidsProfileRules> = {};
  for (const [profileId, rules] of Object.entries(all)) {
    if (sourceId in rules.sources) {
      touched = true;
      const { [sourceId]: _removed, ...sources } = rules.sources;
      next[profileId] = { ...rules, sources };
    } else {
      next[profileId] = rules;
    }
  }
  if (touched) writeAllRules(next);
}

/** Test-only. */
export function __resetParentalForTests(): void {
  revision = 0;
  listeners.clear();
}
