// ==========================================
// api/pushStats.js — プッシュ登録台数の一覧（マスター専用）
// ・各ユーザーの登録端末「台数だけ」を返す。トークンの値そのものは返さない。
//   送信先ごとの登録台数は金庫（privateAccounts）側にしか無く、他人の金庫は
//   クライアントから読めないため、サーバー側で数えて件数だけを返す。
// ・呼び出しは本人のIDトークン必須。呼び出し元がマスター（ゆうた）と
//   確認できた場合のみ応答する。
// ==========================================
const { getApps, initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const https = require('https');
const crypto = require('crypto');

const MASTER_USER = 'ゆうた';
const PLACEHOLDER_TOKEN = 'ios_native_local_notification_enabled';

let adminReady = false;
try {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY
          ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
          : undefined,
      }),
    });
  }
  adminReady = Boolean(
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  );
} catch (e) {
  adminReady = false;
}

// --- Firebase ID トークン検証（findUserByUid と同じ自前実装） ---
let cachedGoogleCerts = null;
let cachedGoogleCertsExpireAt = 0;

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (resp) => {
      let d = '';
      resp.on('data', c => { d += c; });
      resp.on('end', () => {
        try { resolve({ json: JSON.parse(d), headers: resp.headers }); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function getGoogleCerts() {
  const now = Date.now();
  if (cachedGoogleCerts && now < cachedGoogleCertsExpireAt) return cachedGoogleCerts;
  const { json, headers } = await fetchJson('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
  let maxAge = 3600;
  const m = String(headers['cache-control'] || '').match(/max-age=(\d+)/);
  if (m) maxAge = parseInt(m[1], 10);
  cachedGoogleCerts = json;
  cachedGoogleCertsExpireAt = now + maxAge * 1000;
  return json;
}

function b64urlDecodeToBuffer(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

async function verifyFirebaseIdToken(idToken, projectId) {
  const parts = String(idToken).split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const header = JSON.parse(b64urlDecodeToBuffer(parts[0]).toString('utf8'));
  const payload = JSON.parse(b64urlDecodeToBuffer(parts[1]).toString('utf8'));
  if (header.alg !== 'RS256' || !header.kid) throw new Error('bad header');
  const nowSec = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp <= nowSec) throw new Error('expired');
  if (payload.aud !== projectId) throw new Error('bad aud');
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('bad iss');
  if (!payload.sub) throw new Error('bad sub');
  const certs = await getGoogleCerts();
  const pem = certs[header.kid];
  if (!pem) throw new Error('unknown kid');
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${parts[0]}.${parts[1]}`);
  if (!verifier.verify(pem, b64urlDecodeToBuffer(parts[2]))) throw new Error('bad signature');
  return payload;
}

// 簡易レート制限（同一subから1分に20回まで）
const attempts = new Map();
function throttled(key) {
  const now = Date.now();
  const arr = (attempts.get(key) || []).filter(t => now - t < 60 * 1000);
  arr.push(now);
  attempts.set(key, arr);
  return arr.length > 20;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  if (!adminReady) {
    return res.status(501).json({ error: 'Server is not configured' });
  }

  const idToken = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!idToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  let caller;
  try {
    caller = await verifyFirebaseIdToken(idToken, process.env.FIREBASE_PROJECT_ID);
  } catch (e) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (throttled('uid:' + caller.sub)) {
    return res.status(429).json({ error: 'Too many attempts' });
  }

  try {
    const db = getFirestore();
    const base = 'artifacts/withfit-app/public/data';
    const privColl = db.collection(`${base}/privateAccounts`);

    // 呼び出し元のユーザー名を解決する（カスタムトークンは sub=ユーザー名、
    // Google/Apple は金庫の連携情報、それでも無ければ uidMap）
    let callerName = null;
    const ownDoc = await privColl.doc(caller.sub).get();
    if (ownDoc.exists) callerName = caller.sub;
    if (!callerName) {
      for (const field of ['googleUid', 'appleUid']) {
        const snap = await privColl.where(field, '==', caller.sub).limit(1).get();
        if (!snap.empty) { callerName = snap.docs[0].id; break; }
      }
    }
    if (!callerName) {
      const mapSnap = await db.doc(`${base}/uidMap/${caller.sub}`).get();
      if (mapSnap.exists && mapSnap.data().username) callerName = mapSnap.data().username;
    }
    if (callerName !== MASTER_USER) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // 全ユーザーの登録台数を数える（金庫と公開側の合算、重複とプレースホルダは除く）
    const tokenSets = new Map();
    const collect = (username, data) => {
      if (!username || !data) return;
      if (!tokenSets.has(username)) tokenSets.set(username, new Set());
      const set = tokenSets.get(username);
      const list = [
        ...(Array.isArray(data.fcmTokens) ? data.fcmTokens : []),
        data.fcmToken,
      ];
      for (const t of list) {
        if (typeof t === 'string' && t.trim().length > 0 && t !== PLACEHOLDER_TOKEN) set.add(t);
      }
    };
    const [privSnap, accSnap] = await Promise.all([
      privColl.get(),
      db.collection(`${base}/accounts`).get(),
    ]);
    privSnap.forEach(d => collect(d.id, d.data()));
    accSnap.forEach(d => collect(d.id, d.data()));

    const counts = {};
    for (const [username, set] of tokenSets.entries()) {
      counts[username] = set.size;
    }
    return res.status(200).json({ counts });
  } catch (e) {
    console.error('pushStats error:', e);
    return res.status(500).json({ error: 'Internal error' });
  }
};
