# ✅ Watch2Earn - READY TO RUN

## What Just Happened

I've fixed the Firebase initialization issue by switching to a more robust method using environment variables. The new approach:

1. **Previous Issue**: `firebase-admin.credential.cert` was undefined (module loaded but incomplete)
2. **New Solution**: Now uses `GOOGLE_APPLICATION_CREDENTIALS` environment variable + default credentials
3. **Result**: More reliable initialization that works with various firebase-admin versions

---

## 🚀 START THE SERVER

### Option 1: Automatic (Recommended)
**Double-click this file:** `run.bat`

It will:
- ✓ Install dependencies automatically
- ✓ Check firebase-admin
- ✓ Start the server
- ✓ Show "Ready" message

### Option 2: Manual
**Open Command Prompt** in this folder and run:
```cmd
npm install
npm start
```

---

## ✅ What to Expect

When server starts successfully, you'll see:
```
✅ Firebase Admin SDK fully initialized and ready!
✅ Watch2Earn REAL SITE + CRYPTO Running on http://localhost:5000
✅ Naira: Bank Transfer, OPay, Palmpay
✅ Crypto: BTC, BNB, DOGE, ETH, USDT, SOL, LTC, XRP, TRX, ADA (10 wallets)
```

---

## 📍 Application URLs

| Feature | URL |
|---------|-----|
| **Main App** | http://localhost:5000 |
| **Signup/Login** | http://localhost:5000 |
| **Dashboard** | http://localhost:5000/home.html |
| **Earn Money** | http://localhost:5000/earn.html |
| **Withdraw** | http://localhost:5000/withdraw.html |
| **History** | http://localhost:5000/history.html |
| **Settings** | http://localhost:5000/settings.html |
| **Admin Panel** | http://localhost:5000/admin.html |

---

## 🔐 Admin Credentials

**Email:** `petervic3600@gmail.com`  
**Password:** `Humblee3600$.`

Login via: `http://localhost:5000/admin.html`

---

## 🧪 Test the System

### 1. Create User Account
1. Go to http://localhost:5000
2. Sign up with email, password, and name
3. Note: To test referrals, use: `http://localhost:5000?ref=REFERRER_EMAIL`

### 2. Start Earning
1. Go to http://localhost:5000/earn.html
2. Click "Watch Ad" button
3. Check balance updates
4. Referrer should get 10% bonus automatically

### 3. Save Payment Account
1. Go to http://localhost:5000/settings.html
2. Scroll to "Bank Account"
3. Fill in bank details (or save OPay/Palmpay account)
4. Can also add Crypto accounts (Bitcoin, Ethereum, etc.)
5. Click "Save Account"

### 4. Request Withdrawal
1. Go to http://localhost:5000/withdraw.html
2. Select saved account or enter new details
3. Choose amount (5500, 10500, 15400, or custom 20000+)
4. Custom 20000+ = NO FEE
5. Submit request

### 5. Admin Approval (Test)
1. Go to http://localhost:5000/admin.html
2. Login with credentials above
3. View withdrawal requests
4. Approve or reject (will update balance)

### 6. Check History
1. Go to http://localhost:5000/history.html
2. See all earnings, referrals, and withdrawals

---

## 📊 Referral System

**How it works:**
1. User A signs up with: `?ref=UserB@email.com`
2. User A earns ₦100 from watching ads
3. **Automatically:**
   - User A gets full ₦100 (≈ $0.0667 USD)
   - User B gets 10% bonus: ₦10 (≈ $0.0067 USD)
   - Transaction recorded for both users

**Testing**
- Create 2 test accounts: A and B
- Signup with: `http://localhost:5000?ref=B_EMAIL@domain.com`
- Both users watch ads
- Check admin panel stats to see referral bonuses

---

## 💾 Database

Uses Firebase Firestore with this structure:
```
users/
  {uid}/
    - email
    - displayName
    - balance (USD)
    - referredBy (referrer email)
    - referralCode
    - referralEarned (total naira from referrals)
    - totalReferralCount
    
  {uid}/accounts/  (subcollection)
    - bank accounts or crypto wallets
    
transactions/
  - earnings (link to watchad events)
  - referral_bonuses (automatic 10% credits)
  
withdrawals/
  - pending requests
  - approved/rejected history
```

---

## ⚙️ Configuration

Edit `.env` file to change:
```
PORT=5000                              # Server port
ADMIN_EMAIL=petervic3600@gmail.com    # Admin email
ADMIN_PASSWORD=Humblee3600$.          # Admin password
FIREBASE_PROJECT_ID=enable-authentication-1b56c
```

---

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| **Port 5000 already in use** | Change `PORT=` in `.env` to 5001, 5002, etc. |
| **"Cannot connect to database"** | Make sure `config/serviceAccountKey.json` exists (see SETUP.md) |
| **firebase-admin still errors** | Run: `npm uninstall firebase-admin && npm install firebase-admin@14.2.0` |
| **Module not found errors** | Run: `npm install` again |
| **Page not loading** | Make sure server is running (check terminal) |
| **Can't login** | Verify Firebase project is set up (SETUP.md step 2) |

---

## 📚 Full Documentation

For detailed setup including Firebase configuration:  
👉 See **SETUP.md** in this folder

For quick reference:  
👉 See **QUICK_START.md** in this folder

---

## ✨ What's Implemented

✅ User authentication (Email/Password)  
✅ Earn money by watching ads  
✅ Automatic 10% referral bonuses  
✅ Bank account saving (OPay, Palmpay, etc.)  
✅ Crypto wallet saving (10 wallets: BTC, ETH, etc.)  
✅ Multiple withdrawal tiers with fees  
✅ No-fee premium tier (₦20,000+)  
✅ Transaction history  
✅ Admin dashboard with stats  
✅ Dark mode theme  
✅ Notification sounds  
✅ Multilingual ready  

---

## 🎯 Next Steps After Startup

1. ✅ Run `npm install` (if run.bat doesn't do it)
2. ✅ Run `npm start` or double-click `run.bat`
3. ✅ Wait for "Ready!" message
4. ✅ Go to http://localhost:5000
5. ✅ Create test accounts
6. ✅ Test referral system
7. ✅ Check admin panel

---

**Ready? Let's go! 🚀**
