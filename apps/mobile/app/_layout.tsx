import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { Stack as ExpoStack } from 'expo-router';
import { ThemeProvider } from '../src/theme/ThemeProvider';
import { initI18n } from '../src/i18n/i18n';
import { useAuth } from '../src/store/auth';
import { useTryonOnboarding } from '../src/store/tryon-onboarding';
import { useTryonCollection } from '../src/store/tryon-collection';
import { registerPushToken, attachPushListeners } from '../src/lib/push';
import { router } from 'expo-router';
// Side-effect import: patches Alert.alert to be nil-safe (iOS 26 crash fix).
import '../src/lib/safe-alert';

SplashScreen.preventAutoHideAsync().catch(() => {});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

export default function RootLayout() {
  const [i18nReady, setI18nReady] = useState(false);
  const hydrate = useAuth((s) => s.hydrate);
  const isAuthed = useAuth((s) => s.isAuthed);
  const hydrateTryon = useTryonOnboarding((s) => s.hydrate);
  const hydrateTryonCollection = useTryonCollection((s) => s.hydrate);

  const [fontsLoaded] = useFonts({
    'PlayfairDisplay': require('../assets/fonts/PlayfairDisplay.ttf'),
    'Inter': require('../assets/fonts/Inter.ttf'),
  });

  useEffect(() => {
    initI18n().then(() => setI18nReady(true));
    hydrate();
    hydrateTryon();
    hydrateTryonCollection();
  }, [hydrate, hydrateTryon, hydrateTryonCollection]);

  useEffect(() => {
    if (fontsLoaded && i18nReady) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded, i18nReady]);

  // Push notifications — register the token once we know the user is
  // signed in, and route to the right screen when they tap a push.
  useEffect(() => {
    if (!isAuthed) return;
    registerPushToken().catch(() => {});
    const detach = attachPushListeners((data) => {
      // seller_new | chat_message | order_update → open the right place.
      try {
        if (data?.kind === 'seller_new' && data?.orderId) {
          router.push('/(seller-tabs)/orders' as any);
        } else if (data?.kind === 'chat_message' && data?.chatId) {
          router.push({ pathname: '/chat/[id]', params: { id: String(data.chatId) } } as any);
        } else if (data?.orderId) {
          router.push('/orders' as any);
        } else {
          router.push('/notifications' as any);
        }
      } catch {}
    });
    return detach;
  }, [isAuthed]);

  if (!fontsLoaded || !i18nReady) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="(onboarding)" />
              <Stack.Screen name="(tryon-onboarding)" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="(seller-tabs)" />
              <Stack.Screen name="search" options={{ animation: 'slide_from_right' }} />
              <Stack.Screen name="wishlist" options={{ animation: 'slide_from_right' }} />
              <Stack.Screen name="checkout" options={{ animation: 'slide_from_right' }} />
              <Stack.Screen name="notifications" options={{ animation: 'slide_from_right' }} />
              <Stack.Screen name="settings" options={{ animation: 'slide_from_right' }} />
              <Stack.Screen name="terms" options={{ animation: 'slide_from_right' }} />
              <Stack.Screen name="privacy" options={{ animation: 'slide_from_right' }} />
              <Stack.Screen name="role-switcher" options={{ animation: 'fade' }} />
            </Stack>
          </ThemeProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
