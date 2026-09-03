// ⚠️ DEPRECATED: This project uses MongoDB only (via mongoose and mongodb native driver)
// Do not use this file anymore. All data should be stored in MongoDB.
// This stub is kept only for backward compatibility.

const db = {
  query(sql, params = []) {
    throw new Error('❌ PostgreSQL/SQLite is deprecated. Use MongoDB only. Set MONGODB_URI env var.');
  },
  all(sql, params = [], cb) {
    const err = new Error('❌ PostgreSQL/SQLite is deprecated. Use MongoDB only.');
    if (typeof cb === 'function') return cb(err);
    return Promise.reject(err);
  },
  get(sql, params = [], cb) {
    const err = new Error('❌ PostgreSQL/SQLite is deprecated. Use MongoDB only.');
    if (typeof cb === 'function') return cb(err);
    return Promise.reject(err);
  },
  run(sql, params = [], cb) {
    const err = new Error('❌ PostgreSQL/SQLite is deprecated. Use MongoDB only.');
    if (typeof cb === 'function') return cb(err);
    return Promise.reject(err);
  },
  read(fileKey) {
    throw new Error('❌ JSON file storage is deprecated. Use MongoDB only.');
  },
  write(fileKey, data) {
    throw new Error('❌ JSON file storage is deprecated. Use MongoDB only.');
  },
  close() {
    return Promise.resolve();
  }
};

module.exports = db;