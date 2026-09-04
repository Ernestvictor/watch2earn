const { auth } = require('../config/firebaseAdmin');
const User = require('../models/users');

async function ensureMongoUser(decoded) {
  if (!decoded || !decoded.uid) return null;

  const normalizedEmail = String(decoded.email || '').trim().toLowerCase();
  const safeName = (decoded.name || (normalizedEmail ? normalizedEmail.split('@')[0] : 'User') || 'User').trim();

  let user = await User.findOne({
    $or: [
      { firebaseUid: decoded.uid },
      { uid: decoded.uid },
      { id: decoded.uid },
      ...(normalizedEmail ? [{ email: normalizedEmail }] : [])
    ]
  });

  if (user) {
    const updates = {};
    if (!user.firebaseUid && decoded.uid) updates.firebaseUid = decoded.uid;
    if (!user.uid && decoded.uid) updates.uid = decoded.uid;
    if (!user.id && decoded.uid) updates.id = decoded.uid;
    if (normalizedEmail && !user.email) updates.email = normalizedEmail;
    if (!user.displayName && safeName) updates.displayName = safeName;
    if (!user.username && safeName) updates.username = safeName;
    if (Object.keys(updates).length) {
      user = await User.findOneAndUpdate(
        { _id: user._id },
        { $set: updates },
        { new: true }
      );
    }
    return user;
  }

  user = await User.create({
    firebaseUid: decoded.uid,
    uid: decoded.uid,
    id: decoded.uid,
    email: normalizedEmail || `${decoded.uid}@firebase.local`,
    username: safeName,
    displayName: safeName,
    wallet: 0,
    balance: 0,
    totalEarned: 0,
    status: 'active',
    isBanned: false,
    isSuspended: false,
    isDisabled: false
  });

  return user;
}

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
    req.mongoUser = await ensureMongoUser(decoded);
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = verifyToken;
module.exports.ensureMongoUser = ensureMongoUser;
