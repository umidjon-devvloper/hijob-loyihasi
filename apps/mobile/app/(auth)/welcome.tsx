import { Dimensions, View, Pressable, Text as RNText } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import { Text } from '../../src/components/Text';
import { Logo } from '../../src/components/Logo';
import { useTheme } from '../../src/theme/ThemeProvider';

const { width: SCREEN_W } = Dimensions.get('window');
const CIRCLE_SIZE = SCREEN_W * 0.68;

export default function WelcomeScreen() {
  const { colors, theme, scheme } = useTheme();
  const router = useRouter();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />

      {/* Background gold curves */}
      <Svg
        width={SCREEN_W}
        height="100%"
        style={{ position: 'absolute', top: 0, left: 0 }}
        viewBox={`0 0 ${SCREEN_W} 844`}
        preserveAspectRatio="xMidYMid slice"
      >
        <Defs>
          <LinearGradient id="gGold" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={colors.gold} stopOpacity={0.5} />
            <Stop offset="50%" stopColor={colors.goldSoft} stopOpacity={0.7} />
            <Stop offset="100%" stopColor={colors.gold} stopOpacity={0.3} />
          </LinearGradient>
        </Defs>
        <Path
          d={`M-20 0C30 120 10 250 40 400C70 550 20 680 -10 844`}
          stroke="url(#gGold)"
          strokeWidth={0.8}
          fill="none"
          opacity={0.35}
        />
        <Path
          d={`M-10 0C40 130 20 260 50 410C80 560 30 690 0 844`}
          stroke="url(#gGold)"
          strokeWidth={0.5}
          fill="none"
          opacity={0.2}
        />
        <Path
          d={`M${SCREEN_W + 20} 100C${SCREEN_W - 30} 250 ${SCREEN_W - 10} 380 ${SCREEN_W - 40} 500C${SCREEN_W - 70} 620 ${SCREEN_W - 20} 720 ${SCREEN_W + 10} 844`}
          stroke="url(#gGold)"
          strokeWidth={0.6}
          fill="none"
          opacity={0.2}
        />
      </Svg>

      <SafeAreaView
        edges={['top', 'bottom']}
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 40,
          paddingTop: 24,
          paddingBottom: 40,
        }}
      >
        <View />

        <View style={{ alignItems: 'center', gap: 20 }}>
          {/* Logo */}
          <View style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 16, elevation: 8 }}>
            <Logo size={80} />
          </View>

          {/* Brand Name */}
          <View style={{ alignItems: 'center' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <View style={{ width: 5, height: 5, backgroundColor: colors.gold, transform: [{ rotate: '45deg' }], opacity: 0.6 }} />
              <RNText
                style={{
                  fontFamily: theme.fontFamilies.body,
                  fontSize: 13,
                  color: colors.muted,
                  letterSpacing: 3,
                  textTransform: 'uppercase',
                }}
              >
                Islamic Fashion
              </RNText>
              <View style={{ width: 5, height: 5, backgroundColor: colors.gold, transform: [{ rotate: '45deg' }], opacity: 0.6 }} />
            </View>
          </View>

          {/* Hero: Circle frame + woman photo */}
          <View style={{ width: CIRCLE_SIZE + 20, height: CIRCLE_SIZE + 20, alignItems: 'center', justifyContent: 'center' }}>
            {/* Woman photo clipped to circle */}
            <View
              style={{
                position: 'absolute',
                width: CIRCLE_SIZE - 24,
                height: CIRCLE_SIZE - 24,
                borderRadius: (CIRCLE_SIZE - 24) / 2,
                overflow: 'hidden',
              }}
            >
              <Image
                source={require('../../assets/welcome-woman.webp')}
                style={{ width: '100%', height: '100%' }}
                contentFit="cover"
                contentPosition={{ top: '20%' }}
              />
            </View>

            {/* Gold frame overlay */}
            <Image
              source={require('../../assets/welcome-frame.webp')}
              style={{
                position: 'absolute',
                width: CIRCLE_SIZE + 20,
                height: CIRCLE_SIZE + 20,
              }}
              contentFit="contain"
            />

            {/* Gold sparkle */}
            <View style={{ position: 'absolute', top: -2, right: 20 }}>
              <Svg width={18} height={18} viewBox="0 0 18 18" fill="none">
                <Path d="M9 0L10.8 6.5L18 9L10.8 11.5L9 18L7.2 11.5L0 9L7.2 6.5L9 0Z" fill={colors.gold} />
              </Svg>
            </View>

            {/* Virtual Try-On badge */}
            <View
              style={{
                position: 'absolute',
                bottom: 8,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                backgroundColor: 'rgba(250,246,234,0.92)',
                borderRadius: 20,
                paddingVertical: 8,
                paddingHorizontal: 16,
                paddingLeft: 10,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.08,
                shadowRadius: 12,
                elevation: 4,
                borderWidth: 1,
                borderColor: 'rgba(217,208,190,0.5)',
              }}
            >
              <Svg width={28} height={28} viewBox="0 0 28 28" fill="none" stroke={colors.oliveDeep} strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round">
                <Path d="M4 3h20v22H4z" strokeDasharray="3 2" />
                <Path d="M14 7a4 4 0 100 8 4 4 0 000-8z" />
                <Path d="M7 22c0-3 3-5 7-5s7 2 7 5" />
              </Svg>
              <RNText
                style={{
                  fontFamily: theme.fontFamilies.body,
                  fontSize: 13,
                  fontWeight: '600',
                  color: colors.oliveDeep,
                  letterSpacing: 0.3,
                }}
              >
                Virtual Try-On
              </RNText>
            </View>
          </View>

          {/* Tagline */}
          <View style={{ alignItems: 'center', maxWidth: 280 }}>
            <RNText
              style={{
                fontFamily: theme.fontFamilies.body,
                fontSize: 16,
                color: colors.oliveDark,
                lineHeight: 24,
                textAlign: 'center',
              }}
            >
              Kiyimlarni sotib olishdan oldin
            </RNText>
            <RNText
              style={{
                fontFamily: theme.fontFamilies.body,
                fontSize: 17,
                fontWeight: '700',
                color: colors.oliveDeep,
                marginTop: 2,
              }}
            >
              virtual sinab ko'ring
            </RNText>
          </View>
        </View>

        {/* Bottom Actions */}
        <View style={{ width: '100%', gap: 14 }}>
          <Pressable
            onPress={() => router.push('/(auth)/register')}
            style={{
              width: '100%',
              paddingVertical: 18,
              backgroundColor: colors.oliveDeep,
              borderRadius: 18,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.2,
              shadowRadius: 16,
              elevation: 6,
            }}
          >
            <RNText
              style={{
                fontFamily: theme.fontFamilies.display,
                fontSize: 18,
                fontWeight: '700',
                color: colors.goldSoft,
                letterSpacing: 0.5,
              }}
            >
              Boshlash
            </RNText>
            <View
              style={{
                width: 28,
                height: 28,
                borderRadius: 14,
                borderWidth: 1.5,
                borderColor: 'rgba(228,206,154,0.4)',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Svg width={14} height={14} fill="none" stroke={colors.goldSoft} strokeWidth={2} strokeLinecap="round">
                <Path d="M5 3L10 7L5 11" />
              </Svg>
            </View>
          </Pressable>

          <Pressable
            onPress={() => router.push('/(auth)/login')}
            style={{
              alignItems: 'center',
              flexDirection: 'row',
              justifyContent: 'center',
              gap: 6,
              paddingVertical: 8,
            }}
          >
            <Text variant="bodySmall" color="muted">
              Akkauntingiz bormi?
            </Text>
            <Text variant="bodySmall" color="gold" style={{ fontWeight: '600' }}>
              Kirish
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}
