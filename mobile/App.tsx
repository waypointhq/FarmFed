import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ActivityIndicator, BackHandler, Linking, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as StoreReview from 'expo-store-review';
import Constants from 'expo-constants';

const SITE_URL = (Constants.expoConfig?.extra as any)?.siteUrl || 'https://www.farmfed.us';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

const registerForPushNotifications = async (): Promise<{ token: string; platform: string } | null> => {
  if (!Device.isDevice) return null;

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
    });
  }

  const projectId =
    (Constants.expoConfig?.extra as any)?.eas?.projectId ||
    (Constants as any).easConfig?.projectId;
  const tokenResp = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  return { token: tokenResp.data, platform: Platform.OS };
};

const triggerHaptic = (style: string | undefined) => {
  switch (style) {
    case 'light':
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      break;
    case 'medium':
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      break;
    case 'heavy':
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      break;
    case 'success':
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      break;
    case 'warning':
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      break;
    case 'error':
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      break;
    default:
      Haptics.selectionAsync();
  }
};

const pickImage = async (source: 'camera' | 'library' | undefined) => {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error('Camera permission denied');
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      base64: true,
    });
    if (result.canceled) return null;
    const asset = result.assets[0];
    return { uri: asset.uri, base64: asset.base64, mimeType: asset.mimeType || 'image/jpeg' };
  }
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error('Photo library permission denied');
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.85,
    base64: true,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  return { uri: asset.uri, base64: asset.base64, mimeType: asset.mimeType || 'image/jpeg' };
};

export default function App() {
  const webViewRef = useRef<WebView>(null);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [pushPlatform, setPushPlatform] = useState<string>(Platform.OS);
  const [loading, setLoading] = useState(true);

  // Register for push on launch; we'll inject the token into the WebView when both
  // the page is loaded and the token has resolved.
  useEffect(() => {
    registerForPushNotifications()
      .then(result => {
        if (result?.token) {
          setPushToken(result.token);
          setPushPlatform(result.platform);
        }
      })
      .catch(err => console.warn('Push registration failed:', err));
  }, []);

  const injectPushToken = useCallback(() => {
    if (!pushToken || !webViewRef.current) return;
    const escaped = pushToken.replace(/[\\"']/g, '\\$&');
    const platform = pushPlatform.replace(/[\\"']/g, '\\$&');
    webViewRef.current.injectJavaScript(`
      window.__EXPO_PUSH_TOKEN__ = "${escaped}";
      window.__EXPO_PUSH_PLATFORM__ = "${platform}";
      true;
    `);
  }, [pushToken, pushPlatform]);

  useEffect(() => {
    injectPushToken();
  }, [injectPushToken]);

  // Hardware Android back button → WebView goBack if possible
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (webViewRef.current) {
        webViewRef.current.goBack();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, []);

  const handleMessage = async (event: WebViewMessageEvent) => {
    let msg: any;
    try {
      msg = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    const { type, payload, callbackId } = msg || {};
    const respond = (result?: any, error?: string) => {
      if (callbackId == null || !webViewRef.current) return;
      const safe = JSON.stringify(error ? { error } : result || null);
      if (error) {
        webViewRef.current.injectJavaScript(
          `window.__NATIVE_BRIDGE__ && window.__NATIVE_BRIDGE__.reject(${callbackId}, ${JSON.stringify(error)}); true;`
        );
      } else {
        webViewRef.current.injectJavaScript(
          `window.__NATIVE_BRIDGE__ && window.__NATIVE_BRIDGE__.resolve(${callbackId}, ${safe}); true;`
        );
      }
    };

    try {
      switch (type) {
        case 'requestPushToken': {
          if (pushToken) return respond({ token: pushToken, platform: pushPlatform });
          const fresh = await registerForPushNotifications();
          if (fresh?.token) {
            setPushToken(fresh.token);
            setPushPlatform(fresh.platform);
            return respond({ token: fresh.token, platform: fresh.platform });
          }
          return respond({ token: null, platform: pushPlatform });
        }
        case 'haptic': {
          triggerHaptic(payload?.style);
          return; // fire-and-forget, no respond
        }
        case 'requestReview': {
          // OS rating dialog (SKStoreReviewController / Play In-App Review).
          // The OS decides whether it actually appears and never tells us, so
          // this is fire-and-forget.
          if (await StoreReview.hasAction()) {
            await StoreReview.requestReview();
          }
          return;
        }
        case 'camera': {
          const result = await pickImage(payload?.source);
          return respond(result);
        }
        case 'share': {
          // expo-sharing requires a file URI; for URLs Linking is simplest
          if (payload?.url) Linking.openURL(payload.url);
          return respond({ ok: true });
        }
        default:
          return respond(null, `Unknown bridge message type: ${type}`);
      }
    } catch (e: any) {
      respond(undefined, e?.message || String(e));
    }
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <StatusBar style="dark" />
        <WebView
          ref={webViewRef}
          source={{ uri: SITE_URL }}
          onMessage={handleMessage}
          onLoadEnd={() => {
            setLoading(false);
            injectPushToken();
          }}
          allowsBackForwardNavigationGestures
          pullToRefreshEnabled
          domStorageEnabled
          javaScriptEnabled
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          mixedContentMode="compatibility"
          decelerationRate="normal"
          originWhitelist={['*']}
          setSupportMultipleWindows={false}
          onShouldStartLoadWithRequest={req => {
            // Only redirect actual user link clicks to the system browser.
            // Subresource loads (scripts like Stripe's js.stripe.com, iframes,
            // mapbox tiles, etc.) come through as navigationType "other" and
            // must be allowed inside the WebView.
            if (req.navigationType !== 'click') return true;
            try {
              const url = new URL(req.url);
              const target = new URL(SITE_URL);
              if (url.host && url.host !== target.host) {
                Linking.openURL(req.url);
                return false;
              }
            } catch {
              /* allow */
            }
            return true;
          }}
        />
        {loading ? (
          <View style={styles.loading} pointerEvents="none">
            <ActivityIndicator size="large" />
          </View>
        ) : null}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  loading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
});
