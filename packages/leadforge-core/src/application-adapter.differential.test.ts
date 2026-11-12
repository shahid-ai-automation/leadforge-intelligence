import { describe, expect, it } from "vitest";
import { DEFAULT_ICP, DEFAULT_WORKFLOW, type Campaign, type InboxItem, type Prospect } from "./model";
import { identityHashes } from "./suppression";
import {
  adaptApplicationAction,
  reduceApplicationState,
  toCoreState,
  type ApplicationCatalog,
  type ApplicationState,
} from "./application-adapter";
import { pinnedReducerOracle } from "./reference/pinned-reducer.oracle";
import type { RefAction, RefState } from "./reference/reducer-harness";

type Industry = "B2B SaaS" | "Healthcare";
const prospect: Prospect = {
  id: "adapter-p-1", name: "Alex Morgan", title: "Founder", roleCategory: "decision_maker",
  company: "Northstar Systems", industry: "B2B SaaS", country: "United States",
  city: "Austin", employees: 45, need: "confirmed", needNote: "Synthetic",
  signals: ["Synthetic"], channel: "Email", stage: "outreach", replyStatus: "none",
  lastActivity: "Synthetic baseline",
};
const campaign: Campaign = {
  id: "adapter-c-1", name: "Synthetic campaign", objective: "service", status: "running",
  brief: null, prospectIds: [prospect.id], templates: [], sequence: [], config: {},
  createdAt: "fixed", events: [], simCursor: 5, prospectsContacted: 3, repliesDetected: 0,
  config: {} as Campaign["config"],
};
const inbox: InboxItem = {
  id: "adapter-i-1", prospectId: prospect.id, campaignId: campaign.id,
  incomingText: "Interested", at: "11:00", intentScore: 80, intentLabel: "High Intent",
  intentClass: "high", recommendedAction: "Book a meeting", suggestedReply: "Suggested",
  category: "high", status: "awaiting",
};
const catalog: ApplicationCatalog = {
  prospects: [prospect],
  industryIcps: {
    "B2B SaaS": DEFAULT_ICP,
    Healthcare: { ...DEFAULT_ICP, industries: ["Healthcare"] },
  },
};
const base = (overrides: Partial<ApplicationState<Industry>> = {}): ApplicationState<Industry> => ({
  icp: DEFAULT_ICP, demoIndustry: "B2B SaaS", workflow: DEFAULT_WORKFLOW,
  customProspects: [], runtime: {
    [prospect.id]: {
      stage: prospect.stage, replyStatus: prospect.replyStatus, intentScore: null,
      intentResult: null, optedOut: false, lastActivity: prospect.lastActivity,
    },
  },
  campaigns: [], inbox: [], conversations: [], drafts: {}, suppressions: {},
  activity: [], notifications: [], notifHistory: [], selectedProspectId: null,
  hiddenProspectIds: [], prospectEdits: {}, simCursor: 0, simRunning: false,
  ...overrides,
});
const meta = { seed: "app-adapter-", at: "12:30" };

function compare(input: ApplicationState<Industry>, action: Parameters<typeof reduceApplicationState<Industry>>[1], counter = 100, resetBaseline?: ApplicationState<Industry>) {
  const coreInput = toCoreState(input, catalog);
  const adapted = adaptApplicationAction(action, catalog, resetBaseline);
  const expected = pinnedReducerOracle(coreInput as RefState, adapted.action as RefAction, meta, counter);
  const actual = reduceApplicationState(input, action, catalog, meta, counter, resetBaseline);
  expect(toCoreState(actual.state, catalog)).toEqual(expected);
  return actual;
}

