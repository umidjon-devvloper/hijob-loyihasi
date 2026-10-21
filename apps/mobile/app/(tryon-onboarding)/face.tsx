import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, View, Text as RNText, ActivityIndicator, Platform } from 'react-native';
import { Image } from 'expo-image';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Asset } from 'expo-asset';
import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Ellipse, Path, Polyline, Rect } from 'react-native-svg';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useTryonOnboarding, type BodyType } from '../../src/store/tryon-onboarding';
import {
  extractFacePreview,
  facePreviewErrorMessage,
  saveLocalFace,
} from '../../src/lib/face-local-cache';
import { errorMessage, errorTitle } from '../../src/lib/api-errors';
import { safeBack } from '../../src/lib/safe-back';

const BODY_IMGS: Record<BodyType, any> = {
  slim: require('../../assets/body-slim.webp'),
  medium: require('../../assets/body-medium.webp'),
  full: require('../../assets/body-full.webp'),
};

const BODY_LABELS: Record<BodyType, { label: string; sub: string }> = {
  slim: { label: "Ozg'in", sub: '(Nozik)' },
  medium: { label: "O'rtacha", sub: '(Normal)' },
  full: { label: "To'la", sub: '(Biroz to\'la)' },
};

const IS_SIMULATOR =
  Platform.OS === 'ios' && !Constants.isDevice && Constants.executionEnvironment !== 'storeClient';

