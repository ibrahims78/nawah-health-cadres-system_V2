# Nawah Healthcare Staff Management System

A full-stack web application for healthcare staff registration and management, featuring an admin dashboard, Google Sheets integration, and Telegram notifications.

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS v3, Radix UI / shadcn-ui
- **Routing**: Wouter (client-side), Express (server-side)
- **State Management**: TanStack Query v5, React Context
- **Backend**: Node.js, Express 4
- **Database**: PostgreSQL (Replit built-in) with Drizzle ORM
- **Auth**: Express Session + `connect-pg-simple` + bcryptjs
- **Integrations**: Google Sheets API, Telegram Bot API, Nodemailer (SMTP)
- **Security**: AES-256-GCM encryption (crypto-js), Helmet, rate limiting

## Running the App

```bash
npm run dev        # starts both Express (port 3001) and Vite (port 5000)
npm run db:push    # push Drizzle schema changes to the database
npm run build      # production build
npm start          # run production build
```

The preview pane opens on port 5000 (Vite dev server proxying the API on port 3001).

## First Run

Navigate to the app — it redirects to the **Setup** page to create the first admin account. Fill in the form to get started.

## Required Secrets / Environment Variables

| Key | Type | Notes |
|-----|------|-------|
| `SESSION_SECRET` | Secret | Express session signing key |
| `ENCRYPTION_KEY` | Env var | 64-character hex string (256-bit AES key) |

## Optional Integrations

| Key | Purpose |
|-----|---------|
| `GOOGLE_PRIVATE_KEY`, `GOOGLE_CLIENT_EMAIL`, `GOOGLE_SHEET_ID` | Google Sheets sync |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Telegram notifications |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Email (SMTP) |

## Architecture

```
client/      React + Vite frontend
server/      Express backend
shared/      Drizzle schema + Zod validators (shared by both)
```

## User Preferences

- Keep the existing project structure and stack — do not restructure or migrate.
