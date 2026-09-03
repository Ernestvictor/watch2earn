Watch2Earn Refactor Summary
===========================

Date: 2026-09-03

What I completed
- Guarded Firebase middleware so routes don't crash when Firebase Admin isn't configured (`middleware/auth.js`).
- Converted the majority of route logic away from JSON file fallbacks; JSON storage removed from 5 of 7 major routes (progress: 5/7).
- Added a tracked TODO list for the remaining refactor tasks.

Additional changes applied (2026-09-03):
- Standardized `models/users.js` so `balance` is the canonical field and added a `wallet` virtual for compatibility.
- Replaced `db.js` with a migration stub that clearly errors if used (encourages using MongoDB only).
- Added `.env` to `.gitignore` to avoid committing local secrets.
 - Converted suspend appeals storage from JSON files to MongoDB `Appeal` collection (`models/appeal.js` and `routes/users.js`).

What remains (high priority)
1. Consolidate all data access to MongoDB only. Remove all JSON file reads/writes across routes (admin.js, users.js, withdrawals.js, others).
2. Standardize the `User` schema: choose single canonical balance field, remove duplicate `wallet` syncing quirks, and update all routes to use it.
3. Replace `db.js` JSON fallback with Mongo-only implementations or safe stubs that clearly error.
4. Rotate any secrets found in repository or `.env`, add `.env` to `.gitignore`, and ensure production secrets live in deployment settings.
5. Run integration/startup smoke tests and fix any remaining route regressions.

Migration path (recommended order)
- Step 1: Ensure `MONGODB_URI` is set in your `.env` or deployment environment and that Mongo is reachable.
- Step 2: Update `models/User.js` to a single canonical balance field (e.g., `balance` in cents) and remove `wallet` or make it an alias only.
- Step 3: Update all routes to use Mongoose models / native Mongo collections exclusively. Remove JSON file reads/writes.
- Step 4: Remove or archive `db.js` and `data/` JSON files after migration and verification.
- Step 5: Add safe guards in `config/firebaseAdmin.js` and `middleware/auth.js` so the app starts even if Firebase is disabled (but document missing feature).
- Step 6: Run `node server.js` and exercise key endpoints: `/api/ad-check`, `/api/earning`, `/api/withdrawals`, admin routes.

Quick test commands
```bash
# install (if needed)
npm ci
# start
node server.js
# curl examples
curl http://localhost:3000/api/ad-check?email=test@example.com
```

Notes & risks
- There are live secrets in the current `.env`; rotate any keys that were committed. Do not commit `SERVICE_ACCOUNT_KEY` or similar.
- Mixing JSON and Mongo during migration can create split-brain issues. Migrate user records carefully (export/import or write transitional code to copy JSON -> Mongo once).

Next steps I can take (pick one)
- Finish converting remaining routes to MongoDB-only (I can do `admin.js`, `users.js`, `withdrawals.js`).
- Standardize `models/User.js` and update dependent routes.
- Run smoke tests and fix failures.

Files touched / created
- `REFACTOR_SUMMARY.md` (this file)

If you want, I’ll continue by standardizing `User` and finishing the remaining route conversions. Reply with which next step to run.
