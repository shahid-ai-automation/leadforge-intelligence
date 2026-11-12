import { describe, expect, it } from "vitest";
import { DEFAULT_ICP, DEFAULT_WORKFLOW, type Prospect } from "./model";
import {
  reduceApplicationState,
  toApplicationState,
  toCoreState,
  type ApplicationCatalog,
  type ApplicationState,
} from "./application-adapter";

const prospect: Prospect = {
  id: "synthetic-001", name: "Alex Morgan", title: "Founder",
  roleCategory: "decision_maker", company: "Northstar Systems",
  industry: "B2B SaaS", country: "United States", city: "Austin",
  employees: 45, need: "confirmed", needNote: "Synthetic test only",
  signals: ["Synthetic"], channel: "Email", stage: "outreach",
  replyStatus: "none", lastActivity: "Synthetic baseline",
};
const catalog: ApplicationCatalog = {
  prospects: [prospect],
  industryIcps: { "B2B SaaS": DEFAULT_ICP, Healthcare: { ...DEFAULT_ICP, industries: ["Healthcare"] } },
};
const appState = (overrides: Partial<ApplicationState<"B2B SaaS" | "Healthcare">> = {}): ApplicationState<"B2B SaaS" | "Healthcare"> => ({
  icp: DEFAULT_ICP,
  demoIndustry: "B2B SaaS",
  workflow: DEFAULT_WORKFLOW,
  customProspects: [],
  runtime: {
    [prospect.id]: {
      stage: prospect.stage, replyStatus: prospect.replyStatus,
      intentScore: null, intentResult: null, optedOut: false,
      lastActivity: prospect.lastActivity,
    },
  },
  campaigns: [], inbox: [], conversations: [], drafts: {}, suppressions: {},
  activity: [], notifications: [], notifHistory: [], selectedProspectId: null,
  hiddenProspectIds: [], prospectEdits: {}, simCursor: 0, simRunning: false,
  ...overrides,
});
const meta = { seed: "adapter-", at: "12:00" };

describe("application boundary adapter", () => {
  it("round-trips mutable app state without leaking injected catalogues", () => {
    const input = appState({ selectedProspectId: prospect.id, customProspects: [{ ...prospect, id: "custom-1" }] });
    const core = toCoreState(input, catalog);
    const output = toApplicationState(core);
    expect(output).toEqual(input);
    expect("prospects" in output).toBe(false);
    expect("industryIcps" in output).toBe(false);
  });

  it("requires an app-generated seedState baseline for RESET and preserves DNC", () => {
    const input = appState({ suppressions: { "sha256:synthetic": prospect.id }, customProspects: [{ ...prospect, id: "custom-1" }] });
    expect(() => reduceApplicationState(input, { type: "RESET" }, catalog, meta, 100)).toThrow(/ADAPTER_RESET_BASELINE_REQUIRED/);
    const baseline = appState({ activity: [], customProspects: [] });
    const result = reduceApplicationState(input, { type: "RESET" }, catalog, meta, 100, baseline);
    expect(result.state.customProspects).toEqual([]);
    expect(result.state.suppressions).toEqual({ "sha256:synthetic": prospect.id });
  });

  it("keeps HYDRATE as exact replacement rather than merging stale state", () => {
    const current = appState({ selectedProspectId: prospect.id, customProspects: [{ ...prospect, id: "stale" }] });
    const hydrated = appState({ selectedProspectId: null, customProspects: [{ ...prospect, id: "fresh" }] });
    const result = reduceApplicationState(current, { type: "HYDRATE", state: hydrated }, catalog, meta, 100);
    expect(result.state).toEqual(hydrated);
    expect(result.state.customProspects.map(p => p.id)).toEqual(["fresh"]);
  });

  it("preserves expectedVersion and authorization metadata for the outer server guard", () => {
    const input = appState();
    const save = reduceApplicationState(input, {
      type: "SAVE_DRAFT",
      draft: { prospectId: prospect.id, category: "intro", body: "Synthetic", approved: false },
      expectedVersion: 7,
    }, catalog, meta, 100);
    expect(save.boundary).toEqual({ expectedVersion: 7 });

    const move = reduceApplicationState(input, {
      type: "MOVE_STAGE", prospectId: prospect.id, stage: "engaged", authorized: false,
    }, catalog, meta, 100);
    expect(move.boundary).toEqual({ authorized: false });
  });

  it("rejects unknown industries before calling the core reducer", () => {
    expect(() => reduceApplicationState(appState(), {
      type: "SET_DEMO_INDUSTRY", industry: "Unlisted" as "B2B SaaS",
    }, catalog, meta, 100)).toThrow(/ADAPTER_UNKNOWN_INDUSTRY/);
  });

  it("keeps notification ids continuous using a caller-owned counter", () => {
    const input = appState();
    const result = reduceApplicationState(input, {
      type: "SUBMIT_REPLY", prospectId: prospect.id,
      text: "Please remove me and do not contact me again.",
    }, catalog, meta, 100);
    expect(result.state.notifications.at(-1)?.id).toBe(101);
    expect(result.state.notifHistory[0]?.id).toBe(102);
    expect(result.notificationCounter).toBe(102);
  });
});
