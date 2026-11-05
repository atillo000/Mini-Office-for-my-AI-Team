// An optional provider boundary. No external messaging provider is configured or called.
export interface EmailDraft {
  id: string;
  to: string;
  subject: string;
  body: string;
}
export interface EmailApproval {
  draftId: string;
  approvedBy: 'ceo';
  approvedAt: number;
}
export interface EmailProvider {
  name: string;
  sendApprovedDraft(
    draft: EmailDraft,
    approval: EmailApproval,
  ): Promise<{ providerMessageId: string }>;
}
export function requireEmailApproval(draft: EmailDraft, approval: EmailApproval) {
  if (approval.draftId !== draft.id || approval.approvedBy !== 'ceo' || !approval.approvedAt) {
    throw new Error('A matching CEO approval is required before sending external email');
  }
}
