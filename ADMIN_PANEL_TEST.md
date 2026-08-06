# Admin Panel Testing Guide

## ✅ Quick Start Server Test

1. **Start the server:**
   ```bash
   cd c:\Users\User\Desktop\watch2earn
   node server.js
   ```

2. **Expected output:**
   ```
   Server running on port 5000
   ```

## 📋 Admin Panel Access Points

### Login Flow
- Navigate to: `http://localhost:5000/verify`
- Or: `http://localhost:5000/admin-login`
- Or: `http://localhost:5000/admin-panel`

**Default Credentials:**
- Email: `admin@watch2earn.com`
- Password: `admin1234`

### Admin Dashboard
- After login, you'll be redirected to: `http://localhost:5000/carbinate`
- Or directly: `http://localhost:5000/admin-dashboard`

## 🧪 Live Data Verification

### Check Dashboard (Main Page)
**URL:** `http://localhost:5000/carbinate`
- Should show: Total Balance, Profit, User Profit
- Should show: Users count, Pending Withdrawals, Revenue
- Should show: Recent Activity feed with live data descriptions

### Check Users Page
**URL:** `http://localhost:5000/carbinate` → Click "Users" in bottom nav
- Should show: Health Score, Real/Bot user counts
- Should show: User List (empty if no users registered yet)
- Users table should have columns: Name, Email, Role, Status, Actions

### Check Withdrawals Page
**URL:** Click "Withdrawals" in bottom nav
- Should show: Total Payout, Pending Payout counts
- Should show: Withdrawals table with live data
- Table columns: Name, Amount, Method, Status, Risk, Action

### Check History Page
**URL:** Click "History" in bottom nav
- Should show: Total Paid Out, Paid This Month amounts
- Should show: Transaction History table (empty initially)
- Should show: System Updates list with live data
- Buttons: Export CSV, Export PDF (should work)

### Check Messages Page
**URL:** Click "Messages" in bottom nav
- Should show: Message send form
- Should show: Recent Messages list (empty initially)
- Send a test message and see it appear in the list

### Check Charts Page
**URL:** Click "Charts" in bottom nav
- Should show: Two bar charts (Earnings and Ads Watched)
- Should show: Earnings Summary table with 1-day, 7-days, 30-days, 90-days

## 🔍 API Endpoints Test (in browser console)

These should work with your admin token:

```javascript
// Get admin token first (from login)
const token = localStorage.getItem('adminToken');
console.log('Admin Token:', token);

// Test Dashboard
fetch('/api/admin/dashboard', {
  headers: {'Authorization': `Bearer ${token}`}
}).then(r => r.json()).then(d => console.log('Dashboard:', d));

// Test Users
fetch('/api/admin/users', {
  headers: {'Authorization': `Bearer ${token}`}
}).then(r => r.json()).then(d => console.log('Users:', d));

// Test Withdrawals
fetch('/api/admin/withdrawals', {
  headers: {'Authorization': `Bearer ${token}`}
}).then(r => r.json()).then(d => console.log('Withdrawals:', d));

// Test History
fetch('/api/admin/history', {
  headers: {'Authorization': `Bearer ${token}`}
}).then(r => r.json()).then(d => console.log('History:', d));

// Test Messages
fetch('/api/admin/messages', {
  headers: {'Authorization': `Bearer ${token}`}
}).then(r => r.json()).then(d => console.log('Messages:', d));

// Test Settings
fetch('/api/admin/settings', {
  headers: {'Authorization': `Bearer ${token}`}
}).then(r => r.json()).then(d => console.log('Settings:', d));
```

## 📱 Responsive Design Check

- Open admin panel on desktop
- Resize browser to narrow width (320px) to test mobile view
- Tables should adapt and be readable on phone sizes

## ✨ Expected Live Data Behavior

All pages now show **live data**, not static data:

### Dashboard (carbinate.html)
- ✅ Fetches from `/api/admin/dashboard`
- ✅ Shows real withdrawal counts, totals, and activity
- ✅ Displays error message if API call fails

### Users Page (users.html)
- ✅ Fetches from `/api/admin/users`
- ✅ Shows empty state when no users
- ✅ Displays error message if API call fails

