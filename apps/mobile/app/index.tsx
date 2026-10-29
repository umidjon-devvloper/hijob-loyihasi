import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Redirect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../src/store/auth';
import { Logo } from '../src/components/Logo';
import { useTheme } from '../src/theme/ThemeProvider';

export default function Splash() {
  const { isLoading, isAuthed, user } = useAuth();
  const { colors } = useTheme();

  useEffect(() => {
    // Give the splash a beat so the user sees the brand.
    const t = setTimeout(() => {}, 500);
    return () => clearTimeout(t);
  }, []);

  if (!isLoading) {
    if (!isAuthed) return <Redirect href="/(auth)/welcome" />;
    // Everyone — buyers, sellers, admins — lands on the buyer home by
    // default. Sellers and admins open the seller dashboard explicitly
    // from the role-switcher in the top-left menu. This lets one demo
    // account (and real sellers who also browse) use both sides without
    // a forced redirect.
    const needsFace = !user?.onboarding?.faceCaptured;
    const needsBody = !user?.onboarding?.bodyProvided;
    // Seller / admin accounts skip the face/body onboarding (it's a
    // buyer try-on step). Buyers still get it on their first visit.
    const isSellerOrAdmin = user?.role === 'seller' || user?.role === 'admin';
    if (!isSellerOrAdmin) {
      if (needsBody) return <Redirect href="/(onboarding)/body" />;
      if (needsFace) return <Redirect href="/(onboarding)/face" />;
    }
    return <Redirect href="/(tabs)/home" />;
  }

  return (
    <LinearGradient
      colors={[colors.oliveDark, colors.olive, colors.oliveSoft]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
    >
      <View style={{ alignItems: 'center', gap: 32 }}>
        <Logo size={160} />
        <ActivityIndicator color={colors.goldSoft} />
      </View>
    </LinearGradient>
  );
}
