import { describe, expect, it } from "vitest";
import { DEFAULT_ICP, DEFAULT_WORKFLOW, type Campaign, type InboxItem, type Prospect } from "../model";
import { identityHashes } from "../suppression";
import { referenceTransition, type RefAction, type RefState } from "./reducer-harness";
import { reduceLeadForgeState } from "../reducer";
import { pinnedReducerOracle } from "./pinned-reducer.oracle";

const person = (id = "p-001", overrides: Partial<Prospect> = {}): Prospect => ({
  id, name: "Alex Morgan", title: "Founder", roleCategory: "decision_maker",
  company: "Northstar Systems", industry: "B2B SaaS", country: "United States",
  city: "Austin", employees: 45, need: "confirmed", needNote: "Synthetic",
  signals: ["Synthetic"], channel: "Email", stage: "outreach", replyStatus: "none",
  lastActivity: "Synthetic baseline", ...overrides,
});
const campaign = (prospectIds: string[], overrides: Partial<Campaign> = {}) => ({
  id: "cmp-test", name: "Synthetic campaign", objective: "service", status: "running",
  brief: null, prospectIds, templates: [], sequence: [], config: {}, createdAt: "fixed",
  events: [], simCursor: 0, prospectsContacted: 0, repliesDetected: 0, ...overrides,
} as unknown as Campaign);
const inboxItem = (p: Prospect, overrides: Partial<InboxItem> = {}) => ({
  id: "in-test", prospectId: p.id, campaignId: "cmp-test", incomingText: "Interested",
  at: "11:00", intentScore: 80, intentLabel: "High Intent", intentClass: "high",
  recommendedAction: "Book a meeting", suggestedReply: "Suggested", category: "high",
  status: "awaiting", ...overrides,
} as InboxItem);
const state = (overrides: Partial<RefState> = {}): RefState => {
  const p = person();
  return {
    prospects: [p], icp: DEFAULT_ICP, demoIndustry: "B2B SaaS",
    industryIcps: { "B2B SaaS": DEFAULT_ICP, Healthcare: { ...DEFAULT_ICP, industries: ["Healthcare"] } },
    workflow: DEFAULT_WORKFLOW, customProspects: [],
    runtime: { [p.id]: { stage: p.stage, replyStatus: p.replyStatus, intentScore: null, intentResult: null, optedOut: false, lastActivity: p.lastActivity } },
    campaigns: [], inbox: [], conversations: [], drafts: {}, suppressions: {},
    activity: [], notifications: [], notifHistory: [], selectedProspectId: null,
    hiddenProspectIds: [], prospectEdits: {}, simCursor: 0, simRunning: false, ...overrides,
  };
};
const meta = { seed: "diff-", at: "12:34" };
const p = person();
const newcomer = person("p-002", { name: "Jamie Reed", company: "Harbor Analytics" });
const draft = { prospectId: p.id, category: "intro", body: "Synthetic draft", approved: false, status: "draft" as const, version: 1 };
const item = inboxItem(p);
const base = state();

