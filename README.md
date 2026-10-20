# Library Management System

A full-stack library operations dashboard using React + Vite on the frontend and Python + FastAPI on the backend.

## Stack

- Frontend: React, Vite
- Backend: Python, FastAPI
- Data: in-memory sample data for books, users, projects, audit events, and documents

## Features implemented

- Role-based access control
- Dynamic dashboard and analytics
- Audit logs and activity history
- Search and advanced filtering for catalog records
- Shelf-by-shelf catalog view grouped by each book's location
- Shared physical book codes across different titles, grades, or book types while blocking exact catalog duplicates
- Import from CSV/XLSX files
- Export reports as CSV, Excel, and PDF
- Task tracking with a Kanban-style board
- Document and file management overview

## Run the app

### Backend

cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
uvicorn app:app --reload --host 0.0.0.0 --port 8000

### Frontend

cd frontend
npm install
npm run dev -- --host 0.0.0.0

Then open the local Vite URL in the browser.
