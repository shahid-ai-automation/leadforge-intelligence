import { describe, expect, it } from "vitest";
import { DEFAULT_ICP, DEFAULT_WORKFLOW, type Campaign, type Prospect } from "../model";
import { analyzeBuyerIntent } from "../engine";
import { identityHashes } from "../suppression";
import { referenceTransition, type RefState } from "./reducer-harness";

const person = (id = "p-001", overrides: Partial<Prospect> = {}): Prospect => ({
  id, name: "Alex Morgan", title: "Founder", roleCategory: "decision_maker",
  company: "Northstar Systems", industry: "B2B SaaS", country: "United States",
  city: "Austin", employees: 45, need: "confirmed", needNote: "Synthetic test signal",
  signals: ["Synthetic signal"], channel: "Email", stage: "outreach",
  replyStatus: "none", lastActivity: "Synthetic baseline", ...overrides,
});

const campaign = (prospectIds: string[], overrides: Partial<Campaign> = {}) => ({
  id: "cmp-test", name: "Synthetic campaign", objective: "service", status: "running",
  brief: null, prospectIds, templates: [], sequence: [], config: {}, createdAt: "fixed",
  events: [], simCursor: 0, prospectsContacted: 0, repliesDetected: 0, ...overrides,
} as unknown as Campaign);

const state = (overrides: Partial<RefState> = {}): RefState => {
  const p = person();
  return {
    prospects: [p], icp: DEFAULT_ICP, demoIndustry: "B2B SaaS", industryIcps: { "B2B SaaS": DEFAULT_ICP, "Healthcare": { ...DEFAULT_ICP, industries: ["Healthcare"] } }, workflow: DEFAULT_WORKFLOW, customProspects: [],
    runtime: { [p.id]: { stage: p.stage, replyStatus: p.replyStatus, intentScore: null, intentResult: null, optedOut: false, lastActivity: p.lastActivity } },
    campaigns: [], inbox: [], conversations: [], drafts: {}, suppressions: {},
    activity: [], notifications: [], notifHistory: [], selectedProspectId: null,
    hiddenProspectIds: [], prospectEdits: {}, simCursor: 0, simRunning: false,
    ...overrides,
  };
};
const meta = { seed: "parity-seed-", at: "12:34" };