const cases: Array<{ name: string; state: RefState; action: RefAction }> = [
  { name: "HYDRATE exact replacement", state: base, action: { type: "HYDRATE", state: state({ selectedProspectId: "p-001" }) } },
  { name: "RESET preserves accumulated DNC", state: state({ suppressions: Object.fromEntries(identityHashes(p).map(h => [h, p.id])) }), action: { type: "RESET", baseline: state() } },
  { name: "SET_ICP", state: base, action: { type: "SET_ICP", icp: { ...DEFAULT_ICP, sizeMin: 25 } } },
  { name: "SET_DEMO_INDUSTRY", state: base, action: { type: "SET_DEMO_INDUSTRY", industry: "Healthcare" } },
  { name: "SELECT_PROSPECT", state: base, action: { type: "SELECT_PROSPECT", id: p.id } },
  { name: "SUBMIT_REPLY high intent", state: base, action: { type: "SUBMIT_REPLY", prospectId: p.id, text: "We are actively evaluating this and can schedule a demo next week. I make the decision." } },
  { name: "SUBMIT_REPLY opt-out", state: base, action: { type: "SUBMIT_REPLY", prospectId: p.id, text: "Please remove me and do not contact me again." } },
  { name: "SUBMIT_REPLY sticky opt-out", state: state({ runtime: { [p.id]: { stage: p.stage, replyStatus: "opted_out", intentScore: null, intentResult: null, optedOut: true, lastActivity: "opted out" } }, suppressions: Object.fromEntries(identityHashes(p).map(h => [h, p.id])) }), action: { type: "SUBMIT_REPLY", prospectId: p.id, text: "Actually, tell me more." } },
  { name: "MOVE_STAGE", state: base, action: { type: "MOVE_STAGE", prospectId: p.id, stage: "engaged" } },
  { name: "UPDATE_STEP", state: base, action: { type: "UPDATE_STEP", stepId: "w4", patch: { message: "Synthetic change", delayDays: 2 } } },
  { name: "SIM_START", state: base, action: { type: "SIM_START" } },
  { name: "SIM_PAUSE", state: state({ simRunning: true }), action: { type: "SIM_PAUSE" } },
  { name: "SIM_RESTART", state: base, action: { type: "SIM_RESTART" } },
  { name: "SIM_TICK", state: state({ simRunning: true }), action: { type: "SIM_TICK" } },
  { name: "SAVE_DRAFT", state: base, action: { type: "SAVE_DRAFT", draft } },
  { name: "REVIEW_DRAFT approved", state: state({ drafts: { [p.id]: draft } }), action: { type: "REVIEW_DRAFT", prospectId: p.id, status: "approved" } },
  { name: "DELETE_DRAFT", state: state({ drafts: { [p.id]: draft } }), action: { type: "DELETE_DRAFT", prospectId: p.id } },
  { name: "NOTIFY caps", state: state({ notifications: [1,2,3].map(id => ({ id, title: "old", body: "", tone: "info" as const })), notifHistory: Array.from({ length: 50 }, (_,id) => ({ id, title: "old", body: "", tone: "info" as const })) }), action: { type: "NOTIFY", n: { id: 101, title: "new", body: "", tone: "success" } } },
  { name: "DISMISS_NOTIFICATION", state: state({ notifications: [{ id: 7, title: "x", body: "", tone: "info" }] }), action: { type: "DISMISS_NOTIFICATION", id: 7 } },
  { name: "ADD_PROSPECTS dedupe", state: base, action: { type: "ADD_PROSPECTS", prospects: [newcomer, person("p-003"), newcomer] } },
  { name: "SAVE_CAMPAIGN create", state: base, action: { type: "SAVE_CAMPAIGN", campaign: campaign([p.id]) } },
  { name: "SAVE_CAMPAIGN update", state: state({ campaigns: [campaign([p.id])] }), action: { type: "SAVE_CAMPAIGN", campaign: campaign([p.id], { name: "Updated campaign" }) } },
  { name: "DELETE_CAMPAIGN", state: state({ campaigns: [campaign([p.id])] }), action: { type: "DELETE_CAMPAIGN", id: "cmp-test" } },
  { name: "CAMPAIGN_RESTART", state: state({ campaigns: [campaign([p.id], { simCursor: 5, prospectsContacted: 3, repliesDetected: 1, events: [{ id: "ev", at: "x", text: "x" }] })] }), action: { type: "CAMPAIGN_RESTART", id: "cmp-test" } },
  { name: "CAMPAIGN_SET_STATUS", state: state({ campaigns: [campaign([p.id])] }), action: { type: "CAMPAIGN_SET_STATUS", id: "cmp-test", status: "paused" } },
  { name: "CAMPAIGN_SIM_NEXT connection", state: state({ campaigns: [campaign([p.id], { simCursor: 3 })] }), action: { type: "CAMPAIGN_SIM_NEXT", id: "cmp-test" } },
  { name: "CAMPAIGN_SIM_NEXT reply and inbox", state: state({ campaigns: [campaign([p.id], { simCursor: 5 })] }), action: { type: "CAMPAIGN_SIM_NEXT", id: "cmp-test" } },
  { name: "CAMPAIGN_SIM_NEXT approval event", state: state({ campaigns: [campaign([p.id], { simCursor: 8 })] }), action: { type: "CAMPAIGN_SIM_NEXT", id: "cmp-test" } },
  { name: "INBOX_APPROVE", state: state({ inbox: [item] }), action: { type: "INBOX_APPROVE", id: item.id, reply: "Approved synthetic reply" } },
  { name: "INBOX_REMINDER", state: state({ inbox: [item] }), action: { type: "INBOX_REMINDER", id: item.id, days: 7 } },
  { name: "INBOX_DISMISS", state: state({ inbox: [item] }), action: { type: "INBOX_DISMISS", id: item.id } },
  { name: "INBOX_REJECT", state: state({ inbox: [item] }), action: { type: "INBOX_REJECT", id: item.id } },
  { name: "UPDATE_PROSPECT", state: base, action: { type: "UPDATE_PROSPECT", id: p.id, patch: { name: "  Alex Updated  ", company: "  " } } },
  { name: "DELETE_PROSPECT seeded", state: base, action: { type: "DELETE_PROSPECT", id: p.id } },
  { name: "DELETE_PROSPECT imported", state: state({ customProspects: [newcomer], runtime: { ...base.runtime, [newcomer.id]: { stage: newcomer.stage, replyStatus: newcomer.replyStatus, intentScore: null, intentResult: null, optedOut: false, lastActivity: newcomer.lastActivity } } }), action: { type: "DELETE_PROSPECT", id: newcomer.id } },
];

