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
  { id: 'BK-1024', title: 'The Pragmatic Programmer', author: 'Andrew Hunt', category: 'Technology', status: 'Available', location: 'A1-12' },
  { id: 'BK-2048', title: 'Atomic Habits', author: 'James Clear', category: 'Self Improvement', status: 'Checked Out', location: 'B4-02' },
  { id: 'BK-3410', title: 'The Alchemist', author: 'Paulo Coelho', category: 'Fiction', status: 'Available', location: 'C3-09' },
  { id: 'BK-4411', title: 'Clean Code', author: 'Robert C. Martin', category: 'Technology', status: 'Overdue', location: 'A2-07' },
  { id: 'BK-5120', title: 'Deep Work', author: 'Cal Newport', category: 'Productivity', status: 'Available', location: 'D1-05' },
  { id: 'BK-6177', title: 'The Silent Patient', author: 'Alex Michaelides', category: 'Mystery', status: 'Reserved', location: 'B2-14' },
]

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

function App() {
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
      const matchesSearch = [book.title, book.author, book.id, book.category]
        .join(' ')
        .toLowerCase()
        .includes(search.toLowerCase())

      const matchesStatus = statusFilter === 'All' || book.status === statusFilter
      return matchesSearch && matchesStatus
    })
  }, [books, search, statusFilter])

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
        setBooks((currentBooks) => [...currentBooks, ...records.map((record) => ({
          id: record.id || `BK-${Date.now()}`,
          title: record.title || 'Imported Book',
          author: record.author || 'Unknown author',
          category: record.category || 'General',
          status: record.status || 'Available',
          location: record.location || 'New shelf',
        }))])
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
          <button className="nav-item active">Dashboard</button>
          <button className="nav-item">Catalog</button>
          <button className="nav-item">Circulation</button>
          <button className="nav-item">Attendance</button>
          <button className="nav-item">Reports</button>
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
            <p className="eyebrow">Overview</p>
            <h1>Library Management System</h1>
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
                <h2>Search and filter books</h2>
              </div>
            </div>

            <div className="toolbar-row">
              <input
                type="text"
                placeholder="Search title, author, ID..."
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

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Title</th>
                    <th>Category</th>
                    <th>Status</th>
                    <th>Location</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBooks.map((book) => (
                    <tr key={book.id}>
                      <td>{book.id}</td>
                      <td>
                        <strong>{book.title}</strong>
                        <small>{book.author}</small>
                      </td>
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
                  <option key={book.id} value={book.id}>{book.title}</option>
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
                  <option key={book.id} value={book.id}>{book.title}</option>
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
      </main>
    </div>
  )
}

export default App
