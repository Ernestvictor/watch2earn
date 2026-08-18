# MongoDB Schemas (models/)

This file documents the Mongoose schemas found in `models/` for quick reference.

---

## User (`models/users.js` / `models/User.js`)
- firebaseUid: String, required, unique, index, sparse
- email: String, required, index, sparse
- username: String
- displayName: String, default ''
- wallet: Number, default 0, min 0
- balance: Number, default 0, min 0
- totalEarned: Number, default 0, min 0
- referredBy: ObjectId -> `User`, default null
- lastAdShowTime: Date, default null
- isBanned: Boolean, default false
- isDisabled: Boolean, default false
- timestamps: `createdAt`, `updatedAt`

Notes: `wallet` and `balance` are numeric NGN values in Naira; some parts of the app convert USD <-> NGN.

---

## Message (`models/messeges.js` / `models/Message.js`)
- userId: ObjectId -> `User`, required, index
- firebaseUid: String, index
- message: String, required
- type: String enum ['earning', 'withdrawal', 'system', 'warning'], default 'earning'
- read: Boolean, default false
- timestamps

---

## History (`models/history.js`)
- userId: ObjectId -> `User`, required, index
- firebaseUid: String, index
- type: String enum ['earning','withdrawal','bonus','referral','ad_watch','offer_click','signup_bonus','consecutive_bonus','system','warning','other'], default 'other'
- amount: Number, default 0, min 0
- description: String
- referenceId: String (external id)
- status: String enum ['pending','success','failed'], default 'success'
- metadata: Mixed (flexible object)
- timestamps

---

## Earning (`models/earning.js`)
- userId: ObjectId -> `User`, required, index
- firebaseUid: String, index
- amount: Number, required, min 0
- type: String enum ['ad_watch','referral','bonus','withdrawal','offer_click'], required
- description: String
- timestamps (createdAt used as transaction date)

---

If you want, I can:
- Create JSON Schema files for each model
- Add TypeScript interfaces or JSDoc types
- Migrate any remaining file-based flows to MongoDB-backed flows consistently

Tell me which next step you'd like.