describe("differential parity: pinned source reducer vs fixture-free harness", () => {
  it.each(cases)("$name", ({ state: input, action }) => {
    const oracle = pinnedReducerOracle(input, action, meta, 100);
    const harness = referenceTransition(input, action, meta, 100);
    const extracted = reduceLeadForgeState(input, action, meta, 100);
    expect(harness).toEqual(oracle);
    expect(extracted).toEqual(oracle);
  });

  it("compares opt-out after identity edits, including both original and edited fingerprints", () => {
    const opted = state({
      runtime: { [p.id]: { stage: p.stage, replyStatus: "opted_out", intentScore: null, intentResult: null, optedOut: true, lastActivity: "opted out" } },
      prospectEdits: { [p.id]: { name: "Alex Changed", company: "Changed Company" } },
    });
    const action: RefAction = { type: "SUBMIT_REPLY", prospectId: p.id, text: "Please remove me." };
    const oracle = pinnedReducerOracle(opted, action, meta);
    expect(referenceTransition(opted, action, meta)).toEqual(oracle);
    expect(reduceLeadForgeState(opted, action, meta)).toEqual(oracle);
  });

  it("matches no-op identity and malformed-record behavior", () => {
    const missing = { type: "SUBMIT_REPLY", prospectId: "missing", text: "hello" } as RefAction;
    expect(referenceTransition(base, missing, meta)).toEqual(pinnedReducerOracle(base, missing, meta));
    expect(reduceLeadForgeState(base, missing, meta)).toEqual(pinnedReducerOracle(base, missing, meta));
    const missingMove = { type: "MOVE_STAGE", prospectId: "missing", stage: "engaged" } as RefAction;
    expect(referenceTransition(base, missingMove, meta)).toEqual(pinnedReducerOracle(base, missingMove, meta));
    expect(reduceLeadForgeState(base, missingMove, meta)).toEqual(pinnedReducerOracle(base, missingMove, meta));
  });
  it.each(Array.from({ length: 9 }, (_, cursor) => cursor))("matches pinned campaign simulation at cursor %i", (cursor) => {
    const input = state({ campaigns: [campaign([p.id], { simCursor: cursor })] });
    const action: RefAction = { type: "CAMPAIGN_SIM_NEXT", id: "cmp-test" };
    const oracle = pinnedReducerOracle(input, action, meta);
    expect(referenceTransition(input, action, meta)).toEqual(oracle);
    expect(reduceLeadForgeState(input, action, meta)).toEqual(oracle);
  });

  it("matches DNC guards for inbox approval, reminders, drafts and campaign simulation", () => {
    const blockedState = state({
      campaigns: [campaign([p.id])],
      inbox: [item],
      drafts: { [p.id]: draft },
      runtime: { [p.id]: { stage: p.stage, replyStatus: "opted_out", intentScore: null, intentResult: null, optedOut: true, lastActivity: "opted out" } },
      suppressions: Object.fromEntries(identityHashes(p).map(hash => [hash, p.id])),
    });
    const actions: RefAction[] = [
      { type: "INBOX_APPROVE", id: item.id, reply: "Must not send" },
      { type: "INBOX_REMINDER", id: item.id, days: 7 },
      { type: "REVIEW_DRAFT", prospectId: p.id, status: "approved" },
      { type: "CAMPAIGN_SIM_NEXT", id: "cmp-test" },
      { type: "SAVE_DRAFT", draft: { ...draft, body: "Must not save" } },
    ];
    for (const action of actions) {
      const oracle = pinnedReducerOracle(blockedState, action, meta);
      expect(referenceTransition(blockedState, action, meta)).toEqual(oracle);
      expect(reduceLeadForgeState(blockedState, action, meta)).toEqual(oracle);
    }
  });

  it("matches re-import suppression after a prior opt-out", () => {
    const blockedState = state({
      runtime: { [p.id]: { stage: p.stage, replyStatus: "opted_out", intentScore: null, intentResult: null, optedOut: true, lastActivity: "opted out" } },
      suppressions: Object.fromEntries(identityHashes(p).map(hash => [hash, p.id])),
    });
    const reimport = person("p-reimport", { name: p.name, company: p.company });
    const action: RefAction = { type: "ADD_PROSPECTS", prospects: [reimport] };
    const oracle = pinnedReducerOracle(blockedState, action, meta);
    expect(referenceTransition(blockedState, action, meta)).toEqual(oracle);
    expect(reduceLeadForgeState(blockedState, action, meta)).toEqual(oracle);
  });

});
