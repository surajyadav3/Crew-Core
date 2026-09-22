import { useCallback } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

/**
 * Refetches whenever this screen gains focus (like useFocusEffect) AND
 * whenever the app returns to the foreground while this screen stays
 * focused — e.g. after being locked or task-switched without navigating
 * away. Plain useFocusEffect only fires on a focus *transition*, so a
 * backgrounded-then-resumed screen was left showing whatever it had
 * fetched before backgrounding (stale attendance/leave/payslip data,
 * sometimes hours old) until the user manually pulled to refresh or
 * switched tabs and back.
 */
export function useForegroundRefresh(fetchData: () => Promise<any> | void, setLoading?: (v: boolean) => void) {
  useFocusEffect(
    useCallback(() => {
      setLoading?.(true);
      Promise.resolve(fetchData()).finally(() => setLoading?.(false));

      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') fetchData();
      });
      return () => sub.remove();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fetchData])
  );
}
