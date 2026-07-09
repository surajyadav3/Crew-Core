import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const ROUTE_BY_TYPE: Record<string, string> = {
  policy: '/(tabs)/notices',
  announcement: '/(tabs)/notices',
  leave_approved: '/(tabs)/leaves',
  leave_rejected: '/(tabs)/leaves',
  clock_in: '/(tabs)/attendance',
  clock_out: '/(tabs)/attendance',
};

let navigationReady = false;
let pendingRoute: string | null = null;

function goTo(route: string) {
  if (navigationReady) {
    router.push(route as any);
  } else {
    // Navigator isn't mounted yet (e.g. app cold-started by tapping a
    // notification) — queue it and flush once markNavigationReady() runs.
    pendingRoute = route;
  }
}

// Call this once expo-router's navigation state is ready (see app/_layout.tsx).
export function markNavigationReady() {
  navigationReady = true;
  if (pendingRoute) {
    const route = pendingRoute;
    pendingRoute = null;
    router.push(route as any);
  }
}

// Presents an immediate system notification (Android notification tray / iOS banner),
// as opposed to an in-app toast or banner. `data.type` drives the tap-to-navigate
// routing in ROUTE_BY_TYPE above.
export async function presentLocalNotification(
  title: string,
  body: string,
  data?: Record<string, unknown>
) {
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data },
    trigger: null,
  });
}

export function initNotificationResponseListener() {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const type = response.notification.request.content.data?.type as string | undefined;
    const route = type ? ROUTE_BY_TYPE[type] : undefined;
    if (route) goTo(route);
  });
  return () => subscription.remove();
}
