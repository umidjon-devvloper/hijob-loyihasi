import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { api } from '../api/client';

/**
 * Foreground presentation — always show the banner so a seller doesn't
 * miss a new-order push while the shop app is open on their phone.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Umumiy',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#C9A96E',
  });
}

/**
 * Request permission, read the Expo push token, and register it with
 * the backend so /push/send can target this device. Call it right
 * after the user logs in — the token is tied to the current session.
 *
 * Returns the token on success, null on simulator / denied permission.
 */
export async function registerPushToken(): Promise<string | null> {
  if (!Device.isDevice) {
    // Simulators can't receive push notifications; skip quietly.
    return null;
  }

  await ensureAndroidChannel();

  const { status: existing } = await Notifications.getPermissionsAsync();
  let final = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    final = status;
  }
  if (final !== 'granted') return null;

  // EAS build uses the project id from app.json's extra. Guard against
  // missing config so a dev launch doesn't throw before login.
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;

  let token: string | null = null;
  try {
    const resp = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    token = resp.data;
  } catch {
    return null;
  }
  if (!token) return null;

  try {
    await api.post('/push/register', {
      token,
      platform: Platform.OS,
    });
  } catch {
    // If the backend is down we still return the token so the caller can
    // try again later; the server-side register endpoint is idempotent.
  }
  return token;
}

/**
 * Attach listeners for foreground notifications and tap handlers. Call
 * once at app launch; returns a cleanup to remove the subscriptions.
 */
export function attachPushListeners(onTap?: (data: Record<string, any>) => void) {
  const received = Notifications.addNotificationReceivedListener(() => {
    // Reserved: refresh in-app badges / inbox from here if needed.
  });
  const responded = Notifications.addNotificationResponseReceivedListener(
    (resp) => {
      const data = resp.notification.request.content.data ?? {};
      onTap?.(data as Record<string, any>);
    },
  );
  return () => {
    received.remove();
    responded.remove();
  };
}
