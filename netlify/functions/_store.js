const { getStore } = require('@netlify/blobs');

let STORE = null;
const KEYS = {
  analytics: 'analytics-events',
  calls: 'debug-calls',
};

const LIMITS = {
  analytics: 10000,
  calls: 500,
};

function store() {
  if (STORE) return STORE;
  try {
    STORE = getStore('tawano-live-data');
    return STORE;
  } catch (error) {
    console.error('Netlify Blobs unavailable:', error.message);
    return null;
  }
}

async function readArray(key) {
  const s = store();
  if (!s) return [];
  const data = await s.get(key, { type: 'json' });
  return Array.isArray(data) ? data : [];
}

async function writeArray(key, list) {
  const safe = Array.isArray(list) ? list : [];
  const s = store();
  if (s) await s.setJSON(key, safe);
  return safe;
}

async function readValue(key, fallback = null) {
  const s = store();
  if (!s) return fallback;
  const data = await s.get(key, { type: 'json' });
  return data == null ? fallback : data;
}

async function writeValue(key, value) {
  const s = store();
  if (s) await s.setJSON(key, value);
  return value;
}

async function appendLimited(key, item, maxSize) {
  const list = await readArray(key);
  list.push(item);
  if (list.length > maxSize) {
    list.splice(0, list.length - maxSize);
  }
  const s = store();
  if (s) await s.setJSON(key, list);
  return list;
}

module.exports = {
  KEYS,
  LIMITS,
  readArray,
  writeArray,
  readValue,
  writeValue,
  appendLimited,
};
