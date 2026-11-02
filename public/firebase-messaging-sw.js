// ==========================================
// firebase-messaging-sw.js — バックグラウンドプッシュ通知＆クリック制御用 Service Worker
// ==========================================
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js');

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

firebase.initializeApp({
  apiKey: "AIzaSyDQTfLhyuc8PEoMtw-FvEq4k9HShRJz_io",
  authDomain: "duofit-app-75cb2.firebaseapp.com",
  projectId: "duofit-app-75cb2",
  storageBucket: "duofit-app-75cb2.firebasestorage.app",
  messagingSenderId: "949622687026",
  appId: "1:949622687026:web:bcc53a734a31fc1a2a432b",
});

const messaging = firebase.messaging();

// データのみ（data-only）のペイロードが届いた場合のフォールバック表示
messaging.onBackgroundMessage((payload) => {
  if (payload && payload.notification) {
    // notificationフィールドがある場合はブラウザのFCM SDKが自動表示するため二重表示しない
    return;
  }
  const data = (payload && payload.data) || {};
  const title = data.title || 'WithFit';
  const options = {
    body: data.body || '新しい通知があります',
    icon: '/logo192.png',
    badge: '/logo192.png',
    tag: data.tag || `withfit_${Date.now()}`,
    data: data,
  };
  self.registration.showNotification(title, options);
});

// 通知タップ時にアプリをフォーカスまたは起動して対象画面へ遷移
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const notifData = event.notification.data || {};
  const targetUrl = notifData.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.postMessage({
            type: 'NOTIFICATION_CLICK',
            data: notifData,
          });
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return null;
    })
  );
});

// ==========================================
// アプリ本体のキャッシュ（起動高速化）
// ハッシュ付き静的ファイルはキャッシュ優先、画面遷移はネット優先（落ちたらキャッシュ）
// ==========================================
const STATIC_CACHE = 'withfit-static-v1';
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('withfit-static-') && k !== STATIC_CACHE).map((k) => caches.delete(k))))
  );
});
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/static/')) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(event.request);
        if (hit) return hit;
        const res = await fetch(event.request);
        if (res && res.ok) cache.put(event.request, res.clone());
        return res;
      })
    );
  } else if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).then(async (res) => {
        const cache = await caches.open(STATIC_CACHE);
        cache.put('/index.html', res.clone());
        return res;
      }).catch(() => caches.match('/index.html'))
    );
  }
});
