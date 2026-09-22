import { Redirect } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { View, ActivityIndicator, StyleSheet } from 'react-native';

export default function Index() {
  const { user, profile, loading } = useAuth();

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#00AEEF" />
      </View>
    );
  }

  if (!user) return <Redirect href={'/login' as any} />;
  if (!profile) return <Redirect href={'/register' as any} />;
  return <Redirect href={'/(tabs)' as any} />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8FAFC' },
});
