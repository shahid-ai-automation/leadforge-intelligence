/**
 * Test-only pinned reducer oracle.
 *
 * The switch body below is mechanically copied from the read-only Development
 * Remix state.ts reducer at commit d84685707d15a5f23321d35bdc3f9ddc7a950386.
 * Adaptations are limited to dependency injection:
 * - DEMO_PROSPECTS -> RefState.prospects
 * - DEMO_ICPS -> RefState.industryIcps
 * - seedState() on RESET -> an injected synthetic baseline on the RESET action
 * - Date/Math.random/global notification counter -> deterministic per-call metadata
 *
 * This is not production code and imports no application fixtures, browser,
 * database, or network modules. Keep this oracle independent from the harness.
 */
import type {
  ActivityEvent, Campaign, CampaignEvent, ChatMessage, Conversation, ICP,
  InboxItem, PipelineStage, Prospect, ReplyStatus, WorkflowStep, CampaignStatus,
} from "../model";
import {
  analyzeBuyerIntent, calculateFitScore, matchesAnyIdentity, prospectIdentity,
  calculateLeadPriority, qualifiesForHandoff, simulationScript, suggestedReplyFor,
} from "../engine";
import { identityHashes } from "../suppression";
import { editDraft, reviewDraft, type DraftMessage } from "../drafts";
import type { RefAction, RefMeta, RefNotification, RefState } from "./reducer-harness";

type ProspectEdit = Partial<Pick<Prospect, "name" | "title" | "company" | "city" | "country">>;

const everyProspect = (s: RefState): Prospect[] =>
  [...s.prospects, ...s.customProspects]
    .map((p) => s.prospectEdits[p.id] ? { ...p, ...s.prospectEdits[p.id] } : p);
const allProspects = (s: RefState): Prospect[] => {
  const hidden = new Set(s.hiddenProspectIds ?? []);
  return everyProspect(s).filter((p) => !hidden.has(p.id));
};
function addSuppressions(s: RefState, ids: string[]): Record<string, string> {
  const out = { ...(s.suppressions ?? {}) };
  for (const id of ids) {
    const original = [...s.prospects, ...s.customProspects].find((p) => p.id === id);
    if (!original) continue;
    for (const hash of identityHashes(original)) out[hash] = id;
    const edits = s.prospectEdits?.[id];
    if (edits) for (const hash of identityHashes({ ...original, ...edits })) out[hash] = id;
  }
  return out;
}
function dedupeNewProspects(existing: Prospect[], incoming: Prospect[]): Prospect[] {
  const ids = new Set(existing.map((p) => p.id));
  const known = existing.map(prospectIdentity);
  const out: Prospect[] = [];
  for (const p of incoming) {
    const identity = prospectIdentity(p);
    if (ids.has(p.id) || matchesAnyIdentity(identity, known)) continue;
    ids.add(p.id); known.push(identity); out.push(p);
  }
  return out;
}
const isOptedOut = (s: RefState, id: string | undefined): boolean => !!id && !!s.runtime[id]?.optedOut;
function isSuppressedIdentity(s: RefState, p: Prospect): boolean {
  if (s.runtime[p.id]?.optedOut) return true;
  const list = s.suppressions ?? {};
  return identityHashes(p).some((hash) => hash in list) || Object.values(list).includes(p.id);
}

