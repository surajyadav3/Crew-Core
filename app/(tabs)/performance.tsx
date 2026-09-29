import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, Modal,
  TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { useFeatures } from '@/context/FeatureContext';
import { useForegroundRefresh } from '@/hooks/useForegroundRefresh';
import { listMyKras, updateKraProgress } from '@/services/kraService';
import {
  listReceivedFeedback, listGivenFeedback, listPendingRequests, listColleagues,
  giveFeedback, requestFeedback, respondToFeedbackRequest,
} from '@/services/feedbackService';
import { getMyActivePip, listPipCheckins } from '@/services/pipService';
import { listMyReviews, getReviewDetail, submitReviewAnswer } from '@/services/reviewService';
import { listMyMeetings, scheduleMeeting, updateMeetingStatus, addMeetingSummary } from '@/services/oneOnOneService';
import { showToast } from '@/components/Toast';
import { fmtDate, fmtDateTime, fmtTime12, todayStr } from '@/lib/helpers';
import { Colors as C } from '@/constants/Colors';

const fullName = (p: any) => [p?.first_name, p?.middle_name, p?.last_name].filter(Boolean).join(' ').toUpperCase() || 'UNKNOWN';

// ── Shared bits ──────────────────────────────────────────────────────────────
function ProgressBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value || 0));
  return (
    <View style={pb.track}>
      <View style={[pb.fill, { width: `${pct}%`, backgroundColor: pct >= 100 ? C.success : C.primary }]} />
    </View>
  );
}
const pb = StyleSheet.create({
  track: { height: 8, borderRadius: 4, backgroundColor: C.border, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
});

function EmptyState({ icon, title, text }: { icon: keyof typeof Ionicons.glyphMap; title: string; text: string }) {
  return (
    <View style={s.emptyCard}>
      <View style={s.emptyIconWrap}><Ionicons name={icon} size={32} color={C.primary} /></View>
      <Text style={s.emptyTitle}>{title}</Text>
      <Text style={s.emptyText}>{text}</Text>
    </View>
  );
}

function Loading() {
  return <View style={s.loadingBox}><ActivityIndicator color={C.primary} size="large" /></View>;
}

function RatingPill({ value }: { value: number | null | undefined }) {
  if (value == null) return null;
  return (
    <View style={s.ratingPill}>
      <Ionicons name="star" size={11} color="#F5A623" />
      <Text style={s.ratingPillText}>{Number(value).toFixed(1)}/5</Text>
    </View>
  );
}

function ColleaguePickerModal({ visible, title, colleagues, selected, onSelect, onClose }: {
  visible: boolean; title: string; colleagues: any[]; selected: string; onSelect: (id: string) => void; onClose: () => void;
}) {
  return (
    <Modal visible={visible} animationType="fade" transparent>
      <TouchableOpacity style={s.modalOverlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={s.pickerCard} onPress={() => {}}>
          <Text style={s.pickerTitle}>{title}</Text>
          <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
            {colleagues.length === 0 ? (
              <Text style={{ color: C.muted, fontSize: 13, paddingVertical: 12 }}>No colleagues found.</Text>
            ) : colleagues.map((c) => (
              <TouchableOpacity key={c.id} style={[s.pickerItem, selected === c.id && { backgroundColor: C.primaryBg }]} onPress={() => onSelect(c.id)}>
                <Text style={[s.pickerText, selected === c.id && { color: C.primary, fontWeight: '700' }]}>{fullName(c)}</Text>
                {selected === c.id && <Ionicons name="checkmark-circle" size={18} color={C.primary} />}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// ── KRAs tab ─────────────────────────────────────────────────────────────────
function KRAsTab({ onRefresh }: { onRefresh: (fn: () => Promise<void>) => void }) {
  const { profile, tenant } = useAuth();
  const [kras, setKras] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!tenant || !profile) return;
    const { data, error } = await listMyKras(tenant.id, profile.id);
    if (error) showToast(error.message || 'Failed to load KRAs.', 'error');
    setKras(data);
  }, [tenant, profile]);

  useForegroundRefresh(fetchData, setLoading);
  useEffect(() => { onRefresh(fetchData); }, [fetchData]);

  const toggleExpand = (id: string) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const saveProgress = async (kra: any) => {
    const raw = draft[kra.id];
    const value = Math.max(0, Math.min(100, parseInt(raw ?? String(kra.progress_percent || 0), 10) || 0));
    setSaving(kra.id);
    try {
      const { error } = await updateKraProgress(kra.id, value);
      if (error) return showToast('Failed: ' + error.message, 'error');
      showToast('Progress updated', 'success');
      fetchData();
    } finally {
      setSaving(null);
    }
  };

  if (loading) return <Loading />;
  if (kras.length === 0) return <EmptyState icon="flag-outline" title="No KRAs yet" text="Your Key Result Areas will show up here once assigned." />;

  return (
    <View style={s.list}>
      {kras.map((k) => {
        const isOwner = k.profile_id === profile?.id;
        const isCompleted = k.status === 'Completed';
        const currentDraft = draft[k.id] ?? String(k.progress_percent || 0);
        const dirty = currentDraft !== String(k.progress_percent || 0);
        return (
          <View key={k.id} style={s.card}>
            <View style={s.cardTop}>
              <Text style={s.cardTitle}>{k.title}</Text>
              <View style={[s.badge, { backgroundColor: k.scope === 'company' ? C.tealBg : C.primaryBg }]}>
                <Text style={[s.badgeText, { color: k.scope === 'company' ? C.teal : C.primary }]}>
                  {k.scope === 'company' ? 'Company-wide' : 'Individual'}
                </Text>
              </View>
              {isCompleted && (
                <View style={[s.badge, { backgroundColor: C.successBg }]}>
                  <Text style={[s.badgeText, { color: C.success }]}>Completed</Text>
                </View>
              )}
            </View>
            {!!k.description && <Text style={s.cardDesc}>{k.description}</Text>}
            <Text style={s.metaText}>
              {k.weight ? `Weight: ${k.weight}%` : ''}
              {k.weight && k.period_start && k.period_end ? ' · ' : ''}
              {k.period_start && k.period_end ? `${fmtDate(k.period_start)} → ${fmtDate(k.period_end)}` : ''}
            </Text>

            <View style={s.progressRow}>
              <View style={{ flex: 1 }}><ProgressBar value={k.progress_percent} /></View>
              <Text style={s.progressPct}>{k.progress_percent || 0}%</Text>
            </View>

            {isOwner && !isCompleted && (
              <View style={s.progressEditRow}>
                <TextInput
                  style={s.progressInput}
                  keyboardType="numeric"
                  maxLength={3}
                  value={currentDraft}
                  onChangeText={(v) => setDraft((d) => ({ ...d, [k.id]: v.replace(/[^0-9]/g, '') }))}
                />
                <Text style={s.progressInputSuffix}>%</Text>
                <TouchableOpacity
                  style={[s.smallBtn, (!dirty || saving === k.id) && { opacity: 0.5 }]}
                  onPress={() => saveProgress(k)}
                  disabled={!dirty || saving === k.id}
                >
                  {saving === k.id ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.smallBtnText}>Update</Text>}
                </TouchableOpacity>
              </View>
            )}

            <TouchableOpacity style={s.expandBtn} onPress={() => toggleExpand(k.id)}>
              <Ionicons name={expanded.has(k.id) ? 'chevron-up' : 'chevron-down'} size={14} color={C.primary} />
              <Text style={s.expandBtnText}>KPIs ({(k.kra_kpis || []).length})</Text>
            </TouchableOpacity>

            {expanded.has(k.id) && (
              <View style={s.kpiWrap}>
                {(k.kra_kpis || []).length === 0 ? (
                  <Text style={s.kpiEmpty}>No KPIs defined.</Text>
                ) : (k.kra_kpis || []).map((kpi: any) => (
                  <View key={kpi.id} style={s.kpiRow}>
                    <Text style={s.kpiTitle}>{kpi.title}</Text>
                    {(kpi.target || kpi.achieved) && (
                      <Text style={s.kpiSub}>Target: {kpi.target || '—'} · Achieved: {kpi.achieved || '—'}</Text>
                    )}
                  </View>
                ))}
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

// ── Feedback tab ─────────────────────────────────────────────────────────────
const FB_TYPE_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  praise: { label: 'Praise', color: C.success, bg: C.successBg },
  feedback: { label: 'Feedback', color: C.primary, bg: C.primaryBg },
  request: { label: 'Requested', color: C.muted, bg: C.border },
};

function FeedbackTab({ onRefresh }: { onRefresh: (fn: () => Promise<void>) => void }) {
  const { profile, tenant } = useAuth();
  const [subTab, setSubTab] = useState<'received' | 'given' | 'requests'>('received');
  const [received, setReceived] = useState<any[]>([]);
  const [given, setGiven] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [colleagues, setColleagues] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [showGive, setShowGive] = useState(false);
  const [giveForm, setGiveForm] = useState({ to_profile_id: '', type: 'praise', message: '' });
  const [showGivePicker, setShowGivePicker] = useState(false);
  const [savingGive, setSavingGive] = useState(false);

  const [showRequest, setShowRequest] = useState(false);
  const [requestFrom, setRequestFrom] = useState('');
  const [showRequestPicker, setShowRequestPicker] = useState(false);
  const [savingRequest, setSavingRequest] = useState(false);

  const [responseDraft, setResponseDraft] = useState<Record<string, string>>({});
  const [respondingId, setRespondingId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!tenant || !profile) return;
    const [r, g, p, c] = await Promise.all([
      listReceivedFeedback(tenant.id, profile.id),
      listGivenFeedback(tenant.id, profile.id),
      listPendingRequests(tenant.id, profile.id),
      listColleagues(tenant.id, profile.id),
    ]);
    setReceived(r.data);
    setGiven(g.data);
    setRequests(p.data);
    setColleagues(c.data);
  }, [tenant, profile]);

  useForegroundRefresh(fetchData, setLoading);
  useEffect(() => { onRefresh(fetchData); }, [fetchData]);

  const openGive = () => { setGiveForm({ to_profile_id: '', type: 'praise', message: '' }); setShowGive(true); };
  const saveGive = async () => {
    if (!giveForm.to_profile_id) return showToast('Select who this feedback is for.', 'error');
    if (!giveForm.message.trim()) return showToast('Message is required.', 'error');
    setSavingGive(true);
    try {
      const { error } = await giveFeedback({
        tenantId: tenant!.id, fromProfileId: profile!.id, toProfileId: giveForm.to_profile_id,
        type: giveForm.type, message: giveForm.message.trim(), visibility: 'private',
      });
      if (error) return showToast('Failed: ' + error.message, 'error');
      showToast('Feedback sent', 'success');
      setShowGive(false);
      fetchData();
    } finally {
      setSavingGive(false);
    }
  };

  const openRequest = () => { setRequestFrom(''); setShowRequest(true); };
  const saveRequest = async () => {
    if (!requestFrom) return showToast('Select who you want feedback from.', 'error');
    setSavingRequest(true);
    try {
      const { error } = await requestFeedback({ tenantId: tenant!.id, createdBy: profile!.id, requestedFrom: requestFrom });
      if (error) return showToast('Failed: ' + error.message, 'error');
      showToast('Feedback requested', 'success');
      setShowRequest(false);
      fetchData();
    } finally {
      setSavingRequest(false);
    }
  };

  const respond = async (req: any) => {
    const message = (responseDraft[req.id] || '').trim();
    if (!message) return showToast('Write a response first.', 'error');
    setRespondingId(req.id);
    try {
      const { error } = await respondToFeedbackRequest(req.id, { fromProfileId: profile!.id, message });
      if (error) return showToast('Failed: ' + error.message, 'error');
      showToast('Response submitted', 'success');
      fetchData();
    } finally {
      setRespondingId(null);
    }
  };

  const renderFeedbackList = (items: any[], emptyIcon: keyof typeof Ionicons.glyphMap, emptyTitle: string, emptyText: string) => (
    items.length === 0 ? <EmptyState icon={emptyIcon} title={emptyTitle} text={emptyText} /> : (
      <View style={s.list}>
        {items.map((f) => {
          const tl = FB_TYPE_LABEL[f.type] || FB_TYPE_LABEL.feedback;
          return (
            <View key={f.id} style={s.card}>
              <View style={s.cardTop}>
                <Text style={s.feedbackFrom}>{f.from_profile ? fullName(f.from_profile) : 'Someone'}</Text>
                <Ionicons name="arrow-forward" size={12} color={C.muted} />
                <Text style={s.feedbackFrom}>{f.to_profile ? fullName(f.to_profile) : ''}</Text>
                <View style={[s.badge, { backgroundColor: tl.bg }]}><Text style={[s.badgeText, { color: tl.color }]}>{tl.label}</Text></View>
              </View>
              <Text style={s.metaText}>{fmtDateTime(f.created_at)}</Text>
              {!!f.message && <Text style={s.cardDesc}>{f.message}</Text>}
            </View>
          );
        })}
      </View>
    )
  );

  return (
    <>
      <View style={s.actionRow}>
        <TouchableOpacity style={s.outlineBtn} onPress={openRequest}>
          <Ionicons name="hand-left-outline" size={14} color={C.primary} />
          <Text style={s.outlineBtnText}>Request</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.primaryBtn} onPress={openGive}>
          <Ionicons name="add" size={16} color="#fff" />
          <Text style={s.primaryBtnText}>Give Feedback</Text>
        </TouchableOpacity>
      </View>

      <View style={s.subTabRow}>
        {([
          { key: 'received', label: 'Received' },
          { key: 'given', label: 'Given' },
          { key: 'requests', label: `Requests${requests.length ? ` (${requests.length})` : ''}` },
        ] as const).map((t) => (
          <TouchableOpacity key={t.key} style={[s.subTabItem, subTab === t.key && s.subTabItemActive]} onPress={() => setSubTab(t.key)}>
            <Text style={[s.subTabLabel, subTab === t.key && s.subTabLabelActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? <Loading /> : subTab === 'received' ? renderFeedbackList(received, 'chatbox-ellipses-outline', 'No feedback received yet', 'Praise and feedback from colleagues will show up here.')
        : subTab === 'given' ? renderFeedbackList(given, 'chatbox-ellipses-outline', "You haven't given any feedback yet", 'Recognize a colleague — tap "Give Feedback" above.')
        : requests.length === 0 ? <EmptyState icon="hand-left-outline" title="No pending requests" text="Feedback requests directed at you will show up here." />
        : (
          <View style={s.list}>
            {requests.map((r) => (
              <View key={r.id} style={s.card}>
                <Text style={s.cardDesc}><Text style={{ fontWeight: '700' }}>{r.to_profile ? fullName(r.to_profile) : 'Someone'}</Text> asked you for feedback</Text>
                <Text style={s.metaText}>{fmtDateTime(r.created_at)}</Text>
                <TextInput
                  style={[s.textArea, { marginTop: 10 }]}
                  placeholder="Write your feedback…" placeholderTextColor={C.muted}
                  multiline numberOfLines={3}
                  value={responseDraft[r.id] || ''}
                  onChangeText={(v) => setResponseDraft((d) => ({ ...d, [r.id]: v }))}
                />
                <TouchableOpacity style={[s.smallBtn, { marginTop: 8, alignSelf: 'flex-start' }]} onPress={() => respond(r)} disabled={respondingId === r.id}>
                  {respondingId === r.id ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.smallBtnText}>Submit</Text>}
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

      <Modal visible={showGive && !showGivePicker} animationType="slide" transparent>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={s.modalCard}>
            <View style={s.modalHandle} />
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Give Feedback</Text>
              <TouchableOpacity onPress={() => setShowGive(false)} style={s.closeBtn}><Ionicons name="close" size={20} color={C.muted} /></TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={s.formGroup}>
                <Text style={s.formLabel}>To *</Text>
                <TouchableOpacity style={s.select} onPress={() => setShowGivePicker(true)}>
                  <Text style={s.selectText}>
                    {giveForm.to_profile_id ? fullName(colleagues.find((c) => c.id === giveForm.to_profile_id)) : 'Select a colleague'}
                  </Text>
                  <Ionicons name="chevron-down" size={16} color={C.muted} />
                </TouchableOpacity>
              </View>
              <View style={s.formGroup}>
                <Text style={s.formLabel}>Type</Text>
                <View style={s.pillRow}>
                  {(['praise', 'feedback'] as const).map((t) => (
                    <TouchableOpacity key={t} style={[s.pillOpt, giveForm.type === t && { borderColor: C.primary, backgroundColor: C.primaryBg }]} onPress={() => setGiveForm((f) => ({ ...f, type: t }))}>
                      <Text style={[s.pillOptText, giveForm.type === t && { color: C.primary }]}>{t === 'praise' ? 'Praise' : 'Constructive Feedback'}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <View style={s.formGroup}>
                <Text style={s.formLabel}>Message *</Text>
                <TextInput style={s.textArea} multiline numberOfLines={4} value={giveForm.message} onChangeText={(v) => setGiveForm((f) => ({ ...f, message: v }))} placeholder="Write your message…" placeholderTextColor={C.muted} />
              </View>
              <View style={s.modalFooter}>
                <TouchableOpacity style={s.cancelBtn} onPress={() => setShowGive(false)}><Text style={s.cancelText}>Cancel</Text></TouchableOpacity>
                <TouchableOpacity style={[s.submitBtn, savingGive && { opacity: 0.6 }]} onPress={saveGive} disabled={savingGive}>
                  {savingGive ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.submitText}>Send</Text>}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <ColleaguePickerModal visible={showGivePicker} title="Select colleague" colleagues={colleagues} selected={giveForm.to_profile_id}
        onSelect={(id) => { setGiveForm((f) => ({ ...f, to_profile_id: id })); setShowGivePicker(false); }} onClose={() => setShowGivePicker(false)} />

      <Modal visible={showRequest && !showRequestPicker} animationType="slide" transparent>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={s.modalCard}>
            <View style={s.modalHandle} />
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Request Feedback</Text>
              <TouchableOpacity onPress={() => setShowRequest(false)} style={s.closeBtn}><Ionicons name="close" size={20} color={C.muted} /></TouchableOpacity>
            </View>
            <View style={s.formGroup}>
              <Text style={s.formLabel}>From *</Text>
              <TouchableOpacity style={s.select} onPress={() => setShowRequestPicker(true)}>
                <Text style={s.selectText}>{requestFrom ? fullName(colleagues.find((c) => c.id === requestFrom)) : 'Select (HR or Manager)'}</Text>
                <Ionicons name="chevron-down" size={16} color={C.muted} />
              </TouchableOpacity>
              <Text style={s.formHint}>They'll see this as a pending request under their Feedback → Requests tab.</Text>
            </View>
            <View style={s.modalFooter}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setShowRequest(false)}><Text style={s.cancelText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={[s.submitBtn, savingRequest && { opacity: 0.6 }]} onPress={saveRequest} disabled={savingRequest}>
                {savingRequest ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.submitText}>Send Request</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <ColleaguePickerModal visible={showRequestPicker} title="Select colleague" colleagues={colleagues} selected={requestFrom}
        onSelect={(id) => { setRequestFrom(id); setShowRequestPicker(false); }} onClose={() => setShowRequestPicker(false)} />
    </>
  );
}

// ── PIP tab (read-only self view) ─────────────────────────────────────────────
const PIP_GOAL_STATUS: Record<string, { color: string; bg: string }> = {
  Pending: { color: C.warning, bg: C.warningBg },
  Achieved: { color: C.success, bg: C.successBg },
  Missed: { color: C.danger, bg: C.dangerBg },
};

function PIPTab({ onRefresh }: { onRefresh: (fn: () => Promise<void>) => void }) {
  const { profile, tenant } = useAuth();
  const [pip, setPip] = useState<any>(null);
  const [checkins, setCheckins] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!tenant || !profile) return;
    const { data } = await getMyActivePip(tenant.id, profile.id);
    setPip(data);
    if (data) {
      const { data: ci } = await listPipCheckins(data.id);
      setCheckins(ci);
    } else {
      setCheckins([]);
    }
  }, [tenant, profile]);

  useForegroundRefresh(fetchData, setLoading);
  useEffect(() => { onRefresh(fetchData); }, [fetchData]);

  if (loading) return <Loading />;

  if (!pip) {
    return (
      <View style={s.emptyCard}>
        <View style={[s.emptyIconWrap, { backgroundColor: C.successBg }]}><Ionicons name="checkmark-circle" size={32} color={C.success} /></View>
        <Text style={s.emptyTitle}>You're on track</Text>
        <Text style={s.emptyText}>No Performance Improvement Plan required. Keep up the great work!</Text>
      </View>
    );
  }

  return (
    <View style={s.list}>
      <View style={s.card}>
        <View style={s.cardTop}>
          <Text style={s.cardTitle}>Performance Improvement Plan</Text>
          <View style={[s.badge, { backgroundColor: C.primaryBg }]}><Text style={[s.badgeText, { color: C.primary }]}>In Process</Text></View>
        </View>
        <Text style={s.metaText}>{fmtDate(pip.start_date)} → {fmtDate(pip.end_date)} · Manager: {pip.manager ? fullName(pip.manager) : '—'}</Text>
        <Text style={s.cardDesc}>{pip.reason}</Text>
      </View>

      <Text style={s.sectionLabel}>Goals</Text>
      {(pip.pip_goals || []).length === 0 ? (
        <Text style={s.kpiEmpty}>No goals set yet.</Text>
      ) : (pip.pip_goals || []).map((g: any) => {
        const gs = PIP_GOAL_STATUS[g.status] || PIP_GOAL_STATUS.Pending;
        return (
          <View key={g.id} style={s.card}>
            <View style={s.cardTop}>
              <Text style={s.cardTitle}>{g.title}</Text>
              <View style={[s.badge, { backgroundColor: gs.bg }]}><Text style={[s.badgeText, { color: gs.color }]}>{g.status}</Text></View>
            </View>
            {!!g.description && <Text style={s.cardDesc}>{g.description}</Text>}
            {!!g.target_date && <Text style={s.metaText}>Target: {fmtDate(g.target_date)}</Text>}
          </View>
        );
      })}

      <Text style={s.sectionLabel}>Check-ins</Text>
      {checkins.length === 0 ? (
        <Text style={s.kpiEmpty}>No check-ins yet.</Text>
      ) : checkins.map((c) => (
        <View key={c.id} style={s.checkinRow}>
          <Text style={s.metaText}>{c.author ? fullName(c.author) : ''} · {fmtDateTime(c.created_at)}</Text>
          <Text style={s.cardDesc}>{c.note}</Text>
        </View>
      ))}
    </View>
  );
}

// ── Reviews tab ────────────────────────────────────────────────────────────────
const REVIEW_STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  Completed: { bg: C.successBg, color: C.success },
  'In Progress': { bg: C.primaryBg, color: C.primary },
  'Not Started': { bg: C.border, color: C.muted },
};

function ReviewsTab({ onRefresh }: { onRefresh: (fn: () => Promise<void>) => void }) {
  const { profile, tenant } = useAuth();
  const [reviews, setReviews] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<any>(null);
  const [detailTab, setDetailTab] = useState<'questions' | 'kras'>('questions');
  const [answerDraft, setAnswerDraft] = useState<Record<string, { rating?: number | null; comment?: string }>>({});
  const [savingQ, setSavingQ] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!tenant || !profile) return;
    const { data, error } = await listMyReviews(tenant.id, profile.id);
    if (error) showToast(error.message || 'Failed to load reviews.', 'error');
    setReviews(data);
  }, [tenant, profile]);

  useForegroundRefresh(fetchData, setLoading);
  useEffect(() => { onRefresh(fetchData); }, [fetchData]);

  const openReview = async (r: any) => {
    setDetailTab('questions');
    setAnswerDraft({});
    const { data, error } = await getReviewDetail(r.id, profile!.id);
    if (error) return showToast('Failed to load review.', 'error');
    setDetail(data);
  };

  const refreshDetail = async () => {
    if (!detail) return;
    const { data } = await getReviewDetail(detail.review.id, profile!.id);
    setDetail(data);
    fetchData();
  };

  const readOnly = detail && detail.review.status === 'Completed';
  const existingSelfAnswer = (questionId: string) => (detail?.answers || []).find((a: any) => a.question_id === questionId && a.answered_by === profile?.id);
  const managerAnswer = (questionId: string) => (detail?.answers || []).find((a: any) => a.question_id === questionId && a.answered_by !== profile?.id);

  const saveAnswer = async (questionId: string) => {
    const draft = answerDraft[questionId] || {};
    const existing = existingSelfAnswer(questionId);
    setSavingQ(questionId);
    try {
      const { error } = await submitReviewAnswer({
        reviewId: detail.review.id, questionId, answeredBy: profile!.id,
        rating: draft.rating ?? existing?.rating ?? null,
        comment: draft.comment ?? existing?.comment ?? '',
      });
      if (error) return showToast('Failed: ' + error.message, 'error');
      showToast('Saved', 'success');
      refreshDetail();
    } finally {
      setSavingQ(null);
    }
  };

  if (loading) return <Loading />;

  return (
    <>
      {reviews.length === 0 ? (
        <EmptyState icon="star-outline" title="No reviews yet" text="Your performance review cycles will show up here." />
      ) : (
        <View style={s.list}>
          {reviews.map((r) => {
            const ss = REVIEW_STATUS_STYLE[r.status] || REVIEW_STATUS_STYLE['Not Started'];
            return (
              <TouchableOpacity key={r.id} style={s.card} onPress={() => openReview(r)} activeOpacity={0.8}>
                <View style={s.cardTop}>
                  <Text style={s.cardTitle}>{r.cycle?.name}</Text>
                  <View style={[s.badge, { backgroundColor: ss.bg }]}><Text style={[s.badgeText, { color: ss.color }]}>{r.status}</Text></View>
                </View>
                <Text style={s.metaText}>Manager: {r.reporting_manager ? fullName(r.reporting_manager) : '—'}</Text>
                {r.overall_rating != null && <RatingPill value={r.overall_rating} />}
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <Modal visible={!!detail} animationType="slide" transparent onRequestClose={() => setDetail(null)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalCard, { maxHeight: '92%' }]}>
            <View style={s.modalHandle} />
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>{detail?.review?.cycle?.name || 'Review'}</Text>
              <TouchableOpacity onPress={() => setDetail(null)} style={s.closeBtn}><Ionicons name="close" size={20} color={C.muted} /></TouchableOpacity>
            </View>
            {detail && (
              <>
                {detail.review.overall_rating != null && (
                  <View style={{ marginBottom: 12 }}><RatingPill value={detail.review.overall_rating} /></View>
                )}
                <View style={s.subTabRow}>
                  <TouchableOpacity style={[s.subTabItem, detailTab === 'questions' && s.subTabItemActive]} onPress={() => setDetailTab('questions')}>
                    <Text style={[s.subTabLabel, detailTab === 'questions' && s.subTabLabelActive]}>Questions ({detail.questions.length})</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.subTabItem, detailTab === 'kras' && s.subTabItemActive]} onPress={() => setDetailTab('kras')}>
                    <Text style={[s.subTabLabel, detailTab === 'kras' && s.subTabLabelActive]}>KRAs ({detail.kras.length})</Text>
                  </TouchableOpacity>
                </View>

                <ScrollView showsVerticalScrollIndicator={false}>
                  {detailTab === 'questions' ? (
                    detail.questions.length === 0 ? (
                      <Text style={s.kpiEmpty}>No questions defined for this cycle.</Text>
                    ) : detail.questions.map((q: any) => {
                      const selfAns = existingSelfAnswer(q.id);
                      const mgrAns = managerAnswer(q.id);
                      const d = answerDraft[q.id] || {};
                      return (
                        <View key={q.id} style={s.card}>
                          <Text style={s.cardTitle}>{q.question_text}</Text>
                          <View style={s.answerBox}>
                            <Text style={s.answerBoxLabel}>Your answer</Text>
                            {!readOnly ? (
                              <>
                                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                                  <TextInput
                                    style={s.ratingInput} keyboardType="numeric" maxLength={1} placeholder="1-5" placeholderTextColor={C.muted}
                                    defaultValue={selfAns?.rating != null ? String(selfAns.rating) : ''}
                                    onChangeText={(v) => setAnswerDraft((prev) => ({ ...prev, [q.id]: { ...prev[q.id], rating: v ? parseFloat(v) : null } }))}
                                  />
                                  <TextInput
                                    style={[s.textArea, { flex: 1, height: 56 }]} multiline
                                    defaultValue={selfAns?.comment ?? ''}
                                    onChangeText={(v) => setAnswerDraft((prev) => ({ ...prev, [q.id]: { ...prev[q.id], comment: v } }))}
                                    placeholder="Comment…" placeholderTextColor={C.muted}
                                  />
                                </View>
                                <TouchableOpacity style={[s.smallBtn, { marginTop: 8, alignSelf: 'flex-start' }]} onPress={() => saveAnswer(q.id)} disabled={savingQ === q.id}>
                                  {savingQ === q.id ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.smallBtnText}>Save</Text>}
                                </TouchableOpacity>
                              </>
                            ) : selfAns ? (
                              <Text style={s.cardDesc}>{selfAns.rating != null ? `${selfAns.rating}/5 · ` : ''}{selfAns.comment}</Text>
                            ) : <Text style={s.kpiEmpty}>No self-answer submitted.</Text>}
                          </View>
                          <View style={s.answerBox}>
                            <Text style={s.answerBoxLabel}>Manager</Text>
                            {mgrAns ? (
                              <Text style={s.cardDesc}>{mgrAns.rating != null ? `${mgrAns.rating}/5 · ` : ''}{mgrAns.comment}</Text>
                            ) : <Text style={s.kpiEmpty}>No manager answer yet.</Text>}
                          </View>
                        </View>
                      );
                    })
                  ) : (
                    detail.kras.length === 0 ? (
                      <Text style={s.kpiEmpty}>No KRAs defined.</Text>
                    ) : detail.kras.map((k: any) => {
                      const rating = (detail.kraRatings || []).find((r: any) => r.kra_id === k.id);
                      return (
                        <View key={k.id} style={s.card}>
                          <View style={s.cardTop}>
                            <Text style={s.cardTitle}>{k.title}</Text>
                            {!!k.weight && <Text style={s.metaText}>{k.weight}%</Text>}
                          </View>
                          <View style={{ marginVertical: 8 }}><ProgressBar value={k.progress_percent} /></View>
                          <View style={s.answerBox}>
                            <Text style={s.answerBoxLabel}>Manager feedback</Text>
                            {rating ? (
                              <Text style={s.cardDesc}>{rating.rating != null ? `${rating.rating}/5 · ` : ''}{rating.feedback_text}</Text>
                            ) : <Text style={s.kpiEmpty}>No feedback yet.</Text>}
                          </View>
                        </View>
                      );
                    })
                  )}
                </ScrollView>
              </>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

// ── 1:1s tab ─────────────────────────────────────────────────────────────────
const ONE_ON_ONE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ONE_ON_ONE_TIME_RE = /^\d{2}:\d{2}$/;
const EMPTY_MEETING_FORM = {
  participant_id: '', title: '1:1 Meeting', meeting_date: todayStr(),
  start_time: '', end_time: '', location: '', agenda_content: '',
};

function OneOnOnesTab({ onRefresh }: { onRefresh: (fn: () => Promise<void>) => void }) {
  const { tenant, profile } = useAuth();
  const [tab, setTab] = useState<'Upcoming' | 'Past'>('Upcoming');
  const [meetings, setMeetings] = useState<any[]>([]);
  const [colleagues, setColleagues] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_MEETING_FORM });
  const [saving, setSaving] = useState(false);
  const [showParticipantPicker, setShowParticipantPicker] = useState(false);

  const [detail, setDetail] = useState<any>(null);
  const [summaryDraft, setSummaryDraft] = useState('');

  const fetchData = useCallback(async () => {
    if (!tenant || !profile) return;
    const [{ data: mData }, { data: cData }] = await Promise.all([
      listMyMeetings(tenant.id, profile.id),
      listColleagues(tenant.id, profile.id),
    ]);
    setMeetings(mData || []);
    setColleagues(cData || []);
  }, [tenant, profile]);

  useForegroundRefresh(fetchData, setLoading);
  useEffect(() => { onRefresh(fetchData); }, [fetchData]);

  const openModal = () => { setForm({ ...EMPTY_MEETING_FORM, meeting_date: todayStr() }); setShowModal(true); };

  const save = async () => {
    if (!form.participant_id) { showToast('Select who this meeting is with.', 'error'); return; }
    if (!ONE_ON_ONE_DATE_RE.test(form.meeting_date)) { showToast('Meeting date must be YYYY-MM-DD.', 'error'); return; }
    if (form.start_time && !ONE_ON_ONE_TIME_RE.test(form.start_time)) { showToast('Start time must be HH:MM.', 'error'); return; }
    if (form.end_time && !ONE_ON_ONE_TIME_RE.test(form.end_time)) { showToast('End time must be HH:MM.', 'error'); return; }
    setSaving(true);
    try {
      const { error } = await scheduleMeeting({
        tenantId: tenant!.id,
        organizerId: profile!.id,
        participantId: form.participant_id,
        title: form.title.trim() || '1:1 Meeting',
        agendaContent: form.agenda_content.trim(),
        meetingDate: form.meeting_date,
        startTime: form.start_time || null,
        endTime: form.end_time || null,
        location: form.location.trim(),
      });
      if (error) { showToast('Failed: ' + error.message, 'error'); return; }
      showToast('1:1 meeting scheduled.', 'success');
      setShowModal(false);
      fetchData();
    } finally {
      setSaving(false);
    }
  };

  const openDetail = (meeting: any) => { setDetail(meeting); setSummaryDraft(meeting.summary || ''); };

  const cancelMeeting = async () => {
    const { error } = await updateMeetingStatus(detail.id, 'Cancelled');
    if (error) { showToast('Failed: ' + error.message, 'error'); return; }
    showToast('Meeting cancelled.', 'info');
    setDetail(null);
    fetchData();
  };

  const completeMeeting = async () => {
    const { error } = await addMeetingSummary(detail.id, summaryDraft.trim());
    if (error) { showToast('Failed: ' + error.message, 'error'); return; }
    showToast('Meeting marked completed.', 'success');
    setDetail(null);
    fetchData();
  };

  const filtered = meetings.filter((m) => (tab === 'Upcoming' ? m.status === 'Scheduled' : m.status !== 'Scheduled'));

  if (loading) return <Loading />;

  return (
    <>
      <View style={s.subTabRow}>
        {(['Upcoming', 'Past'] as const).map((t) => (
          <TouchableOpacity key={t} style={[s.subTabItem, tab === t && s.subTabItemActive]} onPress={() => setTab(t)}>
            <Text style={[s.subTabLabel, tab === t && s.subTabLabelActive]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={s.actionRow}>
        <TouchableOpacity style={s.primaryBtn} onPress={openModal} activeOpacity={0.85}>
          <Ionicons name="add" size={16} color="#fff" />
          <Text style={s.primaryBtnText}>Schedule 1:1</Text>
        </TouchableOpacity>
      </View>

      {filtered.length === 0 ? (
        <EmptyState icon="people-outline" title={`No ${tab.toLowerCase()} 1:1s`} text="1:1 meetings you organize or attend will show up here." />
      ) : (
        <View style={s.list}>
          {filtered.map((m) => {
            const other = m.organizer_id === profile?.id ? m.participant : m.organizer;
            const role = m.organizer_id === profile?.id ? 'Organizer' : 'Participant';
            const ss = m.status === 'Completed' ? { bg: C.successBg, color: C.success } : m.status === 'Cancelled' ? { bg: C.dangerBg, color: C.danger } : { bg: C.primaryBg, color: C.primary };
            return (
              <TouchableOpacity key={m.id} style={s.card} onPress={() => openDetail(m)} activeOpacity={0.8}>
                <View style={s.cardTop}>
                  <Text style={s.cardTitle}>{m.title}</Text>
                  <View style={[s.badge, { backgroundColor: C.border }]}><Text style={[s.badgeText, { color: C.muted }]}>{role}</Text></View>
                  <View style={[s.badge, { backgroundColor: ss.bg }]}><Text style={[s.badgeText, { color: ss.color }]}>{m.status}</Text></View>
                </View>
                <Text style={s.metaText}>
                  With {other ? fullName(other) : '—'} · {fmtDate(m.meeting_date)}{m.start_time ? ` · ${fmtTime12(m.start_time)}` : ''}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Schedule modal */}
      <Modal visible={showModal && !showParticipantPicker} animationType="slide" transparent onRequestClose={() => setShowModal(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <View style={s.modalHandle} />
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Schedule 1:1 Meeting</Text>
              <TouchableOpacity onPress={() => setShowModal(false)} style={s.closeBtn}><Ionicons name="close" size={20} color={C.muted} /></TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={s.formGroup}>
                <Text style={s.formLabel}>With *</Text>
                <TouchableOpacity style={s.select} onPress={() => setShowParticipantPicker(true)} activeOpacity={0.8}>
                  <Text style={s.selectText}>
                    {form.participant_id ? fullName(colleagues.find((c) => c.id === form.participant_id)) : 'Select a colleague'}
                  </Text>
                  <Ionicons name="chevron-down" size={16} color={C.muted} />
                </TouchableOpacity>
              </View>
              <View style={s.formGroup}>
                <Text style={s.formLabel}>Title</Text>
                <TextInput style={s.lineInput} value={form.title} onChangeText={(v) => setForm((f) => ({ ...f, title: v }))} />
              </View>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={[s.formGroup, { flex: 1 }]}>
                  <Text style={s.formLabel}>Date *</Text>
                  <TextInput style={s.lineInput} value={form.meeting_date} placeholder="YYYY-MM-DD" placeholderTextColor={C.muted}
                    keyboardType="numeric" maxLength={10} onChangeText={(v) => setForm((f) => ({ ...f, meeting_date: v }))} />
                </View>
                <View style={[s.formGroup, { flex: 1 }]}>
                  <Text style={s.formLabel}>Location</Text>
                  <TextInput style={s.lineInput} placeholder="Room / Meet link" placeholderTextColor={C.muted}
                    value={form.location} onChangeText={(v) => setForm((f) => ({ ...f, location: v }))} />
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={[s.formGroup, { flex: 1 }]}>
                  <Text style={s.formLabel}>Start Time</Text>
                  <TextInput style={s.lineInput} value={form.start_time} placeholder="HH:MM" placeholderTextColor={C.muted}
                    keyboardType="numeric" maxLength={5} onChangeText={(v) => setForm((f) => ({ ...f, start_time: v }))} />
                </View>
                <View style={[s.formGroup, { flex: 1 }]}>
                  <Text style={s.formLabel}>End Time</Text>
                  <TextInput style={s.lineInput} value={form.end_time} placeholder="HH:MM" placeholderTextColor={C.muted}
                    keyboardType="numeric" maxLength={5} onChangeText={(v) => setForm((f) => ({ ...f, end_time: v }))} />
                </View>
              </View>
              <View style={s.formGroup}>
                <Text style={s.formLabel}>Agenda</Text>
                <TextInput style={s.textArea} multiline placeholder="What do you want to discuss?" placeholderTextColor={C.muted}
                  value={form.agenda_content} onChangeText={(v) => setForm((f) => ({ ...f, agenda_content: v }))} />
              </View>
              <View style={s.modalFooter}>
                <TouchableOpacity style={s.cancelBtn} onPress={() => setShowModal(false)}>
                  <Text style={s.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.submitBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving} activeOpacity={0.85}>
                  {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.submitText}>Schedule</Text>}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <ColleaguePickerModal
        visible={showParticipantPicker} title="With" colleagues={colleagues} selected={form.participant_id}
        onSelect={(id) => { setForm((f) => ({ ...f, participant_id: id })); setShowParticipantPicker(false); }}
        onClose={() => setShowParticipantPicker(false)}
      />

      {/* Detail modal */}
      <Modal visible={!!detail} animationType="slide" transparent onRequestClose={() => setDetail(null)}>
        <View style={s.modalOverlay}>
          <View style={s.modalCard}>
            <View style={s.modalHandle} />
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>{detail?.title}</Text>
              <TouchableOpacity onPress={() => setDetail(null)} style={s.closeBtn}><Ionicons name="close" size={20} color={C.muted} /></TouchableOpacity>
            </View>
            {detail && (
              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={s.metaText}>
                  {fmtDate(detail.meeting_date)}{detail.start_time ? ` · ${fmtTime12(detail.start_time)}` : ''}{detail.location ? ` · ${detail.location}` : ''}
                </Text>
                {!!detail.agenda_content && (
                  <View style={{ marginTop: 14 }}>
                    <Text style={s.sectionLabel}>Agenda</Text>
                    <Text style={[s.cardDesc, { marginTop: 6 }]}>{detail.agenda_content}</Text>
                  </View>
                )}
                {detail.status === 'Completed' ? (
                  <View style={{ marginTop: 14 }}>
                    <Text style={s.sectionLabel}>Summary</Text>
                    <Text style={[s.cardDesc, { marginTop: 6 }]}>{detail.summary || '—'}</Text>
                  </View>
                ) : detail.status === 'Cancelled' ? (
                  <Text style={[s.metaText, { marginTop: 14 }]}>This meeting was cancelled.</Text>
                ) : (
                  <View style={{ marginTop: 14 }}>
                    <Text style={s.sectionLabel}>Mark Completed</Text>
                    <TextInput style={[s.textArea, { marginTop: 8 }]} multiline placeholder="Meeting summary / notes…" placeholderTextColor={C.muted}
                      value={summaryDraft} onChangeText={setSummaryDraft} />
                    <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                      <TouchableOpacity style={s.smallBtn} onPress={completeMeeting}>
                        <Text style={s.smallBtnText}>Mark Completed</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[s.smallBtn, { backgroundColor: C.dangerBg }]} onPress={cancelMeeting}>
                        <Text style={[s.smallBtnText, { color: C.danger }]}>Cancel Meeting</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

// ── Screen shell ────────────────────────────────────────────────────────────────
type TabKey = 'kras' | 'feedback' | 'pip' | 'reviews' | 'oneOnOnes';
const TABS: { key: TabKey; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'kras', label: 'KRAs', icon: 'flag-outline' },
  { key: 'feedback', label: 'Feedback', icon: 'chatbox-ellipses-outline' },
  { key: 'pip', label: 'PIP', icon: 'stats-chart-outline' },
  { key: 'reviews', label: 'Reviews', icon: 'star-outline' },
  { key: 'oneOnOnes', label: '1:1s', icon: 'people-outline' },
];

const FEATURE_KEY_BY_TAB: Record<TabKey, string> = {
  kras: 'performance_kras',
  feedback: 'performance_feedback',
  pip: 'performance_pip',
  reviews: 'performance_reviews',
  oneOnOnes: 'performance_one_on_ones',
};

export default function PerformanceScreen() {
  const { isEnabled } = useFeatures();
  const visibleTabs = TABS.filter((t) => isEnabled(FEATURE_KEY_BY_TAB[t.key]));
  const [activeTab, setActiveTab] = useState<TabKey>('kras');
  const [refreshing, setRefreshing] = useState(false);
  const refreshRefs = useRef<Record<TabKey, () => Promise<void>>>({
    kras: async () => {}, feedback: async () => {}, pip: async () => {}, reviews: async () => {}, oneOnOnes: async () => {},
  });

  useEffect(() => {
    if (!visibleTabs.some((t) => t.key === activeTab) && visibleTabs.length) setActiveTab(visibleTabs[0].key);
  }, [visibleTabs.map((t) => t.key).join(',')]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshRefs.current[activeTab]();
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <Text style={s.title}>Performance</Text>
        <Text style={s.subtitle}>Goals, feedback & growth</Text>
      </View>

      <View style={s.tabContainer}>
        {visibleTabs.map((t) => {
          const isActive = activeTab === t.key;
          return (
            <TouchableOpacity key={t.key} style={[s.tabItem, isActive && s.tabItemActive]} onPress={() => setActiveTab(t.key)} activeOpacity={0.8}>
              <Ionicons name={t.icon} size={15} color={isActive ? C.primary : C.muted} />
              <Text style={[s.tabLabel, isActive && s.tabLabelActive]}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView
        style={s.scroll} showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={C.primary} colors={[C.primary]} />}
      >
        {activeTab === 'kras' && <KRAsTab onRefresh={(fn) => { refreshRefs.current.kras = fn; }} />}
        {activeTab === 'feedback' && <FeedbackTab onRefresh={(fn) => { refreshRefs.current.feedback = fn; }} />}
        {activeTab === 'pip' && <PIPTab onRefresh={(fn) => { refreshRefs.current.pip = fn; }} />}
        {activeTab === 'reviews' && <ReviewsTab onRefresh={(fn) => { refreshRefs.current.reviews = fn; }} />}
        {activeTab === 'oneOnOnes' && <OneOnOnesTab onRefresh={(fn) => { refreshRefs.current.oneOnOnes = fn; }} />}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.dark },
  scroll: { flex: 1, backgroundColor: C.bg },
  header: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 14, backgroundColor: C.dark },
  title: { fontSize: 24, fontWeight: '900', color: '#fff' },
  subtitle: { fontSize: 13, color: 'rgba(255,255,255,0.4)', marginTop: 2 },
  tabContainer: { flexDirection: 'row', backgroundColor: C.dark, paddingHorizontal: 14, paddingBottom: 14, gap: 6 },
  tabItem: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    paddingVertical: 10, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  tabItemActive: { backgroundColor: C.primaryBg, borderColor: C.primary },
  tabLabel: { fontSize: 11.5, fontWeight: '600', color: C.muted },
  tabLabelActive: { color: C.primary },

  actionRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 14, paddingTop: 14 },
  outlineBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.5, borderColor: C.primary,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: C.primaryBg,
  },
  outlineBtnText: { color: C.primary, fontWeight: '700', fontSize: 13 },
  primaryBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: C.primary, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
    shadowColor: C.primary, shadowOpacity: 0.35, shadowRadius: 8, elevation: 4,
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  subTabRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 4 },
  subTabItem: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  subTabItemActive: { backgroundColor: C.primaryBg, borderColor: C.primary },
  subTabLabel: { fontSize: 12.5, fontWeight: '600', color: C.muted },
  subTabLabelActive: { color: C.primary },

  loadingBox: { padding: 60, alignItems: 'center' },
  emptyCard: {
    margin: 14, backgroundColor: C.surface, borderRadius: 20, padding: 40, alignItems: 'center', gap: 10,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, elevation: 3,
  },
  emptyIconWrap: { width: 68, height: 68, borderRadius: 22, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: C.text },
  emptyText: { fontSize: 13, color: C.muted, textAlign: 'center' },

  list: { padding: 14, gap: 12 },
  card: { backgroundColor: C.surface, borderRadius: 16, padding: 16, gap: 6, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, elevation: 3 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  cardTitle: { fontSize: 15, fontWeight: '700', color: C.text, flexShrink: 1 },
  cardDesc: { fontSize: 13, color: C.text, lineHeight: 19 },
  metaText: { fontSize: 12, color: C.muted },
  badge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  ratingPill: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', backgroundColor: '#FEF3C7', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  ratingPillText: { fontSize: 11.5, fontWeight: '700', color: '#B45309' },

  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  progressPct: { fontSize: 12, color: C.muted, minWidth: 34, textAlign: 'right', fontWeight: '600' },
  progressEditRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  progressInput: { borderWidth: 1.5, borderColor: C.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: C.text, width: 56, backgroundColor: '#FAFAFA' },
  progressInputSuffix: { fontSize: 13, color: C.muted },

  expandBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  expandBtnText: { fontSize: 12.5, fontWeight: '600', color: C.primary },
  kpiWrap: { marginTop: 8, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: C.border, gap: 8 },
  kpiRow: { gap: 2 },
  kpiTitle: { fontSize: 13, fontWeight: '600', color: C.text },
  kpiSub: { fontSize: 12, color: C.muted },
  kpiEmpty: { fontSize: 13, color: C.muted, paddingVertical: 6 },

  feedbackFrom: { fontSize: 13, fontWeight: '700', color: C.text },

  sectionLabel: { fontSize: 13, fontWeight: '700', color: C.text, marginTop: 4, marginBottom: -4 },
  checkinRow: { backgroundColor: C.surface, borderRadius: 14, padding: 14, gap: 4 },

  smallBtn: { backgroundColor: C.primary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, alignItems: 'center', justifyContent: 'center' },
  smallBtnText: { color: '#fff', fontWeight: '700', fontSize: 12.5 },

  answerBox: { marginTop: 10, padding: 10, borderRadius: 10, backgroundColor: '#FAFAFA' },
  answerBoxLabel: { fontSize: 11, fontWeight: '700', color: C.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.3 },
  ratingInput: { borderWidth: 1.5, borderColor: C.border, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13, color: C.text, width: 56, backgroundColor: '#fff' },

  // Modals
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: C.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, maxHeight: '90%' },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center', marginBottom: 16 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
  modalTitle: { fontSize: 17, fontWeight: '800', color: C.text, flexShrink: 1 },
  closeBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  formGroup: { marginBottom: 14 },
  formLabel: { fontSize: 13, fontWeight: '600', color: C.text, marginBottom: 7 },
  formHint: { fontSize: 12, color: C.muted, marginTop: 6 },
  select: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 1.5, borderColor: C.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13, backgroundColor: '#FAFAFA',
  },
  selectText: { flex: 1, fontSize: 14, color: C.text, fontWeight: '500' },
  textArea: { borderWidth: 1.5, borderColor: C.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: C.text, backgroundColor: '#FAFAFA', height: 88, textAlignVertical: 'top' },
  lineInput: { borderWidth: 1.5, borderColor: C.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: C.text, backgroundColor: '#FAFAFA' },
  pillRow: { flexDirection: 'row', gap: 8 },
  pillOpt: { flex: 1, borderWidth: 1.5, borderColor: C.border, borderRadius: 12, paddingVertical: 10, alignItems: 'center', backgroundColor: '#FAFAFA' },
  pillOptText: { fontSize: 12.5, fontWeight: '600', color: C.muted },
  modalFooter: { flexDirection: 'row', gap: 12, marginTop: 8, paddingBottom: 12 },
  cancelBtn: { flex: 1, borderWidth: 1.5, borderColor: C.border, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  cancelText: { fontSize: 14, fontWeight: '600', color: C.muted },
  submitBtn: { flex: 1, backgroundColor: C.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', shadowColor: C.primary, shadowOpacity: 0.35, shadowRadius: 10, elevation: 5 },
  submitText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  pickerCard: {
    alignSelf: 'center', backgroundColor: C.surface, borderRadius: 24, padding: 20, width: '85%', maxWidth: 340,
    marginTop: 'auto', marginBottom: 'auto', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 24, elevation: 12,
  },
  pickerTitle: { fontSize: 16, fontWeight: '800', color: C.text, marginBottom: 14 },
  pickerItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 10, borderRadius: 12 },
  pickerText: { flex: 1, fontSize: 14, color: C.text },
});
