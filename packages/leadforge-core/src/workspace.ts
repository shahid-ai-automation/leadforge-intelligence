/**
 * LeadForge workspace state primitives.
 * Pure collection and suppression helpers; callers inject their own seed catalog.
 * No demo fixtures, persistence, network access, or application-specific store.
 */
import { matchesAnyIdentity, prospectIdentity } from "./engine";
import { identityHashes } from "./suppression";
import type { Prospect, ReplyStatus } from "./model";

export type ProspectEdit = Partial<Pick<Prospect, "name" | "title" | "company" | "city" | "country">>;

export interface ProspectRuntimeState {
  optedOut?: boolean;
  replyStatus?: ReplyStatus;
}

export interface ProspectCollectionState {
  customProspects: Prospect[];
  hiddenProspectIds?: string[];
  prospectEdits?: Record<string, ProspectEdit>;
  runtime: Record<string, ProspectRuntimeState | undefined>;
  suppressions?: Record<string, string>;
}

/** Remove duplicate IDs and person identities, preserving the first occurrence. */
export function dedupeNewProspects(existing: Prospect[], incoming: Prospect[]): Prospect[] {
  const ids = new Set(existing.map(p => p.id));
  const known = existing.map(prospectIdentity);
  const result: Prospect[] = [];
  for (const prospect of incoming) {
    const identity = prospectIdentity(prospect);
    if (ids.has(prospect.id) || matchesAnyIdentity(identity, known)) continue;
    ids.add(prospect.id);
    known.push(identity);
    result.push(prospect);
  }
  return result;
}

/** Return visible seed + custom records with workspace-local edits applied. */
export function listWorkspaceProspects(
  seedProspects: Prospect[],
  state: Pick<ProspectCollectionState, "customProspects" | "hiddenProspectIds" | "prospectEdits">,
): Prospect[] {
  const hidden = new Set(state.hiddenProspectIds ?? []);
  return [...seedProspects, ...state.customProspects]
    .filter(prospect => !hidden.has(prospect.id))
    .map(prospect => state.prospectEdits?.[prospect.id]
      ? { ...prospect, ...state.prospectEdits[prospect.id] }
      : prospect);
}

/** Return all known records, including hidden seeds, with local edits applied. */
export function listKnownProspects(
  seedProspects: Prospect[],
  state: Pick<ProspectCollectionState, "customProspects" | "prospectEdits">,
): Prospect[] {
  return [...seedProspects, ...state.customProspects]
    .map(prospect => state.prospectEdits?.[prospect.id]
      ? { ...prospect, ...state.prospectEdits[prospect.id] }
      : prospect);
}

/** Add original and edited identity fingerprints to the append-only suppression map. */
export function addProspectSuppressions(
  seedProspects: Prospect[],
  state: Pick<ProspectCollectionState, "customProspects" | "prospectEdits" | "suppressions">,
  prospectIds: string[],
): Record<string, string> {
  const result = { ...(state.suppressions ?? {}) };
  const catalog = [...seedProspects, ...state.customProspects];
  for (const id of prospectIds) {
    const original = catalog.find(prospect => prospect.id === id);
    if (!original) continue;
    for (const hash of identityHashes(original)) result[hash] = id;
    const edit = state.prospectEdits?.[id];
    if (edit) for (const hash of identityHashes({ ...original, ...edit })) result[hash] = id;
  }
  return result;
}

/** Merge opt-out runtime state into the persistent suppression map. */
export function deriveOptOutSuppressions(
  seedProspects: Prospect[],
  state: Pick<ProspectCollectionState, "customProspects" | "prospectEdits" | "suppressions" | "runtime">,
): Record<string, string> {
  const optedOutIds = listKnownProspects(seedProspects, state)
    .filter(prospect => state.runtime[prospect.id]?.optedOut)
    .map(prospect => prospect.id);
  return addProspectSuppressions(seedProspects, state, optedOutIds);
}

/** Block a prospect if its runtime status, identity fingerprint, or stored ID is suppressed. */
export function isProspectSuppressed(
  state: Pick<ProspectCollectionState, "runtime" | "suppressions">,
  prospect: Prospect,
): boolean {
  if (state.runtime[prospect.id]?.optedOut) return true;
  const suppressions = state.suppressions ?? {};
  return identityHashes(prospect).some(hash => hash in suppressions)
    || Object.values(suppressions).includes(prospect.id);
}

export function isProspectOptedOut(
  state: Pick<ProspectCollectionState, "runtime">,
  prospectId: string | undefined,
): boolean {
  return !!prospectId && !!state.runtime[prospectId]?.optedOut;
}
