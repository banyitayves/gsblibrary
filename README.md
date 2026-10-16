# leaf & lore — Library Management System

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

## Demo sign-in

| Role | Email | Password |
| --- | --- | --- |
| Administrator | `admin@library.local` | `admin123` |
| Librarian | `librarian@library.local` | `lib123` |

Change or remove the sample accounts before using this app with real users.

## Features

- Dashboard with live collection, loan, member, and overdue totals
- Searchable book catalog with add, edit, and CSV export
- Member directory and registration
- Book checkout, return, and overdue tracking
- Audit history for library actions
- JWT sign-in, hashed staff passwords, and Administrator/Librarian permissions

## Other commands

```powershell
npm.cmd run build        # Build the frontend
npm.cmd run lint         # Lint the frontend
npm.cmd run db:setup     # Apply schema and sample data to configured MySQL
npm.cmd start            # Start the Express API
```
