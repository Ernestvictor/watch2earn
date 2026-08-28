# Watch2Earn - Render Deployment Guide

This guide provides comprehensive instructions for deploying Watch2Earn to Render with proper environment variable configuration.

## Prerequisites
- Render account
- MongoDB Atlas connection string (or other MongoDB service)
- Firebase project setup with service account credentials
- Optional: Gmail SMTP credentials for email notifications

## Step 1: Create a New Web Service on Render

1. Go to [render.com](https://render.com) and sign in to your account
2. Click **New +** → **Web Service**
3. Connect your GitHub repository
4. Fill in the configuration:
   - **Name**: `watch2earn` (or your preferred name)
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`

## Step 2: Configure Environment Variables

In the Render dashboard, go to your service's **Environment** tab and add the following variables:

### Essential Variables

```
PORT=3000
NODE_ENV=production
```

### Database Configuration

```
MONGODB_URI=mongodb://username:password@host:port/database?ssl=true&replicaSet=...
DB_NAME=watch2earn
```

**Get your MongoDB Atlas URI:**
1. Go to MongoDB Atlas → Clusters → Connect
2. Copy the connection string
3. Replace `<username>`, `<password>`, and `<dbname>` with your actual values

### Firebase Configuration

```
FIREBASE_PROJECT_ID=enable-authentication-1b56c
FIREBASE_DB_URL=https://enable-authentication-1b56c-default-rtdb.firebaseio.com/
SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"...","private_key":"..."}
```

**To get SERVICE_ACCOUNT_JSON (Direct Environment Variable - Recommended):**

⚠️ **IMPORTANT**: The app now reads the service account key **directly from environment variables** without writing to disk. This is more secure for Render deployments.

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project → **Project Settings** → **Service Accounts** tab
3. Click **Generate New Private Key**
4. Open the downloaded JSON file and copy the **entire contents**
5. In Render dashboard:
   - Go to your Web Service → **Environment**
   - Add a new variable: `SERVICE_ACCOUNT_JSON`
   - Paste the entire JSON content as the value (do NOT escape newlines - Render handles this automatically)
6. Optional: You can also use `FIREBASE_SERVICE_ACCOUNT_JSON` or `GOOGLE_APPLICATION_CREDENTIALS_JSON` as alternative variable names

**Example of SERVICE_ACCOUNT_JSON value:**
```json
{
  "type": "service_account",
  "project_id": "your-project-id",
  "private_key_id": "key-id",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com",
  "client_id": "123456789",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://www.googleapis.com/..."
}
```

### Admin Credentials

```
ADMIN_EMAIL=your-email@gmail.com
ADMIN_PASSWORD=your-secure-password
ADMIN_EMAILS=your-email@gmail.com,another-admin@gmail.com
JWT_SECRET=your-long-random-secret-key
COOKIE_SECRET=another-long-random-secret-key
```

### Payment & External Services

```
PAYSTACK_SECRET_KEY=sk_live_...  (or sk_test_ for testing)
CRYPTO_API_KEY=your-api-key
BOT_TOKEN=your-telegram-bot-token
TELEGRAM_CLAIM_REWARD_USD=0.1
```

### Email Configuration (SMTP)

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
GMAIL_APP_PASSWORD=your-app-password
```

**To get Gmail App Password:**
1. Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
2. Select Mail and App
3. Choose your device
4. Copy the generated password (without spaces)

## Step 3: Deploy

1. In the Render dashboard, click **Deploy** or **Manual Deploy**
2. Watch the deployment logs to ensure everything starts correctly
3. Once deployed, you'll get a URL like `https://watch2earn.onrender.com`

## Step 4: Verify Deployment

Test the following endpoints:
- **Frontend**: `https://your-app.onrender.com/`
- **API Health**: `https://your-app.onrender.com/api/auth/status`
- **Admin Panel**: `https://your-app.onrender.com/verify`

## Environment Variables Reference

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| PORT | No | Server port | 3000 |
| NODE_ENV | No | Environment | production |
| MONGODB_URI | Yes | MongoDB connection | mongodb://user:pass@host/db |
| DB_NAME | No | Database name | watch2earn |
| FIREBASE_PROJECT_ID | Yes | Firebase project ID | enable-authentication-1b56c |
| SERVICE_ACCOUNT_JSON | Yes | Firebase credentials | {...full json...} |
| ADMIN_EMAIL | Yes | Admin email | admin@example.com |
| ADMIN_PASSWORD | Yes | Admin password secret | ComplexPassword123! |
| JWT_SECRET | Yes | JWT token secret | random-string-32-chars |
| COOKIE_SECRET | Yes | Cookie secret | random-string-32-chars |
| SMTP_HOST | No | SMTP server | smtp.gmail.com |
| SMTP_PORT | No | SMTP port | 587 |
| SMTP_SECURE | No | Use TLS | false |
| SMTP_USER | No | SMTP username | email@gmail.com |
| SMTP_PASS | No | SMTP password | app-password |
| BOT_TOKEN | No | Telegram bot token | 123456:ABC... |

## Troubleshooting

### "MongoDB connection error"
- Verify MONGODB_URI is correct
- Check if MongoDB IP whitelist includes Render's IP address
- Visit MongoDB Atlas → Network Access → Add Current IP

### "Firebase initialization failed"
- Ensure SERVICE_ACCOUNT_JSON is valid JSON
- Check if FIREBASE_PROJECT_ID matches the JSON
- Verify the service account has necessary permissions

### "Port already in use"
- Render automatically assigns PORT through environment variable
- Do not hardcode port in code

### "SMTP authentication failed"
- Use Gmail App Password, not your Google password
- Verify SMTP_USER and SMTP_PASS are correct
- Enable "Less secure app access" if using regular password

### Logs not showing
- Go to Render dashboard → Logs tab
- Check both deployment logs and runtime logs
- Search for specific error messages

## Production Tips

1. **Security**: Always use strong, randomly generated secrets for JWT_SECRET and COOKIE_SECRET
2. **MongoDB**: Use production MongoDB Atlas tier with replication for reliability
3. **Backups**: Enable automatic MongoDB backups
4. **Rate Limiting**: The code includes rate limiting - ensure it's appropriate for your use case
5. **SSL/TLS**: Render automatically provides HTTPS
6. **Monitoring**: Enable Render's error notifications

## Scaling

- **Free tier**: Limited resources, good for testing
- **Paid tier**: Better performance, custom domains, better SLA
- To upgrade: Settings → Billing → Change plan

## Additional Resources

- [Render Documentation](https://render.com/docs)
- [MongoDB Atlas Documentation](https://docs.atlas.mongodb.com/)
- [Firebase Admin SDK](https://firebase.google.com/docs/admin/setup)

## Support

For deployment issues:
1. Check Render deployment logs
2. Verify all environment variables are set correctly
3. Test locally with same environment variables
4. Review error messages for specific failures

---

**Last Updated**: August 2026
