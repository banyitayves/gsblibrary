from io import BytesIO

import pandas as pd
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

app = FastAPI(title="Library Management System API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

roles = [
    {"name": "Administrator", "permissions": ["users", "catalog", "analytics", "audit", "projects"]},
    {"name": "Librarian", "permissions": ["catalog", "loans", "audit", "documents"]},
    {"name": "Manager", "permissions": ["analytics", "projects", "team", "reports"]},
    {"name": "Student", "permissions": ["catalog", "reading", "attendance"]},
]

users = [
    {"id": 1, "username": "admin", "password": "admin123", "name": "Aisha Khan", "role": "Administrator"},
    {"id": 2, "username": "librarian", "password": "lib123", "name": "Nora James", "role": "Librarian"},
    {"id": 3, "username": "manager", "password": "mgr123", "name": "Hashim Roy", "role": "Manager"},
    {"id": 4, "username": "student", "password": "stu123", "name": "Maya Clark", "role": "Student"},
]

books = [
    {"id": "BK-1024", "title": "The Pragmatic Programmer", "author": "Andrew Hunt", "category": "Technology", "status": "Available", "location": "A1-12", "copies": 3, "borrowed": 0},
    {"id": "BK-2048", "title": "Atomic Habits", "author": "James Clear", "category": "Self Improvement", "status": "Checked Out", "location": "B4-02", "copies": 2, "borrowed": 1},
    {"id": "BK-3410", "title": "The Alchemist", "author": "Paulo Coelho", "category": "Fiction", "status": "Available", "location": "C3-09", "copies": 4, "borrowed": 0},
    {"id": "BK-4411", "title": "Clean Code", "author": "Robert C. Martin", "category": "Technology", "status": "Overdue", "location": "A2-07", "copies": 2, "borrowed": 1},
    {"id": "BK-5120", "title": "Deep Work", "author": "Cal Newport", "category": "Productivity", "status": "Available", "location": "D1-05", "copies": 5, "borrowed": 0},
    {"id": "BK-6177", "title": "The Silent Patient", "author": "Alex Michaelides", "category": "Mystery", "status": "Reserved", "location": "B2-14", "copies": 3, "borrowed": 2},
]

loans = [
    {"id": "L-1001", "bookId": "BK-2048", "member": "Maya Clark", "dueDate": "2026-10-20", "status": "Borrowed"},
    {"id": "L-1002", "bookId": "BK-4411", "member": "Aisha Khan", "dueDate": "2026-10-17", "status": "Returned"},
]

attendance = [
    {"id": "AT-2001", "student": "Maya Clark", "date": "2026-10-14", "book": "Deep Work", "minutes": 60},
    {"id": "AT-2002", "student": "Nia Lopez", "date": "2026-10-14", "book": "Atomic Habits", "minutes": 45},
]

audit_logs = [
    {"time": "2026-10-14 08:40", "user": "Nora James", "action": "Catalog updated", "details": "Added 23 titles to the technology shelf"},
    {"time": "2026-10-14 09:12", "user": "Hashim Roy", "action": "Loan approved", "details": "Approved renewal for BK-2048"},
    {"time": "2026-10-14 10:03", "user": "Aisha Khan", "action": "Invoice exported", "details": "Saved monthly circulation report as Excel"},
    {"time": "2026-10-14 11:27", "user": "Mina Patel", "action": "Document uploaded", "details": "Attached policy update to shared catalog folder"},
    {"time": "2026-10-14 12:55", "user": "Leo Grant", "action": "Member account updated", "details": "Changed inactive account status to active"},
]

projects = [
    {"id": "PRJ-101", "title": "Reader onboarding campaign", "stage": "Research", "owner": "Nora James", "deadline": "2026-10-19", "hours": 18},
    {"id": "PRJ-104", "title": "Catalog metadata cleanup", "stage": "In Review", "owner": "Aisha Khan", "deadline": "2026-10-18", "hours": 32},
    {"id": "PRJ-109", "title": "Annual inventory audit", "stage": "Planning", "owner": "Hashim Roy", "deadline": "2026-10-24", "hours": 26},
    {"id": "PRJ-118", "title": "Digital archiving rollout", "stage": "In Progress", "owner": "Mina Patel", "deadline": "2026-10-29", "hours": 42},
]

documents = [
    {"name": "Library_Operations_Policy.pdf", "owner": "Nora James", "size": "2.4 MB", "updated": "2 hours ago"},
    {"name": "Reading_Room_Schedule.xlsx", "owner": "Aisha Khan", "size": "840 KB", "updated": "5 hours ago"},
    {"name": "Collections_Review_2026.csv", "owner": "Hashim Roy", "size": "310 KB", "updated": "1 day ago"},
    {"name": "Volunteer_Training_Guide.docx", "owner": "Mina Patel", "size": "1.8 MB", "updated": "3 days ago"},
]


@app.get("/api/health")
def health_check():
    return {"status": "ok", "service": "library-management-system"}


@app.get("/api/dashboard")
def dashboard():
    return {
        "stats": [
            {"label": "Total books", "value": 8452, "change": "+12.5%"},
            {"label": "Active loans", "value": 382, "change": "+6.3%"},
            {"label": "Late returns", "value": 29, "change": "-2.1%"},
            {"label": "Member satisfaction", "value": "96.4%", "change": "+4.8%"},
        ],
        "chart": [
            {"month": "Jan", "value": 220},
            {"month": "Feb", "value": 240},
            {"month": "Mar", "value": 290},
            {"month": "Apr", "value": 310},
            {"month": "May", "value": 360},
            {"month": "Jun", "value": 390},
            {"month": "Jul", "value": 410},
            {"month": "Aug", "value": 450},
        ],
    }


@app.get("/api/books")
def get_books():
    return books


@app.get("/api/users")
def get_users():
    return users


@app.get("/api/loans")
def get_loans():
    return loans


@app.get("/api/attendance")
def get_attendance():
    return attendance


@app.get("/api/audit")
def get_audit():
    return audit_logs


@app.get("/api/projects")
def get_projects():
    stages = [
        {"name": "Planning", "tasks": [p for p in projects if p["stage"] == "Planning"]},
        {"name": "Research", "tasks": [p for p in projects if p["stage"] == "Research"]},
        {"name": "In Progress", "tasks": [p for p in projects if p["stage"] == "In Progress"]},
        {"name": "In Review", "tasks": [p for p in projects if p["stage"] == "In Review"]},
    ]
    return stages


@app.get("/api/documents")
def get_documents():
    return documents


@app.get("/api/roles")
def get_roles():
    return roles


@app.post("/api/login")
def login(payload: dict):
    username = payload.get("username")
    password = payload.get("password")
    user = next((u for u in users if u["username"] == username and u["password"] == password), None)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return {"message": "Login successful", "user": {"id": user["id"], "name": user["name"], "role": user["role"]}}


@app.post("/api/import")
async def import_book_data(file: UploadFile = File(...), kind: str = Query(default="books")):
    if not file.filename:
        raise HTTPException(status_code=400, detail="A file is required for import.")

    extension = file.filename.split(".")[-1].lower()
    if extension not in {"csv", "xlsx", "xls"}:
        raise HTTPException(status_code=400, detail="Unsupported file type. Use CSV or Excel.")

    content = await file.read()
    buffer = BytesIO(content)

    try:
        if extension == "csv":
            data = pd.read_csv(buffer)
        else:
            data = pd.read_excel(buffer, engine="openpyxl")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Unable to parse file: {exc}") from exc

    imported = data.to_dict(orient="records")
    return {
        "message": f"Imported {len(imported)} {kind} records from {file.filename}",
        "filename": file.filename,
        "count": len(imported),
        "preview": imported[:3],
        "kind": kind,
    }


@app.post("/api/issue-book")
def issue_book(payload: dict):
    member = payload.get("member")
    book_id = payload.get("bookId")
    due_date = payload.get("dueDate")
    if not member or not book_id or not due_date:
        raise HTTPException(status_code=400, detail="Member, book ID, and due date are required.")

    book_to_update = next((book for book in books if book["id"] == book_id), None)
    if not book_to_update:
        raise HTTPException(status_code=404, detail="Book not found")

    book_to_update["status"] = "Checked Out"
    due_entry = {
        "id": f"L-{len(loans) + 1001}",
        "bookId": book_id,
        "member": member,
        "dueDate": due_date,
        "status": "Borrowed",
    }
    loans.append(due_entry)
    return {"message": "Book issued successfully", "loan": due_entry}


@app.post("/api/return-book")
def return_book(payload: dict):
    book_id = payload.get("bookId")
    if not book_id:
        raise HTTPException(status_code=400, detail="Book ID is required")

    for book in books:
        if book["id"] == book_id:
            book["status"] = "Available"
            break

    for loan in loans:
        if loan["bookId"] == book_id and loan["status"] == "Borrowed":
            loan["status"] = "Returned"
            break

    return {"message": "Book returned successfully"}


@app.post("/api/issue-library-read")
def issue_library_read(payload: dict):
    student = payload.get("student")
    book_id = payload.get("bookId")
    minutes = payload.get("minutes", 45)
    date = payload.get("date")

    if not student or not book_id or not date:
        raise HTTPException(status_code=400, detail="Student, book ID, and date are required.")

    book = next((item for item in books if item["id"] == book_id), None)
    if not book:
        raise HTTPException(status_code=404, detail="Book not found")

    attendance_entry = {
        "id": f"AT-{len(attendance) + 2001}",
        "student": student,
        "date": date,
        "book": book["title"],
        "minutes": int(minutes),
    }
    attendance.append(attendance_entry)

    if book["status"] != "Checked Out":
        book["status"] = "In Library"

    return {"message": "Book issued for in-library reading", "entry": attendance_entry}


@app.get("/api/export")
def export_report(type: str = Query(default="excel", pattern="^(csv|xlsx|pdf)$")):
    export_data = pd.DataFrame(books)

    if type == "csv":
        csv_buffer = BytesIO()
        export_data.to_csv(csv_buffer, index=False)
        csv_buffer.seek(0)
        return StreamingResponse(
            csv_buffer,
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=library_report.csv"},
        )

    if type == "xlsx":
        excel_buffer = BytesIO()
        with pd.ExcelWriter(excel_buffer, engine="openpyxl") as writer:
            export_data.to_excel(writer, index=False, sheet_name="Library Report")
        excel_buffer.seek(0)
        return StreamingResponse(
            excel_buffer,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=library_report.xlsx"},
        )

    pdf_buffer = BytesIO()
    pdf = canvas.Canvas(pdf_buffer, pagesize=letter)
    pdf.setTitle("Library Report")
    pdf.setFont("Helvetica-Bold", 16)
    pdf.drawString(50, 760, "Library Management System Report")
    pdf.setFont("Helvetica", 11)
    y = 730
    for index, book in enumerate(books, start=1):
        text = f"{index}. {book['title']} by {book['author']} | Status: {book['status']}"
        pdf.drawString(50, y, text)
        y -= 18
        if y < 80:
            pdf.showPage()
            y = 760
    pdf.save()
    pdf_buffer.seek(0)
    return StreamingResponse(
        pdf_buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=library_report.pdf"},
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
