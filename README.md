# ALIVE payment backend — setup guide

## What is included
- `server.js`: Node backend; creates unique ₹2,999 Razorpay payment links; writes registrations to the existing Google Sheet; verifies Razorpay webhook signature and payment details; updates payment status; sends customer confirmation and owner notification emails.
- `package.json`: dependencies and Render start command.
- `.env.example`: environment variables to configure in Render. Never commit actual secrets.

## Google Sheet
Spreadsheet ID: `1yDXnJVCtrioXfb3t6LzAFs8RQSDbTti8Jro8kjpRoMA`, tab `Sheet1`.
The existing A-J columns remain; the backend fills K-P with Registration Reference, Payment Link ID, Client Email Status, Owner Email Status, Paid At, Webhook Event ID.
Create a Google Cloud service account, enable Google Sheets API, download its JSON key, and share the sheet with its `client_email` as Editor. Put the complete JSON in Render's `GOOGLE_SERVICE_ACCOUNT_JSON` environment variable.

## Render
Use Node runtime, build command `npm install`, start command `npm start`. Add every variable in `.env.example` in Render Environment settings. Set `FRONTEND_ORIGIN` to the actual public website origin (no trailing slash) and `API_PUBLIC_URL` to the actual Render service URL (no trailing slash).

## Resend
Create a Resend API key and verify a sender domain. `EMAIL_FROM` must use a sender allowed by Resend; do not assume a personal Gmail sender can be used.

## Razorpay webhook
Add webhook URL `https://YOUR-RENDER-SERVICE.onrender.com/webhooks/razorpay`, subscribe to `payment_link.paid`, and use the exact same webhook secret in Razorpay and Render. Test with Razorpay test keys first.

## Frontend still needs connecting
The current `offer.html` must submit JSON to `https://YOUR-RENDER-SERVICE.onrender.com/api/register`, then redirect to the `paymentUrl` returned by the API. Expected fields: `name`, `email`, `phone`, `occupation`, `reason`, `goals` (or `goal`), `preferredContact`. The backend does not use an embedded frontend secret because browser code cannot keep secrets.
Do not use the old reusable Razorpay link for this new flow.

## Important limitations
- Browser redirect is not proof of payment; webhook verification is the source of truth.
- This is not production-ready until environment variables, Google access, Resend sender, Razorpay webhook, and frontend are configured and tested.
- The sheet records email status. If Resend fails, the relevant status becomes `Failed` for manual retry. The current version does not automatically retry failed emails.
- Google Sheets is not transactional; concurrent webhook deliveries can race. For strict exactly-once processing at scale, use a database plus a durable outbox.
