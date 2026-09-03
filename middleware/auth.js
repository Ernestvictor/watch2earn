const { auth } = require('../config/firebaseAdmin');

async function verifyToken(req, res, next) {
  if (!auth || typeof auth.verifyIdToken !== 'function') {
    return res.status(503).json({ error: 'Firebase auth is not configured' });
  }

  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const decoded = await auth.verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = verifyToken;
