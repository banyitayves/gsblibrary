# GS Busanza Library Management System

A full-stack library app with a React + Tailwind CSS frontend, an Express API, and MySQL storage.

## Windows quick start

Requirements: Windows 10/11, Node.js 20.19+, and npm.

Install the official MySQL Server from an Administrator PowerShell:

```powershell
winget install --id Oracle.MySQL --exact
```

Open PowerShell in the project root and set up the app:

```powershell
npm.cmd install
npm.cmd run db:bootstrap
```

The bootstrap initializes a private MySQL data directory under your Windows user profile, generates local database, MySQL administrator, and session secrets in the ignored root `.env` file, creates the app database account and tables, and adds sample library records. It does not require Windows administrator privileges. It will stop rather than replace an existing `.env`, a nonempty MySQL data directory, or another server using port 3306.

**Start MySQL and leave its terminal open:**

```powershell
.\run_mysql.bat
```

In a second PowerShell window at the project root, start the frontend and API:

```powershell
npm.cmd run dev
```

Open <http://localhost:5173>. The API health check is at <http://localhost:3001/api/health>. When you are finished, press `Ctrl+C` in the MySQL terminal for a clean shutdown. MySQL data remains at `%LOCALAPPDATA%\LibraryFlow\MySQL\data` between runs.

## MySQL setup details

The bootstrap uses the installed MySQL 8.4 Server binaries, binds the database only to `127.0.0.1`, and creates the `library_management` database and a dedicated `library_app` account. All generated passwords and the JWT secret are stored in the root `.env`, which is excluded from Git. The app uses only the dedicated app account; use `MYSQL_ROOT_PASSWORD` from `.env` only when administering MySQL.

To install MySQL Community Server separately, use the [official MySQL Installer](https://dev.mysql.com/downloads/installer/) or [Community Server downloads](https://dev.mysql.com/downloads/mysql/). If you have an existing MySQL server or data, **do not run `db:bootstrap`**: configure `.env` using [.env.example](./.env.example), create `library_management` and a least-privilege app account in MySQL Workbench, then run `npm.cmd run db:setup`.

## Deploy to Vercel

This repository deploys as a single Vercel project containing two services, so choose **Import multi-service project**. The included `vercel.json` defines:

- `frontend`: Vite app from `frontend/`, public for all non-API paths.
- `backend`: Express app from `backend/`, public under `/api/*`.

The frontend sends same-origin requests to `/api/*`; Vercel routes those requests to the backend. There is no frontend-to-backend server call, so no internal service binding is needed.

Vercel functions **cannot connect to the MySQL server on your computer**. For a no-cost start, TiDB Cloud Starter offers a MySQL-compatible mode. Create a MySQL-compatible instance, enable its public endpoint, and add the provider's **AWS Access** firewall rule for Vercel. Do not leave `Allow_all_public_connections` enabled. Set the instance's monthly spending limit to `$0` to stay within its free quota; the instance can be throttled after the quota is reached.

Initialize the hosted database from a trusted computer by configuring the provider's connection details in the root `.env` and running `npm.cmd run db:setup`. This script creates `library_management`, its tables, and sample records. For TiDB Starter, use the generated connection username and set `DB_SSL=true`; the setup script uses the same TLS configuration as the API. Keep the database password and JWT secret private; do not commit `.env`.

In **Vercel → Project → Settings → Environment Variables**, configure these values for each environment you deploy:

| Name | Value |
| --- | --- |
| `DB_HOST` | Managed MySQL server hostname only (not a URL) |
| `DB_PORT` | Database server port (`4000` for TiDB Cloud Starter) |
| `DB_USER` | Database user (TiDB Starter uses its generated cluster username) |
| `DB_PASSWORD` | Database user's password |
| `DB_NAME` | Database name, e.g. `library_management` |
| `DB_SSL` | `true` when required by the database provider (`true` for TiDB Cloud Starter) |
| `JWT_SECRET` | Unique random value of at least 32 characters |

If your provider requires a custom certificate, also set `DB_SSL_CA` to its CA certificate. Vercel automatically supplies the deployed URL for CORS. Optionally set `CLIENT_URL` to an additional allowed frontend origin.

After saving or changing environment variables, **redeploy** so the backend service receives the updated settings. Verify the deployed database/API connection at `https://<your-deployment-domain>/api/health`. A healthy deployment responds with `{"status":"ok","database":"connected"}`. Database connection problems return an API error with a message directing you to the `DB_*` and `DB_SSL` settings.

## Demo sign-in

| Role | Email | Password |
| --- | --- | --- |
| Administrator | `admin@library.local` | `admin123` |
| Librarian | `librarian@library.local` | `lib123` |

Change or remove the sample accounts before using this app with real users.

## Features

- Dashboard with live collection, loan, member, and overdue totals
- Searchable book catalog with add, edit, and CSV export
- GS Busanza student directory for S1A–S6MCE classes and a separate teacher directory
- CSV import/export for students and teachers, duplicate reporting, and optional email addresses
- Name, membership-number, class, and member-type search and filters
- Book checkout, return, and overdue tracking
- Borrower counts and filtered circulation/class reports with CSV export
- Audit history for library actions
- JWT sign-in, hashed staff passwords, and Administrator/Librarian permissions

### Student and teacher CSV files

Download either CSV template from **Students & teachers**. Both templates use these exact headers:

```csv
name,member_type,class_section,membership_number,email
```

For students, set `member_type` to `Student` and `class_section` to one of `S1A`, `S1B`, `S1C`, `S1D`, `S1E`, `S1F`, `S2A`, `S2B`, `S2C`, `S2D`, `S3A`, `S3B`, `S3C`, `S3D`, `S4LANG`, `S4ARTS`, `S4MS2`, `S5LANG`, `S5ARTS`, `S5MS2`, `S6LFK`, `S6HGL`, or `S6MCE`. For teachers, set `member_type` to `Teacher` and leave `class_section` blank. Email and membership number may be blank; missing numbers are generated. Duplicate membership numbers and email addresses are skipped and reported. Imports accept up to 5,000 rows per file.

### Apply the school-directory database migration

Before deploying these directory features to an existing database, run the idempotent migration from a trusted machine with the correct production database settings in the root `.env`:

```powershell
npm.cmd run db:migrate:directory
```

It makes member email optional, adds member type and class fields/indexes, and updates the `librarian@library.local` display name to `NSHIMIYIMANA Yves`. It does not change account passwords or remove library data. Run it successfully before deploying the new API version.

## Other commands

```powershell
npm.cmd run build        # Build the frontend
npm.cmd run lint         # Lint the frontend
npm.cmd run db:setup     # Apply schema and sample data to configured MySQL
npm.cmd run db:migrate:directory # Apply the existing-database school directory migration
npm.cmd start            # Start the Express API
```
