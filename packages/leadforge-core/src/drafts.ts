export interface DraftMessage {
  prospectId: string;
  category: string;
  body: string;
  approved: boolean;
  status?: 'draft' | 'approved' | 'rejected';
  version?: number;
  generatedBy?: 'ai' | 'template' | 'manual';
}
export type DraftStatus = 'draft' | 'approved' | 'rejected';
export function draftStatus(d?: DraftMessage): DraftStatus { return d?.status ?? (d?.approved ? 'approved' : 'draft'); }
export function editDraft(old: DraftMessage | undefined, next: DraftMessage): DraftMessage {
  if (draftStatus(old) === 'approved') throw new Error('CONFLICT: Approved content is read-only.');
  return { ...next, approved: false, status: 'draft', version: (old?.version ?? 0) + 1 };
}
export function reviewDraft(old: DraftMessage, status: 'approved' | 'rejected'): DraftMessage {
  const current = draftStatus(old);
  if (current === status) return old;
  if (current !== 'draft') throw new Error('CONFLICT: Edit rejected content before reviewing again. Approved content is read-only.');
  return { ...old, status, approved: status === 'approved', version: (old.version ?? 0) + 1 };
}
