/**
 * Fixture-free LeadForge state reducer.
 *
 * Behavioral oracle transcribed from the read-only Development Remix source:
 * src/components/outbound-intelligence/state.ts
 * pinned commit: d84685707d15a5f23321d35bdc3f9ddc7a950386
 *
 * This module contains only deterministic state transitions. Seed data, persistence,
 * browser APIs, providers, and network integrations are injected or remain outside.
 */
import type { ActivityEvent, Campaign, ChatMessage, Conversation, InboxItem, Prospect, PipelineStage, ReplyStatus, WorkflowStep, ICP, CampaignStatus } from "./model";
import { analyzeBuyerIntent, calculateFitScore, calculateLeadPriority, qualifiesForHandoff, simulationScript, suggestedReplyFor, matchesAnyIdentity, prospectIdentity } from "./engine";
import { identityHashes } from "./suppression";
import { editDraft, reviewDraft, type DraftMessage } from "./drafts";

export interface LeadForgeRuntime {
  stage: PipelineStage;
  replyStatus: ReplyStatus;
  intentScore: number | null;
  intentResult: ReturnType<typeof analyzeBuyerIntent> | null;
  optedOut: boolean;
  lastActivity: string;
}
export interface LeadForgeNotification {
  id: number; title: string; body: string; tone: "info" | "success" | "warn";
  link?: { screen: string; id?: string };
}
export interface LeadForgeState {
  prospects: Prospect[];
  icp: ICP;
  demoIndustry: string;
  industryIcps: Record<string, ICP>;
  workflow: WorkflowStep[];
  customProspects: Prospect[];
  runtime: Record<string, LeadForgeRuntime>;
  campaigns: Campaign[];
  inbox: InboxItem[];
  conversations: Conversation[];
  drafts: Record<string, DraftMessage>;
  suppressions: Record<string, string>;
  activity: ActivityEvent[];
  notifications: LeadForgeNotification[];
  notifHistory: LeadForgeNotification[];
  selectedProspectId: string | null;
  hiddenProspectIds: string[];
  prospectEdits: Record<string, Partial<Pick<Prospect, "name" | "title" | "company" | "city" | "country">>>;
  simCursor: number;
  simRunning: boolean;
}
export interface ReducerMeta { seed: string; at: string }
export type LeadForgeAction =
  | { type: "SET_ICP"; icp: ICP }
  | { type: "SET_DEMO_INDUSTRY"; industry: string }
  | { type: "ADD_PROSPECTS"; prospects: Prospect[] }
  | { type: "DELETE_DRAFT"; prospectId: string }
  | { type: "SUBMIT_REPLY"; prospectId: string; text: string }
  | { type: "CAMPAIGN_SIM_NEXT"; id: string }
  | { type: "INBOX_APPROVE"; id: string; reply: string }
  | { type: "INBOX_REMINDER"; id: string; days: number }
  | { type: "INBOX_REJECT"; id: string }
  | { type: "INBOX_DISMISS"; id: string }
  | { type: "RESET"; baseline: LeadForgeState }
  | { type: "SAVE_DRAFT"; draft: DraftMessage }
  | { type: "REVIEW_DRAFT"; prospectId: string; status: "approved" | "rejected" }
  | { type: "MOVE_STAGE"; prospectId: string; stage: PipelineStage }
  | { type: "UPDATE_STEP"; stepId: string; patch: Partial<Pick<WorkflowStep, "message" | "delayDays">> }
  | { type: "SIM_START" } | { type: "SIM_PAUSE" } | { type: "SIM_RESTART" } | { type: "SIM_TICK" }
  | { type: "NOTIFY"; n: LeadForgeNotification }
  | { type: "DISMISS_NOTIFICATION"; id: number }
  | { type: "SAVE_CAMPAIGN"; campaign: Campaign }
  | { type: "DELETE_CAMPAIGN"; id: string }
  | { type: "CAMPAIGN_RESTART"; id: string }
  | { type: "CAMPAIGN_SET_STATUS"; id: string; status: CampaignStatus }
  | { type: "UPDATE_PROSPECT"; id: string; patch: Partial<Pick<Prospect, "name" | "title" | "company" | "city" | "country">> }
  | { type: "DELETE_PROSPECT"; id: string }
  | { type: "SELECT_PROSPECT"; id: string | null }
  | { type: "HYDRATE"; state: LeadForgeState };

