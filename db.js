const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const FILES = {
  messages: path.join(DATA_DIR, 'messages.json'),
  settings: path.join(DATA_DIR, 'settings.json'),
  transactions: path.join(DATA_DIR, 'transactions.json'),
  withdrawals: path.join(DATA_DIR, 'withdrawals.json'),
  accounts: path.join(DATA_DIR, 'accounts.json'),
  users: path.join(DATA_DIR, 'users.json')
};

function ensureDataFiles() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const [key, filePath] of Object.entries(FILES)) {
    if (!fs.existsSync(filePath)) {
      const fallback =
        key === 'messages' ? '[]' :
        key === 'settings' ? JSON.stringify({ dailyAdLimit: 5, bonusAdCount: 0, lastAnnouncement: '' }, null, 2) :
        key === 'transactions' ? '[]' :
        key === 'withdrawals' ? '[]' :
        key === 'accounts' ? '[]' :
        '[]';
      fs.writeFileSync(filePath, fallback);
    }
  }
}

function readJSON(filePath, fallback) {
  ensureDataFiles();
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    return fallback;
  }
}

function writeJSON(filePath, data) {
  ensureDataFiles();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function routeData(fileKey) {
  return { filePath: FILES[fileKey], fallback: fileKey === 'settings' ? { dailyAdLimit: 5, bonusAdCount: 0, lastAnnouncement: '' } : [] };
}

const db = {
  query(sql, params = []) {
    return Promise.resolve({ rows: [] });
  },
  all(sql, params = [], cb) {
    if (typeof cb === 'function') {
      cb(null, readJSON(FILES.withdrawals, []));
      return;
    }
    return Promise.resolve(readJSON(FILES.withdrawals, []));
  },
  get(sql, params = [], cb) {
    if (typeof cb === 'function') {
      cb(null, null);
      return;
    }
    return Promise.resolve(null);
  },
  run(sql, params = [], cb) {
    if (typeof cb === 'function') {
      cb(null, { changes: 0, lastID: 0 });
      return;
    }
    return Promise.resolve({ changes: 0, lastID: 0 });
  },
  read(fileKey) {
    const { filePath, fallback } = routeData(fileKey);
    return readJSON(filePath, fallback);
  },
  write(fileKey, data) {
    const { filePath } = routeData(fileKey);
    writeJSON(filePath, data);
  },
  close() {
    return Promise.resolve();
  }
};

module.exports = db;