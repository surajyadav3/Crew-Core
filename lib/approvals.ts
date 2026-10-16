import { Ionicons } from '@expo/vector-icons';
import { Colors as C } from '@/constants/Colors';
import { isRaniwalaTenant } from '@/lib/helpers';

/**
 * Who gets the approver side of the app (Team tab, approvals inbox) and
 * which request types they review — the same split as the website's
 * manager / Raniwala manager / HR sidebars. RLS on every table still decides
 * which rows come back; this only decides what's shown.
 */

export type ApprovalKind = 'leave' | 'punch' | 'regularize' | 'wfh' | 'special' | 'expense' | 'travel' | 'verification';

export const APPROVER_ROLES = ['manager', 'hod', 'management', 'admin'];

export const isApproverRole = (role?: string | null) => APPROVER_ROLES.includes(role || '');

/** HR (admin) decides on anything; managers / HODs only on their own team. */
export const isHrRole = (role?: string | null) => role === 'admin' || role === 'superadmin';

export type ApprovalKindInfo = {
  kind: ApprovalKind;
  label: string;
  short: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  bg: string;
};

const KIND_INFO: Record<ApprovalKind, ApprovalKindInfo> = {
  leave: { kind: 'leave', label: 'Leave Requests', short: 'Leave', icon: 'calendar-outline', color: C.teal, bg: C.tealBg },
  punch: { kind: 'punch', label: 'Punch Approvals', short: 'Punches', icon: 'finger-print', color: C.primary, bg: C.primaryBg },
  regularize: { kind: 'regularize', label: 'Regularize Attendance', short: 'Regularize', icon: 'calendar-number-outline', color: C.rose, bg: C.roseBg },
  wfh: { kind: 'wfh', label: 'Work From Home', short: 'WFH', icon: 'home-outline', color: C.amber, bg: C.amberBg },
  special: { kind: 'special', label: 'Special Requests', short: 'Special', icon: 'flash-outline', color: C.purple, bg: '#EDE9FE' },
  expense: { kind: 'expense', label: 'Expense Claims', short: 'Expenses', icon: 'receipt-outline', color: C.success, bg: C.successBg },
  travel: { kind: 'travel', label: 'Travel Requests', short: 'Travel', icon: 'airplane-outline', color: C.primaryDark, bg: '#DDD6FE' },
  verification: { kind: 'verification', label: 'Verification Requests', short: 'Verification', icon: 'shield-checkmark-outline', color: C.danger, bg: C.dangerBg },
};

export const kindInfo = (kind: ApprovalKind) => KIND_INFO[kind];

/**
 * Request types this person reviews, in inbox order.
 * - Punch approvals exist only at Raniwala (outlets.app_punch_needs_approval).
 * - Expense / travel: RLS lets only manager + HR read them (no HOD policy).
 * - Verification: Raniwala keeps it HR-only (policy "pvr: raniwala hr only").
 * - Special requests: FeatureContext already hides them for Raniwala.
 */
export function visibleApprovalKinds(profile: any, tenant: any, isEnabled: (key?: string | null) => boolean): ApprovalKind[] {
  const role = profile?.role || '';
  if (!isApproverRole(role)) return [];
  const raniwala = isRaniwalaTenant(tenant);
  const managerOrHr = role === 'manager' || isHrRole(role);
  const kinds: ApprovalKind[] = [];
  if (isEnabled('leave_requests')) kinds.push('leave');
  if (raniwala && isEnabled('attendance')) kinds.push('punch');
  if (isEnabled('regularize_attendance')) kinds.push('regularize');
  if (isEnabled('wfh_requests')) kinds.push('wfh');
  if (isEnabled('special_requests')) kinds.push('special');
  if (managerOrHr && isEnabled('expense_claims')) kinds.push('expense');
  if (managerOrHr && isEnabled('travel_requests')) kinds.push('travel');
  if (isEnabled('profile_verification') && (isHrRole(role) || (!raniwala && role === 'manager'))) kinds.push('verification');
  return kinds;
}

/**
 * Notification link_key -> inbox tab, for request notifications sent to an
 * approver (new request, HR copy, FYI). Results sent to the requester
 * (…_approved / …_rejected / punch_approval_result) are not approver work.
 */
const KIND_BY_LINK_KEY: Record<string, ApprovalKind> = {
  leave_requests: 'leave',
  punch_approvals: 'punch',
  regularize_attendance: 'regularize',
  regularize_requests: 'regularize',
  wfh_requests: 'wfh',
  special_requests: 'special',
  expense_claims: 'expense',
  travel_requests: 'travel',
  verification_requests: 'verification',
};

const APPROVER_TYPE_RE = /(_submitted|_hr_copy|_fyi|_request|_pending|_stage)$/;

export function approvalRouteForNotification(n: { type?: string | null; link_key?: string | null }): string | null {
  const kind = n.link_key ? KIND_BY_LINK_KEY[n.link_key] : undefined;
  if (!kind || !n.type || !APPROVER_TYPE_RE.test(n.type)) return null;
  return kind === 'verification' ? '/team-verification' : `/approvals?kind=${kind}`;
}
