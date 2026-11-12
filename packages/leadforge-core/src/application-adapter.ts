/**
 * Application-boundary adapter for the isolated LeadForge core reducer.
 *
 * This module intentionally has no dependency on the Remix application, its
 * demo fixtures, React, browser APIs, persistence, or server functions. The
 * caller injects the pinned application catalogue and supplies seedState()
 * output for RESET. Security/concurrency metadata is returned separately and
 * is never silently discarded.
 */
import {
  reduceLeadForgeState,
  type LeadForgeAction,
  type LeadForgeState,
  type ReducerMeta,
} from "./reducer";
import type { Campaign, ICP, Prospect } from "./model";
import type { DraftMessage } from "./drafts";

export type ApplicationState<TIndustry extends string = string> =
  Omit<LeadForgeState, "prospects" | "industryIcps" | "demoIndustry"> & {
    demoIndustry: TIndustry;
  };

export interface ApplicationCatalog {
  /** Code-owned seed catalogue; inject from the application at its boundary. */
  prospects: Prospect[];
  /** Code-owned ICP catalogue; inject from the application at its boundary. */
  industryIcps: Record<string, ICP>;
}

type CorePassthroughAction = Exclude<
  LeadForgeAction,
  | { type: "RESET" }
  | { type: "HYDRATE" }
  | { type: "MOVE_STAGE" }
  | { type: "SAVE_DRAFT" }
  | { type: "REVIEW_DRAFT" }
  | { type: "SET_DEMO_INDUSTRY" }
>;

export type ApplicationAction<TIndustry extends string = string> =
  | CorePassthroughAction
  | { type: "SET_DEMO_INDUSTRY"; industry: TIndustry }
  | { type: "MOVE_STAGE"; prospectId: string; stage: LeadForgeState["runtime"][string]["stage"]; authorized?: boolean }
  | { type: "SAVE_DRAFT"; draft: DraftMessage; expectedVersion?: number }
  | { type: "REVIEW_DRAFT"; prospectId: string; status: "approved" | "rejected"; expectedVersion: number }
  | { type: "RESET" }
  | { type: "HYDRATE"; state: ApplicationState<TIndustry> };

export interface BoundaryMetadata {
  /** Must be checked by the existing server mutation boundary before reduction. */
  expectedVersion?: number;
  /** Authorization hint is preserved for the caller; it is not a security decision. */
  authorized?: boolean;
}

export interface AdaptedAction {
  action: LeadForgeAction;
  boundary: BoundaryMetadata;
}

export interface ApplicationReduction<TIndustry extends string = string> {
  state: ApplicationState<TIndustry>;
  boundary: BoundaryMetadata;
  /** Last allocated notification id; caller owns and persists this counter. */
  notificationCounter: number;
}

export function toCoreState<TIndustry extends string>(
  state: ApplicationState<TIndustry>,
  catalog: ApplicationCatalog,
): LeadForgeState {
  return {
    ...state,
    prospects: catalog.prospects,
    industryIcps: catalog.industryIcps,
  };
}

/** Explicit projection prevents injected catalogue fields leaking into app state. */
export function toApplicationState<TIndustry extends string>(
  state: LeadForgeState,
): ApplicationState<TIndustry> {
  const {
    prospects: _seedProspects,
    industryIcps: _industryCatalogue,
    ...applicationState
  } = state;
  return applicationState as ApplicationState<TIndustry>;
}

export function adaptApplicationAction<TIndustry extends string>(
  action: ApplicationAction<TIndustry>,
  catalog: ApplicationCatalog,
  resetBaseline?: ApplicationState<TIndustry>,
): AdaptedAction {
  switch (action.type) {
    case "RESET": {
      if (!resetBaseline) {
        throw new Error("ADAPTER_RESET_BASELINE_REQUIRED: pass the application seedState() result.");
      }
      return { action: { type: "RESET", baseline: toCoreState(resetBaseline, catalog) }, boundary: {} };
    }
    case "HYDRATE":
      return { action: { type: "HYDRATE", state: toCoreState(action.state, catalog) }, boundary: {} };
    case "MOVE_STAGE":
      return {
        action: { type: "MOVE_STAGE", prospectId: action.prospectId, stage: action.stage },
        boundary: action.authorized === undefined ? {} : { authorized: action.authorized },
      };
    case "SAVE_DRAFT":
      return {
        action: { type: "SAVE_DRAFT", draft: action.draft },
        boundary: action.expectedVersion === undefined ? {} : { expectedVersion: action.expectedVersion },
      };
    case "REVIEW_DRAFT":
      return {
        action: { type: "REVIEW_DRAFT", prospectId: action.prospectId, status: action.status },
        boundary: { expectedVersion: action.expectedVersion },
      };
    case "SET_DEMO_INDUSTRY":
      if (!Object.prototype.hasOwnProperty.call(catalog.industryIcps, action.industry)) {
        throw new Error(`ADAPTER_UNKNOWN_INDUSTRY: ${action.industry}`);
      }
      return { action: { type: "SET_DEMO_INDUSTRY", industry: action.industry }, boundary: {} };
    default:
      return { action: action as LeadForgeAction, boundary: {} };
  }
}

/**
 * Apply one app action through the isolated core reducer.
 *
 * The module-global application notification counter is replaced by an
 * explicit caller-owned counter. Current reducer transitions that allocate
 * notification ids allocate exactly two ids (notification + history) per
 * generated notification. NOTIFY/HYDRATE/RESET do not allocate from that
 * counter, matching the pinned application reducer's behavior.
 */
export function reduceApplicationState<TIndustry extends string>(
  current: ApplicationState<TIndustry>,
  action: ApplicationAction<TIndustry>,
  catalog: ApplicationCatalog,
  meta: ReducerMeta,
  notificationCounter: number,
  resetBaseline?: ApplicationState<TIndustry>,
): ApplicationReduction<TIndustry> {
  const coreState = toCoreState(current, catalog);
  const adapted = adaptApplicationAction(action, catalog, resetBaseline);
  const nextCore = reduceLeadForgeState(coreState, adapted.action, meta, notificationCounter);

  const allocatesNotificationId =
    action.type === "SUBMIT_REPLY" ||
    action.type === "CAMPAIGN_SIM_NEXT" ||
    action.type === "INBOX_APPROVE";
  const addedHistoryEntry =
    nextCore.notifHistory !== coreState.notifHistory &&
    nextCore.notifHistory[0] !== coreState.notifHistory[0];
  const nextNotificationCounter =
    allocatesNotificationId && addedHistoryEntry
      ? notificationCounter + 2
      : notificationCounter;

  return {
    state: toApplicationState<TIndustry>(nextCore),
    boundary: adapted.boundary,
    notificationCounter: nextNotificationCounter,
  };
}
