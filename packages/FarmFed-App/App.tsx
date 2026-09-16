import { useRef, useState, useCallback, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import * as StoreReview from 'expo-store-review';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { readAsStringAsync } from 'expo-file-system';
import {
  StyleSheet,
  Text,
  Image,
  TouchableOpacity,
  BackHandler,
  Platform,
  Share,
  View,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, WebViewNavigation, WebViewMessageEvent } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';

const SITE_URL = 'https://www.farmfed.us';
const BRAND_GREEN = '#2ecc71';
const INACTIVE_GRAY = '#8E8E93';
const TAB_BAR_HEIGHT = 56;

SplashScreen.preventAutoHideAsync();

// Configure how notifications are displayed when app is foregrounded
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/**
 * Register for push notifications and return the Expo push token.
 * Returns null if permissions are denied or device is a simulator.
 */
async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) {
    console.log('Push notifications require a physical device');
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('Push notification permission not granted');
    return null;
  }

  // Get the Expo push token
  const tokenData = await Notifications.getExpoPushTokenAsync({
    projectId: '6cb78586-e9e6-4425-a874-2fea026341eb',
  });

  // Configure Android notification channel
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#2ecc71',
    });
  }

  return tokenData.data;
}

// --- Tab definitions ---
interface TabDef {
  key: string;
  label: string;
  path: string;
  iconName: keyof typeof Ionicons.glyphMap;
  iconNameActive: keyof typeof Ionicons.glyphMap;
}

const ICON_SIZE = 24;

const TABS: TabDef[] = [
  { key: 'home', label: 'Home', path: '/', iconName: 'home-outline', iconNameActive: 'home' },
  { key: 'search', label: 'Search', path: '/s', iconName: 'search-outline', iconNameActive: 'search' },
  { key: 'sell', label: 'Sell', path: '/l/new', iconName: 'add-circle-outline', iconNameActive: 'add-circle' },
  { key: 'inbox', label: 'Inbox', path: '/inbox/sales', iconName: 'chatbubble-outline', iconNameActive: 'chatbubble' },
  { key: 'profile', label: 'Profile', path: '/profile-settings', iconName: 'person-outline', iconNameActive: 'person' },
];

function getActiveTab(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    if (pathname === '/') return 'home';
    if (pathname.startsWith('/s')) return 'search';
    if (pathname.startsWith('/l/new')) return 'sell';
    if (pathname.startsWith('/inbox')) return 'inbox';
    if (pathname.startsWith('/profile-settings') || pathname.startsWith('/account')) return 'profile';
  } catch {}
  return '';
}

// JavaScript injected before web content loads to intercept SPA navigations
const URL_TRACKING_JS = `
(function() {
  function notifyUrl() {
    window.ReactNativeWebView && window.ReactNativeWebView.postMessage(
      JSON.stringify({ type: 'urlChanged', payload: { url: window.location.href } })
    );
  }

  // Intercept pushState / replaceState
  var origPush = history.pushState;
  var origReplace = history.replaceState;
  history.pushState = function() {
    origPush.apply(this, arguments);
    notifyUrl();
  };
  history.replaceState = function() {
    origReplace.apply(this, arguments);
    notifyUrl();
  };

  // Intercept popstate (back/forward)
  window.addEventListener('popstate', notifyUrl);

  // Initial notification
  notifyUrl();
})();
true;
`;

// CSS injected to add bottom padding so content isn't hidden behind tab bar
const BOTTOM_PADDING_CSS = `
(function() {
  var style = document.createElement('style');
  style.textContent = 'body { padding-bottom: ${TAB_BAR_HEIGHT}px !important; }';
  document.head.appendChild(style);
})();
true;
`;

