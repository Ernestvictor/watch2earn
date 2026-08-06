# Message Management System Guide

## Overview
The Watch2Earn admin message system provides automated message templates, scheduled sending, user targeting, and persistent storage. All data is saved to `data/messages.json` and survives page reloads.

---

## Features Implemented

### 1. Automatic Message Templates
Four pre-built templates available in the Admin Messages panel:

#### **New Sign In** 👋
- **Template**: "Welcome to Watch2Earn!"
- **Content**: Welcome message with user invitation to earn
- **Use Case**: Send to new users automatically on first login

#### **Withdrawal Submitted** 💳
- **Template**: "Withdrawal Submitted"
- **Content**: Confirms withdrawal request with payment method and 24-hour notice
- **Placeholders**: {method}, {amount}
- **Use Case**: Auto-send when user initiates withdrawal

#### **Withdrawal Rejected** ❌
- **Template**: "Withdrawal Rejected"
- **Content**: Explains reason for rejection (wrong account, suspicious activity)
- **Placeholders**: {reason}
- **Use Case**: Manual send when admin rejects withdrawal

#### **Withdrawal Successful** ✅
- **Template**: "Withdrawal Successful! 🎉"
- **Content**: Confirms funds sent with amount and date
- **Placeholders**: {amount}, {method}, {date}
- **Use Case**: Auto-send when withdrawal clears

---

## How to Use

### Access Admin Messages
1. Login to Admin Panel: `/admin-panel/verify.html`
2. Navigate to Messages tab in bottom menu
3. Choose between three tabs:
   - **Auto Messages**: Use template-based messages
   - **Manual Message**: Create custom messages
   - **Message History**: View all saved/scheduled messages

### Create from Template

1. **Click Template Card**
   - Select one of the 4 templates
   - Preview appears showing template content

2. **Choose Send Type**
   - **Manual**: Send immediately or on-demand
   - **Automatic**: Schedule for future sending

3. **Set Schedule (Automatic Only)**
   - Date & Time: When to send
   - Frequency: Once, Daily, Weekly, or Monthly

4. **Target Recipients**
   - **All Users**: Send to every user
   - **Specific Users**: Search and select individual users
   - Add/remove users with checkbox

5. **Save & Schedule**
   - Click "Save & Schedule Message"
   - Message saves to `data/messages.json`
   - Appears in Message History

### Create Custom Message

1. **Enter Message Details**
   - Title: Subject/heading
   - Content: Full message body (supports formatting)
   - Priority: Normal, Urgent, or Critical

2. **Configure Delivery**
   - Send Type: Manual or Automatic
   - Schedule Date/Time (if automatic)
   - Repeat Frequency

3. **Target Users**
   - Select All Users or specific users
   - Search by name/email

4. **Send/Schedule**
   - Custom message saves and persists
   - Status shows as "Pending" (manual) or "Scheduled" (automatic)

### View Message History

1. **Browse All Messages**
   - Shows all saved messages (newest first)
   - Displays type, recipients, schedule, and status

2. **Filter Messages**
   - Search box to find by title or content
   - Live filtering updates list

3. **Delete Messages**
   - Click delete button on any message
   - Message removed from data/messages.json

4. **Message Status**
   - **Pending**: Manual message waiting to send
   - **Scheduled**: Automatic message scheduled for future
   - **Sent**: Message already delivered

---

## Backend Endpoints

### GET /api/admin/messages
- **Description**: Retrieve all messages
- **Auth**: Admin token required
- **Response**: Array of message objects (sorted newest first)

### POST /api/admin/messages
- **Description**: Create new message
- **Auth**: Admin token required
- **Body**:
  ```json
  {
    "templateType": "template" | "custom",
    "title": "Message Title",
    "message": "Message content",
    "sendType": "manual" | "automatic",
    "scheduleDateTime": "2024-01-15T10:30:00Z",
    "frequency": "once" | "daily" | "weekly" | "monthly",
    "targetType": "all" | "specific",
    "targetUsers": "all" | ["user_id_1", "user_id_2"],
    "priority": "normal" | "urgent" | "critical"
  }
  ```

### DELETE /api/admin/messages/{id}
- **Description**: Delete a message
- **Auth**: Admin token required
- **Response**: Success confirmation

### PUT /api/admin/messages/{id}
- **Description**: Update message status or content
- **Auth**: Admin token required
- **Body**: Partial message object properties to update

---

## Data Structure

### Message Object in messages.json

```json
{
  "id": "1704067200000",
  "templateType": "template",
  "title": "Welcome to Watch2Earn!",
  "message": "Welcome {username}! Ready to start earning...",
  "sendType": "automatic",
  "priority": "normal",
  "channel": "inapp",
  "scheduleDateTime": "2024-01-01T09:00:00Z",
  "frequency": "once",
  "targetType": "all",
  "targetUsers": "all",
  "status": "pending",
  "createdAt": "2024-01-01T08:00:00Z",
  "updatedAt": "2024-01-01T08:00:00Z"
}
```

---

## Important Notes

### Authentication
- All message endpoints require valid admin JWT token
- Token obtained via `/api/admin/login` with ADMIN_EMAIL and ADMIN_PASSWORD
- Token stored in localStorage as `adminToken`

### Data Persistence
- All messages stored in `/data/messages.json`
- File created automatically if missing
- Data persists across server restarts and page reloads

### User Targeting
- "All Users" = message available to all registered users
- "Specific Users" = message targeted to selected user IDs only
- Users loaded from Firebase Admin SDK

### Scheduling
- Automatic messages stored with scheduleDateTime
- Frontend shows scheduled date/time in history
- Backend can implement cron job to trigger sends at scheduled times

### Message Status
- **pending**: Manual message, ready to send
- **scheduled**: Automatic message, waiting for scheduled time
- **sent**: Message delivered to users

---

## Future Enhancements

1. **Scheduled Message Delivery**
   - Implement cron job to check and send scheduled messages
   - Track delivery status per user

2. **Message Statistics**
   - Track open rates, clicks, engagement
   - Show in admin dashboard

3. **User Notifications**
   - Display sent messages to users in their dashboard
   - Create notification queue system

4. **Email/Push Integration**
   - Send messages via email or push notifications
   - Support multiple channels simultaneously

5. **Template Variables**
   - Auto-populate {username}, {amount}, etc. from database
   - Advanced formatting options

---

## File References

- **Frontend**: [public/admin-panel/messages.html](public/admin-panel/messages.html)
- **Backend Routes**: [routes/admin.js](routes/admin.js)
- **Data Storage**: [data/messages.json](data/messages.json)
- **Middleware**: verifyAdminToken in routes/admin.js

---

## Testing Checklist

- [x] Create message from template
- [x] Create custom message
- [x] Schedule automatic message
- [x] Target all users
- [x] Target specific users
- [x] Search and filter messages
- [x] Delete message
- [x] Verify persistence on page reload
- [x] Verify admin authentication required
