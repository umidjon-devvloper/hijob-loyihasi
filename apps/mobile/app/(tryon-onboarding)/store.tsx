import { Pressable, ScrollView, View, Text as RNText, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import Svg, { Circle, Path, Polyline } from 'react-native-svg';
import { useTheme } from '../../src/theme/ThemeProvider';
import { useTryonOnboarding } from '../../src/store/tryon-onboarding';
import { useTryonCollection } from '../../src/store/tryon-collection';
import { api } from '../../src/api/client';
import { safeBack } from '../../src/lib/safe-back';

interface Store {
  id: string;
  brandName: string;
  logoUrl: string | null;
  description: string | null;
  // Prisma Decimal serializes to a string over JSON, so narrow accordingly.
  rating: string | number;
  reviewsCount: number;
  verified: boolean;
}

const STORE_TINTS = ['#C9A96E', '#8A8D5B', '#B85450', '#5F7A94', '#D9A24B', '#8E8868'];

export default function StoreSelectScreen() {
  const { colors, theme, scheme } = useTheme();
  const router = useRouter();
  const selectedId = useTryonOnboarding((s) => s.storeId);
  const setStore = useTryonOnboarding((s) => s.setStore);
  const clearCollection = useTryonCollection((s) => s.clear);

  const { data, isLoading } = useQuery<Store[]>({
    queryKey: ['tryon-onb-stores'],
    queryFn: async () => (await api.get('/catalog/stores')).data,
  });

  const stores = data ?? [];

  const pick = async (id: string) => {
    await setStore(id);
    // Switching stores wipes the user's Primerka collection so the
    // tab shows the newly-picked shop's own catalogue instead of a
    // mix from previous shops. Items from different stores no longer
    // make sense once the buyer narrowed down to one shop.
    await clearCollection();
  };

  const next = () => {
    router.push('/(tryon-onboarding)/avatar');
  };

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
              3 / 4
            </RNText>
            <View style={{ flexDirection: 'row', gap: 4 }}>
              <View style={{ width: 22, height: 4, borderRadius: 2, backgroundColor: colors.oliveDeep }} />
              <View style={{ width: 22, height: 4, borderRadius: 2, backgroundColor: colors.oliveDeep }} />
              <View style={{ width: 22, height: 4, borderRadius: 2, backgroundColor: colors.oliveDeep }} />
              <View style={{ width: 22, height: 4, borderRadius: 2, backgroundColor: colors.rule }} />
            </View>
          </View>
        </View>

        <View style={{ paddingHorizontal: 24, paddingTop: 20, paddingBottom: 10 }}>
          <RNText style={{
            fontFamily: theme.fontFamilies.display, fontSize: 26, fontWeight: '700',
            color: colors.oliveDeep, marginBottom: 6,
          }}>
            Qaysi do'kondan?
          </RNText>
          <RNText style={{
            fontFamily: theme.fontFamilies.body, fontSize: 13,
            color: colors.muted, lineHeight: 18,
          }}>
            Primerka uchun bitta do'konni tanlang — keyin o'zgartira olasiz
          </RNText>
        </View>

        {isLoading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={colors.oliveDeep} />
          </View>
        ) : stores.length === 0 ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 }}>
            <RNText style={{
              fontFamily: theme.fontFamilies.body, fontSize: 13,
              color: colors.muted, textAlign: 'center',
            }}>
              Hozircha do'konlar yo'q. "O'tkazib yuborish" tugmasini bosing.
            </RNText>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16, gap: 10 }}
            showsVerticalScrollIndicator={false}
            style={{ flex: 1 }}
          >
            {stores.map((s, i) => {
              const selected = s.id === selectedId;
              const tint = STORE_TINTS[i % STORE_TINTS.length];
              return (
                <Pressable
                  key={s.id}
                  onPress={() => pick(s.id)}
                  style={{
                    backgroundColor: selected ? `${colors.oliveDeep}0A` : colors.surface,
                    borderRadius: 16,
                    borderWidth: selected ? 2 : 1,
                    borderColor: selected ? colors.oliveDark : colors.rule,
                    padding: 14,
                    flexDirection: 'row', alignItems: 'center', gap: 12,
                  }}
                >
                  <View style={{
                    width: 52, height: 52, borderRadius: 14,
                    backgroundColor: `${tint}22`,
                    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                  }}>
                    {s.logoUrl ? (
                      <Image source={{ uri: s.logoUrl }} style={{ width: 52, height: 52 }} contentFit="cover" />
                    ) : (
                      <RNText style={{
                        fontFamily: theme.fontFamilies.display, fontSize: 20, fontWeight: '700',
                        color: tint,
                      }}>
                        {s.brandName.slice(0, 1).toUpperCase()}
                      </RNText>
                    )}
                  </View>

                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <RNText
                        numberOfLines={1}
                        style={{
                          fontFamily: theme.fontFamilies.body, fontSize: 15, fontWeight: '600',
                          color: colors.ink,
                        }}
                      >
                        {s.brandName}
                      </RNText>
                      {s.verified && (
                        <Svg width={14} height={14} fill="none">
                          <Circle cx={7} cy={7} r={6} fill={colors.olive} />
                          <Polyline points="4 7 6.5 9 10 5" stroke="#fff" strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                        </Svg>
                      )}
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                      <RNText style={{
                        fontFamily: theme.fontFamilies.body, fontSize: 12,
                        color: colors.gold, fontWeight: '600',
                      }}>
                        ★ {Number(s.rating).toFixed(1)}
                      </RNText>
                      <RNText style={{
                        fontFamily: theme.fontFamilies.body, fontSize: 11,
                        color: colors.muted,
                      }}>
                        · {s.reviewsCount} baho
                      </RNText>
                    </View>
                  </View>

                  <View style={{
                    width: 24, height: 24, borderRadius: 12,
                    backgroundColor: selected ? colors.oliveDark : 'transparent',
                    borderWidth: selected ? 0 : 1.5,
                    borderColor: colors.rule,
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    {selected && (
                      <Svg width={12} height={12} fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <Polyline points="2 6 5 9 10 3" />
                      </Svg>
                    )}
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        )}

        <View style={{ paddingHorizontal: 20, paddingTop: 8, gap: 10 }}>
          <Pressable
            onPress={next}
            disabled={!selectedId && stores.length > 0}
            style={{
              width: '100%', paddingVertical: 18, backgroundColor: colors.oliveDeep,
              borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
              opacity: !selectedId && stores.length > 0 ? 0.5 : 1,
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

          <Pressable onPress={next} style={{ alignItems: 'center', paddingVertical: 6 }}>
            <RNText style={{
              fontFamily: theme.fontFamilies.body, fontSize: 13,
              color: colors.muted, fontWeight: '500',
            }}>
              O'tkazib yuborish
            </RNText>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}
