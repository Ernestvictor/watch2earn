# Watch2Earn - Setup & Run Instructions

## What Was Fixed
✅ Renamed `firebaseAdmin (1).js` → `firebaseAdmin.js` (was causing require errors)  
✅ Renamed `serviceAccountKey.json.json` → `serviceAccountKey.json`  
✅ All backend dependencies already in `package.json`  
✅ Logo, theme, notifications, account saving, referral system all implemented  

## Quick Start

### 1️⃣ Install Dependencies
```bash
cd c:\Users\User\Desktop\watch2earn
npm install
```

### 2️⃣ Environment Variables
Create `.env` in the project root (`c:\Users\User\Desktop\watch2earn\.env`):
```
PORT=3000
ADMIN_EMAIL=petervic3600@gmail.com
ADMIN_PASSWORD=Humblee3600$.
NODE_ENV=development
```

### 3️⃣ Start the Server
```bash
npm start
```

You should see:
```
✅ Watch2Earn REAL SITE + CRYPTO Running on http://localhost:3000
✅ Firebase Admin initialized
```

### 4️⃣ Access the Site
- **User Frontend**: http://localhost:3000
- **Sign Up**: http://localhost:3000/index.html
- **Login**: http://localhost:3000/login.html
- **Home**: http://localhost:3000/home.html
- **Admin Panel**: http://localhost:3000/admin.html

---

## Key Features Implemented

### Frontend
- ✅ SVG Watch2Earn logo on all pages
- ✅ Dark theme (default) with toggle option
- ✅ Notification sound (WebAudio beeps)
- ✅ Settings page: save/manage bank accounts and crypto wallets
- ✅ Withdraw page: select from saved accounts or enter new details
- ✅ Earn page: watch ads to earn (calls backend `/api/transactions/earn`)
- ✅ Logout page: sign user out
- ✅ Referral system: 10% bonus when invited friends earn

### Backend
- ✅ **POST /api/accounts** – Save bank/crypto accounts
- ✅ **GET /api/accounts** – List user's saved accounts
- ✅ **DELETE /api/accounts/:id** – Remove saved account
- ✅ **GET /api/accounts/:id** – Get single account details
- ✅ **POST /api/transactions/earn** – Record user earnings + referral bonus (10%)
- ✅ **POST /api/withdrawals** – Accept `accountId` to use saved accounts
- ✅ **GET /api/admin/dashboard/stats** – Admin stats (users, earnings, withdrawals)
- ✅ **POST /api/admin/dashboard/content** – Add ads/games/surveys/links
- ✅ **GET /api/admin/dashboard/content** – List content

---

## Firebase / Firestore Setup

### Enable Authentication
1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your project: **enable-authentication-1b56c**
3. Go to **Authentication** → **Sign-in method**
4. Enable **Email/Password**

### Enable Firestore
1. Go to **Firestore Database**
2. Create database in **Native mode** (location: US or your region)
3. Start in **test mode** (for local development)

### Firestore Security Rules (Optional - for testing)
Go to **Firestore** → **Rules** and use these permissive rules for local testing:
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Allow all reads/writes for testing
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

