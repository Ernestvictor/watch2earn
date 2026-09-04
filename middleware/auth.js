const { auth } = require('../config/firebaseAdmin');

async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  if (!auth || typeof auth.verifyIdToken !== 'function') {
    return res.status(503).json({ error: 'Firebase auth is not configured on this server.' });
  }

  try {
    const decoded = await auth.verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = verifyToken;