const everyProspect = (s: LeadForgeState) => [...s.prospects, ...s.customProspects]
  .map(p => s.prospectEdits[p.id] ? { ...p, ...s.prospectEdits[p.id] } : p);
const allProspects = (s: LeadForgeState) => {
  const hidden = new Set(s.hiddenProspectIds);
  return everyProspect(s).filter(p => !hidden.has(p.id));
};
const visibleProspect = (s: LeadForgeState, id: string) => allProspects(s).find(p => p.id === id);
const addSuppressions = (s: LeadForgeState, ids: string[]) => {
  const out = { ...s.suppressions };
  for (const id of ids) {
    const original = [...s.prospects, ...s.customProspects].find(p => p.id === id);
    if (!original) continue;
    for (const hash of identityHashes(original)) out[hash] = id;
    const edits = s.prospectEdits[id];
    if (edits) for (const hash of identityHashes({ ...original, ...edits })) out[hash] = id;
  }
  return out;
};
const dedupeNewProspects = (existing: Prospect[], incoming: Prospect[]) => {
  const ids = new Set(existing.map(p => p.id));
  const known = existing.map(prospectIdentity);
  const out: Prospect[] = [];
  for (const p of incoming) {
    const identity = prospectIdentity(p);
    if (ids.has(p.id) || matchesAnyIdentity(identity, known)) continue;
    ids.add(p.id); known.push(identity); out.push(p);
  }
  return out;
};
const optedOut = (s: LeadForgeState, id: string) => !!s.runtime[id]?.optedOut;
const isSuppressed = (s: LeadForgeState, p: Prospect) => optedOut(s, p.id) || identityHashes(p).some(h => h in s.suppressions) || Object.values(s.suppressions).includes(p.id);

