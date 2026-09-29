import { Redirect } from 'expo-router';
import { useAuth } from '@/context/AuthContext';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import ConnectingScreen from '@/components/ConnectingScreen';

export default function Index() {
  const { user, profile, loading, profileStatus } = useAuth();

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#00AEEF" />
      </View>
    );
  }

  if (!user) return <Redirect href={'/login' as any} />;
  // Only a server-confirmed "no profile" means registration; a profile that
  // just couldn't load (offline) keeps the user signed in.
  if (!profile) return profileStatus === 'missing' ? <Redirect href={'/register' as any} /> : <ConnectingScreen />;
  return <Redirect href={'/(tabs)' as any} />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8FAFC' },
});
