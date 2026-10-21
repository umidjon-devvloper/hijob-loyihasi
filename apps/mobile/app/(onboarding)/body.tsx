import { useState } from 'react';
import { Alert, Pressable, ScrollView, TextInput, View, Text as RNText } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Ellipse, G, Line, Path, Polyline, Rect } from 'react-native-svg';
import { useTheme } from '../../src/theme/ThemeProvider';
import { api } from '../../src/api/client';
import { useAuth } from '../../src/store/auth';
import { errorMessage, errorTitle } from '../../src/lib/api-errors';
import { safeBack } from '../../src/lib/safe-back';

const WOMAN_IMG = require('../../assets/body-woman.webp');
const BODY_IMGS: Record<BodyType, any> = {
  slim: require('../../assets/body-slim.webp'),
  medium: require('../../assets/body-medium.webp'),
  full: require('../../assets/body-full.webp'),
};

type BodyType = 'slim' | 'medium' | 'full';

export default function BodyParamsScreen() {
  const { colors, theme, scheme } = useTheme();
  const router = useRouter();
  const refreshMe = useAuth((s) => s.refreshMe);

  const [heightCm, setHeightCm] = useState('168');
  const [weightKg, setWeightKg] = useState('62');
  const [bodyType, setBodyType] = useState<BodyType>('medium');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    try {
      setSaving(true);
      await api.put('/onboarding/body', {
        heightCm: parseInt(heightCm) || 168,
        weightKg: parseInt(weightKg) || 62,
        bodyType,
      });
      await refreshMe();
      router.push('/(onboarding)/face');
    } catch (e: any) {
      Alert.alert(errorTitle(), errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const skip = () => {
    router.push('/(onboarding)/face');
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        {/* Header */}
        <View style={{ paddingHorizontal: 20, paddingTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Pressable
            onPress={() => safeBack()}
            style={{
              width: 40, height: 40, borderRadius: 20,
              backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.rule,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Svg width={18} height={18} fill="none" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <Path d="M12 4 L6 9 L12 14" />
            </Svg>
          </Pressable>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <RNText style={{ fontFamily: theme.fontFamilies.body, fontSize: 12, color: colors.muted, fontWeight: '500' }}>
              2 / 3
            </RNText>
            <View style={{ flexDirection: 'row', gap: 4 }}>
              <View style={{ width: 28, height: 4, borderRadius: 2, backgroundColor: colors.oliveDeep }} />
              <View style={{ width: 28, height: 4, borderRadius: 2, backgroundColor: colors.oliveDeep }} />
              <View style={{ width: 28, height: 4, borderRadius: 2, backgroundColor: colors.rule }} />
            </View>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 24, flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Title */}
          <RNText style={{ fontFamily: theme.fontFamilies.display, fontSize: 28, fontWeight: '700', color: colors.oliveDeep, marginBottom: 6 }}>
            O'lchovlaringiz
          </RNText>
          <RNText style={{ fontFamily: theme.fontFamilies.body, fontSize: 14, color: colors.muted, lineHeight: 20, marginBottom: 20 }}>
            Virtual primerka uchun tana o'lchovlarini kiriting
          </RNText>

          {/* Body Illustration with Woman Photo */}
          <View style={{ height: 300, marginBottom: 20, position: 'relative' }}>
            {/* Golden wave background */}
            <View pointerEvents="none" style={{ position: 'absolute', top: 30, left: 60, zIndex: 0 }}>
              <Svg width={280} height={240} viewBox="0 0 280 240" fill="none">
                <Path d="M40 200 C60 80, 140 40, 240 60 C260 64, 270 80, 260 120 C240 180, 160 200, 80 220 C60 224, 44 216, 40 200Z" fill={`${colors.goldSoft}1A`} />
                <Path d="M80 190 C100 100, 160 70, 230 90" stroke={`${colors.goldSoft}26`} strokeWidth={1} fill="none" />
              </Svg>
            </View>

            {/* Height dashed line */}
            <View style={{ position: 'absolute', left: 51, top: 10, bottom: 10, width: 8, alignItems: 'center', zIndex: 1 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.olive }} />
              <Svg style={{ flex: 1, width: 2 }} viewBox="0 0 2 100" preserveAspectRatio="none">
                <Line x1={1} y1={0} x2={1} y2={100} stroke={colors.olive} strokeWidth={2} strokeDasharray="6 4" />
              </Svg>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.olive }} />
            </View>

            {/* Bo'y label */}
            <View style={{
              position: 'absolute', left: 20, top: '42%',
              backgroundColor: `${colors.olive}26`, padding: 8, paddingHorizontal: 6, borderRadius: 8, zIndex: 3,
            }}>
              <RNText style={{
                fontFamily: theme.fontFamilies.body, fontSize: 11, fontWeight: '600',
                color: colors.olive, letterSpacing: 1, writingDirection: 'ltr',
                transform: [{ rotate: '-90deg' }],
              }}>
                Bo'y
              </RNText>
            </View>

            {/* Woman photo */}
            <View style={{ position: 'absolute', left: 70, top: 5, zIndex: 2 }}>
              <Image
                source={WOMAN_IMG}
                style={{ width: 150, height: 290 }}
                contentFit="contain"
              />
            </View>

            {/* Tooltip card */}
            <View style={{
              position: 'absolute', right: 0, top: 30, width: 135,
              backgroundColor: `${colors.surfaceAlt}F2`, borderWidth: 1, borderColor: colors.ruleSoft,
              borderRadius: 14, padding: 12, zIndex: 3,
            }}>
              <View style={{
                width: 28, height: 28, borderRadius: 14,
                backgroundColor: `${colors.olive}1F`,
                alignItems: 'center', justifyContent: 'center', marginBottom: 8,
              }}>
                <Svg width={16} height={16} fill="none" stroke={colors.olive} strokeWidth={1.5} strokeLinecap="round">
                  <Circle cx={8} cy={5.5} r={3.5} />
                  <Path d="M3 15v-1a5 5 0 0110 0v1" />
                </Svg>
              </View>
              <RNText style={{ fontFamily: theme.fontFamilies.body, fontSize: 11, color: colors.muted, lineHeight: 15 }}>
                Aniq o'lchovlar sizga mos kiyimlarni tavsiya qilishga yordam beradi
              </RNText>
            </View>

            {/* Curved arrow from tooltip to woman */}
            <View pointerEvents="none" style={{ position: 'absolute', right: 110, top: 100, zIndex: 3 }}>
              <Svg width={40} height={30} fill="none">
                <Path d="M36 4C26 6 14 12 6 22" stroke={colors.oliveSoft} strokeWidth={1.2} strokeLinecap="round" />
                <Path d="M9 16L5 23l7-3" stroke={colors.oliveSoft} strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" />
              </Svg>
            </View>
          </View>

          {/* Measurements Form */}
          <View style={{
            backgroundColor: colors.surface, borderRadius: 20, padding: 20,
            borderWidth: 1, borderColor: colors.rule, gap: 18, marginBottom: 16,
          }}>
            {/* Height & Weight Row */}
            <View style={{ flexDirection: 'row', gap: 14 }}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <Svg width={18} height={18} fill="none" stroke={colors.oliveDeep} strokeWidth={1.5} strokeLinecap="round">
                    <Circle cx={9} cy={4} r={2.5} />
                    <Path d="M5 17v-3a4 4 0 018 0v3" />
                    <Path d="M9 2v-1M7 3.5l-1-1M11 3.5l1-1" />
                  </Svg>
                  <RNText style={{ fontFamily: theme.fontFamilies.body, fontSize: 13, fontWeight: '600', color: colors.ink }}>
                    Bo'y (sm)
                  </RNText>
                </View>
                <View style={{
                  paddingHorizontal: 16, paddingVertical: 14,
                  backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.rule,
                  borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <TextInput
                    value={heightCm}
                    onChangeText={(t) => setHeightCm(t.replace(/\D/g, '').slice(0, 3))}
                    keyboardType="number-pad"
                    maxLength={3}
                    style={{
                      flex: 1, fontFamily: theme.fontFamilies.body,
                      fontSize: 18, fontWeight: '600', color: colors.ink, padding: 0,
                    }}
                  />
                  <RNText style={{ fontFamily: theme.fontFamilies.body, fontSize: 13, color: colors.oliveSoft, fontWeight: '500' }}>sm</RNText>
                </View>
              </View>

              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <Svg width={18} height={18} fill="none" stroke={colors.oliveDeep} strokeWidth={1.5} strokeLinecap="round">
                    <Rect x={3} y={3} width={12} height={12} rx={2} />
                    <Path d="M3 9h4l2-3 2 6 2-3h4" />
                  </Svg>
                  <RNText style={{ fontFamily: theme.fontFamilies.body, fontSize: 13, fontWeight: '600', color: colors.ink }}>
                    Vazn (kg)
                  </RNText>
                </View>
                <View style={{
                  paddingHorizontal: 16, paddingVertical: 14,
                  backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.rule,
                  borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  <TextInput
                    value={weightKg}
                    onChangeText={(t) => setWeightKg(t.replace(/\D/g, '').slice(0, 3))}
                    keyboardType="number-pad"
                    maxLength={3}
                    style={{
                      flex: 1, fontFamily: theme.fontFamilies.body,
                      fontSize: 18, fontWeight: '600', color: colors.ink, padding: 0,
                    }}
                  />
                  <RNText style={{ fontFamily: theme.fontFamilies.body, fontSize: 13, color: colors.oliveSoft, fontWeight: '500' }}>kg</RNText>
                </View>
              </View>
            </View>

            {/* Body Type */}
            <View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <Svg width={18} height={18} fill="none" stroke={colors.oliveDeep} strokeWidth={1.5} strokeLinecap="round">
                  <Path d="M5 16V8l4-5 4 5v8" />
                  <Path d="M3 16h12" />
                  <Path d="M7 12h4" />
                </Svg>
                <RNText style={{ fontFamily: theme.fontFamilies.body, fontSize: 13, fontWeight: '600', color: colors.ink }}>
                  Tana turi
                </RNText>
                <View style={{
                  width: 18, height: 18, borderRadius: 9,
                  backgroundColor: `${colors.rule}66`,
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <RNText style={{ fontSize: 11, color: colors.muted, fontWeight: '600' }}>?</RNText>
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <BodyTypeCard
                  type="slim"
                  label="Nozik"
                  sublabel="(Ozgina)"
                  selected={bodyType === 'slim'}
                  onPress={() => setBodyType('slim')}
                  colors={colors}
                  theme={theme}
                />
                <BodyTypeCard
                  type="medium"
                  label="O'rtacha"
                  sublabel="(Normal)"
                  selected={bodyType === 'medium'}
                  onPress={() => setBodyType('medium')}
                  colors={colors}
                  theme={theme}
                />
                <BodyTypeCard
                  type="full"
                  label="To'la"
                  sublabel="(Biroz to'la)"
                  selected={bodyType === 'full'}
                  onPress={() => setBodyType('full')}
                  colors={colors}
                  theme={theme}
                />
              </View>
            </View>
          </View>

          {/* Privacy Note */}
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 10,
            padding: 14, paddingHorizontal: 16,
            backgroundColor: `${colors.surface}99`, borderWidth: 1, borderColor: colors.ruleSoft,
            borderRadius: 14, marginBottom: 20,
          }}>
            <View style={{
              width: 32, height: 32, borderRadius: 10,
              backgroundColor: `${colors.olive}14`,
              alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Svg width={16} height={16} fill="none" stroke={colors.olive} strokeWidth={1.5} strokeLinecap="round">
                <Rect x={3} y={8} width={10} height={7} rx={2} />
                <Path d="M5.5 8V5.5a2.5 2.5 0 015 0V8" />
              </Svg>
            </View>
            <RNText style={{ fontFamily: theme.fontFamilies.body, fontSize: 11, color: colors.muted, lineHeight: 15, flex: 1 }}>
              Ma'lumotlaringiz faqat virtual primerka uchun ishlatiladi va uchinchi tomonlarga berilmaydi
            </RNText>
          </View>

          <View style={{ flex: 1 }} />

          {/* Actions */}
          <View style={{ gap: 12 }}>
            <Pressable
              onPress={submit}
              disabled={saving}
              style={{
                width: '100%', paddingVertical: 18, backgroundColor: colors.oliveDeep,
                borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
                opacity: saving ? 0.7 : 1,
              }}
            >
              <RNText style={{
                fontFamily: theme.fontFamilies.display, fontSize: 17, fontWeight: '700',
                color: colors.goldSoft, letterSpacing: 0.3,
              }}>
                Keyingi
              </RNText>
              <Svg width={18} height={18} fill="none" stroke={colors.goldSoft} strokeWidth={2} strokeLinecap="round">
                <Path d="M7 4l6 5-6 5" />
              </Svg>
            </Pressable>

            <Pressable onPress={skip} style={{ alignItems: 'center', paddingVertical: 8 }}>
              <RNText style={{ fontFamily: theme.fontFamilies.body, fontSize: 13, color: colors.muted, fontWeight: '500' }}>
                O'tkazib yuborish
              </RNText>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function BodyTypeCard({
  type, label, sublabel, selected, onPress, colors, theme,
}: {
  type: BodyType;
  label: string;
  sublabel: string;
  selected: boolean;
  onPress: () => void;
  colors: any;
  theme: any;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1, paddingTop: 12, paddingBottom: 10, paddingHorizontal: 6,
        // Transparent card background so the mannequin figures sit on
        // the parent screen colour directly. Only the selected card gets
        // a faint olive tint to signal state.
        backgroundColor: selected ? `${colors.oliveDeep}0A` : 'transparent',
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? colors.oliveDark : 'transparent',
        borderRadius: 14, alignItems: 'center', position: 'relative',
      }}
    >
      {selected && (
        <View style={{
          position: 'absolute', top: -6, right: -6, width: 22, height: 22,
          borderRadius: 11, backgroundColor: colors.oliveDark,
          alignItems: 'center', justifyContent: 'center', zIndex: 1,
        }}>
          <Svg width={12} height={12} fill="none" stroke={colors.surfaceAlt} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <Polyline points="2 6 5 9 10 3" />
          </Svg>
        </View>
      )}

      <View style={{ width: 56, height: 72, marginBottom: 8, borderRadius: 10, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
        <Image source={BODY_IMGS[type]} style={{ width: 56, height: 68 }} contentFit="contain" />
      </View>

      <RNText style={{
        fontFamily: theme.fontFamilies.body, fontSize: 12,
        fontWeight: selected ? '700' : '600',
        color: selected ? colors.oliveDeep : colors.ink, marginBottom: 2,
      }}>
        {label}
      </RNText>
      <RNText style={{
        fontFamily: theme.fontFamilies.body, fontSize: 10,
        color: selected ? colors.oliveDark : colors.muted,
        fontWeight: selected ? '500' : '400',
      }}>
        {sublabel}
      </RNText>
    </Pressable>
  );
}
