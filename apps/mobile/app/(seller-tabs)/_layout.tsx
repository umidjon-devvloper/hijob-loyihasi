import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../src/theme/ThemeProvider';

type IoniconName = keyof typeof Ionicons.glyphMap;

export default function SellerTabsLayout() {
  const { colors, theme } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, 10);
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
        name="dashboard"
        options={{
          title: t('seller.tabs.dashboard'),
          tabBarIcon: ({ focused }) => (
            <SellerIcon icon="grid" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="products"
        options={{
          title: t('seller.tabs.products'),
          tabBarIcon: ({ focused }) => (
            <SellerIcon icon="pricetag" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: t('seller.tabs.orders'),
          tabBarIcon: ({ focused }) => (
            <SellerIcon icon="receipt" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="analytics"
        options={{
          title: t('seller.tabs.analytics'),
          tabBarIcon: ({ focused }) => (
            <SellerIcon icon="bar-chart" focused={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('tabs.profile'),
          tabBarIcon: ({ focused }) => (
            <SellerIcon icon="person" focused={focused} />
          ),
        }}
      />
    </Tabs>
  );
}

function SellerIcon({
  icon,
  focused,
}: {
  icon: 'grid' | 'pricetag' | 'receipt' | 'bar-chart' | 'person';
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