describe("fixture-free reducer reference parity harness", () => {
  it("covers selection and workflow-step configuration transitions", () => {
    const s = state();
    expect(referenceTransition(s, { type: "SELECT_PROSPECT", id: "p-001" }, meta).selectedProspectId).toBe("p-001");
    const changed = referenceTransition(s, { type: "UPDATE_STEP", stepId: "w4", patch: { message: "Human review required", delayDays: 2 } }, meta);
    expect(changed.workflow.find(w => w.id === "w4")).toMatchObject({ message: "Human review required", delayDays: 2 });
    expect(changed.activity[0]?.text).toBe("Outreach workflow configuration updated");
  });

  it("covers ICP and demo-industry configuration actions", () => {
    const s = state();
    const nextIcp = { ...DEFAULT_ICP, sizeMin: 25 };
    expect(referenceTransition(s, { type: "SET_ICP", icp: nextIcp }, meta).icp.sizeMin).toBe(25);
    const switched = referenceTransition(s, { type: "SET_DEMO_INDUSTRY", industry: "Healthcare" }, meta);
    expect(switched.demoIndustry).toBe("Healthcare");
    expect(switched.icp.industries).toEqual(["Healthcare"]);
    expect(referenceTransition(s, { type: "SET_DEMO_INDUSTRY", industry: "Unknown" }, meta)).toBe(s);
  });

  it("adds only new prospects, rejects identity duplicates and suppresses DNC identities", () => {
    const s = state();
    const newcomer = person("p-002", { name: "Jamie Reed", email: undefined } as any);
    const duplicate = person("p-003", { name: "Alex Morgan" });
    const added = referenceTransition(s, { type: "ADD_PROSPECTS", prospects: [newcomer, duplicate, newcomer] }, meta);
    expect(added.customProspects.map(p => p.id)).toEqual(["p-002"]);
    expect(added.runtime["p-002"]?.stage).toBe("outreach");
    const blocked = state({ suppressions: Object.fromEntries(identityHashes(newcomer).map(h => [h, "old-id"])) });
    expect(referenceTransition(blocked, { type: "ADD_PROSPECTS", prospects: [newcomer] }, meta)).toBe(blocked);
    const optedOut = person("p-004", { name: "Taylor Quinn", company: "Harbor Analytics", replyStatus: "opted_out" });
    const addedOptOut = referenceTransition(s, { type: "ADD_PROSPECTS", prospects: [optedOut] }, meta);
    expect(addedOptOut.runtime["p-004"]?.optedOut).toBe(true);
    expect(Object.values(addedOptOut.suppressions)).toContain("p-004");
  });

  it("deletes drafts without mutating the prior state", () => {
    const s = state({ drafts: { "p-001": { prospectId: "p-001", category: "intro", body: "draft", approved: false, status: "draft", version: 1 } } });
    const next = referenceTransition(s, { type: "DELETE_DRAFT", prospectId: "p-001" }, meta);
    expect(next.drafts["p-001"]).toBeUndefined();
    expect(s.drafts["p-001"]).toBeDefined();
  });

  it("records incoming replies, classifies intent, and appends conversation messages", () => {
    const s = state();
    const text = "We are actively looking for help. Can we schedule a demo next week?";
    const next = referenceTransition(s, { type: "SUBMIT_REPLY", prospectId: "p-001", text }, meta);
    expect(next.runtime["p-001"]?.intentResult).toEqual(analyzeBuyerIntent(text));
    expect(next.conversations).toHaveLength(1);
    expect(next.conversations[0]?.messages.at(-1)).toMatchObject({ from: "prospect", text, at: "12:34" });
    expect(next.activity[0]?.id).toBe("a-parity-seed-0");
  });

  it("makes opt-out sticky and stores identity fingerprints", () => {
    const s = state();
    const next = referenceTransition(s, { type: "SUBMIT_REPLY", prospectId: "p-001", text: "Please remove me and do not contact me again." }, meta);
    expect(next.runtime["p-001"]?.optedOut).toBe(true);
    expect(next.runtime["p-001"]?.replyStatus).toBe("opted_out");
    for (const hash of identityHashes(s.prospects[0]!)) expect(next.suppressions[hash]).toBe("p-001");
    const later = referenceTransition(next, { type: "SUBMIT_REPLY", prospectId: "p-001", text: "Actually, tell me more." }, meta);
    expect(later.runtime["p-001"]?.optedOut).toBe(true);
    expect(later.runtime["p-001"]?.replyStatus).toBe("opted_out");
  });

  it("simulates connection acceptance with deterministic event metadata", () => {
    const p = person();
    const s = state({ campaigns: [campaign([p.id], { simCursor: 3 })] });
    const a = { type: "CAMPAIGN_SIM_NEXT" as const, id: "cmp-test" };
    const left = referenceTransition(s, a, meta);
    const right = referenceTransition(s, a, meta);
    expect(left).toEqual(right);
    expect(left.campaigns[0]?.simCursor).toBe(4);
    expect(left.runtime[p.id]?.stage).toBe("engaged");
    expect(left.campaigns[0]?.events[0]).toMatchObject({ id: "ev-parity-seed-0", at: "12:34" });
  });

  it("creates an inbox item and intent update at the scripted reply transition", () => {
    const p = person();
    const s = state({ campaigns: [campaign([p.id], { simCursor: 5 })] });
    const next = referenceTransition(s, { type: "CAMPAIGN_SIM_NEXT", id: "cmp-test" }, meta);
    expect(next.campaigns[0]?.simCursor).toBe(6);
    expect(next.campaigns[0]?.repliesDetected).toBe(1);
    expect(next.inbox[0]).toMatchObject({ prospectId: p.id, campaignId: "cmp-test", status: "awaiting" });
    expect(next.runtime[p.id]?.replyStatus).toBe("positive");
    expect(next.notifications.at(-1)?.title).toBe("New Interested Prospect");
  });

  it("blocks campaign simulation for stopped campaigns and fully suppressed audiences", () => {
    const p = person();
    const stopped = state({ campaigns: [campaign([p.id], { status: "paused" })] });
    expect(referenceTransition(stopped, { type: "CAMPAIGN_SIM_NEXT", id: "cmp-test" }, meta)).toBe(stopped);
    const blocked = state({
      campaigns: [campaign([p.id])],
      runtime: { [p.id]: { stage: p.stage, replyStatus: "opted_out", intentScore: null, intentResult: null, optedOut: true, lastActivity: "opted out" } },
    });
    expect(referenceTransition(blocked, { type: "CAMPAIGN_SIM_NEXT", id: "cmp-test" }, meta)).toBe(blocked);
  });

  it("covers every scripted campaign simulation cursor and the terminal boundary", () => {
    const p = person();
    for (let cursor = 0; cursor < 9; cursor++) {
      const s = state({ campaigns: [campaign([p.id], { simCursor: cursor })] });
      const next = referenceTransition(s, { type: "CAMPAIGN_SIM_NEXT", id: "cmp-test" }, meta);
      expect(next.campaigns[0]?.simCursor).toBe(cursor + 1);
      expect(next.campaigns[0]?.events.at(-1)?.id).toBe(`ev-parity-seed-0`);
      expect(next.campaigns[0]?.events.at(-1)?.at).toBe("12:34");
    }
    const terminal = state({ campaigns: [campaign([p.id], { simCursor: 9 })] });
    expect(referenceTransition(terminal, { type: "CAMPAIGN_SIM_NEXT", id: "cmp-test" }, meta)).toBe(terminal);
  });

  it("guards manual stage movement after opt-out and allows valid movement", () => {
    const s = state();
    const moved = referenceTransition(s, { type: "MOVE_STAGE", prospectId: "p-001", stage: "engaged" }, meta);
    expect(moved.runtime["p-001"]?.stage).toBe("engaged");
    const opted = state({ runtime: { "p-001": { ...s.runtime["p-001"]!, optedOut: true, replyStatus: "opted_out" } } });
    expect(referenceTransition(opted, { type: "MOVE_STAGE", prospectId: "p-001", stage: "qualified" }, meta)).toBe(opted);
  });

  it("covers workflow simulation start, pause, restart, tick and terminal behavior", () => {
    const s = state();
    const started = referenceTransition(s, { type: "SIM_START" }, meta);
    expect(started.simRunning).toBe(true);
    const ticked = referenceTransition(started, { type: "SIM_TICK" }, meta);
    expect(ticked.simCursor).toBe(1);
    expect(ticked.workflow[0]?.status).toBe("active");
    const paused = referenceTransition(ticked, { type: "SIM_PAUSE" }, meta);
    expect(referenceTransition(paused, { type: "SIM_TICK" }, meta).simCursor).toBe(1);
    const restarted = referenceTransition(paused, { type: "SIM_RESTART" }, meta);
    expect(restarted.simCursor).toBe(0);
    expect(restarted.workflow.every(w => w.status === "pending")).toBe(true);
    const terminal = referenceTransition({ ...started, simCursor: started.workflow.length }, { type: "SIM_TICK" }, meta);
    expect(terminal.simRunning).toBe(false);
  });

  it("keeps notification queue and history caps", () => {
    const s = state({ notifications: [1,2,3].map(id => ({ id, title: "old", body: "", tone: "info" as const })), notifHistory: Array.from({length:50},(_,i)=>({id:i,title:"old",body:"",tone:"info" as const})) });
    const next = referenceTransition(s, { type: "NOTIFY", n: { id: 99, title: "new", body: "", tone: "success" } }, meta);
    expect(next.notifications).toHaveLength(3);
    expect(next.notifications.at(-1)?.title).toBe("new");
    expect(next.notifHistory).toHaveLength(50);
    expect(next.notifHistory[0]?.title).toBe("new");
    expect(referenceTransition(next, { type: "DISMISS_NOTIFICATION", id: 99 }, meta).notifications.some(n=>n.id===99)).toBe(false);
  });

  it("covers campaign create/update, status and restart transitions", () => {
    const c = campaign(["p-001"]);
    const s = state();
    const created = referenceTransition(s, { type: "SAVE_CAMPAIGN", campaign: c }, meta);
    expect(created.campaigns).toHaveLength(1);
    const updated = referenceTransition(created, { type: "SAVE_CAMPAIGN", campaign: { ...c, name: "Renamed" } }, meta);
    expect(updated.campaigns).toHaveLength(1);
    expect(updated.campaigns[0]?.name).toBe("Renamed");
    const running = referenceTransition(updated, { type: "CAMPAIGN_SET_STATUS", id: c.id, status: "running" }, meta);
    expect(running.campaigns[0]?.status).toBe("running");
    const progressed = { ...running, campaigns: [{ ...running.campaigns[0]!, simCursor: 5, prospectsContacted: 3, repliesDetected: 1, events: [{id:"ev",at:"x",text:"event"}] }] };
    const reset = referenceTransition(progressed, { type: "CAMPAIGN_RESTART", id: c.id }, meta);
    expect(reset.campaigns[0]).toMatchObject({ status: "approved", simCursor: 0, prospectsContacted: 0, repliesDetected: 0, events: [] });
    expect(referenceTransition(reset, { type: "DELETE_CAMPAIGN", id: c.id }, meta).campaigns).toHaveLength(0);
  });

  it("covers prospect edit normalization, delete and hidden sample behavior", () => {
    const s = state({ campaigns: [campaign(["p-001"])] , selectedProspectId: "p-001" });
    const edited = referenceTransition(s, { type: "UPDATE_PROSPECT", id: "p-001", patch: { name: "  Alex Updated  ", company: "  " } }, meta);
    expect(edited.prospectEdits["p-001"]?.name).toBe("Alex Updated");
    expect(edited.prospectEdits["p-001"]?.company).toBeUndefined();
    const deleted = referenceTransition(edited, { type: "DELETE_PROSPECT", id: "p-001" }, meta);
    expect(deleted.hiddenProspectIds).toContain("p-001");
    expect(deleted.selectedProspectId).toBeNull();
    expect(deleted.campaigns[0]?.prospectIds).toEqual([]);
  });

  it("suppresses edited identities after an opted-out prospect is updated", () => {
    const p = person("p-001", { replyStatus: "opted_out" });
    const s = state({
      prospects: [p],
      runtime: { [p.id]: { stage: p.stage, replyStatus: "opted_out", intentScore: null, intentResult: null, optedOut: true, lastActivity: "opted out" } },
    });
    const changed = referenceTransition(s, { type: "UPDATE_PROSPECT", id: p.id, patch: { name: "Alex Newname", company: "New Company" } }, meta);
    const edited = { ...p, name: "Alex Newname", company: "New Company" };
    for (const hash of identityHashes(edited)) expect(changed.suppressions[hash]).toBe(p.id);
  });

  it("deletes imported prospects completely while preserving unrelated records", () => {
    const imported = person("p-import", { name: "Morgan Lee", company: "Imported Co" });
    const base = state({ customProspects: [imported], runtime: {
      "p-001": state().runtime["p-001"]!,
      "p-import": { stage: imported.stage, replyStatus: imported.replyStatus, intentScore: null, intentResult: null, optedOut: false, lastActivity: imported.lastActivity },
    }, selectedProspectId: imported.id });
    const next = referenceTransition(base, { type: "DELETE_PROSPECT", id: imported.id }, meta);
    expect(next.customProspects).toHaveLength(0);
    expect(next.runtime[imported.id]).toBeUndefined();
    expect(next.prospectEdits[imported.id]).toBeUndefined();
    expect(next.selectedProspectId).toBeNull();
    expect(next.hiddenProspectIds).not.toContain(imported.id);
  });

  it("supports hydrate as exact replacement", () => {
    const s = state();
    const hydrated = state({ selectedProspectId: "p-001" });
    expect(referenceTransition(s, { type: "HYDRATE", state: hydrated }, meta)).toBe(hydrated);
  });

  it("approves an awaiting inbox reply, records simulated conversation and notification", () => {
    const p = person();
    const item = { id: "in-1", prospectId: p.id, campaignId: "cmp-test", incomingText: "Interested", at: "11:00",
      intentScore: 80, intentLabel: "High Intent", intentClass: "high", recommendedAction: "Book a meeting",
      suggestedReply: "Original suggestion", category: "high", status: "awaiting" } as const;
    const s = state({ inbox: [item as any] });
    const next = referenceTransition(s, { type: "INBOX_APPROVE", id: item.id, reply: "Edited approved reply" }, meta);
    expect(next.inbox[0]).toMatchObject({ status: "approved", suggestedReply: "Edited approved reply" });
    expect(next.conversations[0]?.messages[0]).toMatchObject({ from: "you", text: "Edited approved reply", at: "12:34" });
    expect(next.notifications.at(-1)?.title).toBe("Response Approved");
    expect(next.runtime[p.id]?.stage).toBe("qualified");
  });

  it("enforces reminder, reject, dismiss and DNC approval guards", () => {
    const p = person();
    const item = { id: "in-2", prospectId: p.id, campaignId: null, incomingText: "Maybe", at: "11:00",
      intentScore: 20, intentLabel: "Low", intentClass: "negative", recommendedAction: "Follow up later",
      suggestedReply: "Thanks", category: "none", status: "awaiting" } as const;
    const s = state({ inbox: [item as any] });
    const reminder = referenceTransition(s, { type: "INBOX_REMINDER", id: item.id, days: 30 }, meta);
    expect(reminder.inbox[0]).toMatchObject({ status: "reminder", reminderDays: 30 });
    const rejected = referenceTransition(s, { type: "INBOX_REJECT", id: item.id }, meta);
    expect(rejected.inbox[0]?.status).toBe("rejected");
    const dismissed = referenceTransition(s, { type: "INBOX_DISMISS", id: item.id }, meta);
    expect(dismissed.inbox[0]?.status).toBe("dismissed");
    const optedOut = state({
      inbox: [item as any],
      runtime: { [p.id]: { stage: p.stage, replyStatus: "opted_out", intentScore: null, intentResult: null, optedOut: true, lastActivity: "opted out" } },
    });
    expect(referenceTransition(optedOut, { type: "INBOX_APPROVE", id: item.id, reply: "Must not send" }, meta)).toBe(optedOut);
    expect(referenceTransition(optedOut, { type: "INBOX_REMINDER", id: item.id, days: 7 }, meta)).toBe(optedOut);
  });

  it("preserves permanent DNC identities across reset", () => {
    const p = person();
    const hashes = Object.fromEntries(identityHashes(p).map(h => [h, p.id]));
    const current = state({ suppressions: hashes, selectedProspectId: p.id });
    const baseline = state({ selectedProspectId: null, suppressions: {} });
    const next = referenceTransition(current, { type: "RESET", baseline }, meta);
    expect(next.selectedProspectId).toBeNull();
    expect(next.suppressions).toEqual(hashes);
  });

  it("preserves draft approval state machine and blocks approvals after opt-out", () => {
    const p = person();
    const s = state();
    const draft = { prospectId: p.id, category: "intro", body: "Draft", approved: false, status: "draft" as const, version: 1 };
    const saved = referenceTransition(s, { type: "SAVE_DRAFT", draft }, meta);
    const approved = referenceTransition(saved, { type: "REVIEW_DRAFT", prospectId: p.id, status: "approved" }, meta);
    expect(approved.drafts[p.id]).toMatchObject({ approved: true, status: "approved", version: 2 });
    expect(() => referenceTransition(approved, { type: "SAVE_DRAFT", draft }, meta)).toThrow(/read-only/);
    const optedOut = state({
      runtime: { [p.id]: { stage: p.stage, replyStatus: "opted_out", intentScore: null, intentResult: null, optedOut: true, lastActivity: "opted out" } },
      drafts: { [p.id]: draft },
    });
    expect(referenceTransition(optedOut, { type: "REVIEW_DRAFT", prospectId: p.id, status: "approved" }, meta)).toBe(optedOut);
  });

  it("produces byte-for-byte stable ids and timestamps for identical action metadata", () => {
    const s = state();
    const action = { type: "SUBMIT_REPLY" as const, prospectId: "p-001", text: "Please remove me from your list." };
    const a = referenceTransition(s, action, meta);
    const b = referenceTransition(s, action, meta);
    expect(a.activity[0]?.id).toBe("a-parity-seed-0");
    expect(a.activity[0]?.at).toBe("12:34");
    expect(a).toEqual(b);
  });
});
