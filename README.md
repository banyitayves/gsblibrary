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

## Staff sign-in

Use the librarian username and password set for your school deployment. Login accepts a username; it does not need to be an email address.
Signed-in staff can rotate their own credentials with `POST /api/auth/change-credentials` using `currentPassword`, `username`, and `password`. The request requires a new password between 12 and 72 UTF-8 bytes and stores only its bcrypt hash.

For an existing database, change the librarian login from a trusted machine using environment variables (do not put the password in source control):

```powershell
$env:LIBRARIAN_USERNAME = Read-Host "New librarian username"
$securePassword = Read-Host "New librarian password" -AsSecureString
$env:LIBRARIAN_PASSWORD = [System.Net.NetworkCredential]::new("", $securePassword).Password
npm.cmd run db:update-librarian-login
Remove-Item Env:LIBRARIAN_USERNAME, Env:LIBRARIAN_PASSWORD
Remove-Variable securePassword
```

This changes the single librarian account's username and bcrypt password without changing administrator access. For new databases, replace the sample staff accounts and their default passwords before deployment.

## Features

- Dashboard with live collection, loan, member, and overdue totals
- Searchable book catalog with add, edit, delete, and CSV import/export; deletion is blocked for books with loan history
- GS Busanza student directory for S1A–S6MCE classes and a separate teacher directory
- Edit member details and, for administrators, delete members that have no loan or attendance history
- CSV import/export for students and teachers, duplicate reporting, and optional email/phone contact fields
- Name, membership-number, class, and member-type search and filters
- Book checkout with an optional physical copy/accession code, student/teacher loan limits (1/300 active books), return, and overdue tracking
- Daily library attendance for students and teachers, optional reading-book records, frequent-visitor rankings, and date-based CSV export
- Borrower counts and filtered circulation/class reports
- Audit history for library actions
- JWT sign-in, hashed staff passwords, and Administrator/Librarian permissions

### Student and teacher CSV files

Download either CSV template from **Students & teachers**. Both templates use these headers:

```csv
name,member_type,class_section,membership_number,email,phone
```

For students, set `member_type` to `Student` and `class_section` to one of `S1A`, `S1B`, `S1C`, `S1D`, `S1E`, `S1F`, `S2A`, `S2B`, `S2C`, `S2D`, `S3A`, `S3B`, `S3C`, `S3D`, `S4LANG`, `S4ARTS`, `S4MS2`, `S5LANG`, `S5ARTS`, `S5MS2`, `S6LFK`, `S6HGL`, or `S6MCE`. For teachers, set `member_type` to `Teacher` and leave `class_section` blank. Email, phone, and membership number may be blank; missing numbers are generated. Duplicate membership numbers, email addresses, and matching names in the same member type and class are skipped and reported, both within the CSV and against existing members. Phone values are stored for directory use only; automated notifications remain off. Imports accept up to 5,000 rows per file.

### Separate reports

In **Reports**, choose and generate loan activity, overdue loans, returned-loan history, student/teacher borrowing totals, members who have never borrowed, borrowing by class, most-borrowed books, book inventory, or book availability (including out-of-stock books). Reports support the relevant member, class, date, and search filters. Export the generated result as CSV, PDF, or an Excel workbook.

### Library attendance

Open **Library attendance** to record each student or teacher entering the library and optionally note the book they are reading. Search by name, class, or membership number to select a visitor; search by title, ISBN, author, or shelf to select a book. Search the selected day's visit register by visitor name, membership number, class, or reading title. This is an attendance record, not a checkout, so it does not change book availability or loan limits. The page lists visits by selected date, summarizes today and the last 30 days, ranks frequent visitors, and shows the most-recorded reading books. Download the daily register as a CSV file.

### Book catalog CSV files

Use **Book collection → CSV template** to download the book import format, then **Import books** to upload it. Each row creates one catalog title with the supplied number of copies. The template headers are:

```csv
title,isbn,publisher,author,total_copies,date_delivered,publication_year,grade,shelf_location,category
```

The title and total copy count are required. ISBN, publisher, author, delivery date, publication year, grade, shelf location, and category may be blank. Delivery dates use `YYYY-MM-DD`; publication year is a four-digit year. An ISBN already in the catalog or repeated in the same file is skipped and reported. Imports accept up to 5,000 rows. Individual book details can also be entered or edited with **Book collection → Add a book**.

The header includes a sun/moon button to switch between light and dark themes. Your choice is saved in this browser.

At checkout, each student may have at most **1 active book** at a time and each teacher at most **300 active books**. The API enforces these limits as well as the checkout form.

When checking out a title, enter the optional copy/accession code printed inside that physical copy. The code appears on loan records and loan reports, and a code already on an unreturned loan cannot be checked out again until that copy is returned.

### Automatic email and WhatsApp notifications

Automatic notifications are disabled. Email sending needs a configured mail provider; WhatsApp via Twilio is not free for production and requires an approved/verified WhatsApp sender, recipient consent, and billable Twilio/Meta message fees. No Twilio account or sender was created or connected. Unofficial WhatsApp Web/QR wrappers are not used; they can expose linked-session credentials, violate WhatsApp terms, and cause the linked number to be restricted or banned.

### Apply the school-directory database migration

Before deploying school-directory or book catalog changes to an existing database, run the idempotent migration from a trusted machine with the correct production database settings in the root `.env`:

```powershell
npm.cmd run db:migrate:directory
```

It makes member email optional, adds member type, class, and phone fields/indexes, adds the optional copy code to loan records, creates the library attendance table, and sets the librarian display name to `NSHIMIYIMANA Yves`. It does not change account passwords or remove library data. Run it successfully before deploying the new API version.
For a deployed Vercel database, an authenticated Librarian or Administrator can apply the same idempotent migration with `POST /api/admin/migrations/school-directory` and a Bearer token.

## Other commands

```powershell
npm.cmd run build        # Build the frontend
npm.cmd run lint         # Lint the frontend
npm.cmd run db:setup     # Apply schema and sample data to configured MySQL
npm.cmd run db:migrate:directory # Apply the existing-database school directory migration
npm.cmd run db:update-librarian-login # Set a librarian username and password from environment variables
npm.cmd start            # Start the Express API
```