// --- Tab Bar Component ---
function TabBar({
  activeTab,
  onTabPress,
}: {
  activeTab: string;
  onTabPress: (tab: TabDef) => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.tabBar, { paddingBottom: insets.bottom }]}>
      {TABS.map(tab => {
        const isActive = tab.key === activeTab;
        const color = isActive ? BRAND_GREEN : INACTIVE_GRAY;
        return (
          <Pressable
            key={tab.key}
            style={styles.tabItem}
            onPress={() => onTabPress(tab)}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: isActive }}
          >
            <Ionicons
              name={isActive ? tab.iconNameActive : tab.iconName}
              size={ICON_SIZE}
              color={color}
            />
            <Text style={[styles.tabLabel, { color }]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// --- Loading Indicator ---
function LoadingIndicator() {
  return (
    <View style={styles.loadingContainer}>
      <ActivityIndicator size="large" color={BRAND_GREEN} />
    </View>
  );
}

export default function App() {
  const webViewRef = useRef<WebView>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [activeTab, setActiveTab] = useState('home');
  const pushTokenRef = useRef<string | null>(null);

  // Register for push notifications on mount
  useEffect(() => {
    registerForPushNotifications().then(token => {
      if (token) {
        pushTokenRef.current = token;
        // Inject token into WebView so the web app can register it with the server
        webViewRef.current?.injectJavaScript(`
          window.__EXPO_PUSH_TOKEN__ = ${JSON.stringify(token)};
          true;
        `);
      }
    });
  }, []);

  // Handle notification taps — navigate WebView to the relevant page
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data;
      if (data?.listingId && webViewRef.current) {
        const slug = (data.listingTitle as string || 'listing')
          .toLowerCase()
          .replace(/\s+/g, '-');
        webViewRef.current.injectJavaScript(`
          window.location.href = '/l/${slug}/${data.listingId}';
          true;
        `);
      }
    });

    return () => subscription.remove();
  }, []);

  // Android hardware back button
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack && webViewRef.current) {
        webViewRef.current.goBack();
        return true;
      }
      return false;
    });

    return () => handler.remove();
  }, [canGoBack]);

  const onNavigationStateChange = useCallback((navState: WebViewNavigation) => {
    setCanGoBack(navState.canGoBack);
    if (navState.url) {
      setActiveTab(getActiveTab(navState.url));
    }
  }, []);

  const onLoadEnd = useCallback(() => {
    setIsLoaded(true);
    setHasError(false);
    SplashScreen.hideAsync();

    // Inject push token into WebView after load
    if (pushTokenRef.current) {
      webViewRef.current?.injectJavaScript(`
        window.__EXPO_PUSH_TOKEN__ = ${JSON.stringify(pushTokenRef.current)};
        true;
      `);
    }

    // Inject bottom padding CSS
    webViewRef.current?.injectJavaScript(BOTTOM_PADDING_CSS);
  }, []);

  const onError = useCallback(() => {
    setHasError(true);
    setIsLoaded(true);
    SplashScreen.hideAsync();
  }, []);

  // The web server returns 401/403/404 with a valid HTML body that contains
  // a client-side redirect (e.g. to /signup for auth-protected routes when
  // logged out). Treat those as normal navigations, not connection errors.
  const onHttpError = useCallback((event: any) => {
    const status = event?.nativeEvent?.statusCode;
    if (status === 401 || status === 403 || status === 404) {
      setIsLoaded(true);
      SplashScreen.hideAsync();
      return;
    }
    onError();
  }, [onError]);

  const retry = useCallback(() => {
    setHasError(false);
    setIsLoaded(false);
    webViewRef.current?.reload();
  }, []);

  // Resolve a pending callback in the WebView
  const resolveCallback = useCallback((callbackId: number, result: any) => {
    if (!callbackId) return;
    webViewRef.current?.injectJavaScript(`
      window.__NATIVE_BRIDGE__?.resolve(${callbackId}, ${JSON.stringify(result)});
      true;
    `);
  }, []);

  // Reject a pending callback in the WebView
  const rejectCallback = useCallback((callbackId: number, error: string) => {
    if (!callbackId) return;
    webViewRef.current?.injectJavaScript(`
      window.__NATIVE_BRIDGE__?.reject(${callbackId}, ${JSON.stringify(error)});
      true;
    `);
  }, []);

  // Handle tab press — navigate WebView and provide haptic feedback
  const onTabPress = useCallback((tab: TabDef) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    webViewRef.current?.injectJavaScript(`
      window.location.href = '${tab.path}';
      true;
    `);
    setActiveTab(tab.key);
  }, []);

  // Handle messages from the WebView
  const onMessage = useCallback(async (event: WebViewMessageEvent) => {
    let data: { type: string; payload: any; callbackId?: number };
    try {
      data = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }

    const { type, payload, callbackId } = data;

    switch (type) {
      // --- URL Changed (SPA navigation tracking) ---
      case 'urlChanged': {
        if (payload?.url) {
          setActiveTab(getActiveTab(payload.url));
        }
        break;
      }

      // --- Haptic Feedback ---
      case 'haptic': {
        try {
          if (payload.style === 'light') {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          } else if (payload.style === 'medium') {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          } else if (payload.style === 'success') {
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
        } catch {
          // Haptics may not be available (e.g. simulator)
        }
        break;
      }

      // --- App Store Review Prompt ---
      case 'requestReview': {
        // OS rating dialog (SKStoreReviewController / Play In-App Review).
        // The OS decides whether it actually appears and never tells us, so
        // this is fire-and-forget. Web side throttles when it asks.
        try {
          if (await StoreReview.hasAction()) {
            await StoreReview.requestReview();
          }
        } catch {
          // Not available (e.g. simulator, unsigned build)
        }
        break;
      }

      // --- Native Share Sheet ---
      case 'share': {
        try {
          const message = Platform.OS === 'ios'
            ? payload.title
            : `${payload.title}\n${payload.url}`;
          await Share.share({
            message,
            url: payload.url, // iOS only
            title: payload.title,
          });
          if (callbackId) resolveCallback(callbackId, { success: true });
        } catch (e: any) {
          if (callbackId) rejectCallback(callbackId, e.message || 'Share failed');
        }
        break;
      }

      // --- Camera / Image Picker ---
      case 'camera': {
        try {
          const options: ImagePicker.ImagePickerOptions = {
            quality: 0.9,
            base64: true,
            exif: false,
          };

          let result: ImagePicker.ImagePickerResult;

          if (payload.source === 'camera') {
            const { status } = await ImagePicker.requestCameraPermissionsAsync();
            if (status !== 'granted') {
              if (callbackId) rejectCallback(callbackId, 'Camera permission denied');
              return;
            }
            result = await ImagePicker.launchCameraAsync(options);
          } else {
            result = await ImagePicker.launchImageLibraryAsync(options);
          }

          if (result.canceled) {
            if (callbackId) rejectCallback(callbackId, 'User cancelled');
          } else {
            const asset = result.assets[0];
            let base64 = asset.base64;

            // Read as base64 if not already provided
            if (!base64 && asset.uri) {
              base64 = await readAsStringAsync(asset.uri, {
                encoding: 'base64',
              });
            }

            const mimeType = asset.mimeType || 'image/jpeg';
            const dataUrl = `data:${mimeType};base64,${base64}`;
            const format = mimeType.split('/')[1] || 'jpeg';

            if (callbackId) resolveCallback(callbackId, { dataUrl, format });
          }
        } catch (e: any) {
          if (callbackId) rejectCallback(callbackId, e.message || 'Camera failed');
        }
        break;
      }

      // --- Push Notification Token Request ---
      case 'requestPushToken': {
        try {
          let token = pushTokenRef.current;
          if (!token) {
            token = await registerForPushNotifications();
            pushTokenRef.current = token;
          }
          if (token && callbackId) {
            resolveCallback(callbackId, { token, platform: Platform.OS });
          } else if (callbackId) {
            rejectCallback(callbackId, 'Push notifications not available');
          }
        } catch (e: any) {
          if (callbackId) rejectCallback(callbackId, e.message || 'Push registration failed');
        }
        break;
      }

      default:
        break;
    }
  }, [resolveCallback, rejectCallback]);

  if (hasError) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.errorContainer}>
          <StatusBar style="dark" />
          <Image
            source={require('./assets/others/FarmFedLogo.png')}
            style={styles.errorLogo}
            resizeMode="contain"
          />
          <Text style={styles.errorTitle}>Unable to Connect</Text>
          <Text style={styles.errorMessage}>
            Please check your internet connection and try again.
          </Text>
          <TouchableOpacity style={styles.retryButton} onPress={retry}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <StatusBar style="dark" />
        <WebView
          ref={webViewRef}
          source={{ uri: SITE_URL }}
          style={styles.webview}
          onNavigationStateChange={onNavigationStateChange}
          onLoadEnd={onLoadEnd}
          onError={onError}
          onHttpError={onHttpError}
          onMessage={onMessage}
          allowsBackForwardNavigationGestures={true}
          startInLoadingState={true}
          renderLoading={() => <LoadingIndicator />}
          pullToRefreshEnabled={Platform.OS === 'ios'}
          injectedJavaScriptBeforeContentLoaded={URL_TRACKING_JS}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          sharedCookiesEnabled={true}
          allowsInlineMediaPlayback={true}
          mediaPlaybackRequiresUserAction={false}
        />
        <TabBar activeTab={activeTab} onTabPress={onTabPress} />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  webview: {
    flex: 1,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#D1D1D6',
    paddingTop: 6,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  tabLabel: {
    fontSize: 10,
    marginTop: 2,
    fontWeight: '500',
  },
  loadingContainer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorContainer: {
    flex: 1,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  errorLogo: {
    width: 220,
    height: 70,
    marginBottom: 32,
  },
  errorTitle: {
    fontSize: 22,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 12,
  },
  errorMessage: {
    fontSize: 16,
    color: '#666666',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 32,
  },
  retryButton: {
    backgroundColor: '#2ecc71',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
});