export default function TryonFaceScreen() {
  const { colors, theme, scheme } = useTheme();
  const router = useRouter();
  const setFace = useTryonOnboarding((s) => s.setFace);
  const setFaceOverlayUrl = useTryonOnboarding((s) => s.setFaceOverlayUrl);
  const savedBody = useTryonOnboarding((s) => s.bodyType);
  const setBodyType = useTryonOnboarding((s) => s.setBodyType);

  const [bodyType, setBodyTypeLocal] = useState<BodyType>(savedBody ?? 'medium');

  const pickBody = (t: BodyType) => {
    Haptics.selectionAsync().catch(() => {});
    setBodyTypeLocal(t);
    setBodyType(t);
  };

  const [permission, requestPermission] = useCameraPermissions();
  const [stage, setStage] = useState<'intro' | 'camera'>('intro');
  const [busy, setBusy] = useState(false);
  const cameraRef = useRef<CameraView>(null);

  useEffect(() => {
    if (stage === 'camera' && !permission?.granted) requestPermission();
  }, [stage, permission, requestPermission]);

  const start = async () => {
    if (!permission?.granted) {
      const r = await requestPermission();
      if (!r.granted) {
        Alert.alert('Kamera ruxsati', 'Yuz skaneri uchun kameraga ruxsat kerak');
        return;
      }
    }
    setStage('camera');
  };

  const capture = async () => {
    if (!cameraRef.current) return;
    setBusy(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9 });
      if (!photo?.uri) return;
      // Validate + canonicalise the face BEFORE moving on. If Python says
      // the pose is wrong we tell the user to retake instead of saving a
      // bad avatar.
      const result = await extractFacePreview(photo.uri);
      if (!result.ok) {
        Alert.alert('Rasm xato', facePreviewErrorMessage(result.code));
        return;
      }
      await saveLocalFace(photo.uri);
      await setFace(photo.uri);
      await setFaceOverlayUrl(result.url);
      await setBodyType(bodyType);
      router.push('/(tryon-onboarding)/store');
    } catch (e: any) {
      Alert.alert(errorTitle(), errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const useDemoFace = async () => {
    try {
      setBusy(true);
      const asset = Asset.fromModule(require('../../assets/demo-face.jpg'));
      await asset.downloadAsync();
      const uri = asset.localUri ?? asset.uri;
      const result = await extractFacePreview(uri);
      if (!result.ok) {
        Alert.alert('Rasm xato', facePreviewErrorMessage(result.code));
        return;
      }
      await saveLocalFace(uri);
      await setFace(uri);
      await setFaceOverlayUrl(result.url);
      await setBodyType(bodyType);
      router.push('/(tryon-onboarding)/store');
    } catch (e: any) {
      Alert.alert(errorTitle(), errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (stage === 'camera') {
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <CameraView ref={cameraRef} style={{ flex: 1 }} facing="front" />
        <View pointerEvents="none" style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Svg width={260} height={320} viewBox="0 0 260 320">
            <Ellipse cx={130} cy={160} rx={110} ry={140}
              stroke={colors.gold} strokeWidth={3} fill="none" strokeDasharray="8 6" />
          </Svg>
        </View>
        <SafeAreaView edges={['top', 'bottom']} style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          justifyContent: 'space-between',
        }}>
          <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
            <Pressable
              onPress={() => setStage('intro')}
              style={{
                width: 36, height: 36, borderRadius: 18,
                backgroundColor: 'rgba(255,255,255,0.2)',
                alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Svg width={18} height={18} fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round">
                <Path d="M12 4 L6 9 L12 14" />
              </Svg>
            </Pressable>
          </View>
          <View style={{ paddingHorizontal: 20, paddingBottom: 20, gap: 12 }}>
            <RNText style={{
              fontFamily: theme.fontFamilies.body, fontSize: 14, color: '#fff',
              textAlign: 'center', marginBottom: 8,
            }}>
              Yuzingizni ramkaga joylashtiring
            </RNText>
            <Pressable
              onPress={capture}
              disabled={busy}
              style={{
                paddingVertical: 16, backgroundColor: colors.oliveDeep, borderRadius: 14,
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                opacity: busy ? 0.6 : 1,
              }}
            >
              {busy ? (
                <ActivityIndicator color={colors.goldSoft} />
              ) : (
                <Svg width={18} height={18} fill="none" stroke={colors.goldSoft} strokeWidth={2}>
                  <Circle cx={9} cy={9} r={7} />
                  <Circle cx={9} cy={9} r={3} />
                </Svg>
              )}
              <RNText style={{
                fontFamily: theme.fontFamilies.body, fontSize: 15, fontWeight: '600',
                color: colors.goldSoft,
              }}>
                {busy ? 'Yuklanmoqda...' : 'Suratga olish'}
              </RNText>
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
        {/* Header */}
        <View style={{
          paddingHorizontal: 20, paddingTop: 8,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <Pressable
            onPress={() => safeBack()}
            style={{
              width: 40, height: 40, borderRadius: 20,
              backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.rule,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Svg width={18} height={18} fill="none" stroke={colors.ink} strokeWidth={2} strokeLinecap="round">
              <Path d="M12 4 L6 9 L12 14" />
            </Svg>
          </Pressable>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <RNText style={{
              fontFamily: theme.fontFamilies.body, fontSize: 12,
              color: colors.muted, fontWeight: '500',
            }}>
              2 / 4
            </RNText>
            <View style={{ flexDirection: 'row', gap: 4 }}>
              <View style={{ width: 22, height: 4, borderRadius: 2, backgroundColor: colors.oliveDeep }} />
              <View style={{ width: 22, height: 4, borderRadius: 2, backgroundColor: colors.oliveDeep }} />
              <View style={{ width: 22, height: 4, borderRadius: 2, backgroundColor: colors.rule }} />
              <View style={{ width: 22, height: 4, borderRadius: 2, backgroundColor: colors.rule }} />
            </View>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={{ paddingBottom: 10 }}
          showsVerticalScrollIndicator={false}
        >
          <View style={{ paddingHorizontal: 24, paddingTop: 20, alignItems: 'center' }}>
            <RNText style={{
              fontFamily: theme.fontFamilies.display, fontSize: 26, fontWeight: '700',
              color: colors.oliveDeep, textAlign: 'center', marginBottom: 6,
            }}>
              Yuz skaneri
            </RNText>
            <RNText style={{
              fontFamily: theme.fontFamilies.body, fontSize: 13,
              color: colors.muted, lineHeight: 18, textAlign: 'center',
              paddingHorizontal: 10,
            }}>
              Avatarning yuzi sizniki bo'ladi — faqat qurilmangizda saqlanadi
            </RNText>
          </View>

          {/* Compact face frame illustration */}
          <View style={{ alignItems: 'center', paddingTop: 18, paddingBottom: 10 }}>
            <View style={{
              width: 150, height: 150, borderRadius: 75,
              borderWidth: 2, borderStyle: 'dashed', borderColor: colors.olive,
              alignItems: 'center', justifyContent: 'center',
              backgroundColor: `${colors.olive}10`, position: 'relative',
            }}>
              <Svg width={54} height={54} viewBox="0 0 70 70" fill="none">
                <Circle cx={35} cy={28} r={14} stroke={colors.oliveDeep} strokeWidth={2.5} />
                <Path d="M12 60 C12 48, 24 42, 35 42 C46 42, 58 48, 58 60"
                  stroke={colors.oliveDeep} strokeWidth={2.5} strokeLinecap="round" />
              </Svg>
              <View style={{ position: 'absolute', top: 12, left: 12, width: 18, height: 18, borderTopWidth: 2.5, borderLeftWidth: 2.5, borderColor: colors.gold, borderTopLeftRadius: 4 }} />
              <View style={{ position: 'absolute', top: 12, right: 12, width: 18, height: 18, borderTopWidth: 2.5, borderRightWidth: 2.5, borderColor: colors.gold, borderTopRightRadius: 4 }} />
              <View style={{ position: 'absolute', bottom: 12, left: 12, width: 18, height: 18, borderBottomWidth: 2.5, borderLeftWidth: 2.5, borderColor: colors.gold, borderBottomLeftRadius: 4 }} />
              <View style={{ position: 'absolute', bottom: 12, right: 12, width: 18, height: 18, borderBottomWidth: 2.5, borderRightWidth: 2.5, borderColor: colors.gold, borderBottomRightRadius: 4 }} />
            </View>
          </View>

          {/* Body type picker */}
          <View style={{ paddingHorizontal: 20, paddingTop: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <Svg width={16} height={16} fill="none" stroke={colors.oliveDeep} strokeWidth={1.5} strokeLinecap="round">
                <Path d="M5 14V7l3-4 3 4v7" />
                <Path d="M3 14h10" />
              </Svg>
              <RNText style={{
                fontFamily: theme.fontFamilies.body, fontSize: 13, fontWeight: '600',
                color: colors.ink,
              }}>
                Tana turingiz
              </RNText>
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {(['slim', 'medium', 'full'] as BodyType[]).map((t) => {
                const selected = bodyType === t;
                const info = BODY_LABELS[t];
                return (
                  <Pressable
                    key={t}
                    onPress={() => pickBody(t)}
                    style={{
                      flex: 1, paddingTop: 12, paddingBottom: 10, paddingHorizontal: 6,
                      // See body.tsx: transparent card so the figures sit
                      // on the parent screen colour; selected card gets a
                      // faint tint + border.
                      backgroundColor: selected ? `${colors.oliveDeep}0A` : 'transparent',
                      borderWidth: selected ? 2 : 1,
                      borderColor: selected ? colors.oliveDark : 'transparent',
                      borderRadius: 14, alignItems: 'center', position: 'relative',
                    }}
                  >
                    {selected && (
                      <View style={{
                        position: 'absolute', top: -6, right: -6, width: 20, height: 20,
                        borderRadius: 10, backgroundColor: colors.oliveDark,
                        alignItems: 'center', justifyContent: 'center', zIndex: 1,
                      }}>
                        <Svg width={10} height={10} fill="none" stroke={colors.surfaceAlt} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                          <Polyline points="2 5 4 7 8 2" />
                        </Svg>
                      </View>
                    )}
                    <View style={{ width: 48, height: 60, marginBottom: 6, alignItems: 'center', justifyContent: 'center' }}>
                      <Image source={BODY_IMGS[t]} style={{ width: 48, height: 58 }} contentFit="contain" />
                    </View>
                    <RNText style={{
                      fontFamily: theme.fontFamilies.body, fontSize: 12,
                      fontWeight: selected ? '700' : '600',
                      color: selected ? colors.oliveDeep : colors.ink,
                    }}>
                      {info.label}
                    </RNText>
                    <RNText style={{
                      fontFamily: theme.fontFamilies.body, fontSize: 10,
                      color: selected ? colors.oliveDark : colors.muted,
                      marginTop: 1,
                    }}>
                      {info.sub}
                    </RNText>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Privacy note */}
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 10,
            marginHorizontal: 20, marginTop: 16, marginBottom: 8, paddingHorizontal: 14, paddingVertical: 10,
            backgroundColor: `${colors.surface}99`, borderWidth: 1, borderColor: colors.ruleSoft,
            borderRadius: 14,
          }}>
            <View style={{
              width: 28, height: 28, borderRadius: 9,
              backgroundColor: `${colors.olive}14`,
              alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Svg width={14} height={14} fill="none" stroke={colors.olive} strokeWidth={1.5}>
                <Rect x={3} y={8} width={10} height={7} rx={2} />
                <Path d="M5.5 8V5.5a2.5 2.5 0 015 0V8" />
              </Svg>
            </View>
            <RNText style={{
              fontFamily: theme.fontFamilies.body, fontSize: 11,
              color: colors.muted, lineHeight: 15, flex: 1,
            }}>
              Yuz ma'lumotlari qurilmangizda saqlanadi va uchinchi tomonlarga berilmaydi
            </RNText>
          </View>
        </ScrollView>

        <View style={{ paddingHorizontal: 20, paddingBottom: 8, gap: 10 }}>
          <Pressable
            onPress={start}
            style={{
              width: '100%', paddingVertical: 18, backgroundColor: colors.oliveDeep,
              borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
            }}
          >
            <Svg width={20} height={20} fill="none" stroke={colors.goldSoft} strokeWidth={1.8}>
              <Rect x={3} y={3} width={14} height={14} rx={3} />
              <Circle cx={10} cy={10} r={3} />
            </Svg>
            <RNText style={{
              fontFamily: theme.fontFamilies.body, fontSize: 15, fontWeight: '600',
              color: colors.goldSoft,
            }}>
              Skanerlash
            </RNText>
            <Svg width={16} height={16} fill="none" stroke={colors.goldSoft} strokeWidth={2.5}>
              <Path d="M6 3l6 5-6 5" />
            </Svg>
          </Pressable>

          {IS_SIMULATOR && (
            <Pressable
              onPress={useDemoFace}
              disabled={busy}
              style={{
                paddingVertical: 10, borderRadius: 10,
                borderWidth: 1, borderColor: colors.ruleSoft,
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                opacity: busy ? 0.6 : 1,
              }}
            >
              <Svg width={14} height={14} fill="none" stroke={colors.muted} strokeWidth={1.5}>
                <Rect x={2} y={3} width={12} height={10} rx={2} />
                <Circle cx={8} cy={8} r={2} />
              </Svg>
              <RNText style={{
                fontFamily: theme.fontFamilies.body, fontSize: 12, fontWeight: '500',
                color: colors.muted,
              }}>
                Demo (simulator)
              </RNText>
            </Pressable>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}
