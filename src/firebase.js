// ==========================================
// firebase.js — Firebase 初期化・設定モジュール
// ==========================================
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, enableIndexedDbPersistence } from 'firebase/firestore';

// Firebase の接続設定はソースコードに直接書かず、ビルド時の環境変数から読み込む。
// - PWA: Vercel プロジェクトの環境変数（REACT_APP_FIREBASE_*）
// - ネイティブ: GitHub Actions の Secrets を ios-build ワークフロー経由で注入
// 値そのものはクライアント配布前提の公開キーだが、リポジトリには残さない方針。
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY || '',
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN || '',
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID || '',
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: process.env.REACT_APP_FIREBASE_APP_ID || '',
  measurementId: process.env.REACT_APP_FIREBASE_MEASUREMENT_ID || ''
};

// --- Firebase 初期化 ---
let app, auth, db, appId = 'withfit-app';
const FIREBASE_PROJECT_ID = firebaseConfig.projectId;

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);

  if (typeof window !== 'undefined') {
    enableIndexedDbPersistence(db).catch((err) => {
      console.warn("Offline persistence error:", err.code);
    });
  }
} catch (error) {
  console.error("Firebase initialization error:", error);
}

export {
  app,
  auth,
  db,
  appId,
  FIREBASE_PROJECT_ID,
  firebaseConfig
};
