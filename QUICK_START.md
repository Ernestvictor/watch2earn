# Watch2Earn Quick Start Guide

## ⚡ Fast Setup (3 Steps)

### Step 1: Double-click `run.bat`
The batch file will automatically:
- Install dependencies
- Check firebase-admin
- Start the server

### Step 2: Wait for server to start
Look for this message:
```
✅ Firebase Admin SDK fully initialized and ready!
✅ Watch2Earn REAL SITE + CRYPTO Running on http://localhost:3000
```

### Step 3: Open in browser
- **Main App**: http://localhost:3000
- **Admin Panel**: http://localhost:3000/admin.html
  - Email: `petervic3600@gmail.com`
  - Password: `Humblee3600$.`

---

## 🛠️ Manual Setup (if run.bat fails)

Open Command Prompt in your project folder and run:

```
cd c:\Users\User\Desktop\watch2earn
npm install
npm start
```

### If firebase-admin still fails:
```
npm cache clean --force
npm install
npm start
```

### If that doesn't work:
```
npm uninstall firebase-admin
npm install firebase-admin@14.2.0
npm start
```

---

## 📱 Test the App

### 1. Sign Up (Fresh Account)
- Go to: http://localhost:3000
- Create new account
- To test referrals, use URL: `http://localhost:3000?ref=REFERRER_EMAIL`

### 2. Earn Money (Watch Ads)
- Page: http://localhost:3000/earn.html
- Click "Watch Ad" button
- Should see earning balance update
- Referrer should automatically get 10% bonus

### 3. Withdraw
- Page: http://localhost:3000/withdraw.html
- Save bank/crypto account in Settings first
- Request withdrawal
- Admin can approve from admin panel

### 4. Admin Dashboard
- URL: http://localhost:3000/admin.html
- Login with provided credentials
- View stats and manage content

---

## 🔧 Configuration

Edit `.env` file:
```
ADMIN_EMAIL=petervic3600@gmail.com
ADMIN_PASSWORD=Humblee3600$.
PORT=3000
NODE_ENV=development
```

---

## ❌ Common Issues

### "Port 3000 already in use"
Change PORT in .env to 3001, 3002, etc.

### "Cannot connect to database"
Make sure `config/serviceAccountKey.json` exists (check SETUP.md for how to get it)

### "firebase-admin error"
Run: `npm uninstall firebase-admin && npm install firebase-admin@14.2.0`

---

## 📚 Full Documentation
See [SETUP.md](SETUP.md) for complete setup guide with Firebase configuration.