export function pinnedReducerOracle(s: RefState, a: RefAction, meta: RefMeta, notificationStart = 100): RefState {
  let uidN = 0;
  let nid = notificationStart;
  const uid = () => `${meta.seed}${(uidN++).toString(36)}`;
  const now = () => meta.at;
  const log = (activity: ActivityEvent[], icon: string, text: string): ActivityEvent[] =>
    [{ id: `a-${uid()}`, icon, text, at: now() }, ...activity].slice(0, 40);
  const pushNotif = (state: RefState, n: Omit<RefNotification, "id">): RefNotification[] =>
    [...state.notifications, { ...n, id: ++nid }].slice(-3);
  const history = (state: RefState, n: Omit<RefNotification, "id">): RefNotification[] =>
    [{ ...n, id: ++nid }, ...state.notifHistory].slice(0, 50);
  switch (a.type) {
    case "HYDRATE": return a.state;
    case "RESET": {
      // Demo data resets; the Do Not Contact list never does.
      const fresh = a.baseline;
      return { ...fresh, suppressions: { ...fresh.suppressions, ...(s.suppressions ?? {}) } };
    }
    case "SET_ICP":
      return { ...s, icp: a.icp, activity: log(s.activity, "sliders", "ICP configuration updated — all fit scores recalculated") };
    case "SET_DEMO_INDUSTRY":
      return { ...s, demoIndustry: a.industry, icp: s.industryIcps[a.industry], activity: log(s.activity, "sliders", `Demo industry set to ${a.industry} — ICP and fit scores updated`) };
    case "SELECT_PROSPECT": return { ...s, selectedProspectId: a.id };

    case "SUBMIT_REPLY": {
      const all = allProspects(s);
      const p = all.find((x) => x.id === a.prospectId);
      const rt = s.runtime[a.prospectId];
      if (!p || !rt) return s;
      const result = analyzeBuyerIntent(a.text);
      const fit = calculateFitScore(p, s.icp).total;
      // A later reply can never clear an opt-out.
      const wasOptedOut = rt.optedOut;
      const optedOut = wasOptedOut || result.classification === "do_not_contact";
      const replyStatus: ReplyStatus =
        optedOut ? "opted_out"
        : result.classification === "negative" ? "negative"
        : result.classification === "neutral" ? "neutral"
        : "positive";

      let stage = rt.stage;
      let activity = s.activity;
      let notifications = s.notifications;
      let notifHistory = s.notifHistory;
      const priority = calculateLeadPriority(fit, result.score, optedOut);

      if (wasOptedOut) {
        activity = log(activity, "shield", `Reply recorded for ${p.name} — remains Do Not Contact; outreach stays suppressed`);
      } else if (optedOut) {
        activity = log(activity, "shield", `${p.name} opted out — outreach suppressed across all channels`);
        const n = { tone: "warn" as const, title: "Do Not Contact", body: `${p.name} asked to be removed. All outreach stopped.` };
        notifications = pushNotif(s, n);
        notifHistory = history(s, n);
      } else if (qualifiesForHandoff(fit, result.score, false)) {
        stage = "qualified";
        activity = log(activity, "gitbranch", `${p.name} qualified — Priority ${priority.score} (Fit ${fit} · Intent ${result.score}) → routed to sales`);
        const n = { tone: "success" as const, title: "Opportunity Qualified", body: `${p.name} · ${p.company} — Priority ${priority.score}. Routed to the pipeline.` };
        notifications = pushNotif(s, n);
        notifHistory = history(s, n);
      } else {
        activity = log(activity, "brain", `Intent analyzed for ${p.name}: ${result.classificationLabel} (${result.score}/100)`);
        if (result.classification === "high") {
          const n = { tone: "info" as const, title: "High Intent Detected", body: `${p.name} scored ${result.score}/100 intent, but fit ${fit} is below the handoff gate (65).` };
          notifications = pushNotif(s, n);
          notifHistory = history(s, n);
        }
      }

      const msg: ChatMessage = { from: "prospect", text: a.text, at: now() };
      const conversations = s.conversations.some((c) => c.prospectId === a.prospectId)
        ? s.conversations.map((c) => c.prospectId === a.prospectId ? { ...c, messages: [...c.messages, msg] } : c)
        : [...s.conversations, { prospectId: a.prospectId, channel: p.channel, messages: [msg] }];

      return {
        ...s,
        conversations,
        activity,
        notifications,
        notifHistory,
        suppressions: optedOut ? addSuppressions(s, [a.prospectId]) : s.suppressions,
        runtime: {
          ...s.runtime,
          [a.prospectId]: {
            ...rt, stage, replyStatus, optedOut,
            intentScore: result.score, intentResult: result,
            lastActivity: `Replied · ${now()}`,
          },
        },
      };
    }

    case "MOVE_STAGE": {
      const rt = s.runtime[a.prospectId];
      const p = allProspects(s).find((x) => x.id === a.prospectId);
      if (!rt || !p) return s;
      if (rt.optedOut) return s; // hard guard: no re-activation path exists for opted-out prospects
      return {
        ...s,
        runtime: { ...s.runtime, [a.prospectId]: { ...rt, stage: a.stage, lastActivity: `Moved manually · ${now()}` } },
        activity: log(s.activity, "gitbranch", `${p.name} moved to stage “${a.stage}” manually`),
      };
    }

    case "UPDATE_STEP":
      return {
        ...s,
        workflow: s.workflow.map((w) => (w.id === a.stepId ? { ...w, ...a.patch } : w)),
        activity: log(s.activity, "send", "Outreach workflow configuration updated"),
      };

    case "SIM_START": return { ...s, simRunning: true };
    case "SIM_PAUSE": return { ...s, simRunning: false };
    case "SIM_RESTART":
      return { ...s, simRunning: true, simCursor: 0, workflow: s.workflow.map((w) => ({ ...w, status: "pending" })) };
    case "SIM_TICK": {
      if (!s.simRunning || s.simCursor >= s.workflow.length) return { ...s, simRunning: false };
      const workflow = s.workflow.map((w, i) => ({
        ...w,
        status: i < s.simCursor ? "done" as const : i === s.simCursor ? "active" as const : "pending" as const,
      }));
      const step = s.workflow[s.simCursor];
      return {
        ...s, workflow, simCursor: s.simCursor + 1,
        simRunning: s.simCursor + 1 < s.workflow.length,
        activity: step ? log(s.activity, "send", `Workflow step executed: ${step.label} (simulated)`) : s.activity,
      };
    }

    case "SAVE_DRAFT": {
      if (isOptedOut(s, a.draft.prospectId)) return s;
      const draft = editDraft(s.drafts[a.draft.prospectId], a.draft);
      return { ...s, drafts: { ...s.drafts, [draft.prospectId]: draft } };
    }
    case "REVIEW_DRAFT": {
      const old = s.drafts[a.prospectId];
      if (!old) throw new Error("NOT_FOUND: Draft unavailable.");
      if (a.status === "approved" && isOptedOut(s, a.prospectId)) return s;
      const next = reviewDraft(old, a.status);
      return next === old ? s : { ...s, drafts: { ...s.drafts, [a.prospectId]: next } };
    }
    case "DELETE_DRAFT": {
      const drafts = { ...s.drafts };
      delete drafts[a.prospectId];
      return { ...s, drafts };
    }

    case "NOTIFY":
      return { ...s, notifications: [...s.notifications, a.n].slice(-3), notifHistory: [a.n, ...s.notifHistory].slice(0, 50) };
    case "DISMISS_NOTIFICATION": return { ...s, notifications: s.notifications.filter((n) => n.id !== a.id) };

    /* ------------------------- Campaign journey ------------------------- */

    case "ADD_PROSPECTS": {
      // Authoritative duplicate guard: never add a prospect whose id or key already exists.
      // Previously opted-out identities are never re-added, even after deletion.
      const added = dedupeNewProspects([...s.prospects, ...s.customProspects, ...everyProspect(s)], a.prospects)
        .filter((p) => !isSuppressedIdentity(s, p));
      if (added.length === 0) return s;
      const runtime = { ...s.runtime };
      for (const p of added) {
        runtime[p.id] = {
          stage: p.stage, replyStatus: p.replyStatus, intentScore: null,
          intentResult: null, optedOut: p.replyStatus === "opted_out", lastActivity: p.lastActivity,
        };
      }
      const customProspects = [...s.customProspects, ...added];
      const optedIn = added.filter((p) => p.replyStatus === "opted_out").map((p) => p.id);
      return {
        ...s,
        customProspects,
        suppressions: optedIn.length ? addSuppressions({ ...s, customProspects }, optedIn) : s.suppressions,
        runtime,
        activity: log(s.activity, "radar", `${added.length} prospects added to the workspace`),
      };
    }

    case "SAVE_CAMPAIGN": {
      const exists = s.campaigns.some((c) => c.id === a.campaign.id);
      const campaigns = exists
        ? s.campaigns.map((c) => (c.id === a.campaign.id ? a.campaign : c))
        : [...s.campaigns, a.campaign];
      return {
        ...s,
        campaigns,
        activity: log(s.activity, "send", exists
          ? `Campaign “${a.campaign.name}” updated`
          : `Campaign “${a.campaign.name}” created with ${a.campaign.prospectIds.length} prospects`),
      };
    }

    case "DELETE_CAMPAIGN":
      return { ...s, campaigns: s.campaigns.filter((c) => c.id !== a.id) };

    case "CAMPAIGN_RESTART":
      return { ...s, campaigns: s.campaigns.map(c => c.id === a.id ? { ...c, events: [], simCursor: 0, prospectsContacted: 0, repliesDetected: 0, status: "approved" } : c) };

    case "CAMPAIGN_SET_STATUS": {
      const c = s.campaigns.find((x) => x.id === a.id);
      if (!c) return s;
      const campaigns = s.campaigns.map((x) => (x.id === a.id ? { ...x, status: a.status } : x));
      const labels: Record<string, string> = {
        approved: `Campaign “${c.name}” approved — eligible for demo initiation`,
        running: `Campaign “${c.name}” initiated — Demo Mode simulation running`,
        paused: `Campaign “${c.name}” paused — simulated activity stopped`,
        stopped: `Campaign “${c.name}” stopped`,
        in_review: `Campaign “${c.name}” saved for review`,
        draft: `Campaign “${c.name}” saved as draft`,
      };
      return { ...s, campaigns, activity: log(s.activity, "send", labels[a.status] ?? `Campaign “${c.name}” → ${a.status}`) };
    }

    case "CAMPAIGN_SIM_NEXT": {
      const c = s.campaigns.find((x) => x.id === a.id);
      if (!c || c.status !== "running") return s;
      // Opted-out prospects never receive simulated outreach or follow-ups.
      const eligible = c.prospectIds.filter((id) => !isOptedOut(s, id));
      if (c.prospectIds.length > 0 && eligible.length === 0) return s;
      const names = eligible
        .map((id) => allProspects(s).find((p) => p.id === id)?.name)
        .filter((n): n is string => Boolean(n));
      const script = simulationScript({ ...c, prospectIds: eligible }, names);
      if (c.simCursor >= script.length) return s;
      const text = script[c.simCursor]!;
      const ev: CampaignEvent = { id: `ev-${uid()}`, at: now(), text };
      const isReplyEvent = text.includes("Positive response simulated");
      const isApprovalEvent = text.includes("Approval requested");
      const isAcceptEvent = text.includes("accepted the connection request");

      let inbox = s.inbox;
      let notifications = s.notifications;
      let notifHistory = s.notifHistory;
      let runtime = s.runtime;
      let conversations = s.conversations;
      let repliesDetected = c.repliesDetected;

      if (isAcceptEvent) {
        const fid = eligible[0];
        const frt = fid ? runtime[fid] : undefined;
        if (fid && frt && !frt.optedOut) {
          runtime = { ...runtime, [fid]: { ...frt, stage: "engaged", lastActivity: `Connection accepted (simulated) · ${now()}` } };
        }
      }

      if (isReplyEvent) {
        repliesDetected++;
        const prospectId = eligible[0];
        const p = allProspects(s).find((x) => x.id === prospectId);
        if (p) {
          const replyText = p.industry === "Real Estate"
            ? "Thanks for connecting. This is exactly what we need — we are evaluating automation for our property operations this quarter. Could we schedule a demo next week? I lead this decision."
            : p.industry === "Healthcare"
            ? "Thanks for reaching out. We are evaluating patient engagement tools this quarter — could we schedule a demo next week? I make this decision."
            : "Thanks for reaching out. We are actively looking for help with this — could we schedule a demo next week? I decide on this.";
          const intent = analyzeBuyerIntent(replyText);
          const fit = calculateFitScore(p, s.icp).total;
          const priority = calculateLeadPriority(fit, intent.score, false);
          const rt = runtime[p.id];
          if (rt) {
            runtime = { ...runtime, [p.id]: { ...rt, stage: rt.stage === "qualified" || rt.stage === "meeting" ? rt.stage : "interested", replyStatus: "positive", intentScore: intent.score, intentResult: intent, lastActivity: `Replied · ${now()}` } };
          }
          conversations = conversations.some((cv) => cv.prospectId === p.id)
            ? conversations.map((cv) => cv.prospectId === p.id ? { ...cv, messages: [...cv.messages, { from: "prospect" as const, text: replyText, at: now() }] } : cv)
            : [...conversations, { prospectId: p.id, channel: p.channel, messages: [{ from: "prospect" as const, text: replyText, at: now() }] }];
          inbox = [{
            id: `inbox-${uid()}`,
            prospectId: p.id,
            campaignId: c.id,
            incomingText: replyText,
            at: now(),
            intentScore: intent.score,
            intentLabel: intent.classificationLabel,
            intentClass: intent.classification,
            recommendedAction: intent.recommendedAction,
            suggestedReply: suggestedReplyFor(c.brief, intent.classificationLabel).replaceAll("{firstName}", p.name.split(" ")[0] ?? p.name),
            category: intent.score >= 60 ? "high" : intent.score >= 35 ? "review" : "none",
            status: "awaiting",
          }, ...inbox];
          const n = { tone: "info" as const, title: "New Interested Prospect", body: `${p.name} replied to “${c.name}”. AI has prepared a suggested response.`, link: { screen: "inbox" } };
          notifications = pushNotif({ ...s, notifications }, n);
          notifHistory = history(s, n);
          void priority;
        }
      }
      if (isApprovalEvent) {
        const n = { tone: "warn" as const, title: "Response Awaiting Your Approval", body: `A suggested reply for “${c.name}” is waiting in the Intelligence Inbox.`, link: { screen: "inbox" } };
        notifications = pushNotif({ ...s, notifications }, n);
        notifHistory = history(s, n);
      }

      const campaigns = s.campaigns.map((x) =>
        x.id === a.id
          ? { ...x, events: [...x.events, ev], simCursor: x.simCursor + 1, prospectsContacted: Math.max(x.prospectsContacted, Math.min(eligible.length, (x.simCursor + 1) * 3)), repliesDetected }
          : x,
      );
      return {
        ...s, campaigns, inbox, notifications, notifHistory, runtime, conversations,
        activity: log(s.activity, "send", `“${c.name}”: ${text}`),
      };
    }

    case "INBOX_APPROVE": {
      const item = s.inbox.find((i) => i.id === a.id);
      if (!item || (item.status !== "awaiting" && item.status !== "reminder")) return s;
      if (isOptedOut(s, item.prospectId)) return s; // Do Not Contact: no simulated send
      const p = allProspects(s).find((x) => x.id === item.prospectId);
      const conversations = p
        ? (s.conversations.some((c) => c.prospectId === p.id)
            ? s.conversations.map((c) => c.prospectId === p.id ? { ...c, messages: [...c.messages, { from: "you" as const, text: a.reply, at: now() }] } : c)
            : [...s.conversations, { prospectId: p.id, channel: p.channel, messages: [{ from: "you" as const, text: a.reply, at: now() }] }])
        : s.conversations;
      const n = { tone: "success" as const, title: "Response Approved", body: `Your reply to ${p?.name ?? "the prospect"} was recorded (simulated send).` };
      const prt = s.runtime[item.prospectId];
      const qualify = !!p && !!prt && !prt.optedOut && item.intentClass === "high";
      const runtime = qualify
        ? { ...s.runtime, [item.prospectId]: { ...prt, stage: "qualified" as PipelineStage, lastActivity: `Reply approved · qualified · ${now()}` } }
        : s.runtime;
      return {
        ...s,
        runtime,
        conversations,
        inbox: s.inbox.map((i) => (i.id === a.id ? { ...i, status: "approved", suggestedReply: a.reply } : i)),
        notifications: pushNotif(s, n),
        notifHistory: history(s, n),
        activity: log(s.activity, "check", `Suggested reply approved for ${p?.name ?? item.prospectId} (simulated send)${qualify ? " — marked Qualified" : ""}`),
      };
    }

    case "INBOX_REMINDER": {
      const item = s.inbox.find((i) => i.id === a.id);
      if (!item || (item.status !== "awaiting" && item.status !== "reminder")) return s;
      if (isOptedOut(s, item.prospectId)) return s; // Do Not Contact: no follow-up reminders
      return {
        ...s,
        inbox: s.inbox.map((i) => (i.id === a.id ? { ...i, status: "reminder", reminderDays: a.days } : i)),
        activity: log(s.activity, "calendar", `Follow-up reminder set for ${a.days} days (${item.prospectId})`),
      };
    }

    case "INBOX_DISMISS":
      return { ...s, inbox: s.inbox.map((i) => (i.id === a.id ? { ...i, status: "dismissed" } : i)) };

    case "INBOX_REJECT": {
      const item = s.inbox.find((i) => i.id === a.id);
      if (!item || item.status !== "awaiting") return s;
      const p = allProspects(s).find((x) => x.id === item.prospectId);
      return {
        ...s,
        inbox: s.inbox.map((i) => (i.id === a.id ? { ...i, status: "rejected" } : i)),
        activity: log(s.activity, "shield", `Suggested reply rejected for ${p?.name ?? item.prospectId} — nothing sent`),
      };
    }

    case "UPDATE_PROSPECT": {
      const p = allProspects(s).find((x) => x.id === a.id);
      if (!p) return s;
      const clean: ProspectEdit = {};
      for (const [k, v] of Object.entries(a.patch)) {
        const t = typeof v === "string" ? v.trim().slice(0, 120) : "";
        if (t) clean[k as keyof ProspectEdit] = t;
      }
      const prospectEdits = { ...s.prospectEdits, [a.id]: { ...s.prospectEdits[a.id], ...clean } };
      return {
        ...s,
        prospectEdits,
        // Editing an opted-out prospect also suppresses the edited identity.
        suppressions: isOptedOut(s, a.id) ? addSuppressions({ ...s, prospectEdits }, [a.id]) : s.suppressions,
        activity: log(s.activity, "sliders", `Prospect ${clean.name ?? p.name} updated`),
      };
    }

    case "DELETE_PROSPECT": {
      const p = allProspects(s).find((x) => x.id === a.id);
      if (!p) return s;
      const isCustom = s.customProspects.some((x) => x.id === a.id);
      const runtime = { ...s.runtime };
      const prospectEdits = { ...s.prospectEdits };
      if (isCustom) { delete runtime[a.id]; delete prospectEdits[a.id]; }
      return {
        ...s,
        runtime,
        prospectEdits,
        customProspects: isCustom ? s.customProspects.filter((x) => x.id !== a.id) : s.customProspects,
        hiddenProspectIds: isCustom ? s.hiddenProspectIds : [...s.hiddenProspectIds, a.id],
        campaigns: s.campaigns.map((c) => ({ ...c, prospectIds: c.prospectIds.filter((id) => id !== a.id) })),
        inbox: s.inbox.filter((i) => i.prospectId !== a.id),
        selectedProspectId: s.selectedProspectId === a.id ? null : s.selectedProspectId,
        activity: log(s.activity, "shield", isCustom ? `Imported prospect ${p.name} deleted` : `Sample prospect ${p.name} hidden from this demo`),
      };
    }

    default: return s;
  }
}
