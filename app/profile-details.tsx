import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import {
  getMyProfileDetails, upsertProfileDetails,
  EMPTY_PROFILE_DETAILS, ProfileDetails, EmergencyContact, EducationEntry, ExperienceEntry,
} from '@/services/profileDetailsService';
import { showToast } from '@/components/Toast';
import { Colors as C } from '@/constants/Colors';

function Field({ label, value, onChangeText, placeholder, keyboardType, multiline }: any) {
  return (
    <View style={s.formGroup}>
      <Text style={s.formLabel}>{label}</Text>
      <TextInput
        style={[s.input, multiline && s.textarea]} value={value ?? ''} onChangeText={onChangeText}
        placeholder={placeholder} placeholderTextColor={C.muted} keyboardType={keyboardType}
        multiline={multiline} numberOfLines={multiline ? 3 : 1}
      />
    </View>
  );
}

function SectionTitle({ icon, title }: { icon: keyof typeof Ionicons.glyphMap; title: string }) {
  return (
    <View style={s.sectionTitleRow}>
      <Ionicons name={icon} size={16} color={C.primary} />
      <Text style={s.sectionTitle}>{title}</Text>
    </View>
  );
}

export default function ProfileDetailsScreen() {
  const router = useRouter();
  const { profile, tenant } = useAuth();
  const [form, setForm] = useState<ProfileDetails>({ ...EMPTY_PROFILE_DETAILS });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!profile) return;
    getMyProfileDetails(profile.id).then(({ data, error }) => {
      if (error) showToast(error.message || 'Could not load your details.', 'error');
      else if (data) setForm(data as ProfileDetails);
      setLoading(false);
    });
  }, [profile]);

  const set = useCallback(<K extends keyof ProfileDetails>(key: K, value: ProfileDetails[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  }, []);

  const setAddr = (which: 'current_address' | 'permanent_address', key: string, value: string) => {
    setForm((f) => ({ ...f, [which]: { ...(f[which] || {}), [key]: value } }));
  };

  const addContact = () => set('emergency_contacts', [...(form.emergency_contacts || []), { name: '', relationship: '', phone: '' }]);
  const updContact = (idx: number, patch: Partial<EmergencyContact>) =>
    set('emergency_contacts', form.emergency_contacts.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  const rmContact = (idx: number) => set('emergency_contacts', form.emergency_contacts.filter((_, i) => i !== idx));

  const addEducation = () => set('education', [...(form.education || []), { institution: '', degree: '', year: '' }]);
  const updEducation = (idx: number, patch: Partial<EducationEntry>) =>
    set('education', form.education.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  const rmEducation = (idx: number) => set('education', form.education.filter((_, i) => i !== idx));

  const addExperience = () => set('experience', [...(form.experience || []), { company: '', role: '', duration: '' }]);
  const updExperience = (idx: number, patch: Partial<ExperienceEntry>) =>
    set('experience', form.experience.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  const rmExperience = (idx: number) => set('experience', form.experience.filter((_, i) => i !== idx));

  const handleSave = async () => {
    if (!tenant || !profile) { showToast('Account setup incomplete.', 'error'); return; }
    setSaving(true);
    try {
      const { profile_id, ...payload } = form;
      // date_of_birth is a `date`-typed column — Postgres rejects '' with a
      // 400 ("invalid input syntax for type date"), so an untouched (empty)
      // field must go over the wire as null, not the form's default ''.
      const { error } = await upsertProfileDetails(tenant.id, profile.id, {
        ...payload,
        date_of_birth: payload.date_of_birth || null,
      });
      if (error) throw error;
      showToast('Details saved!', 'success');
      router.back();
    } catch (err: any) {
      showToast('Failed: ' + (err.message || 'Something went wrong'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
          <Ionicons name="arrow-back" size={20} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Profile Details</Text>
          <Text style={s.subtitle}>Personal info only you can edit</Text>
        </View>
      </View>

      {loading ? (
        <View style={s.loadingBox}><ActivityIndicator color={C.primary} size="large" /></View>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView style={s.scroll} contentContainerStyle={{ padding: 14, paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
            <SectionTitle icon="person-outline" title="Personal" />
            <View style={s.card}>
              <Field label="Date of Birth" value={form.date_of_birth} placeholder="YYYY-MM-DD"
                onChangeText={(v: string) => set('date_of_birth', v)} keyboardType="numeric" />
              <View style={s.row}>
                <View style={{ flex: 1 }}><Field label="Gender" value={form.gender} placeholder="e.g. Male" onChangeText={(v: string) => set('gender', v)} /></View>
                <View style={{ flex: 1 }}><Field label="Blood Group" value={form.blood_group} placeholder="e.g. O+" onChangeText={(v: string) => set('blood_group', v)} /></View>
              </View>
              <View style={s.row}>
                <View style={{ flex: 1 }}><Field label="Marital Status" value={form.marital_status} placeholder="e.g. Single" onChangeText={(v: string) => set('marital_status', v)} /></View>
                <View style={{ flex: 1 }}><Field label="Nationality" value={form.nationality} placeholder="India" onChangeText={(v: string) => set('nationality', v)} /></View>
              </View>
              <View style={s.switchRow}>
                <Text style={s.formLabel}>Physically Handicapped</Text>
                <Switch value={form.physically_handicapped} onValueChange={(v) => set('physically_handicapped', v)} trackColor={{ true: C.primary }} />
              </View>
            </View>

            <SectionTitle icon="call-outline" title="Contact" />
            <View style={s.card}>
              <Field label="Personal Email" value={form.personal_email} placeholder="you@personal.com" keyboardType="email-address"
                onChangeText={(v: string) => set('personal_email', v)} />
              <View style={s.row}>
                <View style={{ flex: 1 }}><Field label="Work Number" value={form.work_number} placeholder="Alt. work number" keyboardType="phone-pad" onChangeText={(v: string) => set('work_number', v)} /></View>
                <View style={{ flex: 1 }}><Field label="Residence Number" value={form.residence_number} placeholder="Home number" keyboardType="phone-pad" onChangeText={(v: string) => set('residence_number', v)} /></View>
              </View>
            </View>

            <SectionTitle icon="home-outline" title="Current Address" />
            <View style={s.card}>
              <Field label="Address Line 1" value={form.current_address?.line1} onChangeText={(v: string) => setAddr('current_address', 'line1', v)} />
              <Field label="Address Line 2" value={form.current_address?.line2} onChangeText={(v: string) => setAddr('current_address', 'line2', v)} />
              <View style={s.row}>
                <View style={{ flex: 1 }}><Field label="City" value={form.current_address?.city} onChangeText={(v: string) => setAddr('current_address', 'city', v)} /></View>
                <View style={{ flex: 1 }}><Field label="State" value={form.current_address?.state} onChangeText={(v: string) => setAddr('current_address', 'state', v)} /></View>
                <View style={{ flex: 1 }}><Field label="Pincode" value={form.current_address?.pincode} keyboardType="numeric" onChangeText={(v: string) => setAddr('current_address', 'pincode', v)} /></View>
              </View>
            </View>

            <SectionTitle icon="business-outline" title="Permanent Address" />
            <View style={s.card}>
              <Field label="Address Line 1" value={form.permanent_address?.line1} onChangeText={(v: string) => setAddr('permanent_address', 'line1', v)} />
              <Field label="Address Line 2" value={form.permanent_address?.line2} onChangeText={(v: string) => setAddr('permanent_address', 'line2', v)} />
              <View style={s.row}>
                <View style={{ flex: 1 }}><Field label="City" value={form.permanent_address?.city} onChangeText={(v: string) => setAddr('permanent_address', 'city', v)} /></View>
                <View style={{ flex: 1 }}><Field label="State" value={form.permanent_address?.state} onChangeText={(v: string) => setAddr('permanent_address', 'state', v)} /></View>
                <View style={{ flex: 1 }}><Field label="Pincode" value={form.permanent_address?.pincode} keyboardType="numeric" onChangeText={(v: string) => setAddr('permanent_address', 'pincode', v)} /></View>
              </View>
            </View>

            <SectionTitle icon="chatbubble-ellipses-outline" title="About" />
            <View style={s.card}>
              <Field label="About Me" value={form.about_me} multiline placeholder="A short intro…" onChangeText={(v: string) => set('about_me', v)} />
              <Field label="About My Job" value={form.about_job} multiline placeholder="What you do day to day…" onChangeText={(v: string) => set('about_job', v)} />
              <Field label="Hobbies" value={form.hobbies} placeholder="e.g. Reading, cricket" onChangeText={(v: string) => set('hobbies', v)} />
            </View>

            <SectionTitle icon="alert-circle-outline" title="Emergency Contacts" />
            {(form.emergency_contacts || []).map((c, idx) => (
              <View key={idx} style={s.card}>
                <View style={s.itemHeader}>
                  <Text style={s.itemLabel}>Contact {idx + 1}</Text>
                  <TouchableOpacity onPress={() => rmContact(idx)}><Ionicons name="close-circle" size={18} color={C.danger} /></TouchableOpacity>
                </View>
                <Field label="Name" value={c.name} onChangeText={(v: string) => updContact(idx, { name: v })} />
                <View style={s.row}>
                  <View style={{ flex: 1 }}><Field label="Relationship" value={c.relationship} onChangeText={(v: string) => updContact(idx, { relationship: v })} /></View>
                  <View style={{ flex: 1 }}><Field label="Phone" value={c.phone} keyboardType="phone-pad" onChangeText={(v: string) => updContact(idx, { phone: v })} /></View>
                </View>
              </View>
            ))}
            <TouchableOpacity style={s.addBtn} onPress={addContact}>
              <Ionicons name="add" size={16} color={C.primary} /><Text style={s.addBtnText}>Add emergency contact</Text>
            </TouchableOpacity>

            <SectionTitle icon="school-outline" title="Education" />
            {(form.education || []).map((e, idx) => (
              <View key={idx} style={s.card}>
                <View style={s.itemHeader}>
                  <Text style={s.itemLabel}>Education {idx + 1}</Text>
                  <TouchableOpacity onPress={() => rmEducation(idx)}><Ionicons name="close-circle" size={18} color={C.danger} /></TouchableOpacity>
                </View>
                <Field label="Institution" value={e.institution} onChangeText={(v: string) => updEducation(idx, { institution: v })} />
                <View style={s.row}>
                  <View style={{ flex: 1 }}><Field label="Degree" value={e.degree} onChangeText={(v: string) => updEducation(idx, { degree: v })} /></View>
                  <View style={{ flex: 1 }}><Field label="Year" value={e.year} keyboardType="numeric" onChangeText={(v: string) => updEducation(idx, { year: v })} /></View>
                </View>
              </View>
            ))}
            <TouchableOpacity style={s.addBtn} onPress={addEducation}>
              <Ionicons name="add" size={16} color={C.primary} /><Text style={s.addBtnText}>Add education</Text>
            </TouchableOpacity>

            <SectionTitle icon="briefcase-outline" title="Experience" />
            {(form.experience || []).map((e, idx) => (
              <View key={idx} style={s.card}>
                <View style={s.itemHeader}>
                  <Text style={s.itemLabel}>Experience {idx + 1}</Text>
                  <TouchableOpacity onPress={() => rmExperience(idx)}><Ionicons name="close-circle" size={18} color={C.danger} /></TouchableOpacity>
                </View>
                <Field label="Company" value={e.company} onChangeText={(v: string) => updExperience(idx, { company: v })} />
                <View style={s.row}>
                  <View style={{ flex: 1 }}><Field label="Role" value={e.role} onChangeText={(v: string) => updExperience(idx, { role: v })} /></View>
                  <View style={{ flex: 1 }}><Field label="Duration" value={e.duration} placeholder="e.g. 2021–2023" onChangeText={(v: string) => updExperience(idx, { duration: v })} /></View>
                </View>
              </View>
            ))}
            <TouchableOpacity style={s.addBtn} onPress={addExperience}>
              <Ionicons name="add" size={16} color={C.primary} /><Text style={s.addBtnText}>Add experience</Text>
            </TouchableOpacity>
          </ScrollView>

          <View style={s.footer}>
            <TouchableOpacity style={[s.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving} activeOpacity={0.85}>
              {saving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.saveBtnText}>Save Details</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.dark },
  scroll: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14, backgroundColor: C.dark },
  backBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '900', color: '#fff' },
  subtitle: { fontSize: 12.5, color: 'rgba(255,255,255,0.4)', marginTop: 1 },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 6, marginBottom: 8, paddingHorizontal: 2 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: C.text, textTransform: 'uppercase', letterSpacing: 0.3 },
  card: { backgroundColor: C.surface, borderRadius: 16, padding: 14, marginBottom: 14, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  formGroup: { marginBottom: 12 },
  formLabel: { fontSize: 12.5, fontWeight: '600', color: C.text, marginBottom: 6 },
  input: { borderWidth: 1.5, borderColor: C.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13.5, color: C.text, backgroundColor: '#FAFAFA' },
  textarea: { height: 64, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: 10 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  itemLabel: { fontSize: 11.5, fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.3 },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1.5, borderColor: C.primary, borderStyle: 'dashed', borderRadius: 12, paddingVertical: 11, marginBottom: 16 },
  addBtnText: { fontSize: 13, color: C.primary, fontWeight: '700' },
  footer: { padding: 14, paddingBottom: 20, backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.border },
  saveBtn: { backgroundColor: C.primary, borderRadius: 16, paddingVertical: 15, alignItems: 'center', shadowColor: C.primary, shadowOpacity: 0.35, shadowRadius: 12, elevation: 6 },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