⚠️ **For production**: Use restrictive rules:
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users can only modify their own doc
    match /users/{uid} {
      allow read, write: if request.auth.uid == uid;
    }
    // Admin-only collections (backend admin SDK writes these)
    match /withdrawals/{doc=**} {
      allow read, write: if false; // Backend only
    }
    match /transactions/{doc=**} {
      allow read, write: if false; // Backend only
    }
  }
}
```

---

## Admin Panel Usage

### Login to Admin
1. Open http://localhost:3000/admin.html
2. Pre-filled email: `petervic3600@gmail.com`
3. Pre-filled password: `Humblee3600$.`
4. Click **Login**

### View Stats
- Total users (active/passive)
- Earnings overview
- Pending withdrawals count

### Add Content (Ads/Games/Surveys)
1. Select content type (Ad, Game, Survey, Link)
2. Enter JSON data, e.g.:
```json
{"title":"New Ad","payout":50,"duration":30}
```
3. Click **Add**

---

## Referral System

### How It Works
1. User signs up with referral link: `http://localhost:3000/index.html?ref=USERID`
2. Server records `referredBy` in user document
3. When referred user earns, referrer gets **10% bonus**
4. Example:
   - User earns ₦100 from ad
   - Company pays ₦333 (100 is 30% of 333)
   - Referrer gets ₦10 (10% of user's ₦100)

### Generate Referral Link
Each user sees their referral link in the **Account** → **Invite Friends** section.

---

## Withdrawal Flow

### User Steps
1. Go to **Withdraw** page
2. Select Naira or Crypto
3. Choose tier/amount
4. Either:
   - Use saved account (Settings page) → click "Use" button
   - Enter new account details directly
5. Confirm withdrawal (goes to Firestore as "Pending")

### Admin Approval (Backend Only Currently)
Approve/reject via API:
```bash
# Approve withdrawal
curl -X POST http://localhost:3000/api/admin/withdrawals/:id/approve \
  -H "x-admin-email: petervic3600@gmail.com" \
  -H "x-admin-password: Humblee3600$."

# Reject withdrawal
curl -X POST http://localhost:3000/api/admin/withdrawals/:id/reject \
  -H "x-admin-email: petervic3600@gmail.com" \
  -H "x-admin-password: Humblee3600$." \
  -H "Content-Type: application/json" \
  -d '{"reason":"Insufficient funds"}'
```

---

## Troubleshooting

### "Firebase Admin not initialized"
✅ Already fixed! Check that `config/firebaseAdmin.js` exists (not the old `firebaseAdmin (1).js`)

### "serviceAccountKey.json not found"
✅ Already fixed! Check that `config/serviceAccountKey.json` exists (single `.json`, not double)

### Port 3000 already in use
Change PORT in `.env`:
```
PORT=3001
```

### "auth/email-already-in-use" on signup
This is expected if you sign up twice with same email. Try login instead.

### Firestore not working
- Ensure Firestore database is created in Firebase Console
- Check that database is in "Native mode" (not Datastore)
- Verify serviceAccountKey.json has correct credentials

---

## File Structure
```
watch2earn/
├── server.js                 # Express server + routes
├── package.json              # Dependencies
├── .env                       # Environment variables (create this)
├── config/
│   ├── firebaseAdmin.js      # Firebase Admin SDK init
│   └── serviceAccountKey.json # Service account credentials
├── middleware/
│   └── auth.js               # JWT + admin auth
├── routes/
│   ├── ads.js                # Ad endpoints
│   ├── users.js              # User management
│   ├── transactions.js        # Earnings + referral logic
│   ├── withdrawals.js         # Withdrawal requests
│   ├── accounts.js            # Save/list accounts (NEW)
│   └── admin.js               # Admin stats/content (NEW)
└── public/
    ├── assets/
    │   └── logo.svg           # Watch2Earn logo (NEW)
    ├── js/
    │   └── app.js             # Shared helpers (NEW)
    ├── index.html             # Signup + referral tracking (UPDATED)
    ├── login.html             # Login
    ├── home.html              # Dashboard (UPDATED with logo)
    ├── earn.html              # Watch ads (UPDATED with earn endpoint)
    ├── account.html           # User profile (UPDATED with logo)
    ├── settings.html          # Settings + save accounts (UPDATED)
    ├── withdraw.html          # Withdrawal (UPDATED with saved accounts)
    ├── history.html           # Transaction history
    ├── logout.html            # Logout page (NEW)
    ├── admin.html             # Admin panel (NEW)
    └── ...other pages
```

---

## Next Steps (Optional Enhancements)

### Payment Integration
- Add Paystack API for real payments
- Add Flutterwave for bank payouts
- Add crypto payment gateway

### Admin Dashboard
- Add charts (/Chart.js) for stats visualization
- Add approval/rejection UI (currently API-only)
- Add fraud detection interface

---

## SMTP / Gmail (Admin email)

To have admin messages and notifications sent from your Gmail account (watch2earn36@gmail.com) configure SMTP environment variables in your `.env`:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=watch2earn36@gmail.com
# Use an app password generated in your Google account (recommended)
SMTP_PASS=your_gmail_app_password_here
FROM_EMAIL=watch2earn36@gmail.com
```

Notes:
- For Gmail, create an App Password (recommended) and use it as `SMTP_PASS`.
- The server will fallback to console if SMTP is not configured.

### Notifications
- Replace WebAudio beeps with .mp3 files
- Add web push notifications
- Add email notifications

### Security
- Add rate limiting (express-rate-limit)
- Add input validation (joi/express-validator)
- Add CAPTCHA for signup
- Harden Firestore rules for production

---

## Support
If you see errors when running `npm start`, check:
1. Node.js and npm are installed: `node -v && npm -v`
2. All dependencies installed: `npm install`
3. `.env` file exists with correct credentials
4. `config/firebaseAdmin.js` and `config/serviceAccountKey.json` exist
5. Firebase project is set up and Firestore database created
    