describe("application adapter differential parity against pinned reducer oracle", () => {
  it("maps every simple state transition without changing the app contract", () => {
    compare(base(), { type: "SET_ICP", icp: { ...DEFAULT_ICP, sizeMin: 30 } });
    compare(base(), { type: "SET_DEMO_INDUSTRY", industry: "Healthcare" });
    compare(base(), { type: "SELECT_PROSPECT", id: prospect.id });
    compare(base(), { type: "MOVE_STAGE", prospectId: prospect.id, stage: "engaged", authorized: true });
    compare(base(), { type: "UPDATE_STEP", stepId: "w4", patch: { delayDays: 3 } });
    compare(base(), { type: "SIM_START" });
    compare(base({ simRunning: true }), { type: "SIM_TICK" });
  });

  it("matches reply, intent and opt-out transitions including notification ids", () => {
    const result = compare(base(), {
      type: "SUBMIT_REPLY", prospectId: prospect.id,
      text: "Please remove me and do not contact me again.",
    });
    expect(result.notificationCounter).toBe(102);
    expect(result.state.suppressions).toEqual(Object.fromEntries(identityHashes(prospect).map(hash => [hash, prospect.id])));
  });

  it("matches campaign simulation and inbox review transitions", () => {
    compare(base({ campaigns: [campaign] }), { type: "CAMPAIGN_SIM_NEXT", id: campaign.id });
    compare(base({ inbox: [inbox] }), { type: "INBOX_APPROVE", id: inbox.id, reply: "Synthetic approved reply" });
    compare(base({ inbox: [inbox] }), { type: "INBOX_REMINDER", id: inbox.id, days: 5 });
    compare(base({ inbox: [inbox] }), { type: "INBOX_REJECT", id: inbox.id });
    compare(base({ inbox: [inbox] }), { type: "INBOX_DISMISS", id: inbox.id });
  });

  it("matches draft version transitions while preserving version metadata outside core", () => {
    const draft = { prospectId: prospect.id, category: "intro", body: "Draft", approved: false, status: "draft" as const, version: 2 };
    const input = base({ drafts: { [prospect.id]: draft } });
    const save = compare(input, { type: "SAVE_DRAFT", draft: { ...draft, body: "Updated" }, expectedVersion: 2 });
    expect(save.boundary.expectedVersion).toBe(2);
    const review = compare(input, { type: "REVIEW_DRAFT", prospectId: prospect.id, status: "approved", expectedVersion: 2 });
    expect(review.boundary.expectedVersion).toBe(2);
  });

  it("matches reset and hydration boundaries while keeping seed catalogues injected", () => {
    const input = base({ suppressions: { "sha256:old": prospect.id }, customProspects: [{ ...prospect, id: "imported" }] });
    const baseline = base({ activity: [], customProspects: [] });
    const reset = compare(input, { type: "RESET" }, 100, baseline);
    expect(reset.state.customProspects).toEqual([]);
    expect(reset.state.suppressions["sha256:old"]).toBe(prospect.id);
    const hydrated = base({ customProspects: [{ ...prospect, id: "hydrated" }] });
    compare(input, { type: "HYDRATE", state: hydrated });
  });

  it("matches campaign CRUD, notification and prospect lifecycle actions", () => {
    compare(base(), { type: "SAVE_CAMPAIGN", campaign });
    compare(base({ campaigns: [campaign] }), { type: "CAMPAIGN_SET_STATUS", id: campaign.id, status: "paused" });
    compare(base({ campaigns: [campaign] }), { type: "CAMPAIGN_RESTART", id: campaign.id });
    compare(base({ campaigns: [campaign] }), { type: "DELETE_CAMPAIGN", id: campaign.id });
    compare(base(), { type: "NOTIFY", n: { id: 999, title: "Synthetic", body: "", tone: "info" } });
    compare(base({ drafts: { [prospect.id]: { prospectId: prospect.id, category: "intro", body: "Draft", approved: false } } }), { type: "DELETE_DRAFT", prospectId: prospect.id });
    compare(base(), { type: "DELETE_PROSPECT", id: prospect.id });
    compare(base(), { type: "ADD_PROSPECTS", prospects: [{ ...prospect, id: "new-prospect", name: "Jamie Reed", company: "Harbor Analytics" }] });
  });
});
