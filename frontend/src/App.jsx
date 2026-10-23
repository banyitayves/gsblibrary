import { useEffect, useMemo, useState } from 'react'
import './App.css'

const defaultDashboard = {
  stats: [
    { label: 'Total books', value: 8452, change: '+12.5%' },
    { label: 'Active loans', value: 382, change: '+6.3%' },
    { label: 'Late returns', value: 29, change: '-2.1%' },
    { label: 'Member satisfaction', value: '96.4%', change: '+4.8%' },
  ],
  chart: [
    { month: 'Jan', value: 220 },
    { month: 'Feb', value: 240 },
    { month: 'Mar', value: 290 },
    { month: 'Apr', value: 310 },
    { month: 'May', value: 360 },
    { month: 'Jun', value: 390 },
    { month: 'Jul', value: 410 },
    { month: 'Aug', value: 450 },
  ],
}

const defaultUsers = [
  { id: 1, username: 'admin', password: 'admin123', name: 'Aisha Khan', role: 'Administrator' },
  { id: 2, username: 'librarian', password: 'lib123', name: 'Nora James', role: 'Librarian' },
  { id: 3, username: 'manager', password: 'mgr123', name: 'Hashim Roy', role: 'Manager' },
  { id: 4, username: 'student', password: 'stu123', name: 'Maya Clark', role: 'Student' },
  { id: 5, username: 'student2', password: 'stu123', name: 'Nia Lopez', role: 'Student' },
]

const defaultBooks = [
  { id: 'BK-1024', code: 'BK-1024', title: 'The Pragmatic Programmer', author: 'Andrew Hunt', category: 'Technology', status: 'Available', location: 'A1-12' },
  { id: 'BK-2048', code: 'BK-2048', title: 'Atomic Habits', author: 'James Clear', category: 'Self Improvement', status: 'Checked Out', location: 'B4-02' },
  { id: 'BK-3410', code: 'BK-3410', title: 'The Alchemist', author: 'Paulo Coelho', category: 'Fiction', status: 'Available', location: 'C3-09' },
  { id: 'BK-4411', code: 'BK-4411', title: 'Clean Code', author: 'Robert C. Martin', category: 'Technology', status: 'Overdue', location: 'A2-07' },
  { id: 'BK-5120', code: 'BK-5120', title: 'Deep Work', author: 'Cal Newport', category: 'Productivity', status: 'Available', location: 'D1-05' },
  { id: 'BK-6177', code: 'BK-6177', title: 'The Silent Patient', author: 'Alex Michaelides', category: 'Mystery', status: 'Reserved', location: 'B2-14' },
]

const emptyBookForm = {
  code: '',
  title: '',
  author: '',
  grade: '',
  type: '',
  category: '',
  location: '',
}

const normalizeBookValue = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

const hasSameBookIdentity = (book, candidate) => (
  normalizeBookValue(book.code || book.id) === normalizeBookValue(candidate.code)
  && normalizeBookValue(book.title) === normalizeBookValue(candidate.title)
  && normalizeBookValue(book.grade) === normalizeBookValue(candidate.grade)
  && normalizeBookValue(book.type) === normalizeBookValue(candidate.type)
)

const defaultLoans = [
  { id: 'L-1001', bookId: 'BK-2048', member: 'Maya Clark', dueDate: '2026-10-20', status: 'Borrowed' },
  { id: 'L-1002', bookId: 'BK-4411', member: 'Aisha Khan', dueDate: '2026-10-17', status: 'Returned' },
]

const defaultAttendance = [
  { id: 'AT-2001', student: 'Maya Clark', date: '2026-10-14', book: 'Deep Work', minutes: 60 },
  { id: 'AT-2002', student: 'Nia Lopez', date: '2026-10-14', book: 'Atomic Habits', minutes: 45 },
]

const defaultAuditLogs = [
  { time: '2026-10-14 08:40', user: 'Nora James', action: 'Catalog updated', details: 'Added 23 titles to technology shelf' },
  { time: '2026-10-14 09:12', user: 'Hashim Roy', action: 'Loan approved', details: 'Approved renewal for BK-2048' },
  { time: '2026-10-14 10:03', user: 'Aisha Khan', action: 'Invoice exported', details: 'Saved monthly circulation report as Excel' },
  { time: '2026-10-14 11:27', user: 'Mina Patel', action: 'Document uploaded', details: 'Attached policy update to shared catalog folder' },
  { time: '2026-10-14 12:55', user: 'Leo Grant', action: 'Member account updated', details: 'Changed inactive account status to active' },
]

