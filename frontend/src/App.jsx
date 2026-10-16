import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  Bell,
  BookOpen,
  Bookmark,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Download,
  LayoutDashboard,
  LibraryBig,
  LogOut,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  UsersRound,
  X,
} from 'lucide-react'
import { api } from './api.js'

const navigation = [
  { id: 'Dashboard', label: 'Overview', icon: LayoutDashboard },
  { id: 'Catalog', label: 'Book collection', icon: LibraryBig },
  { id: 'Members', label: 'Members', icon: UsersRound },
  { id: 'Loans', label: 'Loans & returns', icon: Bookmark },
]

const initialBook = { isbn: '', title: '', author: '', category: '', shelf: '', totalCopies: 1, publishedOn: '' }
const today = () => {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const userFromSession = () => {
  try {
    return JSON.parse(sessionStorage.getItem('libraryflow-user') || 'null')
  } catch {
    return null
  }
}

function initials(name = '') {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
}

function App() {
  const [user, setUser] = useState(userFromSession)
  const [page, setPage] = useState('Dashboard')
  const [dashboard, setDashboard] = useState(null)
  const [books, setBooks] = useState([])
  const [members, setMembers] = useState([])
  const [loans, setLoans] = useState([])
  const [activity, setActivity] = useState([])
  const [search, setSearch] = useState('')
  const [loanFilter, setLoanFilter] = useState('All')
  const [modal, setModal] = useState(null)
  const [bookForm, setBookForm] = useState(initialBook)
  const [memberForm, setMemberForm] = useState({ name: '', email: '' })
  const [loanForm, setLoanForm] = useState({ bookId: '', memberId: '', dueDate: '' })
  const [loginForm, setLoginForm] = useState({ email: 'admin@library.local', password: 'admin123' })
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')
  const toastTimer = useRef(null)

  const notify = useCallback((message) => {
    setToast(message)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 4000)
  }, [])

  const loadData = useCallback(async () => {
    try {
      const [overview, catalog, directory, circulation, recentActivity] = await Promise.all([
        api('/dashboard'),
        api('/books'),
        api('/members'),
        api('/loans'),
        api('/audit'),
      ])
      setDashboard(overview)
      setBooks(catalog)
      setMembers(directory)
      setLoans(circulation)
      setActivity(recentActivity)
    } catch (error) {
      notify(error.message)
    }
  }, [notify])

  useEffect(() => {
    if (!user) return undefined
    const timer = window.setTimeout(() => { void loadData() }, 0)
    return () => window.clearTimeout(timer)
  }, [loadData, user])

  useEffect(() => {
    const expireSession = () => {
      setUser(null)
      notify('Your session expired. Please sign in again.')
    }
    window.addEventListener('libraryflow:session-expired', expireSession)
    return () => window.removeEventListener('libraryflow:session-expired', expireSession)
  }, [notify])

  const filteredBooks = useMemo(() => {
    const term = search.trim().toLowerCase()
    return books.filter((book) =>
      [book.title, book.author, book.isbn, book.category, book.shelf].join(' ').toLowerCase().includes(term),
    )
  }, [books, search])

  const filteredMembers = useMemo(() => {
    const term = search.trim().toLowerCase()
    return members.filter((member) =>
      [member.name, member.email, member.membershipNumber].join(' ').toLowerCase().includes(term),
    )
  }, [members, search])

  const filteredLoans = useMemo(
    () => loans.filter((loan) => loanFilter === 'All' || loan.status === loanFilter),
    [loans, loanFilter],
  )

  async function handleLogin(event) {
    event.preventDefault()
    setBusy(true)
    try {
      const result = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify(loginForm),
      })
      sessionStorage.setItem('libraryflow-token', result.token)
      sessionStorage.setItem('libraryflow-user', JSON.stringify(result.user))
      setUser(result.user)
      notify(`Welcome back, ${result.user.name.split(' ')[0]}.`)
    } catch (error) {
      notify(error.message)
    } finally {
      setBusy(false)
    }
  }

  function logout() {
    sessionStorage.removeItem('libraryflow-token')
    sessionStorage.removeItem('libraryflow-user')
    setUser(null)
    setDashboard(null)
  }

  async function saveBook(event) {
    event.preventDefault()
    setBusy(true)
    try {
      await api(modal.book ? `/books/${modal.book.id}` : '/books', {
        method: modal.book ? 'PUT' : 'POST',
        body: JSON.stringify({ ...bookForm, totalCopies: Number(bookForm.totalCopies) }),
      })
      setModal(null)
      notify(modal.book ? 'Book details updated.' : 'Book added to the collection.')
      await loadData()
    } catch (error) {
      notify(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function saveMember(event) {
    event.preventDefault()
    setBusy(true)
    try {
      await api('/members', { method: 'POST', body: JSON.stringify(memberForm) })
      setModal(null)
      setMemberForm({ name: '', email: '' })
      notify('New member registered.')
      await loadData()
    } catch (error) {
      notify(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function issueLoan(event) {
    event.preventDefault()
    setBusy(true)
    try {
      await api('/loans', {
        method: 'POST',
        body: JSON.stringify({ ...loanForm, bookId: Number(loanForm.bookId), memberId: Number(loanForm.memberId) }),
      })
      setModal(null)
      setLoanForm({ bookId: '', memberId: '', dueDate: '' })
      notify('Book checked out successfully.')
      await loadData()
    } catch (error) {
      notify(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function returnLoan(loan) {
    setBusy(true)
    try {
      await api(`/loans/${loan.id}/return`, { method: 'POST' })
      notify(`“${loan.bookTitle}” has been returned.`)
      await loadData()
    } catch (error) {
      notify(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function deleteBook(book) {
    if (!window.confirm(`Remove “${book.title}” from the catalog?`)) return
    try {
      await api(`/books/${book.id}`, { method: 'DELETE' })
      notify('Book removed.')
      await loadData()
    } catch (error) {
      notify(error.message)
    }
  }

  async function exportCatalog() {
    try {
      const token = sessionStorage.getItem('libraryflow-token')
      const response = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/export/books.csv`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!response.ok) {
        const result = await response.json().catch(() => ({}))
        throw new Error(result.error || `Export failed (${response.status}).`)
      }
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = 'library-catalog.csv'
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      notify(error.message)
    }
  }

  if (!user) {
    return (
      <Login
        form={loginForm}
        setForm={setLoginForm}
        onSubmit={handleLogin}
        busy={busy}
        toast={toast}
      />
    )
  }

  const canAdminister = user.role === 'Administrator'
  const availableBooks = books.filter((book) => book.availableCopies > 0)

  return (
    <div className="min-h-screen bg-[#f7f8f5] text-[#1d302b]">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[252px] flex-col border-r border-[#e9ede7] bg-white px-5 py-6 lg:flex">
        <Brand />
        <div className="mb-3 mt-10 px-3 text-[10px] font-bold uppercase tracking-[.16em] text-[#a0aba3]">Workspace</div>
        <nav className="space-y-1">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => { setPage(id); setSearch('') }}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[13px] font-semibold transition ${page === id ? 'bg-[#edf5ef] text-[#28644b]' : 'text-[#78847c] hover:bg-[#f7f8f5] hover:text-[#34443b]'}`}
            >
              <Icon size={17} strokeWidth={1.8} />
              {label}
              {id === 'Loans' && dashboard?.overdueLoans > 0 && (
                <span className="ml-auto rounded-full bg-[#faede8] px-2 py-0.5 text-[10px] font-bold text-[#b46146]">
                  {dashboard.overdueLoans}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="mt-auto rounded-2xl bg-[#f6f8f4] p-4">
          <div className="mb-3 flex size-8 items-center justify-center rounded-xl bg-white text-[#587461]">
            <CircleHelp size={16} />
          </div>
          <p className="mb-1 text-[12px] font-bold">Need a hand?</p>
          <p className="mb-3 text-[11px] leading-relaxed text-[#839087]">Your library workspace is ready whenever you are.</p>
          <button onClick={() => notify('Your administrator can help with account and access questions.')} className="text-[11px] font-bold text-[#3f7959]">
            Get support <ArrowRight className="ml-1 inline" size={12} />
          </button>
        </div>
        <UserCard user={user} onLogout={logout} />
      </aside>

      <div className="lg:pl-[252px]">
        <header className="sticky top-0 z-10 border-b border-[#e9ede7] bg-white/95 backdrop-blur">
          <div className="mx-auto flex h-[76px] max-w-[1440px] items-center justify-between gap-4 px-5 sm:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <div className="lg:hidden"><Brand compact /></div>
              <div className="hidden lg:block">
                <p className="mb-0.5 text-[10px] font-bold uppercase tracking-[.14em] text-[#a0aaa2]">Library / {page}</p>
                <h1 className="truncate text-[17px] font-bold tracking-[-.03em]">{page === 'Dashboard' ? 'Good morning' : page}</h1>
              </div>
              <h1 className="truncate text-[16px] font-bold lg:hidden">{page}</h1>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="hidden items-center gap-2 rounded-full bg-[#f3f6f1] px-3 py-2 text-[11px] font-medium text-[#78847c] sm:flex">
                <span className="size-1.5 rounded-full bg-[#67a47b]" />
                Library open today
              </div>
              <button onClick={() => notify('You’re all caught up.')} aria-label="Notifications" className="relative rounded-xl border border-[#edf0eb] p-2.5 text-[#77847b] hover:bg-[#f7f8f5]">
                <Bell size={17} strokeWidth={1.8} />
                {dashboard?.overdueLoans > 0 && <span className="absolute right-2 top-2 size-1.5 rounded-full bg-[#dc8c6e]" />}
              </button>
              <div className="hidden h-8 w-px bg-[#edf0eb] sm:block" />
              <div className="hidden text-right sm:block"><p className="text-[12px] font-bold">{user.name}</p><p className="mt-0.5 text-[10px] text-[#8c978f]">{user.role}</p></div>
              <div className="flex size-9 items-center justify-center rounded-full bg-[#eaf0e9] text-[11px] font-bold text-[#4a7057]">{initials(user.name)}</div>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto border-t border-[#f1f3ef] px-4 py-2 lg:hidden">
            {navigation.map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => { setPage(id); setSearch('') }} className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold ${page === id ? 'bg-[#edf5ef] text-[#28644b]' : 'text-[#78847c]'}`}>
                <Icon size={15} />{label}
              </button>
            ))}
            <button onClick={logout} className="ml-auto flex shrink-0 items-center gap-2 px-3 text-xs text-[#78847c]"><LogOut size={14} /> Sign out</button>
          </nav>
        </header>

        <main className="mx-auto max-w-[1440px] px-5 py-7 sm:px-8 sm:py-9">
          {page === 'Dashboard' && (
            <Dashboard
              dashboard={dashboard}
              books={books}
              loans={loans}
              activity={activity}
              onNavigate={setPage}
              onIssue={() => setModal({ type: 'loan' })}
            />
          )}
          {page === 'Catalog' && (
            <Catalog
              books={filteredBooks}
              search={search}
              setSearch={setSearch}
              onAdd={() => { setBookForm(initialBook); setModal({ type: 'book' }) }}
              onEdit={(book) => { setBookForm({ ...book, totalCopies: book.totalCopies, publishedOn: book.publishedOn || '' }); setModal({ type: 'book', book }) }}
              onDelete={deleteBook}
              onExport={exportCatalog}
              canAdminister={canAdminister}
            />
          )}
          {page === 'Members' && (
            <Members
              members={filteredMembers}
              search={search}
              setSearch={setSearch}
              onAdd={() => setModal({ type: 'member' })}
            />
          )}
          {page === 'Loans' && (
            <Loans
              loans={filteredLoans}
              filter={loanFilter}
              setFilter={setLoanFilter}
              onIssue={() => setModal({ type: 'loan' })}
              onReturn={returnLoan}
              busy={busy}
            />
          )}
        </main>
      </div>

      {modal?.type === 'book' && (
        <Modal title={modal.book ? 'Edit book details' : 'Add a book'} subtitle="Keep your collection details up to date." onClose={() => setModal(null)}>
          <form className="space-y-4" onSubmit={saveBook}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Book title"><input required autoFocus value={bookForm.title} onChange={(event) => setBookForm({ ...bookForm, title: event.target.value })} placeholder="e.g. The Midnight Library" /></Field>
              <Field label="Author"><input required value={bookForm.author} onChange={(event) => setBookForm({ ...bookForm, author: event.target.value })} placeholder="Author name" /></Field>
              <Field label="ISBN"><input required value={bookForm.isbn} onChange={(event) => setBookForm({ ...bookForm, isbn: event.target.value })} placeholder="ISBN-13" /></Field>
              <Field label="Category"><input value={bookForm.category} onChange={(event) => setBookForm({ ...bookForm, category: event.target.value })} placeholder="e.g. Fiction" /></Field>
              <Field label="Shelf location"><input value={bookForm.shelf} onChange={(event) => setBookForm({ ...bookForm, shelf: event.target.value })} placeholder="e.g. A1-04" /></Field>
              <Field label="Total copies"><input required type="number" min="1" max="10000" value={bookForm.totalCopies} onChange={(event) => setBookForm({ ...bookForm, totalCopies: event.target.value })} /></Field>
              <Field label="Publication date"><input type="date" value={bookForm.publishedOn} onChange={(event) => setBookForm({ ...bookForm, publishedOn: event.target.value })} /></Field>
            </div>
            <ModalActions onCancel={() => setModal(null)} busy={busy} submitLabel={modal.book ? 'Save changes' : 'Add to collection'} />
          </form>
        </Modal>
      )}

      {modal?.type === 'member' && (
        <Modal title="Add a member" subtitle="Create a library membership record." onClose={() => setModal(null)}>
          <form className="space-y-4" onSubmit={saveMember}>
            <Field label="Full name"><input required autoFocus value={memberForm.name} onChange={(event) => setMemberForm({ ...memberForm, name: event.target.value })} placeholder="Member name" /></Field>
            <Field label="Email address"><input required type="email" value={memberForm.email} onChange={(event) => setMemberForm({ ...memberForm, email: event.target.value })} placeholder="name@example.com" /></Field>
            <ModalActions onCancel={() => setModal(null)} busy={busy} submitLabel="Register member" />
          </form>
        </Modal>
      )}

      {modal?.type === 'loan' && (
        <Modal title="Check out a book" subtitle="Choose a member and an available title." onClose={() => setModal(null)}>
          {availableBooks.length === 0 || members.every((member) => member.status !== 'Active') ? (
            <div className="rounded-xl bg-[#f7f8f5] p-4 text-sm leading-relaxed text-[#748078]">
              {availableBooks.length === 0 ? 'There are no available copies right now.' : 'Add an active member before creating a loan.'}
            </div>
          ) : (
            <form className="space-y-4" onSubmit={issueLoan}>
              <Field label="Book">
                <select required value={loanForm.bookId} onChange={(event) => setLoanForm({ ...loanForm, bookId: event.target.value })}>
                  <option value="">Choose a book</option>
                  {availableBooks.map((book) => <option key={book.id} value={book.id}>{book.title} · {book.availableCopies} available</option>)}
                </select>
              </Field>
              <Field label="Member">
                <select required value={loanForm.memberId} onChange={(event) => setLoanForm({ ...loanForm, memberId: event.target.value })}>
                  <option value="">Choose a member</option>
                  {members.filter((member) => member.status === 'Active').map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
                </select>
              </Field>
              <Field label="Due date"><input required type="date" min={today()} value={loanForm.dueDate} onChange={(event) => setLoanForm({ ...loanForm, dueDate: event.target.value })} /></Field>
              <ModalActions onCancel={() => setModal(null)} busy={busy} submitLabel="Check out book" />
            </form>
          )}
        </Modal>
      )}

      {toast && <div role="status" className="fixed bottom-5 right-5 z-50 flex max-w-[calc(100vw-2.5rem)] items-center gap-2 rounded-xl bg-[#263b31] px-4 py-3 text-sm font-medium text-white shadow-xl"><Check size={16} className="shrink-0 text-[#9cd0a5]" />{toast}</div>}
    </div>
  )
}

function Brand({ compact = false }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-[14px] bg-[#315c46] text-white shadow-sm">
        <BookOpen size={20} strokeWidth={1.8} />
      </div>
      {!compact && <div><p className="text-[15px] font-extrabold tracking-[-.045em]">leaf &amp; lore</p><p className="mt-0.5 text-[10px] font-medium text-[#929d94]">Library workspace</p></div>}
    </div>
  )
}

function UserCard({ user, onLogout }) {
  return (
    <div className="mt-5 flex items-center gap-3 border-t border-[#edf0eb] px-1 pt-5">
      <div className="flex size-9 items-center justify-center rounded-full bg-[#eaf0e9] text-[11px] font-bold text-[#4a7057]">{initials(user.name)}</div>
      <div className="min-w-0 flex-1"><p className="truncate text-[12px] font-bold">{user.name}</p><p className="mt-0.5 text-[10px] text-[#8c978f]">{user.role}</p></div>
      <button onClick={onLogout} title="Sign out" aria-label="Sign out" className="rounded-lg p-2 text-[#8c978f] hover:bg-[#f5f6f3] hover:text-[#34443b]"><LogOut size={16} /></button>
    </div>
  )
}

function Login({ form, setForm, onSubmit, busy, toast }) {
  return (
    <main className="grid min-h-screen bg-white lg:grid-cols-[1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-[#284737] p-12 text-white lg:flex lg:flex-col lg:justify-between xl:p-16">
        <div className="absolute -right-36 -top-32 size-[460px] rounded-full border border-white/[.07]" />
        <div className="absolute -right-20 -top-16 size-[330px] rounded-full border border-white/[.08]" />
        <div className="absolute -bottom-52 -left-20 size-[440px] rounded-full border border-white/[.07]" />
        <Brand />
        <div className="relative max-w-[500px] py-12">
          <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[.08] px-3 py-1.5 text-[11px] font-semibold text-[#cee1d2]"><Sparkles size={13} /> A calmer way to run your library</span>
          <h1 className="max-w-[490px] text-[48px] font-semibold leading-[1.08] tracking-[-.055em] xl:text-[58px]">A little more room for <span className="font-serif italic font-normal text-[#b8d5ba]">wonder.</span></h1>
          <p className="mt-6 max-w-[390px] text-[14px] leading-7 text-[#d0ddd1]/70">Your books, your readers, and the small moments that make a library feel like home.</p>
          <div className="mt-12 flex items-center gap-4">
            <div className="flex -space-x-2">{['MC', 'NL', 'EB', 'SP'].map((person, index) => <div key={person} className={`flex size-9 items-center justify-center rounded-full border-2 border-[#284737] text-[9px] font-bold text-[#34473a] ${['bg-[#eedac6]', 'bg-[#d9e6d3]', 'bg-[#e4dced]', 'bg-[#eed9d0]'][index]}`}>{person}</div>)}</div>
            <div><p className="text-[11px] font-semibold text-white">Made for your community</p><p className="mt-0.5 text-[10px] text-[#d0ddd1]/60">Every story starts somewhere</p></div>
          </div>
        </div>
        <p className="relative text-[10px] text-white/45">Thoughtfully made for the people who keep stories moving.</p>
      </section>
      <section className="flex min-h-screen items-center justify-center px-6 py-12 sm:px-10">
        <div className="w-full max-w-[380px]">
          <div className="mb-11 lg:hidden"><Brand /></div>
          <p className="text-[11px] font-bold uppercase tracking-[.17em] text-[#79917e]">Welcome back</p>
          <h2 className="mt-3 text-[32px] font-bold tracking-[-.055em]">Sign in to your library</h2>
          <p className="mt-2 text-[13px] leading-6 text-[#8b958e]">A good day to discover something new.</p>
          <form onSubmit={onSubmit} className="mt-8 space-y-5">
            <Field label="Email address"><input required autoComplete="username" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field>
            <Field label="Password"><input required autoComplete="current-password" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></Field>
            <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#315c46] px-4 py-3.5 text-[13px] font-bold text-white transition hover:bg-[#284a39] disabled:cursor-wait disabled:opacity-70">{busy ? 'Signing you in…' : 'Sign in'} <ArrowRight size={15} /></button>
          </form>
          <div className="mt-8 rounded-xl border border-[#e9ede7] bg-[#fafbf9] p-4">
            <p className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.1em] text-[#74877a]"><ShieldCheck size={13} /> Demo account</p>
            <p className="text-[11px] leading-5 text-[#79857c]">Email: <span className="font-semibold text-[#46574c]">admin@library.local</span><br />Password: <span className="font-semibold text-[#46574c]">admin123</span></p>
          </div>
          <p className="mt-8 text-center text-[10px] text-[#a1aaa2]">Your library, always in good hands.</p>
        </div>
        {toast && <div role="alert" className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-[#263b31] px-4 py-3 text-sm text-white shadow-xl">{toast}</div>}
      </section>
    </main>
  )
}

function PageHeading({ eyebrow, title, description, children }) {
  return (
    <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><p className="mb-2 text-[10px] font-bold uppercase tracking-[.16em] text-[#839488]">{eyebrow}</p><h2 className="text-[25px] font-bold tracking-[-.045em]">{title}</h2><p className="mt-1.5 text-[12px] text-[#8c978f]">{description}</p></div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

function ActionButton({ children, onClick, secondary = false, icon: Icon = Plus }) {
  return <button onClick={onClick} className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[11px] font-bold transition ${secondary ? 'border border-[#e5eae3] bg-white text-[#536258] hover:bg-[#f7f8f5]' : 'bg-[#315c46] text-white hover:bg-[#284a39]'}`}><Icon size={14} />{children}</button>
}

function Dashboard({ dashboard, books, loans, activity, onNavigate, onIssue }) {
  const chart = dashboard?.chart || []
  const maxValue = Math.max(...chart.map((item) => item.value), 1)
  const stats = [
    { label: 'Books in collection', value: dashboard?.totalBooks ?? '—', note: `${dashboard?.availableBooks ?? '—'} ready to borrow`, icon: LibraryBig, color: 'bg-[#edf4ed] text-[#598363]', trend: 'A growing collection' },
    { label: 'Active loans', value: dashboard?.activeLoans ?? '—', note: 'Currently with readers', icon: Bookmark, color: 'bg-[#f4f0e7] text-[#a0844f]', trend: 'Out in the community' },
    { label: 'Overdue returns', value: dashboard?.overdueLoans ?? '—', note: 'A friendly reminder may help', icon: Clock3, color: 'bg-[#f8eee9] text-[#bb765b]', trend: 'Needs a little attention' },
    { label: 'Active members', value: dashboard?.activeMembers ?? '—', note: 'Part of your reading community', icon: UsersRound, color: 'bg-[#efedf5] text-[#8275a2]', trend: 'Stories bring us together' },
  ]
  const popular = books.filter((book) => book.totalCopies > book.availableCopies).slice(0, 4)
  const activeLoans = loans.filter((loan) => loan.status !== 'Returned').slice(0, 4)

  return (
    <>
      <PageHeading eyebrow="Your library at a glance" title="A lovely day to turn a page." description="Here’s what’s happening around the library today.">
        <ActionButton secondary icon={Download} onClick={() => onNavigate('Catalog')}>Browse collection</ActionButton>
        <ActionButton onClick={onIssue}>Check out a book</ActionButton>
      </PageHeading>
      <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map(({ label, value, note, icon: Icon, color, trend }) => (
          <article key={label} className="rounded-2xl border border-[#e9ede7] bg-white p-5">
            <div className="mb-5 flex items-center justify-between"><span className="text-[11px] font-semibold text-[#7c887f]">{label}</span><div className={`flex size-8 items-center justify-center rounded-xl ${color}`}><Icon size={16} strokeWidth={1.8} /></div></div>
            <p className="text-[29px] font-bold tracking-[-.055em]">{typeof value === 'number' ? value.toLocaleString() : value}</p>
            <div className="mt-2 flex items-center gap-1.5 text-[10px] text-[#859188]"><span className="font-semibold text-[#63836b]">{trend}</span><span>·</span><span>{note}</span></div>
          </article>
        ))}
      </section>

      <section className="mb-5 grid gap-5 xl:grid-cols-[1.55fr_1fr]">
        <article className="rounded-2xl border border-[#e9ede7] bg-white p-5 sm:p-6">
          <div className="mb-6 flex items-start justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.13em] text-[#93a096]">The rhythm of reading</p><h3 className="mt-1.5 text-[15px] font-bold">Books finding their readers</h3></div><span className="rounded-lg bg-[#f5f7f3] px-2.5 py-1.5 text-[10px] font-semibold text-[#77847a]">Last 6 months</span></div>
          <div className="flex h-[185px] items-end gap-3 border-b border-[#eff1ed] pb-2 sm:gap-5">
            {chart.map((item, index) => {
              const height = Math.max(6, Math.round((item.value / maxValue) * 125))
              return <div key={`${item.month}-${index}`} className="flex h-full flex-1 flex-col items-center justify-end gap-2"><span className="text-[9px] text-[#a1aaa2]">{item.value || ''}</span><div className={`w-full max-w-[36px] rounded-t-lg transition-all ${index === chart.length - 1 ? 'bg-[#60846a]' : 'bg-[#e4ede4] hover:bg-[#cbdacb]'}`} style={{ height: `${height}px` }} /><span className="text-[9px] text-[#89958b]">{item.month}</span></div>
            })}
          </div>
          <div className="mt-4 flex items-center gap-2 text-[10px] text-[#879289]"><span className="size-2 rounded-full bg-[#60846a]" /> Loans checked out</div>
        </article>

        <article className="rounded-2xl border border-[#e9ede7] bg-white p-5 sm:p-6">
          <div className="mb-5 flex items-start justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.13em] text-[#93a096]">Out in the world</p><h3 className="mt-1.5 text-[15px] font-bold">Recent checkouts</h3></div><button onClick={() => onNavigate('Loans')} className="rounded-lg p-1.5 text-[#8a968d] hover:bg-[#f5f7f3]"><ArrowRight size={16} /></button></div>
          <div className="divide-y divide-[#f0f2ee]">
            {activeLoans.length === 0 && <p className="py-8 text-center text-xs text-[#8a968d]">No books checked out just yet.</p>}
            {activeLoans.map((loan) => <div key={loan.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"><div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#f0f4ed] text-[#69846d]"><BookOpen size={15} /></div><div className="min-w-0 flex-1"><p className="truncate text-[11px] font-bold">{loan.bookTitle}</p><p className="mt-1 text-[10px] text-[#8a958d]">{loan.memberName}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-bold ${loan.status === 'Overdue' ? 'bg-[#f9eee9] text-[#b46d53]' : 'bg-[#edf4ed] text-[#64846b]'}`}>{loan.status === 'Overdue' ? 'Overdue' : `Due ${loan.dueDate.slice(5)}`}</span></div>)}
          </div>
          <button onClick={() => onNavigate('Loans')} className="mt-4 w-full rounded-lg border border-[#edf0eb] py-2.5 text-[10px] font-bold text-[#627268] hover:bg-[#f8f9f6]">See all loans <ArrowRight className="ml-1 inline" size={12} /></button>
        </article>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.55fr_1fr]">
        <article className="rounded-2xl border border-[#e9ede7] bg-white p-5 sm:p-6">
          <div className="mb-4 flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.13em] text-[#93a096]">From the shelves</p><h3 className="mt-1.5 text-[15px] font-bold">Books readers are enjoying</h3></div><button onClick={() => onNavigate('Catalog')} className="text-[10px] font-bold text-[#4f7658]">Explore all <ArrowRight className="ml-1 inline" size={12} /></button></div>
          <div className="grid gap-2 sm:grid-cols-2">
            {popular.length === 0 && <p className="col-span-2 py-5 text-xs text-[#8a958d]">Your next favorite book is waiting to be checked out.</p>}
            {popular.map((book, index) => <button key={book.id} onClick={() => onNavigate('Catalog')} className="flex min-w-0 items-center gap-3 rounded-xl p-2 text-left transition hover:bg-[#f7f8f5]"><BookCover index={index} /><span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-bold">{book.title}</span><span className="mt-1 block truncate text-[10px] text-[#8b968d]">{book.author}</span></span><span className="text-[9px] text-[#94a097]">{book.availableCopies} left</span></button>)}
          </div>
        </article>
        <article className="rounded-2xl border border-[#e9ede7] bg-white p-5 sm:p-6">
          <div className="mb-4 flex items-start justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.13em] text-[#93a096]">Around the library</p><h3 className="mt-1.5 text-[15px] font-bold">A little activity</h3></div><CalendarDays size={16} className="text-[#91a095]" /></div>
          <div className="space-y-4">
            {activity.slice(0, 4).map((item, index) => <div key={item.id} className="flex gap-3"><div className="flex flex-col items-center"><div className={`mt-0.5 size-2 rounded-full ${index === 0 ? 'bg-[#729879]' : 'bg-[#d8e2d7]'}`} />{index < Math.min(activity.length, 4) - 1 && <div className="mt-1 w-px flex-1 bg-[#edf0eb]" />}</div><div className="pb-1"><p className="text-[10px] font-bold">{item.action}</p><p className="mt-1 text-[10px] leading-relaxed text-[#88948b]">{item.details}</p><p className="mt-1 text-[9px] text-[#a0aaa2]">{item.actor} · {item.time}</p></div></div>)}
            {activity.length === 0 && <p className="py-6 text-xs text-[#8a958d]">Library activity will appear here.</p>}
          </div>
        </article>
      </section>
    </>
  )
}

function BookCover({ index = 0 }) {
  const covers = [
    'from-[#d9e6dc] to-[#bdd0c1]',
    'from-[#f0e0cd] to-[#dfc6a9]',
    'from-[#ded9eb] to-[#c6bfdd]',
    'from-[#e7d6d0] to-[#d4b9ad]',
    'from-[#d9e0e8] to-[#bbcbd8]',
  ]
  return <div className={`flex h-11 w-9 shrink-0 items-center justify-center rounded-md bg-gradient-to-br ${covers[index % covers.length]} text-[#506454] shadow-sm`}><BookOpen size={15} strokeWidth={1.5} /></div>
}

function SearchBox({ value, onChange, placeholder }) {
  return <label className="flex min-w-0 items-center gap-2.5 rounded-xl border border-[#e8ece6] bg-white px-3.5 py-2.5 focus-within:border-[#9db9a0] sm:w-[260px]"><Search size={15} className="shrink-0 text-[#98a39a]" /><input className="min-w-0 flex-1 border-0 bg-transparent text-[11px] outline-none placeholder:text-[#a0aaa2]" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label>
}

function Catalog({ books, search, setSearch, onAdd, onEdit, onDelete, onExport, canAdminister }) {
  return (
    <>
      <PageHeading eyebrow="A world between the covers" title="Book collection" description={`${books.length} title${books.length === 1 ? '' : 's'} to explore`}>
        <SearchBox value={search} onChange={setSearch} placeholder="Search title, author, ISBN…" />
        <ActionButton secondary icon={Download} onClick={onExport}>Export CSV</ActionButton>
        <ActionButton onClick={onAdd}>Add a book</ActionButton>
      </PageHeading>
      <section className="overflow-hidden rounded-2xl border border-[#e9ede7] bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead><tr className="border-b border-[#edf0eb] bg-[#fbfcfa] text-[9px] font-bold uppercase tracking-[.12em] text-[#929d94]"><th className="px-5 py-3.5">Book</th><th className="px-4 py-3.5">ISBN</th><th className="px-4 py-3.5">Category</th><th className="px-4 py-3.5">Location</th><th className="px-4 py-3.5">Availability</th><th className="px-4 py-3.5">Copies</th><th className="px-5 py-3.5 text-right">Actions</th></tr></thead>
            <tbody className="divide-y divide-[#f0f2ee]">
              {books.map((book, index) => <tr key={book.id} className="transition hover:bg-[#fcfdfa]"><td className="px-5 py-3"><div className="flex items-center gap-3"><BookCover index={index} /><div><p className="max-w-[220px] truncate text-[11px] font-bold">{book.title}</p><p className="mt-1 text-[10px] text-[#8b968d]">{book.author}</p></div></div></td><td className="px-4 py-3 text-[10px] text-[#748078]">{book.isbn}</td><td className="px-4 py-3"><span className="rounded-md bg-[#f4f6f1] px-2 py-1 text-[9px] font-medium text-[#748078]">{book.category}</span></td><td className="px-4 py-3 text-[10px] text-[#748078]">{book.shelf}</td><td className="px-4 py-3"><span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold ${book.availableCopies > 0 ? 'text-[#65856c]' : 'text-[#b87660]'}`}><span className={`size-1.5 rounded-full ${book.availableCopies > 0 ? 'bg-[#76a17d]' : 'bg-[#d59a81]'}`} />{book.availableCopies > 0 ? 'Available' : 'All checked out'}</span></td><td className="px-4 py-3 text-[10px] text-[#748078]">{book.availableCopies} / {book.totalCopies}</td><td className="px-5 py-3 text-right"><button onClick={() => onEdit(book)} className="rounded-lg px-2.5 py-1.5 text-[10px] font-bold text-[#58745e] hover:bg-[#edf4ed]">Edit</button>{canAdminister && <button onClick={() => onDelete(book)} className="ml-1 rounded-lg px-2 py-1.5 text-[10px] font-semibold text-[#a57665] hover:bg-[#f9eee9]">Remove</button>}</td></tr>)}
              {books.length === 0 && <EmptyRow colSpan={7} message="No books found. Try another search, or add a title to your collection." />}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-[#edf0eb] px-5 py-3"><span className="text-[10px] text-[#929d94]">Showing {books.length} {books.length === 1 ? 'book' : 'books'}</span><div className="flex gap-1"><button disabled aria-label="Previous page" className="rounded-lg border border-[#edf0eb] p-1.5 text-[#9ca69e] disabled:opacity-50"><ChevronLeft size={14} /></button><button disabled aria-label="Next page" className="rounded-lg border border-[#edf0eb] p-1.5 text-[#9ca69e] disabled:opacity-50"><ChevronRight size={14} /></button></div></div>
      </section>
    </>
  )
}

function Members({ members, search, setSearch, onAdd }) {
  return (
    <>
      <PageHeading eyebrow="Your reading community" title="Library members" description={`${members.length} lovely readers in your community`}>
        <SearchBox value={search} onChange={setSearch} placeholder="Search members…" />
        <ActionButton onClick={onAdd}>Add a member</ActionButton>
      </PageHeading>
      <section className="overflow-hidden rounded-2xl border border-[#e9ede7] bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-left">
            <thead><tr className="border-b border-[#edf0eb] bg-[#fbfcfa] text-[9px] font-bold uppercase tracking-[.12em] text-[#929d94]"><th className="px-5 py-3.5">Member</th><th className="px-4 py-3.5">Membership no.</th><th className="px-4 py-3.5">Email address</th><th className="px-4 py-3.5">Joined</th><th className="px-5 py-3.5">Status</th></tr></thead>
            <tbody className="divide-y divide-[#f0f2ee]">
              {members.map((member, index) => <tr key={member.id} className="transition hover:bg-[#fcfdfa]"><td className="px-5 py-4"><div className="flex items-center gap-3"><div className={`flex size-9 items-center justify-center rounded-full text-[10px] font-bold ${['bg-[#edf2e9] text-[#6b846c]', 'bg-[#f2ede6] text-[#a17e5c]', 'bg-[#eeebf4] text-[#7e719a]', 'bg-[#f4ece8] text-[#a67762]'][index % 4]}`}>{initials(member.name)}</div><div><p className="text-[11px] font-bold">{member.name}</p><p className="mt-1 text-[9px] text-[#99a29b]">Library reader</p></div></div></td><td className="px-4 py-4 text-[10px] text-[#748078]">{member.membershipNumber}</td><td className="px-4 py-4 text-[10px] text-[#748078]">{member.email}</td><td className="px-4 py-4 text-[10px] text-[#748078]">{member.joinedAt}</td><td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-[9px] font-bold ${member.status === 'Active' ? 'bg-[#edf4ed] text-[#66826b]' : 'bg-[#f8eee9] text-[#ad755d]'}`}>{member.status}</span></td></tr>)}
              {members.length === 0 && <EmptyRow colSpan={5} message="No members found. Add a reader to get started." />}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

function Loans({ loans, filter, setFilter, onIssue, onReturn, busy }) {
  return (
    <>
      <PageHeading eyebrow="Every story has a return date" title="Loans & returns" description="Keep track of books finding their way back home.">
        <ActionButton onClick={onIssue}>Check out a book</ActionButton>
      </PageHeading>
      <section className="overflow-hidden rounded-2xl border border-[#e9ede7] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#edf0eb] px-5 py-4">
          <div className="flex gap-1 rounded-xl bg-[#f5f7f3] p-1">
            {['All', 'Active', 'Overdue', 'Returned'].map((status) => <button key={status} onClick={() => setFilter(status)} className={`rounded-lg px-3 py-1.5 text-[10px] font-bold transition ${filter === status ? 'bg-white text-[#415b48] shadow-sm' : 'text-[#8a958c] hover:text-[#46584b]'}`}>{status}</button>)}
          </div>
          <span className="text-[10px] text-[#929d94]">{loans.length} {loans.length === 1 ? 'record' : 'records'}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left">
            <thead><tr className="border-b border-[#edf0eb] bg-[#fbfcfa] text-[9px] font-bold uppercase tracking-[.12em] text-[#929d94]"><th className="px-5 py-3.5">Book</th><th className="px-4 py-3.5">Member</th><th className="px-4 py-3.5">Checked out</th><th className="px-4 py-3.5">Due date</th><th className="px-4 py-3.5">Status</th><th className="px-5 py-3.5 text-right">Action</th></tr></thead>
            <tbody className="divide-y divide-[#f0f2ee]">
              {loans.map((loan, index) => <tr key={loan.id} className="transition hover:bg-[#fcfdfa]"><td className="px-5 py-4"><div className="flex items-center gap-3"><BookCover index={index} /><div><p className="text-[11px] font-bold">{loan.bookTitle}</p><p className="mt-1 text-[9px] text-[#929d94]">{loan.isbn}</p></div></div></td><td className="px-4 py-4"><p className="text-[10px] font-semibold">{loan.memberName}</p><p className="mt-1 text-[9px] text-[#929d94]">{loan.membershipNumber}</p></td><td className="px-4 py-4 text-[10px] text-[#748078]">{loan.issuedAt}</td><td className="px-4 py-4 text-[10px] text-[#748078]">{loan.dueDate}</td><td className="px-4 py-4"><span className={`rounded-full px-2.5 py-1 text-[9px] font-bold ${loan.status === 'Returned' ? 'bg-[#f1f2ef] text-[#858f87]' : loan.status === 'Overdue' ? 'bg-[#f9eee9] text-[#b46d53]' : 'bg-[#edf4ed] text-[#64846b]'}`}>{loan.status}</span></td><td className="px-5 py-4 text-right">{loan.status !== 'Returned' && <button disabled={busy} onClick={() => onReturn(loan)} className="rounded-lg bg-[#edf4ed] px-3 py-2 text-[10px] font-bold text-[#52745b] hover:bg-[#e3eee4] disabled:opacity-50">Mark returned</button>}{loan.status === 'Returned' && <span className="text-[10px] text-[#a0aaa2]">All done <Check className="ml-1 inline" size={12} /></span>}</td></tr>)}
              {loans.length === 0 && <EmptyRow colSpan={6} message={filter === 'All' ? 'No loans yet. Check out a book to get started.' : `No ${filter.toLowerCase()} loans right now.`} />}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

function EmptyRow({ colSpan, message }) {
  return <tr><td colSpan={colSpan} className="px-5 py-14 text-center"><div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-[#f3f6f1] text-[#849486]"><BookOpen size={17} /></div><p className="text-[11px] font-semibold text-[#56665a]">{message}</p></td></tr>
}

function Field({ label, children }) {
  return <label className="block"><span className="mb-1.5 block text-[10px] font-bold text-[#627067]">{label}</span>{children}</label>
}

function Modal({ title, subtitle, onClose, children }) {
  useEffect(() => {
    const closeOnEscape = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-[#1c2b22]/35 p-0 backdrop-blur-[2px] sm:items-center sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section role="dialog" aria-modal="true" aria-labelledby="modal-title" className="max-h-[92vh] w-full max-w-[500px] overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl sm:p-6">
        <div className="mb-5 flex items-start justify-between"><div><h2 id="modal-title" className="text-[18px] font-bold tracking-[-.03em]">{title}</h2><p className="mt-1 text-[11px] text-[#8c978f]">{subtitle}</p></div><button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-[#879289] hover:bg-[#f4f6f2]"><X size={17} /></button></div>
        {children}
      </section>
    </div>
  )
}

function ModalActions({ onCancel, busy, submitLabel }) {
  return <div className="mt-6 flex justify-end gap-2 border-t border-[#edf0eb] pt-4"><button type="button" onClick={onCancel} className="rounded-xl border border-[#e8ece6] px-4 py-2.5 text-[11px] font-bold text-[#738077] hover:bg-[#f7f8f5]">Cancel</button><button disabled={busy} type="submit" className="rounded-xl bg-[#315c46] px-4 py-2.5 text-[11px] font-bold text-white hover:bg-[#284a39] disabled:opacity-60">{busy ? 'Saving…' : submitLabel}</button></div>
}

export default App
