import { Ionicons } from '@expo/vector-icons';
import { Colors as C } from '@/constants/Colors';

export type MoreTool = {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  bg: string;
  label: string;
  desc: string;
  route: string;
  featureKey: string;
};

/** Shared between the More Tools hub screen and the Home screen's own "More Tools" section — keep in one place so they never drift. */
export const MORE_TOOLS: MoreTool[] = [
  { icon: 'receipt-outline', color: C.primary, bg: C.primaryBg, label: 'Expense Claims', desc: 'Submit & track reimbursements', route: '/expense-claims', featureKey: 'expense_claims' },
  { icon: 'airplane-outline', color: C.teal, bg: C.tealBg, label: 'Travel Requests', desc: 'Plan work travel', route: '/travel-requests', featureKey: 'travel_requests' },
  { icon: 'home-outline', color: C.rose, bg: C.roseBg, label: 'Work From Home', desc: 'Request remote days', route: '/wfh-requests', featureKey: 'wfh_requests' },
  { icon: 'document-text-outline', color: C.success, bg: C.successBg, label: 'Tax Declaration', desc: 'Declare tax-saving investments', route: '/tax-declaration', featureKey: 'tax_declaration' },
  { icon: 'shield-outline', color: C.amber, bg: C.amberBg, label: 'Grievance', desc: 'Confidential — HR only', route: '/grievance', featureKey: 'grievances' },
  { icon: 'people-outline', color: C.purple, bg: '#EDE9FE', label: 'Refer a Friend', desc: 'Refer candidates for open roles', route: '/refer', featureKey: 'refer' },
  { icon: 'school-outline', color: C.primaryDark, bg: '#DDD6FE', label: 'Training', desc: 'Skills & learning programs', route: '/training', featureKey: 'training' },
  { icon: 'people-circle-outline', color: C.primaryDark, bg: '#DDD6FE', label: 'Interviews', desc: 'Schedule & give interview feedback', route: '/interviews', featureKey: 'interviews' },
  { icon: 'clipboard-outline', color: C.success, bg: C.successBg, label: 'My Onboarding', desc: 'Track your onboarding checklist', route: '/my-onboarding', featureKey: 'onboarding' },
  { icon: 'exit-outline', color: C.danger, bg: C.dangerBg, label: 'My Offboarding', desc: 'Track your exit checklist', route: '/my-offboarding', featureKey: 'offboarding' },
  { icon: 'laptop-outline', color: C.teal, bg: C.tealBg, label: 'My Assets', desc: 'Equipment assigned to you', route: '/my-assets', featureKey: 'assets' },
  { icon: 'layers-outline', color: C.amber, bg: C.amberBg, label: 'My Projects', desc: 'Projects & tasks assigned to you', route: '/my-projects', featureKey: 'projects' },
];