const defaultProjects = [
  { id: 'PRJ-101', title: 'Reader onboarding campaign', stage: 'Research', owner: 'Nora James', deadline: '2026-10-19', hours: 18 },
  { id: 'PRJ-104', title: 'Catalog metadata cleanup', stage: 'In Review', owner: 'Aisha Khan', deadline: '2026-10-18', hours: 32 },
  { id: 'PRJ-109', title: 'Annual inventory audit', stage: 'Planning', owner: 'Hashim Roy', deadline: '2026-10-24', hours: 26 },
  { id: 'PRJ-118', title: 'Digital archiving rollout', stage: 'In Progress', owner: 'Mina Patel', deadline: '2026-10-29', hours: 42 },
]

const defaultDocuments = [
  { name: 'Library_Operations_Policy.pdf', owner: 'Nora James', size: '2.4 MB', updated: '2 hours ago' },
  { name: 'Reading_Room_Schedule.xlsx', owner: 'Aisha Khan', size: '840 KB', updated: '5 hours ago' },
  { name: 'Collections_Review_2026.csv', owner: 'Hashim Roy', size: '310 KB', updated: '1 day ago' },
  { name: 'Volunteer_Training_Guide.docx', owner: 'Mina Patel', size: '1.8 MB', updated: '3 days ago' },
]

const defaultRoles = [
  { name: 'Administrator', permissions: ['Users', 'Catalog', 'Analytics', 'Audit', 'Projects'] },
  { name: 'Librarian', permissions: ['Catalog', 'Loans', 'Audit', 'Documents'] },
  { name: 'Manager', permissions: ['Analytics', 'Projects', 'Reports', 'Team'] },
  { name: 'Student', permissions: ['Catalog', 'Reading', 'Attendance'] },
]

const formatDate = (date) => date.toLocaleDateString('en-GB', {
  day: '2-digit',
  month: 'long',
  year: 'numeric',
})

const getDateInputValue = (date) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const shiftDateByMonths = (date, months) => {
  const shiftedDate = new Date(date)
  const dayOfMonth = shiftedDate.getDate()
  shiftedDate.setDate(1)
  shiftedDate.setMonth(shiftedDate.getMonth() - months)
  const lastDayOfMonth = new Date(
    shiftedDate.getFullYear(),
    shiftedDate.getMonth() + 1,
    0,
  ).getDate()
  shiftedDate.setDate(Math.min(dayOfMonth, lastDayOfMonth))
  return shiftedDate
}