### Withdrawals Page (withdrawals.html)
- ✅ Fetches from `/api/admin/withdrawals`
- ✅ Shows real pending withdrawal count
- ✅ Can approve/reject individual withdrawals

### History Page (past.html)
- ✅ Fetches from `/api/admin/history`
- ✅ Shows real transaction data
- ✅ Export and View buttons functional

### Messages Page (messages.html)
- ✅ Fetches from `/api/admin/messages` on load
- ✅ Send button creates new message and updates list
- ✅ Shows sent messages with timestamps

### Charts Page (charts.html)
- ✅ Fetches from `/api/admin/chart/*` endpoints
- ✅ Displays Chart.js graphs with real data
- ✅ Shows earnings summary table

## 🔐 Authentication Flow

1. Browser visits `/verify` → `verify.html` loads
2. User enters credentials and clicks "Login"
3. `/api/admin/login` POST endpoint validates credentials
4. Server returns JWT token if credentials match
5. Token stored in `localStorage.adminToken`
6. Page redirects to `carbinate.html`
7. `carbinate.html` checks for token on load
8. If token exists, loads dashboard data from `/api/admin/dashboard`
9. If no token, redirects back to `verify.html` (login page)

## ⚠️ Troubleshooting

### "Unable to connect to carbinate" error
- [ ] Server is running (`node server.js`)
- [ ] Check browser console for error messages (press F12)
- [ ] Clear localStorage: `localStorage.clear()` and login again
- [ ] Check network tab - look for 404 or 500 errors

### Dashboard shows "Error loading data"
- [ ] Check browser console for error message
- [ ] Verify admin token is in localStorage
- [ ] Test `/api/admin/dashboard` endpoint directly in console (see above)
- [ ] Check server console for error logs

### Pages redirect to login repeatedly
- [ ] Token might be missing - logout and login again
- [ ] Check: `localStorage.getItem('adminToken')` in console
- [ ] Try clearing localStorage and relogging in

### Data doesn't update after sending message
- [ ] Wait 1-2 seconds for page to fetch new data
- [ ] Check browser console for fetch errors
- [ ] Verify message was created: check `/data/messages.json` file

## 🚀 Deployment Checklist

Before redeploy:
- [ ] Test admin login with default credentials
- [ ] Navigate through all 6 admin pages
- [ ] Check that data displays (even if empty)
- [ ] Send a test message and see it appear
- [ ] Check browser console (F12) - no error messages
- [ ] Test on mobile size viewport
- [ ] All bottom navigation links work

### Environment Variables (for Render)
Set these in Render dashboard:
- `JWT_SECRET`: Any random string (e.g., "your-secret-key")
- `ADMIN_EMAIL`: admin@watch2earn.com (or custom)
- `ADMIN_PASSWORD`: admin1234 (or custom)
- `PAYSTACK_SECRET_KEY`: (required for payments)

If not set, defaults will be used:
- ADMIN_EMAIL defaults to: `admin@watch2earn.com`
- ADMIN_PASSWORD defaults to: `admin1234`
- JWT_SECRET defaults to: `dev-secret`

## 📊 Data Files Created

Admin panel uses these JSON files for live data:
- `/data/withdrawals.json` - withdrawal requests and status
- `/data/messages.json` - admin messages and announcements  
- `/data/settings.json` - admin settings (daily ad limit, bonus ads)
- `/data/transactions.json` - user transaction history
- `/data/accounts.json` - saved user bank/crypto accounts
- `/data/users.json` - user profiles (populated when users sign up)

## ✅ Success Indicators

Admin panel is working correctly when:
1. ✅ You can login without errors
2. ✅ Dashboard loads and shows stats
3. ✅ Navigation between 6 pages works smoothly
4. ✅ No red error messages on any page
5. ✅ Activity feeds show live data descriptions
6. ✅ Can send messages and they appear immediately
7. ✅ Can approve/reject withdrawals (when available)
8. ✅ Charts render without errors
9. ✅ Mobile viewport works (resize to 320px)

Good luck with your redeploy! 🚀
