import { Tabs } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../src/theme/ThemeProvider';

type IoniconName = keyof typeof Ionicons.glyphMap;

export default function TabsLayout() {
  const { colors, theme } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, 10);
  // Content band height — label room excluded so the active dot fits.
  const BAR_CONTENT = 62;

  return (
    <Tabs
      screenListeners={{
        tabPress: () => {
          Haptics.selectionAsync().catch(() => {});
        },
      }}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.goldDark,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopWidth: 0,
          height: BAR_CONTENT + bottomInset,
          paddingTop: 10,
          paddingBottom: bottomInset,
          shadowColor: '#000',
          shadowOpacity: 0.1,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: -6 },
          elevation: 12,
        },
        tabBarLabelStyle: {
          fontFamily: theme.fontFamilies.body,
          fontWeight: '600',
          fontSize: 10.5,
          letterSpacing: 0.3,
          marginTop: 2,
        },
        tabBarItemStyle: {
          paddingTop: 2,
        },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: t('tabs.home'),
          tabBarIcon: ({ focused }) => (
            <SideIcon icon="home" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="catalog"
        options={{
          title: t('tabs.catalog'),
          tabBarIcon: ({ focused }) => (
            <SideIcon icon="grid" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="tryon"
        options={{
          title: t('tabs.tryon'),
          tabBarIcon: ({ focused }) => <CenterIcon focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="cart"
        options={{
          title: t('tabs.cart'),
          tabBarIcon: ({ focused }) => (
            <SideIcon icon="bag" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('tabs.profile'),
          tabBarIcon: ({ focused }) => (
            <SideIcon icon="person" focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}

// Outline icon by default, filled with a gold dot indicator above when
// focused. Width is held fixed so active/inactive rows don't shift.
function SideIcon({
  icon,
  focused,
}: {
  icon: 'home' | 'grid' | 'bag' | 'person';
  focused: boolean;
}) {
  const { colors } = useTheme();
  const name: IoniconName = focused ? icon : (`${icon}-outline` as IoniconName);
  const color = focused ? colors.goldDark : colors.muted;
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', minWidth: 36 }}>
      <View
        style={{
          position: 'absolute',
          top: -8,
          width: 5,
          height: 5,
          borderRadius: 2.5,
          backgroundColor: focused ? colors.goldDark : 'transparent',
        }}
      />
      <Ionicons name={name} size={23} color={color} />
    </View>
  );
}

// Center "Primerka" — floats half above the bar; gold gradient when
// focused, deep-olive otherwise. White ring hides the bar seam behind.
function CenterIcon({ focused }: { focused: boolean }) {
  const { colors } = useTheme();
  const palette = focused
    ? ([colors.goldDark, '#8E6E35'] as const)
    : ([colors.oliveDeep, '#232516'] as const);
  return (
    <View style={{ alignItems: 'center', marginTop: -22, width: 60 }}>
      <LinearGradient
        colors={palette}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          width: 58,
          height: 58,
          borderRadius: 29,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 3,
          borderColor: colors.surface,
          shadowColor: focused ? colors.goldDark : '#000',
          shadowOpacity: focused ? 0.4 : 0.22,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 6 },
          elevation: 10,
        }}
      >
        <MaterialCommunityIcons
          name="hanger"
          size={26}
          color={focused ? '#FFF8E7' : colors.goldSoft}
        />
      </LinearGradient>
    </View>
  );
}