function ReportLetter({ books, auditLogs, attendance, reportDate, setReportDate }) {
  const [period, setPeriod] = useState('week')
  const [attachments, setAttachments] = useState([])

  if (!reportDate) return null

  const reportEndDate = new Date(`${reportDate}T00:00:00`)
  const periodStartDate = period === 'week'
    ? new Date(reportEndDate.getFullYear(), reportEndDate.getMonth(), reportEndDate.getDate() - 6)
    : shiftDateByMonths(reportEndDate, period === 'month' ? 1 : period === 'threeMonths' ? 3 : 12)

  const periodStart = getDateInputValue(periodStartDate)
  const periodEnd = getDateInputValue(reportEndDate)
  const periodLogs = auditLogs.filter((entry) => {
    const activityDate = String(entry.time || '').slice(0, 10)
    return activityDate >= periodStart && activityDate <= periodEnd
  })
  const periodAttendance = attendance.filter((entry) => (
    entry.date >= periodStart && entry.date <= periodEnd
  ))
  const issuedBooks = periodLogs.filter((entry) => /issued/i.test(entry.action)).length
  const returnedBooks = periodLogs.filter((entry) => /returned/i.test(entry.action)).length
  const activities = [
    ...periodLogs.map((entry) => ({
      date: String(entry.time || '').slice(0, 10),
      description: `${entry.action}: ${entry.details}`,
    })),
    ...periodAttendance.map((entry) => ({
      date: entry.date,
      description: `Reading session: ${entry.student} read ${entry.book} for ${entry.minutes} minutes.`,
    })),
  ].sort((left, right) => left.date.localeCompare(right.date))

  const periodLabel = {
    week: 'one week',
    month: 'one month',
    threeMonths: 'three months',
    year: 'one year',
  }[period]

  const handleAttachments = (event) => {
    const selectedFiles = Array.from(event.target.files || [], (file) => file.name)
    setAttachments((currentFiles) => [...currentFiles, ...selectedFiles])
    event.target.value = ''
  }

  return (
    <section className="report-workspace">
      <div className="panel report-controls">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Formal report</p>
            <h2>Prepare a library report letter</h2>
          </div>
          <button className="primary" type="button" onClick={() => window.print()}>
            Print / Save as PDF
          </button>
        </div>

        <div className="report-options">
          <label>
            Reporting period
            <select value={period} onChange={(event) => setPeriod(event.target.value)}>
              <option value="week">Last week</option>
              <option value="month">Last month</option>
              <option value="threeMonths">Last 3 months</option>
              <option value="year">Last year</option>
            </select>
          </label>
          <label>
            Report date
            <input
              type="date"
              value={reportDate}
              onChange={(event) => {
                if (event.target.value) setReportDate(event.target.value)
              }}
            />
          </label>
          <label className="report-attachment-picker">
            Attach supporting reports
            <input
              type="file"
              multiple
              accept=".pdf,.csv,.xls,.xlsx,.doc,.docx"
              onChange={handleAttachments}
            />
          </label>
        </div>
        <p className="form-hint">
          Activity details are based on dated library records entered in this system.
          Selected files are listed on the letter; print it and attach the original
          supporting reports before submission.
        </p>
      </div>

      <article className="report-letter" id="report-letter">
        <div className="letter-sender">
          <strong>NSHIMIYIMANA Yves</strong>
          <span>Kicukiro District</span>
          <span>Kanombe Sector</span>
          <span>Tel: 0791756160</span>
        </div>

        <div className="letter-date">{formatDate(reportEndDate)}</div>

        <div className="letter-recipient">
          <strong>To: The Headteacher</strong>
          <span>GS Busanza</span>
        </div>

        <p className="letter-subject"><strong>RE: SUBMISSION OF LIBRARY REPORT</strong></p>
        <p>Dear Headteacher,</p>
        <p>
          I respectfully submit the library report covering {periodLabel}, from{' '}
          <strong>{formatDate(periodStartDate)}</strong> to{' '}
          <strong>{formatDate(reportEndDate)}</strong>. The following summary is
          generated from the dated records available in the library management system.
        </p>

        <h3>Summary of recorded work</h3>
        <ul className="report-summary">
          <li>{periodLogs.length} dated system activity record(s) were logged during this period.</li>
          <li>{issuedBooks} book issue(s) and {returnedBooks} book return(s) were recorded in the activity log.</li>
          <li>{periodAttendance.length} in-library reading session(s) were recorded, totalling {periodAttendance.reduce((minutes, entry) => minutes + Number(entry.minutes || 0), 0)} minutes.</li>
          <li>The current catalog contains {books.length} book record(s) as at the report date. This is a current inventory snapshot, not a count of new books added during this period.</li>
        </ul>

        <h3>Activities recorded during the period</h3>
        {activities.length > 0 ? (
          <ul className="report-activity-list">
            {activities.map((activity, index) => (
              <li key={`${activity.date}-${index}`}>
                <strong>{formatDate(new Date(`${activity.date}T00:00:00`))}:</strong>{' '}
                {activity.description}
              </li>
            ))}
          </ul>
        ) : (
          <p>No dated activity records were available in the system for this reporting period.</p>
        )}

        <p>
          The supporting library reports are attached for your review. I remain
          available to provide any additional information that may be required.
        </p>
        <p>Yours faithfully,</p>

        <div className="letter-signature">
          <span className="signature-line" />
          <strong>NSHIMIYIMANA Yves</strong>
          <span>Library report submitted on {formatDate(reportEndDate)}</span>
        </div>

        <div className="letter-attachments">
          <strong>Attachments</strong>
          {attachments.length > 0 ? (
            <ul>
              {attachments.map((name, index) => (
                <li key={`${name}-${index}`}>
                  {name}
                  <button
                    className="remove-attachment"
                    type="button"
                    aria-label={`Remove ${name}`}
                    onClick={() => setAttachments((currentFiles) => currentFiles.filter((_, fileIndex) => fileIndex !== index))}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p>Supporting reports to be attached.</p>
          )}
        </div>
      </article>
    </section>
  )
}

function App() {
  const [activeView, setActiveView] = useState('dashboard')
  const [reportDate, setReportDate] = useState('')
  const [selectedRole, setSelectedRole] = useState('Administrator')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [dashboard, setDashboard] = useState(defaultDashboard)
  const [books, setBooks] = useState(defaultBooks)
  const [users, setUsers] = useState(defaultUsers)
  const [loans, setLoans] = useState(defaultLoans)
  const [attendance, setAttendance] = useState(defaultAttendance)
  const [auditLogs, setAuditLogs] = useState(defaultAuditLogs)
  const [projects, setProjects] = useState(defaultProjects)
  const [documents, setDocuments] = useState(defaultDocuments)
  const [roles, setRoles] = useState(defaultRoles)
  const [currentUser, setCurrentUser] = useState(null)
  const [loginForm, setLoginForm] = useState({ username: 'admin', password: 'admin123' })
  const [loanForm, setLoanForm] = useState({ member: 'Maya Clark', bookId: 'BK-1024', dueDate: '2026-10-20' })
  const [readingForm, setReadingForm] = useState({ student: 'Maya Clark', bookId: 'BK-5120', minutes: '60', date: '2026-10-14' })
  const [bookForm, setBookForm] = useState(emptyBookForm)

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [dashboardRes, booksRes, usersRes, loansRes, attendanceRes, auditRes, projectRes, docRes, rolesRes] = await Promise.all([
          fetch('/api/dashboard'),
          fetch('/api/books'),
          fetch('/api/users'),
          fetch('/api/loans'),
          fetch('/api/attendance'),
          fetch('/api/audit'),
          fetch('/api/projects'),
          fetch('/api/documents'),
          fetch('/api/roles'),
        ])

        if (dashboardRes.ok) setDashboard(await dashboardRes.json())
        if (booksRes.ok) setBooks(await booksRes.json())
        if (usersRes.ok) setUsers(await usersRes.json())
        if (loansRes.ok) setLoans(await loansRes.json())
        if (attendanceRes.ok) setAttendance(await attendanceRes.json())
        if (auditRes.ok) setAuditLogs(await auditRes.json())
        if (projectRes.ok) setProjects(await projectRes.json())
        if (docRes.ok) setDocuments(await docRes.json())
        if (rolesRes.ok) setRoles(await rolesRes.json())
      } catch (error) {
        console.info('Using mock library data because the backend is not running yet.')
      }
    }

    fetchData()
  }, [])

  const filteredBooks = useMemo(() => {
    return books.filter((book) => {
      const matchesSearch = [book.title, book.author, book.code || book.id, book.category, book.grade, book.type, book.location]
        .join(' ')
        .toLowerCase()
        .includes(search.toLowerCase())

      const matchesStatus = statusFilter === 'All' || book.status === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [books, search, statusFilter])

  const shelfGroups = useMemo(() => {
    const groups = filteredBooks.reduce((shelves, book) => {
      const location = book.location?.trim() || 'Unassigned shelf'
      if (!shelves[location]) shelves[location] = []
      shelves[location].push(book)
      return shelves
    }, {})

    return Object.entries(groups).sort(([locationA], [locationB]) => locationA.localeCompare(locationB, undefined, { numeric: true }))
  }, [filteredBooks])

  const handleAddBook = async (event) => {
    event.preventDefault()
    if (books.some((book) => hasSameBookIdentity(book, bookForm))) {
      alert('This physical code is already used by the same title, grade, and book type.')
      return
    }

    try {
      const response = await fetch('/api/books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bookForm),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || 'Unable to add this book.')
      setBooks((currentBooks) => [...currentBooks, result])
      setAuditLogs((currentLogs) => [
        {
          time: new Date().toLocaleString('sv-SE', { hour12: false }),
          user: currentUser?.name || 'System',
          action: 'Book added',
          details: `Added ${result.title} (${result.code}) to the catalog`,
        },
        ...currentLogs,
      ])
      setBookForm(emptyBookForm)
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Unable to add this book. Please check the backend connection.')
    }
  }

  const handleLogin = (event) => {
    event.preventDefault()
    const matched = users.find(
      (user) => user.username === loginForm.username && user.password === loginForm.password,
    )

    if (!matched) {
      alert('Invalid username or password.')
      return
    }

    setCurrentUser(matched)
    setSelectedRole(matched.role)
  }

  const handleLogout = () => {
    setCurrentUser(null)
  }

  const handleLendBook = (event) => {
    event.preventDefault()
    const selectedBook = books.find((book) => book.id === loanForm.bookId)
    if (!selectedBook) return

    setBooks((currentBooks) =>
      currentBooks.map((book) =>
        book.id === selectedBook.id ? { ...book, status: 'Checked Out' } : book,
      ),
    )

    setLoans((currentLoans) => [
      ...currentLoans,
      {
        id: `L-${Date.now()}`,
        bookId: selectedBook.id,
        member: loanForm.member,
        dueDate: loanForm.dueDate,
        status: 'Borrowed',
      },
    ])

    setAuditLogs((currentLogs) => [
      {
        time: new Date().toLocaleString('sv-SE', { hour12: false }),
        user: currentUser?.name || 'System',
        action: 'Book issued',
        details: `${selectedBook.title} lent to ${loanForm.member}`,
      },
      ...currentLogs,
    ])
  }

  const handleReturnBook = (bookId) => {
    setBooks((currentBooks) =>
      currentBooks.map((book) =>
        book.id === bookId ? { ...book, status: 'Available' } : book,
      ),
    )

    setLoans((currentLoans) =>
      currentLoans.map((loan) =>
        loan.bookId === bookId && loan.status === 'Borrowed'
          ? { ...loan, status: 'Returned' }
          : loan,
      ),
    )

    const returnedBook = books.find((book) => book.id === bookId)
    setAuditLogs((currentLogs) => [
      {
        time: new Date().toLocaleString('sv-SE', { hour12: false }),
        user: currentUser?.name || 'System',
        action: 'Book returned',
        details: `${returnedBook?.title || bookId} returned to the library`,
      },
      ...currentLogs,
    ])
  }

  const handleReadingLog = (event) => {
    event.preventDefault()
    const selectedBook = books.find((book) => book.id === readingForm.bookId)
    if (!selectedBook) return

    const newEntry = {
      id: `AT-${Date.now()}`,
      student: readingForm.student,
      date: readingForm.date,
      book: selectedBook.title,
      minutes: Number(readingForm.minutes),
    }

    setAttendance((currentList) => [newEntry, ...currentList])
    setBooks((currentBooks) =>
      currentBooks.map((book) =>
        book.id === selectedBook.id ? { ...book, status: 'In Library' } : book,
      ),
    )
  }

  const handleImport = async (kind, event) => {
    const file = event.target.files?.[0]
    if (!file) return

    const formData = new FormData()
    formData.append('file', file)

    try {
      const response = await fetch(`/api/import?kind=${kind}`, {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) throw new Error('Upload failed')

      const result = await response.json()
      if (kind === 'books') {
        const records = result.preview || []
        const importedBooks = records.map((record, index) => ({
          id: `BK-IMPORT-${Date.now()}-${index}`,
          code: record.code || record.physicalCode || record.id || `Imported-${Date.now()}-${index}`,
          title: record.title || 'Imported Book',
          author: record.author || 'Unknown author',
          grade: record.grade || '',
          type: record.type || record.bookType || '',
          category: record.category || 'General',
          status: record.status || 'Available',
          location: record.location || 'New shelf',
        }))
        const acceptedBooks = []
        let duplicatesSkipped = 0
        for (const book of importedBooks) {
          if ([...books, ...acceptedBooks].some((existingBook) => hasSameBookIdentity(existingBook, book))) {
            duplicatesSkipped += 1
          } else {
            acceptedBooks.push(book)
          }
        }
        setBooks((currentBooks) => [...currentBooks, ...acceptedBooks])
        if (acceptedBooks.length > 0) {
          setAuditLogs((currentLogs) => [
            {
              time: new Date().toLocaleString('sv-SE', { hour12: false }),
              user: currentUser?.name || 'System',
              action: 'Books imported',
              details: `Added ${acceptedBooks.length} book record(s) from ${file.name}`,
            },
            ...currentLogs,
          ])
        }
        if (duplicatesSkipped > 0) {
          alert(`${duplicatesSkipped} imported book${duplicatesSkipped === 1 ? '' : 's'} skipped because the physical code, title, grade, and type already exist.`)
        }
      }

      if (kind === 'users') {
        const records = result.preview || []
        setUsers((currentUsers) => [...currentUsers, ...records.map((record) => ({
          id: record.id || Date.now(),
          username: record.username || `user${Date.now()}`,
          password: record.password || 'pass123',
          name: record.name || 'Imported User',
          role: record.role || 'Student',
        }))])
      }

      alert(result.message)
    } catch (error) {
      alert('Upload is ready. Start the backend to process spreadsheet imports.')
    }
  }

  const handleExport = async (type) => {
    try {
      const response = await fetch(`/api/export?type=${type}`)
      if (!response.ok) throw new Error('Export failed')

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `library_report.${type === 'xlsx' ? 'xlsx' : type}`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.URL.revokeObjectURL(url)
    } catch (error) {
      alert('Export is ready to run when the Python backend is started.')
    }
  }

  if (!currentUser) {
    return (
      <div className="login-screen">
        <form className="login-card" onSubmit={handleLogin}>
          <div className="brand-block brand-block-login">
            <div className="brand-mark">L</div>
            <div>
              <strong>LibraryFlow</strong>
              <span>Daily library operations</span>
            </div>
          </div>

          <h1>Sign in</h1>
          <p>Access the library system for all staff, managers, and students.</p>

          <label>
            Username
            <input
              type="text"
              value={loginForm.username}
              onChange={(event) => setLoginForm({ ...loginForm, username: event.target.value })}
            />
          </label>

          <label>
            Password
            <input
              type="password"
              value={loginForm.password}
              onChange={(event) => setLoginForm({ ...loginForm, password: event.target.value })}
            />
          </label>

          <div className="demo-accounts">
            <span>Demo users:</span>
            <small>admin / admin123</small>
            <small>librarian / lib123</small>
            <small>student / stu123</small>
          </div>

          <button className="primary full-width" type="submit">Log in</button>
        </form>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">L</div>
          <div>
            <strong>LibraryFlow</strong>
            <span>{currentUser.role}</span>
          </div>
        </div>

        <nav className="nav-menu">
          <button
            className={`nav-item${activeView === 'dashboard' ? ' active' : ''}`}
            onClick={() => setActiveView('dashboard')}
          >
            Dashboard
          </button>
          <button className="nav-item">Catalog</button>
          <button className="nav-item">Circulation</button>
          <button className="nav-item">Attendance</button>
          <button
            className={`nav-item${activeView === 'reports' ? ' active' : ''}`}
            onClick={() => {
              setReportDate(getDateInputValue(new Date()))
              setActiveView('reports')
            }}
          >
            Reports
          </button>
          <button className="nav-item" onClick={handleLogout}>Logout</button>
        </nav>

        <div className="panel mini-panel">
          <p className="eyebrow">Logged in</p>
          <div className="status-row"><strong>{currentUser.name}</strong></div>
          <div className="status-row">{currentUser.role}</div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div>
            <p className="eyebrow">{activeView === 'reports' ? 'Reports' : 'Overview'}</p>
            <h1>{activeView === 'reports' ? 'Library report letter' : 'Library Management System'}</h1>
          </div>

          <div className="topbar-actions">
            <label className="select-label">
              <span>Role</span>
              <select value={selectedRole} onChange={(event) => setSelectedRole(event.target.value)}>
                {roles.map((role) => (
                  <option key={role.name} value={role.name}>{role.name}</option>
                ))}
              </select>
            </label>

            <button className="secondary" onClick={() => handleExport('xlsx')}>Export Excel</button>
            <button className="primary" onClick={() => handleExport('pdf')}>Export PDF</button>
          </div>
        </header>

        {activeView === 'reports' ? (
          <ReportLetter
            books={books}
            auditLogs={auditLogs}
            attendance={attendance}
            reportDate={reportDate}
            setReportDate={setReportDate}
          />
        ) : (
          <>
        <section className="stats-grid">
          {dashboard.stats.map((item) => (
            <article key={item.label} className="stat-card">
              <div className="stat-head">
                <span>{item.label}</span>
                <strong>{item.change}</strong>
              </div>
              <h3>{item.value}</h3>
            </article>
          ))}
        </section>

        <section className="panel chart-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Analytics</p>
              <h2>Circulation activity</h2>
            </div>
            <button className="ghost-button" onClick={() => handleExport('csv')}>Download CSV</button>
          </div>

          <div className="bar-chart">
            {dashboard.chart.map((item) => (
              <div key={item.month} className="bar-group">
                <div className="bar" style={{ height: `${Math.max(16, item.value / 5)}px` }} />
                <span>{item.month}</span>
              </div>
            ))}
          </div>
        </section>

        <div className="two-col-layout">
          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Catalog</p>
                <h2>Catalog books</h2>
              </div>
            </div>

            <form className="catalog-add-form" onSubmit={handleAddBook}>
              <h3>Add a book</h3>
              <div className="catalog-fields">
                <label>
                  Physical code
                  <input
                    required
                    value={bookForm.code}
                    onChange={(event) => setBookForm({ ...bookForm, code: event.target.value })}
                  />
                </label>
                <label>
                  Title
                  <input
                    required
                    value={bookForm.title}
                    onChange={(event) => setBookForm({ ...bookForm, title: event.target.value })}
                  />
                </label>
                <label>
                  Grade
                  <input
                    required
                    placeholder="e.g. S3"
                    value={bookForm.grade}
                    onChange={(event) => setBookForm({ ...bookForm, grade: event.target.value })}
                  />
                </label>
                <label>
                  Book type
                  <input
                    required
                    placeholder="e.g. Student book"
                    value={bookForm.type}
                    onChange={(event) => setBookForm({ ...bookForm, type: event.target.value })}
                  />
                </label>
                <label>
                  Author
                  <input
                    value={bookForm.author}
                    onChange={(event) => setBookForm({ ...bookForm, author: event.target.value })}
                  />
                </label>
                <label>
                  Category
                  <input
                    value={bookForm.category}
                    onChange={(event) => setBookForm({ ...bookForm, category: event.target.value })}
                  />
                </label>
                <label>
                  Location
                  <input
                    value={bookForm.location}
                    onChange={(event) => setBookForm({ ...bookForm, location: event.target.value })}
                  />
                </label>
              </div>
              <button className="primary" type="submit">Add book</button>
              <p className="form-hint">A physical code can be reused for a different title, grade, or book type.</p>
            </form>

            <div className="toolbar-row">
              <input
                type="text"
                placeholder="Search title, author, ID, shelf..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="All">All</option>
                <option value="Available">Available</option>
                <option value="Checked Out">Checked Out</option>
                <option value="Overdue">Overdue</option>
                <option value="Reserved">Reserved</option>
                <option value="In Library">In Library</option>
              </select>
            </div>

            <section className="shelf-browser" aria-label="Books by shelf">
              <div className="shelf-browser-header">
                <div>
                  <h3>Books by shelf</h3>
                  <p>Books are grouped by their catalog location.</p>
                </div>
                <span>{filteredBooks.length} {filteredBooks.length === 1 ? 'book' : 'books'}</span>
              </div>
              {shelfGroups.length > 0 ? (
                <div className="shelf-grid">
                  {shelfGroups.map(([location, shelfBooks]) => (
                    <article className="shelf-card" key={location}>
                      <div className="shelf-card-header">
                        <h4>{location}</h4>
                        <span>{shelfBooks.length} {shelfBooks.length === 1 ? 'book' : 'books'}</span>
                      </div>
                      <ul className="shelf-book-list">
                        {shelfBooks.map((book) => (
                          <li className="shelf-book" key={book.id}>
                            <div className="shelf-book-copy">
                              <strong>{book.title}</strong>
                              <small>{book.code || book.id} · {book.author || 'Unknown author'}</small>
                            </div>
                            <span className={`status-pill ${book.status.toLowerCase().replace(/\s+/g, '-')}`}>
                              {book.status}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="shelf-empty-state">No books match your current search or status filter.</p>
              )}
            </section>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Physical code</th>
                    <th>Title</th>
                    <th>Grade</th>
                    <th>Type</th>
                    <th>Category</th>
                    <th>Status</th>
                    <th>Location</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBooks.map((book) => (
                    <tr key={book.id}>
                      <td>{book.code || book.id}</td>
                      <td>
                        <strong>{book.title}</strong>
                        <small>{book.author}</small>
                      </td>
                      <td>{book.grade || '—'}</td>
                      <td>{book.type || '—'}</td>
                      <td>{book.category}</td>
                      <td><span className={`status-pill ${book.status.toLowerCase().replace(/\s+/g, '-')}`}>{book.status}</span></td>
                      <td>{book.location}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Access</p>
                <h2>Role-Based Access</h2>
              </div>
            </div>

            <div className="role-grid">
              {roles.map((role) => (
                <div key={role.name} className={`role-box ${selectedRole === role.name ? 'active' : ''}`}>
                  <h3>{role.name}</h3>
                  <ul>
                    {role.permissions.map((permission) => (
                      <li key={permission}>{permission}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="two-col-layout">
          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Circulation</p>
                <h2>Lend and return books</h2>
              </div>
            </div>

            <form className="stack-form" onSubmit={handleLendBook}>
              <select value={loanForm.bookId} onChange={(event) => setLoanForm({ ...loanForm, bookId: event.target.value })}>
                {books.map((book) => (
                  <option key={book.id} value={book.id}>{book.title} — {book.grade || 'No grade'} / {book.type || 'No type'} ({book.code || book.id})</option>
                ))}
              </select>
              <input
                type="text"
                value={loanForm.member}
                onChange={(event) => setLoanForm({ ...loanForm, member: event.target.value })}
                placeholder="Borrower name"
              />
              <input
                type="date"
                value={loanForm.dueDate}
                onChange={(event) => setLoanForm({ ...loanForm, dueDate: event.target.value })}
              />
              <button className="primary" type="submit">Lend book</button>
            </form>

            <div className="mini-list">
              {loans.map((loan) => (
                <div key={loan.id} className="mini-row">
                  <div>
                    <strong>{loan.member}</strong>
                    <small>{loan.bookId}</small>
                  </div>
                  <div>
                    <span>{loan.status}</span>
                    <small>Due {loan.dueDate}</small>
                  </div>
                  {loan.status === 'Borrowed' && (
                    <button type="button" className="secondary" onClick={() => handleReturnBook(loan.bookId)}>Return</button>
                  )}
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Daily library</p>
                <h2>In-library reading</h2>
              </div>
            </div>

            <form className="stack-form" onSubmit={handleReadingLog}>
              <input
                type="text"
                value={readingForm.student}
                onChange={(event) => setReadingForm({ ...readingForm, student: event.target.value })}
                placeholder="Student name"
              />
              <select value={readingForm.bookId} onChange={(event) => setReadingForm({ ...readingForm, bookId: event.target.value })}>
                {books.map((book) => (
                  <option key={book.id} value={book.id}>{book.title} — {book.grade || 'No grade'} / {book.type || 'No type'} ({book.code || book.id})</option>
                ))}
              </select>
              <input
                type="date"
                value={readingForm.date}
                onChange={(event) => setReadingForm({ ...readingForm, date: event.target.value })}
              />
              <input
                type="number"
                value={readingForm.minutes}
                onChange={(event) => setReadingForm({ ...readingForm, minutes: event.target.value })}
                placeholder="Minutes read"
              />
              <button className="primary" type="submit">Issue in-library book</button>
            </form>
          </section>
        </div>

        <div className="two-col-layout">
          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Workflow</p>
                <h2>Project tracking board</h2>
              </div>
            </div>

            <div className="kanban-board">
              {['Planning', 'Research', 'In Progress', 'In Review'].map((stage) => (
                <div key={stage} className="kanban-column">
                  <h3>{stage}</h3>
                  {projects.filter((project) => project.stage === stage).map((project) => (
                    <div key={project.id} className="kanban-card">
                      <div className="card-topline">
                        <span>{project.id}</span>
                        <span>{project.hours}h</span>
                      </div>
                      <strong>{project.title}</strong>
                      <p>{project.owner}</p>
                      <small>Due {project.deadline}</small>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">History</p>
                <h2>Audit log</h2>
              </div>
            </div>

            <div className="audit-list">
              {auditLogs.map((entry) => (
                <div key={`${entry.time}-${entry.user}-${entry.action}`} className="audit-item">
                  <div className="audit-time">{entry.time}</div>
                  <div className="audit-copy">
                    <strong>{entry.user}</strong>
                    <span>{entry.action}</span>
                    <p>{entry.details}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="panel documents-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Files</p>
              <h2>Document and user uploads</h2>
            </div>
            <div className="upload-group">
              <label className="upload-button">
                <input type="file" onChange={(event) => handleImport('books', event)} accept=".csv,.xlsx,.xls" />
                Upload books
              </label>
              <label className="upload-button alt">
                <input type="file" onChange={(event) => handleImport('users', event)} accept=".csv,.xlsx,.xls" />
                Upload users
              </label>
            </div>
          </div>

          <div className="document-grid">
            {documents.map((document) => (
              <article key={document.name} className="file-card">
                <div className="file-icon">DOC</div>
                <div>
                  <strong>{document.name}</strong>
                  <p>{document.owner}</p>
                </div>
                <div className="meta-row">
                  <span>{document.size}</span>
                  <span>{document.updated}</span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="panel attendance-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Attendance</p>
              <h2>Daily library attendance</h2>
            </div>
          </div>

          <div className="attendance-grid">
            {attendance.map((entry) => (
              <div key={entry.id} className="attendance-item">
                <strong>{entry.student}</strong>
                <span>{entry.date}</span>
                <small>{entry.book}</small>
                <small>{entry.minutes} minutes</small>
              </div>
            ))}
          </div>
        </section>
          </>
        )}
      </main>
    </div>
  )
}

export default App