export function reduceLeadForgeState(s: LeadForgeState, a: LeadForgeAction, meta: ReducerMeta, notificationStart = 100): LeadForgeState {
  let uidN = 0;
  let notifN = notificationStart;
  const uid = () => `${meta.seed}${(uidN++).toString(36)}`;
  const now = () => meta.at;
  const log = (items: ActivityEvent[], icon: string, text: string) =>
    [{ id: `a-${uid()}`, icon, text, at: now() }, ...items].slice(0, 40);
  const push = (items: LeadForgeNotification[], n: Omit<LeadForgeNotification, "id">) =>
    [...items, { ...n, id: ++notifN }].slice(-3);
  const history = (items: LeadForgeNotification[], n: Omit<LeadForgeNotification, "id">) =>
    [{ ...n, id: ++notifN }, ...items].slice(0, 50);

  switch (a.type) {
    case "RESET":
      return { ...a.baseline, suppressions: { ...a.baseline.suppressions, ...s.suppressions } };
    case "SET_ICP":
      return { ...s, icp: a.icp, activity: log(s.activity, "sliders", "ICP configuration updated — all fit scores recalculated") };
    case "SET_DEMO_INDUSTRY": {
      const icp = s.industryIcps[a.industry];
      if (!icp) return s;
      return { ...s, demoIndustry: a.industry, icp, activity: log(s.activity, "sliders", `Demo industry set to ${a.industry} — ICP and fit scores updated`) };
    }
    case "ADD_PROSPECTS": {
      const added = dedupeNewProspects([...s.prospects, ...s.customProspects, ...everyProspect(s)], a.prospects)
        .filter(p => !isSuppressed(s, p));
      if (added.length === 0) return s;
      const runtime = { ...s.runtime };
      for (const p of added) runtime[p.id] = {
        stage: p.stage, replyStatus: p.replyStatus, intentScore: null, intentResult: null,
        optedOut: p.replyStatus === "opted_out", lastActivity: p.lastActivity,
      };
      const customProspects = [...s.customProspects, ...added];
      const optedIn = added.filter(p => p.replyStatus === "opted_out").map(p => p.id);
      const next = { ...s, customProspects, runtime };
      return { ...next, suppressions: optedIn.length ? addSuppressions(next, optedIn) : s.suppressions,
        activity: log(s.activity, "radar", `${added.length} prospects added to the workspace`) };
    }
    case "HYDRATE": return a.state;
    case "SELECT_PROSPECT": return { ...s, selectedProspectId: a.id };
    case "MOVE_STAGE": {
      const rt=s.runtime[a.prospectId], p=visibleProspect(s,a.prospectId);
      if (!rt || !p || rt.optedOut) return s;
      return { ...s, runtime:{...s.runtime,[a.prospectId]:{...rt,stage:a.stage,lastActivity:`Moved manually · ${now()}`}},activity:log(s.activity,"gitbranch",`${p.name} moved to stage “${a.stage}” manually`) };
    }
    case "UPDATE_STEP": return { ...s, workflow:s.workflow.map(w=>w.id===a.stepId?{...w,...a.patch}:w),activity:log(s.activity,"send","Outreach workflow configuration updated") };
    case "SIM_START": return { ...s, simRunning:true };
    case "SIM_PAUSE": return { ...s, simRunning:false };
    case "SIM_RESTART": return { ...s, simRunning:true, simCursor:0, workflow:s.workflow.map(w=>({...w,status:"pending"})) };
    case "SIM_TICK": {
      if (!s.simRunning || s.simCursor>=s.workflow.length) return {...s,simRunning:false};
      const workflow=s.workflow.map((w,i)=>({...w,status:i<s.simCursor?"done" as const:i===s.simCursor?"active" as const:"pending" as const}));
      const step=s.workflow[s.simCursor];
      return {...s,workflow,simCursor:s.simCursor+1,simRunning:s.simCursor+1<s.workflow.length,activity:step?log(s.activity,"send",`Workflow step executed: ${step.label} (simulated)`):s.activity};
    }
    case "NOTIFY": return {...s,notifications:[...s.notifications,a.n].slice(-3),notifHistory:[a.n,...s.notifHistory].slice(0,50)};
    case "DISMISS_NOTIFICATION": return {...s,notifications:s.notifications.filter(n=>n.id!==a.id)};
    case "SAVE_CAMPAIGN": {
      const exists=s.campaigns.some(c=>c.id===a.campaign.id);
      return {...s,campaigns:exists?s.campaigns.map(c=>c.id===a.campaign.id?a.campaign:c):[...s.campaigns,a.campaign],activity:log(s.activity,"send",exists?`Campaign “${a.campaign.name}” updated`:`Campaign “${a.campaign.name}” created with ${a.campaign.prospectIds.length} prospects`)};
    }
    case "DELETE_CAMPAIGN": return {...s,campaigns:s.campaigns.filter(c=>c.id!==a.id)};
    case "CAMPAIGN_RESTART": return {...s,campaigns:s.campaigns.map(c=>c.id===a.id?{...c,events:[],simCursor:0,prospectsContacted:0,repliesDetected:0,status:"approved"}:c)};
    case "CAMPAIGN_SET_STATUS": {
      const campaign=s.campaigns.find(c=>c.id===a.id); if(!campaign)return s;
      const labels:Record<string,string>={approved:`Campaign “${campaign.name}” approved — eligible for demo initiation`,running:`Campaign “${campaign.name}” initiated — Demo Mode simulation running`,paused:`Campaign “${campaign.name}” paused — simulated activity stopped`,stopped:`Campaign “${campaign.name}” stopped`,in_review:`Campaign “${campaign.name}” saved for review`,draft:`Campaign “${campaign.name}” saved as draft`};
      return {...s,campaigns:s.campaigns.map(c=>c.id===a.id?{...c,status:a.status}:c),activity:log(s.activity,"send",labels[a.status]??`Campaign “${campaign.name}” → ${a.status}`)};
    }
    case "UPDATE_PROSPECT": {
      const p=visibleProspect(s,a.id); if(!p)return s;
      const clean:Partial<Pick<Prospect,"name"|"title"|"company"|"city"|"country">>={};
      for(const [k,v] of Object.entries(a.patch)){const t=typeof v==="string"?v.trim().slice(0,120):"";if(t)clean[k as keyof typeof clean]=t;}
      const prospectEdits={...s.prospectEdits,[a.id]:{...s.prospectEdits[a.id],...clean}};
      const editedState = { ...s, prospectEdits };
      const suppressions = optedOut(s, a.id) ? addSuppressions(editedState, [a.id]) : s.suppressions;
      return {...s,prospectEdits,suppressions,activity:log(s.activity,"sliders",`Prospect ${clean.name??p.name} updated`)};
    }
    case "DELETE_PROSPECT": {
      const p=visibleProspect(s,a.id);if(!p)return s;
      const isCustom=s.customProspects.some(x=>x.id===a.id),runtime={...s.runtime},prospectEdits={...s.prospectEdits};
      if(isCustom){delete runtime[a.id];delete prospectEdits[a.id];}
      return {...s,runtime,prospectEdits,customProspects:isCustom?s.customProspects.filter(x=>x.id!==a.id):s.customProspects,hiddenProspectIds:isCustom?s.hiddenProspectIds:[...s.hiddenProspectIds,a.id],campaigns:s.campaigns.map(c=>({...c,prospectIds:c.prospectIds.filter(id=>id!==a.id)})),inbox:s.inbox.filter(i=>i.prospectId!==a.id),selectedProspectId:s.selectedProspectId===a.id?null:s.selectedProspectId,activity:log(s.activity,"shield",isCustom?`Imported prospect ${p.name} deleted`:`Sample prospect ${p.name} hidden from this demo`)};
    }
    case "DELETE_DRAFT": {
      const drafts = { ...s.drafts };
      delete drafts[a.prospectId];
      return { ...s, drafts };
    }
    case "SAVE_DRAFT": {
      if (optedOut(s, a.draft.prospectId)) return s;
      const draft = editDraft(s.drafts[a.draft.prospectId], a.draft);
      return { ...s, drafts: { ...s.drafts, [draft.prospectId]: draft } };
    }
    case "REVIEW_DRAFT": {
      const old = s.drafts[a.prospectId];
      if (!old) throw new Error("NOT_FOUND: Draft unavailable.");
      if (a.status === "approved" && optedOut(s, a.prospectId)) return s;
      const next = reviewDraft(old, a.status);
      return next === old ? s : { ...s, drafts: { ...s.drafts, [a.prospectId]: next } };
    }
    case "SUBMIT_REPLY": {
      const p = visibleProspect(s, a.prospectId);
      const rt = s.runtime[a.prospectId];
      if (!p || !rt) return s;
      const result = analyzeBuyerIntent(a.text);
      const fit = calculateFitScore(p, s.icp).total;
      const wasOptedOut = rt.optedOut;
      const isOptOutReply = wasOptedOut || result.classification === "do_not_contact";
      const replyStatus: ReplyStatus = isOptOutReply ? "opted_out" : result.classification === "negative" ? "negative" : result.classification === "neutral" ? "neutral" : "positive";
      let stage = rt.stage;
      let activity = s.activity, notifications = s.notifications, notifHistory = s.notifHistory;
      if (wasOptedOut) {
        activity = log(activity, "shield", `Reply recorded for ${p.name} — remains Do Not Contact; outreach stays suppressed`);
      } else if (isOptOutReply) {
        activity = log(activity, "shield", `${p.name} opted out — outreach suppressed across all channels`);
        const n = { tone: "warn" as const, title: "Do Not Contact", body: `${p.name} asked to be removed. All outreach stopped.` };
        notifications = push(notifications, n); notifHistory = history(notifHistory, n);
      } else if (qualifiesForHandoff(fit, result.score, false)) {
        stage = "qualified";
        const priority = calculateLeadPriority(fit, result.score, false);
        activity = log(activity, "gitbranch", `${p.name} qualified — Priority ${priority.score} (Fit ${fit} · Intent ${result.score}) → routed to sales`);
        const n = { tone: "success" as const, title: "Opportunity Qualified", body: `${p.name} · ${p.company} — Priority ${priority.score}. Routed to the pipeline.` };
        notifications = push(notifications, n); notifHistory = history(notifHistory, n);
      } else {
        activity = log(activity, "brain", `Intent analyzed for ${p.name}: ${result.classificationLabel} (${result.score}/100)`);
        if (result.classification === "high") {
          const n = { tone: "info" as const, title: "High Intent Detected", body: `${p.name} scored ${result.score}/100 intent, but fit ${fit} is below the handoff gate (65).` };
          notifications = push(notifications, n); notifHistory = history(notifHistory, n);
        }
      }
      const msg: ChatMessage = { from: "prospect", text: a.text, at: now() };
      const conversations = s.conversations.some(c => c.prospectId === p.id)
        ? s.conversations.map(c => c.prospectId === p.id ? { ...c, messages: [...c.messages, msg] } : c)
        : [...s.conversations, { prospectId: p.id, channel: p.channel, messages: [msg] }];
      const suppressions = isOptOutReply ? addSuppressions(s, [p.id]) : s.suppressions;
      return { ...s, conversations, activity, notifications, notifHistory, suppressions,
        runtime: { ...s.runtime, [p.id]: { ...rt, stage, replyStatus, optedOut: isOptOutReply, intentScore: result.score, intentResult: result, lastActivity: `Replied · ${now()}` } } };
    }
    case "CAMPAIGN_SIM_NEXT": {
      const c = s.campaigns.find(x => x.id === a.id);
      if (!c || c.status !== "running") return s;
      const eligible = c.prospectIds.filter(id => !optedOut(s, id));
      if (c.prospectIds.length > 0 && eligible.length === 0) return s;
      const names = eligible.map(id => visibleProspect(s, id)?.name).filter((n): n is string => Boolean(n));
      const script = simulationScript({ ...c, prospectIds: eligible }, names);
      if (c.simCursor >= script.length) return s;
      const text = script[c.simCursor]!;
      const ev = { id: `ev-${uid()}`, at: now(), text };
      const isReply = text.includes("Positive response simulated");
      const isApproval = text.includes("Approval requested");
      const isAccept = text.includes("accepted the connection request");
      let inbox = s.inbox, notifications = s.notifications, notifHistory = s.notifHistory;
      let runtime = s.runtime, conversations = s.conversations;
      let repliesDetected = c.repliesDetected;
      if (isAccept) {
        const id = eligible[0], rt = id ? runtime[id] : undefined;
        if (id && rt && !rt.optedOut) runtime = { ...runtime, [id]: { ...rt, stage: "engaged", lastActivity: `Connection accepted (simulated) · ${now()}` } };
      }
      if (isReply) {
        repliesDetected++;
        const id = eligible[0], p = id ? visibleProspect(s, id) : undefined;
        if (p) {
          const replyText = p.industry === "Real Estate"
            ? "Thanks for connecting. This is exactly what we need — we are evaluating automation for our property operations this quarter. Could we schedule a demo next week? I lead this decision."
            : p.industry === "Healthcare"
              ? "Thanks for reaching out. We are evaluating patient engagement tools this quarter — could we schedule a demo next week? I make this decision."
              : "Thanks for reaching out. We are actively looking for help with this — could we schedule a demo next week? I decide on this.";
          const intent = analyzeBuyerIntent(replyText), rt = runtime[p.id];
          if (rt) runtime = { ...runtime, [p.id]: { ...rt, stage: rt.stage === "qualified" || rt.stage === "meeting" ? rt.stage : "interested", replyStatus: "positive", intentScore: intent.score, intentResult: intent, lastActivity: `Replied · ${now()}` } };
          const msg: ChatMessage = { from: "prospect", text: replyText, at: now() };
          conversations = conversations.some(cv => cv.prospectId === p.id)
            ? conversations.map(cv => cv.prospectId === p.id ? { ...cv, messages: [...cv.messages, msg] } : cv)
            : [...conversations, { prospectId: p.id, channel: p.channel, messages: [msg] }];
          inbox = [{ id: `inbox-${uid()}`, prospectId: p.id, campaignId: c.id, incomingText: replyText, at: now(), intentScore: intent.score, intentLabel: intent.classificationLabel, intentClass: intent.classification, recommendedAction: intent.recommendedAction, suggestedReply: suggestedReplyFor(c.brief, intent.classificationLabel).replaceAll("{firstName}", p.name.split(" ")[0] ?? p.name), category: intent.score >= 60 ? "high" : intent.score >= 35 ? "review" : "none", status: "awaiting" }, ...inbox];
          const n = { tone: "info" as const, title: "New Interested Prospect", body: `${p.name} replied to “${c.name}”. AI has prepared a suggested response.`, link: { screen: "inbox" } };
          notifications = push(notifications, n); notifHistory = history(notifHistory, n);
        }
      }
      if (isApproval) {
        const n = { tone: "warn" as const, title: "Response Awaiting Your Approval", body: `A suggested reply for “${c.name}” is waiting in the Intelligence Inbox.`, link: { screen: "inbox" } };
        notifications = push(notifications, n); notifHistory = history(notifHistory, n);
      }
      const campaigns = s.campaigns.map(x => x.id === a.id ? { ...x, events: [...x.events, ev], simCursor: x.simCursor + 1, prospectsContacted: Math.max(x.prospectsContacted, Math.min(eligible.length, (x.simCursor + 1) * 3)), repliesDetected } : x);
      return { ...s, campaigns, inbox, notifications, notifHistory, runtime, conversations, activity: log(s.activity, "send", `“${c.name}”: ${text}`) };
    }
    case "INBOX_APPROVE": {
      const item = s.inbox.find(i => i.id === a.id);
      if (!item || (item.status !== "awaiting" && item.status !== "reminder") || optedOut(s, item.prospectId)) return s;
      const p = visibleProspect(s, item.prospectId);
      const conversations = p
        ? s.conversations.some(c => c.prospectId === p.id)
          ? s.conversations.map(c => c.prospectId === p.id ? { ...c, messages: [...c.messages, { from: "you" as const, text: a.reply, at: now() }] } : c)
          : [...s.conversations, { prospectId: p.id, channel: p.channel, messages: [{ from: "you" as const, text: a.reply, at: now() }] }]
        : s.conversations;
      const n = { tone: "success" as const, title: "Response Approved", body: `Your reply to ${p?.name ?? "the prospect"} was recorded (simulated send).` };
      const rt = s.runtime[item.prospectId], qualify = !!p && !!rt && !rt.optedOut && item.intentClass === "high";
      const runtime = qualify ? { ...s.runtime, [item.prospectId]: { ...rt!, stage: "qualified" as PipelineStage, lastActivity: `Reply approved · qualified · ${now()}` } } : s.runtime;
      return { ...s, runtime, conversations, inbox: s.inbox.map(i => i.id === a.id ? { ...i, status: "approved", suggestedReply: a.reply } : i),
        notifications: push(s.notifications, n), notifHistory: history(s.notifHistory, n),
        activity: log(s.activity, "check", `Suggested reply approved for ${p?.name ?? item.prospectId} (simulated send)${qualify ? " — marked Qualified" : ""}`) };
    }
    case "INBOX_REMINDER": {
      const item = s.inbox.find(i => i.id === a.id);
      if (!item || (item.status !== "awaiting" && item.status !== "reminder") || optedOut(s, item.prospectId)) return s;
      return { ...s, inbox: s.inbox.map(i => i.id === a.id ? { ...i, status: "reminder", reminderDays: a.days } : i),
        activity: log(s.activity, "calendar", `Follow-up reminder set for ${a.days} days (${item.prospectId})`) };
    }
    case "INBOX_REJECT": {
      const item = s.inbox.find(i => i.id === a.id);
      if (!item || item.status !== "awaiting") return s;
      const p = visibleProspect(s, item.prospectId);
      return { ...s, inbox: s.inbox.map(i => i.id === a.id ? { ...i, status: "rejected" } : i),
        activity: log(s.activity, "shield", `Suggested reply rejected for ${p?.name ?? item.prospectId} — nothing sent`) };
    }
    case "INBOX_DISMISS":
      return { ...s, inbox: s.inbox.map(i => i.id === a.id ? { ...i, status: "dismissed" } : i) };
    default:
      return s;
  }
}
