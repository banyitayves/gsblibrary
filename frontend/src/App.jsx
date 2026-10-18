import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  BookOpen,
  Bookmark,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  ClipboardCheck,
  Download,
  Eye,
  EyeOff,
  FileBarChart,
  LayoutDashboard,
  LibraryBig,
  LogOut,
  MessageCircle,
  MessageSquareText,
  Moon,
  Plus,
  Search,
  Sparkles,
  Upload,
  UsersRound,
  X,
  Sun,
} from 'lucide-react'
import { api } from './api.js'

const schoolClasses = [
  'S1A', 'S1B', 'S1C', 'S1D', 'S1E', 'S1F',
  'S2A', 'S2B', 'S2C', 'S2D',
  'S3A', 'S3B', 'S3C', 'S3D',
  'S4LANG', 'S4ARTS', 'S4MS2',
  'S5LANG', 'S5ARTS', 'S5MS2',
  'S6LFK', 'S6HGL', 'S6MCE',
]
const navigation = [
  { id: 'Dashboard', label: 'Overview', icon: LayoutDashboard },
  { id: 'Catalog', label: 'Book collection', icon: LibraryBig },
  { id: 'Members', label: 'Students & teachers', icon: UsersRound },
  { id: 'Loans', label: 'Loans & returns', icon: Bookmark },
  { id: 'Attendance', label: 'Library attendance', icon: ClipboardCheck },
  { id: 'Reports', label: 'Reports', icon: FileBarChart },
]

const initialBook = { isbn: '', title: '', author: '', publisher: '', category: '', grade: '', shelf: '', totalCopies: 1, deliveredOn: '', publicationYear: '' }
const initialLoanForm = () => ({
  memberId: '',
  memberSearch: '',
  dueDate: '',
  items: [{ bookId: '', bookSearch: '', quantity: '1', copyCode: '' }],
})
const today = () => {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const dateInDays = (days) => {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const timeGreeting = () => {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}
function whatsappNumber(phone = '') {
  const value = String(phone).trim()
  let digits = value.replace(/\D/g, '')
  if (value.startsWith('00')) digits = digits.slice(2)
  else if (/^0\d{9}$/.test(digits)) digits = `250${digits.slice(1)}`
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null
  return digits
}
function groupReminderRecipients(members, loans, includeLoan) {
  const membersById = new Map(members.map((member) => [Number(member.id), member]))
  const recipients = new Map()
  for (const loan of loans) {
    if (Number(loan.outstandingQuantity) < 1 || !includeLoan(loan)) continue
    const member = membersById.get(Number(loan.memberId))
    if (!member) continue
    let recipient = recipients.get(Number(member.id))
    if (!recipient) {
      recipient = { ...member, loans: [] }
      recipients.set(Number(member.id), recipient)
    }
    recipient.loans.push(loan)
  }
  return [...recipients.values()]
    .map((recipient) => ({ ...recipient, messagingNumber: whatsappNumber(recipient.phone) }))
    .sort((left, right) => left.name.localeCompare(right.name))
}
function checkoutReceiptMessage({ memberName, loans, dueDate }) {
  return `Hello ${memberName},\n\nHere is a copy of the books checked out to you:\n${loans.map((loan) => `- ${loan.bookTitle} (Grade ${loan.grade || 'not recorded'}): ${loan.quantity} ${Number(loan.quantity) === 1 ? 'copy' : 'copies'}`).join('\n')}\n\nDue date: ${dueDate}\n\nPlease return the books by the due date. Thank you!\n\nGS Busanza Library`
}
function borrowerBooksMessage({ memberName, loans }) {
  return `Hello ${memberName},\n\nHere is a copy of all books you currently have borrowed from GS Busanza Library:\n${loans.map((loan) => `- ${loan.bookTitle} (Grade ${loan.grade || 'not recorded'}): ${loan.outstandingQuantity} ${Number(loan.outstandingQuantity) === 1 ? 'copy' : 'copies'} (due ${loan.dueDate})`).join('\n')}\n\nPlease return them by their due dates. Thank you!\n\nGS Busanza Library`
}
function gmailComposeUrl(to, subject, body) {
  const parameters = new URLSearchParams({ view: 'cm', fs: '1', to, su: subject, body })
  return `https://mail.google.com/mail/?${parameters.toString()}`
}
function returnSummaryMessage({ memberName, bookTitle, bookGrade, returnedThisTime, missingThisTime, outstandingQuantity, outstandingLoans, totalOutstanding, totalReturned, totalMissing }) {
  const outstandingLines = outstandingLoans.length
    ? outstandingLoans.map((loan) => `- ${loan.bookTitle} (Grade ${loan.grade || 'not recorded'}): ${loan.outstandingQuantity} ${Number(loan.outstandingQuantity) === 1 ? 'copy' : 'copies'} (due ${loan.dueDate})`).join('\n')
    : 'None'
  return `Hello ${memberName},\n\nGS Busanza Library return update for "${bookTitle}" (Grade ${bookGrade || 'not recorded'}):\n- Returned now: ${returnedThisTime}\n- Missing now: ${missingThisTime}\n- Still outstanding for this title: ${outstandingQuantity}\n- Total returned: ${totalReturned}\n- Total missing: ${totalMissing}\n\nAll books still outstanding (${totalOutstanding} ${totalOutstanding === 1 ? 'copy' : 'copies'}):\n${outstandingLines}\n\nThank you!`
}
const memberCsvHeaders = 'name,member_type,class_section,membership_number,email,phone'
const bookCsvHeaders = 'title,isbn,publisher,author,total_copies,date_delivered,publication_year,grade,shelf_location,category'
const reportDefinitions = {
  loans: {
    title: 'Loan activity',
    columns: [['Borrower', 'memberName'], ['Membership number', 'membershipNumber'], ['Member type', 'memberType'], ['Class', 'classSection'], ['Email', 'email'], ['Book', 'bookTitle'], ['ISBN', 'isbn'], ['Copy code', 'copyCode'], ['Quantity', 'quantity'], ['Returned copies', 'returnedQuantity'], ['Missed copies', 'missedQuantity'], ['Outstanding copies', 'outstandingQuantity'], ['Issued', 'issuedAt'], ['Due', 'dueDate'], ['Returned', 'returnedAt'], ['Missed', 'missedAt'], ['Status', 'status']],
  },
  overdue: {
    title: 'Overdue loans',
    columns: [['Borrower', 'memberName'], ['Membership number', 'membershipNumber'], ['Member type', 'memberType'], ['Class', 'classSection'], ['Book', 'bookTitle'], ['ISBN', 'isbn'], ['Copy code', 'copyCode'], ['Quantity', 'quantity'], ['Returned copies', 'returnedQuantity'], ['Missed copies', 'missedQuantity'], ['Outstanding copies', 'outstandingQuantity'], ['Issued', 'issuedAt'], ['Due', 'dueDate'], ['Status', 'status']],
  },
  returned: {
    title: 'Returned-loan history',
    columns: [['Borrower', 'memberName'], ['Membership number', 'membershipNumber'], ['Member type', 'memberType'], ['Class', 'classSection'], ['Book', 'bookTitle'], ['ISBN', 'isbn'], ['Copy code', 'copyCode'], ['Quantity', 'quantity'], ['Returned copies', 'returnedQuantity'], ['Missed copies', 'missedQuantity'], ['Outstanding copies', 'outstandingQuantity'], ['Issued', 'issuedAt'], ['Due', 'dueDate'], ['Returned', 'returnedAt'], ['Status', 'status']],
  },
  missed: {
    title: 'Missed books',
    columns: [['Borrower', 'memberName'], ['Membership number', 'membershipNumber'], ['Member type', 'memberType'], ['Class', 'classSection'], ['Book', 'bookTitle'], ['ISBN', 'isbn'], ['Copy code', 'copyCode'], ['Quantity', 'quantity'], ['Returned copies', 'returnedQuantity'], ['Missed copies', 'missedQuantity'], ['Outstanding copies', 'outstandingQuantity'], ['Issued', 'issuedAt'], ['Due', 'dueDate'], ['Marked missed', 'missedAt'], ['Status', 'status']],
  },
  people: {
    title: 'Student and teacher borrowing',
    columns: [['Name', 'name'], ['Member type', 'memberType'], ['Class', 'classSection'], ['Membership number', 'membershipNumber'], ['Email', 'email'], ['Phone', 'phone'], ['Status', 'status'], ['Total copies borrowed', 'totalLoans'], ['Active copies', 'activeLoans'], ['Overdue copies', 'overdueLoans']],
  },
  nonBorrowers: {
    title: 'Members who have never borrowed',
    columns: [['Name', 'name'], ['Member type', 'memberType'], ['Class', 'classSection'], ['Membership number', 'membershipNumber'], ['Email', 'email'], ['Phone', 'phone'], ['Member status', 'status'], ['Joined', 'joinedAt']],
  },
  classes: {
    title: 'Class borrowing summary',
    columns: [['Class', 'classSection'], ['Students', 'students'], ['Total copies borrowed', 'totalLoans'], ['Active copies', 'activeLoans'], ['Overdue copies', 'overdueLoans']],
  },
  popular: {
    title: 'Most-borrowed books',
    columns: [['Title', 'title'], ['Author', 'author'], ['ISBN', 'isbn'], ['Publisher', 'publisher'], ['Grade', 'grade'], ['Category', 'category'], ['Shelf', 'shelf'], ['Total loans', 'totalLoans'], ['Unique borrowers', 'uniqueBorrowers']],
  },
  books: {
    title: 'Book inventory',
    columns: [['Title', 'title'], ['ISBN', 'isbn'], ['Publisher', 'publisher'], ['Grade', 'grade'], ['Shelf', 'shelf'], ['Available copies', 'availableCopies'], ['Total copies', 'totalCopies'], ['Date delivered', 'deliveredOn'], ['Publication year', 'publicationYear']],
  },
  availability: {
    title: 'Book availability',
    columns: [['Title', 'title'], ['ISBN', 'isbn'], ['Publisher', 'publisher'], ['Grade', 'grade'], ['Shelf', 'shelf'], ['Available copies', 'availableCopies'], ['Total copies', 'totalCopies'], ['Date delivered', 'deliveredOn'], ['Publication year', 'publicationYear'], ['Availability', 'availability']],
  },
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

function checkoutBookLabel(book) {
  return `${book.title} · ${book.category || 'Uncategorized'} · Grade ${book.grade || 'not recorded'} · ${book.isbn || 'No ISBN'} · ${book.author || 'No author'} · ${book.shelf || 'No shelf'} · ${book.availableCopies} available`
}

function App() {
  const [user, setUser] = useState(userFromSession)
  const [page, setPage] = useState('Dashboard')
  const [dashboard, setDashboard] = useState(null)
  const [books, setBooks] = useState([])
  const [members, setMembers] = useState([])
  const [loans, setLoans] = useState([])
  const [visits, setVisits] = useState([])
  const [visitSummary, setVisitSummary] = useState(null)
  const [visitDate, setVisitDate] = useState(today())
  const [visitForm, setVisitForm] = useState({ memberId: '', memberSearch: '', bookId: '', bookSearch: '' })
  const [activity, setActivity] = useState([])
  const [search, setSearch] = useState('')
  const [attendanceSearch, setAttendanceSearch] = useState('')
  const [memberTypeFilter, setMemberTypeFilter] = useState('All')
  const [classFilter, setClassFilter] = useState('All')
  const [loanFilter, setLoanFilter] = useState('All')
  const [reportData, setReportData] = useState(null)
  const [reportKind, setReportKind] = useState('loans')
  const [reportFilters, setReportFilters] = useState({ search: '', memberType: 'All', classSection: 'All', status: 'All', availability: 'Available', from: '', to: '' })
  const [importResult, setImportResult] = useState(null)
  const [bookImportResult, setBookImportResult] = useState(null)
  const [modal, setModal] = useState(null)
  const [selectedBorrowerIds, setSelectedBorrowerIds] = useState([])
  const [borrowerSearch, setBorrowerSearch] = useState('')
  const [bookForm, setBookForm] = useState(initialBook)
  const [memberForm, setMemberForm] = useState({ name: '', email: '', phone: '', memberType: 'Student', classSection: 'S1A' })
  const [loanForm, setLoanForm] = useState(initialLoanForm)
  const [loanActionQuantities, setLoanActionQuantities] = useState({ returned: '1', missed: '0' })
  const [loginForm, setLoginForm] = useState({ email: '', password: '' })
  const [loginMode, setLoginMode] = useState(() => new URLSearchParams(window.location.search).has('resetToken') ? 'reset' : 'signin')
  const [passwordResetToken, setPasswordResetToken] = useState(() => new URLSearchParams(window.location.search).get('resetToken') || '')
  const [resetPasswordForm, setResetPasswordForm] = useState({ password: '', confirmPassword: '' })
  const [busy, setBusy] = useState(false)
  const [darkMode, setDarkMode] = useState(() => {
    try {
      return localStorage.getItem('gsbusanza-theme') === 'dark'
    } catch {
      return false
    }
  })
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

  const loadAttendance = useCallback(async (date = visitDate) => {
    try {
      const [dailyVisits, summary] = await Promise.all([
        api(`/library-visits?date=${encodeURIComponent(date)}`),
        api(`/library-visits/summary?days=30&date=${encodeURIComponent(today())}`),
      ])
      setVisits(dailyVisits)
      setVisitSummary(summary)
    } catch (error) {
      notify(error.message)
    }
  }, [notify, visitDate])

  useEffect(() => {
    if (!user) return undefined
    const timer = window.setTimeout(() => { void loadData() }, 0)
    return () => window.clearTimeout(timer)
  }, [loadData, user])

  useEffect(() => {
    if (!user || page !== 'Attendance') return undefined
    const timer = window.setTimeout(() => { void loadAttendance(visitDate) }, 0)
    return () => window.clearTimeout(timer)
  }, [loadAttendance, page, user, visitDate])

  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? 'dark' : 'light'
    try {
      localStorage.setItem('gsbusanza-theme', darkMode ? 'dark' : 'light')
    } catch (error) {
      console.warn('Could not save the theme preference on this device.', error)
    }
  }, [darkMode])

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
      [book.title, book.author, book.publisher, book.isbn, book.category, book.grade, book.shelf].join(' ').toLowerCase().includes(term),
    )
  }, [books, search])

  const filteredMembers = useMemo(() => {
    const term = search.trim().toLowerCase()
    return members.filter((member) =>
      (memberTypeFilter === 'All' || member.memberType === memberTypeFilter)
      && (classFilter === 'All' || member.classSection === classFilter)
      && [member.name, member.email, member.phone, member.membershipNumber, member.classSection].join(' ').toLowerCase().includes(term),
    )
  }, [members, search, memberTypeFilter, classFilter])

  const filteredLoans = useMemo(
    () => loans.filter((loan) =>
      (loanFilter === 'All' || loan.status === loanFilter)
      && [loan.memberName, loan.membershipNumber, loan.bookTitle, loan.isbn, loan.copyCode].join(' ').toLowerCase().includes(search.trim().toLowerCase()),
    ),
    [loans, loanFilter, search],
  )
  const dueReminderRecipients = useMemo(
    () => groupReminderRecipients(members, loans, (loan) => loan.dueDate <= today()),
    [loans, members],
  )
  const tomorrowSmsRecipients = useMemo(
    () => groupReminderRecipients(members, loans, (loan) => loan.dueDate === dateInDays(1)),
    [loans, members],
  )
  const activeBorrowerRecipients = useMemo(() => {
    const catalogById = new Map(books.map((book) => [Number(book.id), book]))
    return groupReminderRecipients(members, loans, () => true).map((recipient) => ({
      ...recipient,
      loans: recipient.loans.map((loan) => ({
        ...loan,
        grade: catalogById.get(Number(loan.bookId))?.grade || '',
      })),
    }))
  }, [books, loans, members])

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

  async function requestPasswordReset(event) {
    event.preventDefault()
    setBusy(true)
    try {
      const result = await api('/auth/password-reset/request', {
        method: 'POST',
        body: JSON.stringify({ username: loginForm.email }),
      })
      setLoginMode('forgot-sent')
      notify(result.message)
    } catch (error) {
      notify(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function completePasswordReset(event) {
    event.preventDefault()
    if (resetPasswordForm.password !== resetPasswordForm.confirmPassword) {
      notify('The new passwords do not match.')
      return
    }
    setBusy(true)
    try {
      const result = await api('/auth/password-reset/complete', {
        method: 'POST',
        body: JSON.stringify({ token: passwordResetToken, password: resetPasswordForm.password }),
      })
      window.history.replaceState({}, '', `${window.location.pathname}${window.location.hash}`)
      setPasswordResetToken('')
      setResetPasswordForm({ password: '', confirmPassword: '' })
      setLoginForm((current) => ({ ...current, password: '' }))
      setLoginMode('signin')
      notify(result.message)
    } catch (error) {
      notify(error.message)
    } finally {
      setBusy(false)
    }
  }

  function logout() {
    if (!window.confirm('Are you sure you want to sign out?')) return
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
      await api(modal.member ? `/members/${modal.member.id}` : '/members', {
        method: modal.member ? 'PUT' : 'POST',
        body: JSON.stringify(memberForm),
      })
      setModal(null)
      setMemberForm({ name: '', membershipNumber: '', email: '', phone: '', memberType: 'Student', classSection: 'S1A' })
      notify(modal.member ? 'Member details updated.' : 'New member registered.')
      await loadData()
    } catch (error) {
      notify(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function deleteMember(member) {
    if (!window.confirm(`Delete ${member.name} (${member.membershipNumber})? Members with loan or attendance history cannot be deleted.`)) return
    setBusy(true)
    try {
      await api(`/members/${member.id}`, { method: 'DELETE' })
      notify(`${member.name} was deleted.`)
      await loadData()
    } catch (error) {
      notify(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function issueLoan(event) {
    event.preventDefault()
    const items = loanForm.items.map((item) => ({
      bookId: Number(item.bookId),
      quantity: Number(item.quantity),
      copyCode: item.copyCode.trim(),
    }))
    if (!loanForm.memberId || items.some((item) => !item.bookId || !Number.isInteger(item.quantity) || item.quantity < 1)) {
      notify('Choose a book and an active student or teacher from the suggestions.')
      return
    }
    if (selectedLoanMember?.memberType === 'Student' && (items.length !== 1 || items[0].quantity !== 1)) {
      notify('Students may check out only one book at a time.')
      return
    }
    if (selectedLoanQuantity > selectedMemberRemaining) {
      notify(`This member can check out ${selectedMemberRemaining} more ${selectedMemberRemaining === 1 ? 'copy' : 'copies'}.`)
      return
    }
    setBusy(true)
    try {
      const checkout = await api('/loans/batch', {
        method: 'POST',
        body: JSON.stringify({ memberId: Number(loanForm.memberId), dueDate: loanForm.dueDate, items }),
      })
      const checkoutBooks = new Map(books.map((book) => [Number(book.id), book]))
      setModal({
        type: 'checkoutComplete',
        memberName: selectedLoanMember.name,
        membershipNumber: selectedLoanMember.membershipNumber,
        email: selectedLoanMember.email,
        phone: selectedLoanMember.phone,
        dueDate: loanForm.dueDate,
        loans: checkout.loans.map((loan) => ({
          ...loan,
          grade: checkoutBooks.get(Number(loan.bookId))?.grade || '',
        })),
      })
      setLoanForm(initialLoanForm())
      notify(`${selectedLoanQuantity} ${selectedLoanQuantity === 1 ? 'copy' : 'copies'} checked out successfully.`)
      await loadData()
    } catch (error) {
      notify(error.message)
    } finally {
      setBusy(false)
    }
  }

  function openLoanAction(action, loan) {
    setLoanActionQuantities(action === 'return' ? { returned: '1', missed: '0' } : { returned: '0', missed: '1' })
    const member = members.find((item) => Number(item.id) === Number(loan.memberId))
    setModal({ type: 'loanAction', action, loan, member })
  }

  async function saveLoanAction(event) {
    event.preventDefault()
    const { loan } = modal
    const returnedQuantity = Number(loanActionQuantities.returned)
    const missedQuantity = Number(loanActionQuantities.missed)
    if (!Number.isInteger(returnedQuantity) || returnedQuantity < 0
      || !Number.isInteger(missedQuantity) || missedQuantity < 0
      || returnedQuantity + missedQuantity < 1
      || returnedQuantity + missedQuantity > Number(loan.outstandingQuantity)) {
      notify(`Enter returned and missing quantities that total from 1 to ${loan.outstandingQuantity}.`)
      return
    }
    setBusy(true)
    try {
      const result = await api(`/loans/${loan.id}/reconcile`, {
        method: 'POST',
        body: JSON.stringify({ returnedQuantity, missedQuantity }),
      })
      const catalogById = new Map(books.map((book) => [Number(book.id), book]))
      const outstandingLoans = loans
        .filter((memberLoan) => Number(memberLoan.memberId) === Number(loan.memberId))
        .map((memberLoan) => ({
          ...memberLoan,
          grade: catalogById.get(Number(memberLoan.bookId))?.grade || '',
          outstandingQuantity: Number(memberLoan.id) === Number(loan.id)
            ? Number(result.outstandingQuantity)
            : Number(memberLoan.outstandingQuantity),
        }))
        .filter((memberLoan) => memberLoan.outstandingQuantity > 0)
      const totalOutstanding = outstandingLoans.reduce((total, memberLoan) => total + memberLoan.outstandingQuantity, 0)
      setModal({
        type: 'returnComplete',
        memberName: loan.memberName,
        membershipNumber: loan.membershipNumber,
        email: modal.member?.email || '',
        phone: modal.member?.phone || '',
        bookTitle: loan.bookTitle,
        bookGrade: catalogById.get(Number(loan.bookId))?.grade || '',
        returnedThisTime: returnedQuantity,
        missingThisTime: missedQuantity,
        outstandingQuantity: result.outstandingQuantity,
        outstandingLoans,
        totalOutstanding,
        totalReturned: result.returnedQuantity,
        totalMissing: result.missedQuantity,
      })
      notify(`${returnedQuantity} returned, ${missedQuantity} missing; ${result.outstandingQuantity} still outstanding for “${loan.bookTitle}”.`)
      await loadData()
    } catch (error) {
      notify(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function recordVisit(event) {
    event.preventDefault()
    if (!visitForm.memberId) {
      notify('Choose the student or teacher who entered the library.')
      return
    }
    setBusy(true)
    try {
      await api('/library-visits', {
        method: 'POST',
        body: JSON.stringify({
          memberId: Number(visitForm.memberId),
          bookId: visitForm.bookId ? Number(visitForm.bookId) : null,
          visitDate,
        }),
      })
      setVisitForm({ memberId: '', memberSearch: '', bookId: '', bookSearch: '' })
      notify('Library attendance recorded.')
      await loadAttendance(visitDate)
    } catch (error) {
      notify(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function deleteBook(book) {
    if (!window.confirm(`Delete “${book.title}” from the catalog? Books with loan history cannot be deleted.`)) return
    setBusy(true)
    try {
      await api(`/books/${book.id}`, { method: 'DELETE' })
      notify(`“${book.title}” was removed from the catalog.`)
      await loadData()
    } catch (error) {
      notify(error.message)
    } finally {
      setBusy(false)
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

  async function importMembers(file, memberType) {
    if (!file) return
    setBusy(true)
    try {
      const result = await api(`/members/import?type=${memberType}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv' },
        body: await file.text(),
      })
      setImportResult({ memberType, ...result })
      notify(`Imported ${result.imported} ${memberType.toLowerCase()} record${result.imported === 1 ? '' : 's'}.`)
      await loadData()
    } catch (error) {
      notify(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function importBooks(file) {
    if (!file) return
    setBusy(true)
    try {
      const result = await api('/books/import', {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv' },
        body: await file.text(),
      })
      setBookImportResult(result)
      notify(`Imported ${result.imported} book title${result.imported === 1 ? '' : 's'}.`)
      await loadData()
    } catch (error) {
      notify(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function downloadCsv(path, filename) {
    try {
      const token = sessionStorage.getItem('libraryflow-token')
      const response = await fetch(`${import.meta.env.VITE_API_URL || ''}/api${path}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!response.ok) {
        const result = await response.json().catch(() => ({}))
        throw new Error(result.error || `Export failed (${response.status}).`)
      }
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      notify(error.message)
    }
  }

  async function runReports(filters = reportFilters, kind = reportKind) {
    setBusy(true)
    try {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(filters)) {
        if (key !== 'availability' && value && value !== 'All') params.set(key, value)
      }
      let data
      if (kind === 'loans' || kind === 'overdue' || kind === 'returned' || kind === 'missed') {
        if (kind === 'overdue') params.set('status', 'Overdue')
        if (kind === 'returned') params.set('status', 'Returned')
        if (kind === 'missed') params.set('status', 'Missed')
        data = await api(`/reports?${params}`)
      }
      else if (kind === 'people') data = await api(`/reports/people?${params}`)
      else if (kind === 'nonBorrowers') data = await api(`/reports/non-borrowers?${params}`)
      else if (kind === 'popular') data = await api(`/reports/popular-books?${params}`)
      else if (kind === 'classes') data = await api(`/reports/classes?${new URLSearchParams(Object.fromEntries(['from', 'to'].filter((key) => filters[key]).map((key) => [key, filters[key]])))}`)
      else {
        data = await api(`/books?search=${encodeURIComponent(filters.search || '')}`)
        if (kind === 'availability' && filters.availability !== 'All') {
          data = data.filter((book) => filters.availability === 'Available' ? book.availableCopies > 0 : book.availableCopies === 0)
        }
        if (kind === 'availability') {
          data = data.map((book) => ({ ...book, availability: book.availableCopies > 0 ? 'Available' : 'Out of stock' }))
        }
      }
      setReportData({ kind, data, filters: { ...filters } })
    } catch (error) {
      notify(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function exportReport(format) {
    if (!reportData || reportData.kind !== reportKind) return
    try {
      const definition = reportDefinitions[reportKind]
      const sourceRows = ['loans', 'overdue', 'returned', 'missed'].includes(reportKind) ? reportData.data.rows : reportData.data
      const rows = sourceRows.map((record) => definition.columns.map(([, key]) => record[key] ?? ''))
      const headers = definition.columns.map(([label]) => label)
      const filename = `gs-busanza-${reportKind.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}-report`

      if (format === 'csv') {
        const escapeCsv = (value) => {
          const text = String(value ?? '')
          const safeText = /^[\t\r ]*[=+\-@]/.test(text) ? `'${text}` : text
          return `"${safeText.replace(/"/g, '""')}"`
        }
        const csv = [headers, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\r\n')
        const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
        const link = document.createElement('a')
        link.href = url
        link.download = `${filename}.csv`
        link.click()
        URL.revokeObjectURL(url)
      } else if (format === 'excel') {
        const { default: ExcelJS } = await import('exceljs')
        const workbook = new ExcelJS.Workbook()
        const worksheet = workbook.addWorksheet('Report')
        worksheet.columns = definition.columns.map(([header, key]) => ({ header, key, width: Math.min(Math.max(header.length + 4, 16), 32) }))
        worksheet.addRows(sourceRows.map((record) => Object.fromEntries(definition.columns.map(([, key]) => [key, record[key] ?? '']))))
        const buffer = await workbook.xlsx.writeBuffer()
        const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
        const link = document.createElement('a')
        link.href = url
        link.download = `${filename}.xlsx`
        link.click()
        URL.revokeObjectURL(url)
      } else {
        const [{ jsPDF }, { default: autoTable }] = await Promise.all([
          import('jspdf'),
          import('jspdf-autotable'),
        ])
        const document = new jsPDF({ orientation: headers.length > 7 ? 'landscape' : 'portrait' })
        document.setFontSize(15)
        document.text(`GS Busanza Library — ${definition.title}`, 14, 15)
        document.setFontSize(9)
        document.text(`Generated ${today()} · ${rows.length} records`, 14, 21)
        autoTable(document, {
          head: [headers],
          body: rows,
          startY: 26,
          styles: { fontSize: headers.length > 7 ? 6 : 8, cellPadding: 2, overflow: 'linebreak' },
          headStyles: { fillColor: [40, 100, 75] },
          margin: { left: 10, right: 10 },
        })
        document.save(`${filename}.pdf`)
      }
    } catch (error) {
      notify(`Could not create the ${format.toUpperCase()} report: ${error.message}`)
    }
  }

  if (!user) {
    return (
      <Login
        form={loginForm}
        setForm={setLoginForm}
        mode={loginMode}
        onModeChange={setLoginMode}
        resetToken={passwordResetToken}
        resetForm={resetPasswordForm}
        setResetForm={setResetPasswordForm}
        onSubmit={handleLogin}
        onRequestReset={requestPasswordReset}
        onCompleteReset={completePasswordReset}
        busy={busy}
        toast={toast}
      />
    )
  }

  const canManageLibraryData = ['Administrator', 'Librarian'].includes(user.role)
  const availableBooks = books.filter((book) => book.availableCopies > 0)
  const selectedLoanMember = members.find((member) => String(member.id) === loanForm.memberId)
  const selectedLoanItems = loanForm.items.map((item) => ({
    ...item,
    book: books.find((book) => String(book.id) === item.bookId),
  }))
  const selectedLoanQuantity = loanForm.items.reduce((total, item) => (
    total + (item.bookId ? Number(item.quantity) || 0 : 0)
  ), 0)
  const selectedMemberLimit = selectedLoanMember?.memberType === 'Teacher' ? 300 : 1
  const selectedMemberRemaining = selectedLoanMember ? selectedMemberLimit - Number(selectedLoanMember.activeLoans || 0) : 1
  const canAddLoanItem = selectedLoanMember?.memberType === 'Teacher'
    && selectedMemberRemaining > selectedLoanQuantity
    && loanForm.items.length < availableBooks.length
    && availableBooks.some((book) => !loanForm.items.some((item) => item.bookId === String(book.id)))

  function openLoanForm() {
    setLoanForm(initialLoanForm())
    setModal({ type: 'loan' })
  }

  function updateLoanItem(index, updates) {
    setLoanForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...updates } : item),
    }))
  }

  return (
    <div className="min-h-screen bg-[#f7f8f5] text-[#1d302b]">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[252px] flex-col overflow-y-auto overscroll-contain border-r border-[#e9ede7] bg-white px-5 py-6 lg:flex">
        <Brand />
        <SchoolContact className="mt-4 rounded-xl bg-[#f6f8f4] px-3 py-3 text-[#65756a]" />
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
                <h1 className="truncate text-[17px] font-bold tracking-[-.03em]">{page === 'Dashboard' ? timeGreeting() : page}</h1>
              </div>
              <h1 className="truncate text-[16px] font-bold lg:hidden">{page}</h1>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="hidden items-center gap-2 rounded-full bg-[#f3f6f1] px-3 py-2 text-[11px] font-medium text-[#78847c] sm:flex">
                <span className="size-1.5 rounded-full bg-[#67a47b]" />
                Library open today
              </div>
              <button onClick={() => setDarkMode((current) => !current)} aria-label={`Switch to ${darkMode ? 'light' : 'dark'} mode`} title={`Switch to ${darkMode ? 'light' : 'dark'} mode`} className="rounded-xl border border-[#edf0eb] p-2.5 text-[#77847b] hover:bg-[#f7f8f5]">
                {darkMode ? <Sun size={17} strokeWidth={1.8} /> : <Moon size={17} strokeWidth={1.8} />}
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
              user={user}
              dashboard={dashboard}
              books={books}
              loans={loans}
              activity={activity}
              onNavigate={setPage}
              onIssue={openLoanForm}
            />
          )}
          {page === 'Catalog' && (
            <Catalog
              books={filteredBooks}
              search={search}
              setSearch={setSearch}
              importResult={bookImportResult}
              busy={busy}
              onImport={importBooks}
              onAdd={() => { setBookForm(initialBook); setModal({ type: 'book' }) }}
              onEdit={(book) => { setBookForm({ ...initialBook, ...book, totalCopies: book.totalCopies, deliveredOn: book.deliveredOn || '', publicationYear: book.publicationYear || '' }); setModal({ type: 'book', book }) }}
              onDelete={deleteBook}
              onExport={exportCatalog}
              canManage={canManageLibraryData}
            />
          )}
          {page === 'Members' && (
            <Members
              members={filteredMembers}
              search={search}
              setSearch={setSearch}
              typeFilter={memberTypeFilter}
              setTypeFilter={setMemberTypeFilter}
              classFilter={classFilter}
              setClassFilter={setClassFilter}
              importResult={importResult}
              busy={busy}
              onImport={importMembers}
              onExport={() => downloadCsv('/export/members.csv', 'gs-busanza-members.csv')}
              onAdd={() => { setMemberForm({ name: '', membershipNumber: '', email: '', phone: '', memberType: 'Student', classSection: 'S1A' }); setModal({ type: 'member' }) }}
              onEdit={(member) => {
                setMemberForm({
                  name: member.name,
                  membershipNumber: member.membershipNumber,
                  email: member.email || '',
                  phone: member.phone || '',
                  memberType: member.memberType,
                  classSection: member.classSection || '',
                })
                setModal({ type: 'member', member })
              }}
              onDelete={deleteMember}
              canManage={canManageLibraryData}
            />
          )}
          {page === 'Loans' && (
            <Loans
              loans={filteredLoans}
              search={search}
              setSearch={setSearch}
              filter={loanFilter}
              setFilter={setLoanFilter}
              onIssue={openLoanForm}
              onReturn={(loan) => openLoanAction('return', loan)}
              onMissed={(loan) => openLoanAction('missed', loan)}
              reminders={dueReminderRecipients}
              onOpenReminders={() => setModal({ type: 'reminders' })}
              smsReminders={tomorrowSmsRecipients}
              onOpenSmsReminders={() => setModal({ type: 'smsReminders' })}
              activeBorrowers={activeBorrowerRecipients}
              onOpenBorrowerMessages={() => {
                setSelectedBorrowerIds([])
                setBorrowerSearch('')
                setModal({ type: 'borrowerMessages' })
              }}
              busy={busy}
            />
          )}
          {page === 'Attendance' && (
            <LibraryAttendance
              members={members}
              books={books}
              visits={visits}
              summary={visitSummary}
              date={visitDate}
              setDate={setVisitDate}
              form={visitForm}
              setForm={setVisitForm}
              attendanceSearch={attendanceSearch}
              setAttendanceSearch={setAttendanceSearch}
              busy={busy}
              onRecord={recordVisit}
              onExport={() => downloadCsv(`/export/library-visits.csv?date=${encodeURIComponent(visitDate)}`, `gs-busanza-library-attendance-${visitDate}.csv`)}
            />
          )}
          {page === 'Reports' && (
            <Reports
              filters={reportFilters}
              setFilters={setReportFilters}
              kind={reportKind}
              setKind={(kind) => { setReportKind(kind); setReportData(null) }}
              report={reportData}
              busy={busy}
              onRun={() => runReports(reportFilters, reportKind)}
              onExport={exportReport}
            />
          )}
        </main>
      </div>

      {modal?.type === 'book' && (
        <Modal title={modal.book ? 'Edit book details' : 'Add a book'} subtitle="Keep your collection details up to date." onClose={() => setModal(null)}>
          <form className="space-y-4" onSubmit={saveBook}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Book title"><input required autoFocus value={bookForm.title} onChange={(event) => setBookForm({ ...bookForm, title: event.target.value })} placeholder="e.g. The Midnight Library" /></Field>
              <Field label="ISBN (optional)"><input value={bookForm.isbn || ''} onChange={(event) => setBookForm({ ...bookForm, isbn: event.target.value })} placeholder="ISBN-13" /></Field>
              <Field label="Publisher"><input value={bookForm.publisher || ''} onChange={(event) => setBookForm({ ...bookForm, publisher: event.target.value })} placeholder="Publisher name" /></Field>
              <Field label="Number of copies"><input required type="number" min="1" max="10000" value={bookForm.totalCopies} onChange={(event) => setBookForm({ ...bookForm, totalCopies: event.target.value })} /></Field>
              <Field label="Date delivered"><input type="date" value={bookForm.deliveredOn || ''} onChange={(event) => setBookForm({ ...bookForm, deliveredOn: event.target.value })} /></Field>
              <Field label="Publication year"><input type="number" inputMode="numeric" min="1" max="9999" step="1" value={bookForm.publicationYear || ''} onChange={(event) => setBookForm({ ...bookForm, publicationYear: event.target.value })} placeholder="e.g. 2020" /></Field>
              <Field label="Grade"><input value={bookForm.grade || ''} onChange={(event) => setBookForm({ ...bookForm, grade: event.target.value })} placeholder="e.g. S2 or Senior 4" /></Field>
              <Field label="Shelf location"><input value={bookForm.shelf || ''} onChange={(event) => setBookForm({ ...bookForm, shelf: event.target.value })} placeholder="e.g. A1-04" /></Field>
              <Field label="Author (optional)"><input value={bookForm.author || ''} onChange={(event) => setBookForm({ ...bookForm, author: event.target.value })} placeholder="Author name" /></Field>
              <Field label="Category (optional)"><input value={bookForm.category || ''} onChange={(event) => setBookForm({ ...bookForm, category: event.target.value })} placeholder="e.g. Fiction" /></Field>
            </div>
            <ModalActions onCancel={() => setModal(null)} busy={busy} submitLabel={modal.book ? 'Save changes' : 'Add to collection'} />
          </form>
        </Modal>
      )}

      {modal?.type === 'member' && (
        <Modal title={modal.member ? 'Edit member' : 'Add a member'} subtitle={modal.member ? 'Update this library membership record.' : 'Create a library membership record.'} onClose={() => setModal(null)}>
          <form className="space-y-4" onSubmit={saveMember}>
            <Field label="Full name"><input required autoFocus value={memberForm.name} onChange={(event) => setMemberForm({ ...memberForm, name: event.target.value })} placeholder="Member name" /></Field>
            <Field label="Membership number"><input required={Boolean(modal.member)} value={memberForm.membershipNumber || ''} onChange={(event) => setMemberForm({ ...memberForm, membershipNumber: event.target.value })} placeholder={modal.member ? 'Membership number' : 'Generated automatically if blank'} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Member type"><select value={memberForm.memberType} onChange={(event) => setMemberForm({ ...memberForm, memberType: event.target.value, classSection: event.target.value === 'Student' ? 'S1A' : '' })}><option>Student</option><option>Teacher</option></select></Field>
              {memberForm.memberType === 'Student' && <Field label="Class"><select required value={memberForm.classSection} onChange={(event) => setMemberForm({ ...memberForm, classSection: event.target.value })}>{schoolClasses.map((section) => <option key={section}>{section}</option>)}</select></Field>}
            </div>
            <Field label="Email address (optional)"><input type="email" value={memberForm.email} onChange={(event) => setMemberForm({ ...memberForm, email: event.target.value })} placeholder="name@example.com" /></Field>
            <Field label="Phone / WhatsApp (optional)"><input type="tel" value={memberForm.phone} onChange={(event) => setMemberForm({ ...memberForm, phone: event.target.value })} placeholder="+250 7XX XXX XXX" /></Field>
            <ModalActions onCancel={() => setModal(null)} busy={busy} submitLabel={modal.member ? 'Save changes' : 'Register member'} />
          </form>
        </Modal>
      )}

      {modal?.type === 'loan' && (
        <Modal title="Check out a book" subtitle="Choose a member and an available title." onClose={() => setModal(null)}>
          {availableBooks.length === 0 || members.every((member) => {
            const limit = member.memberType === 'Teacher' ? 300 : 1
            return member.status !== 'Active' || Number(member.activeLoans || 0) >= limit
          }) ? (
            <div className="rounded-xl bg-[#f7f8f5] p-4 text-sm leading-relaxed text-[#748078]">
              {availableBooks.length === 0 ? 'There are no available copies right now.' : 'No active student or teacher is currently below their checkout limit.'}
            </div>
          ) : (
            <form className="space-y-4" onSubmit={issueLoan}>
              <Field label="Member">
                <input
                  required
                  autoComplete="off"
                  list="checkout-members"
                  placeholder="Search student or teacher by name, class, or number…"
                  value={loanForm.memberSearch || ''}
                  onChange={(event) => {
                    const memberSearch = event.target.value
                    const member = members.find((item) => {
                      const limit = item.memberType === 'Teacher' ? 300 : 1
                      return item.status === 'Active'
                        && `${item.name} · ${item.memberType}${item.classSection ? ` · ${item.classSection}` : ''} · ${item.membershipNumber} · ${item.activeLoans || 0}/${limit} copies` === memberSearch
                        && Number(item.activeLoans || 0) < limit
                    })
                    setLoanForm({
                      ...loanForm,
                      memberId: member ? String(member.id) : '',
                      memberSearch,
                      items: member?.memberType === 'Student'
                        ? [{ ...loanForm.items[0], quantity: '1' }]
                        : loanForm.items,
                    })
                  }}
                />
                <datalist id="checkout-members">
                  {members.filter((member) => {
                    const limit = member.memberType === 'Teacher' ? 300 : 1
                    return member.status === 'Active' && Number(member.activeLoans || 0) < limit
                  }).map((member) => {
                    const limit = member.memberType === 'Teacher' ? 300 : 1
                    return <option key={member.id} value={`${member.name} · ${member.memberType}${member.classSection ? ` · ${member.classSection}` : ''} · ${member.membershipNumber} · ${member.activeLoans || 0}/${limit} copies`} />
                  })}
                </datalist>
              </Field>
              {selectedLoanMember && <p className="rounded-lg bg-[#f3f6f1] px-3 py-2 text-[11px] text-[#607667]">{selectedLoanMember.memberType === 'Teacher' ? `Teacher limit: ${selectedLoanMember.activeLoans || 0} of 300 active copies; ${selectedMemberRemaining} more may be checked out across different titles.` : 'Students may have only one active book checked out.'}</p>}
              <div className="space-y-3">
                {loanForm.items.map((item, index) => {
                  const selectedItem = selectedLoanItems[index]
                  const otherQuantity = loanForm.items.reduce((total, otherItem, itemIndex) => (
                    total + (itemIndex === index || !otherItem.bookId ? 0 : Number(otherItem.quantity) || 0)
                  ), 0)
                  const quantityLimit = Math.max(1, Math.min(
                    Number(selectedItem.book?.availableCopies || 1),
                    selectedLoanMember?.memberType === 'Teacher' ? selectedMemberRemaining - otherQuantity : 1,
                  ))
                  const options = availableBooks.filter((book) => (
                    !loanForm.items.some((otherItem, itemIndex) => itemIndex !== index && otherItem.bookId === String(book.id))
                  ))
                  return (
                    <section key={index} className="space-y-3 rounded-xl border border-[#e9ede7] p-3">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] font-bold text-[#56665a]">Book {index + 1}</p>
                        {loanForm.items.length > 1 && <button type="button" onClick={() => setLoanForm((current) => ({ ...current, items: current.items.filter((_, itemIndex) => itemIndex !== index) }))} aria-label={`Remove book ${index + 1}`} className="rounded-lg p-1.5 text-[#a57665] hover:bg-[#f9eee9]"><X size={14} /></button>}
                      </div>
                      <Field label="Book title">
                        <input
                          required
                          autoComplete="off"
                          list={`checkout-books-${index}`}
                          placeholder="Search title, subject, ISBN, author, shelf…"
                          value={item.bookSearch}
                          onChange={(event) => {
                            const bookSearch = event.target.value
                            const book = options.find((candidate) => checkoutBookLabel(candidate) === bookSearch)
                            const quantity = book
                              ? Math.max(1, Math.min(Number(item.quantity) || 1, Number(book.availableCopies), selectedLoanMember?.memberType === 'Teacher' ? selectedMemberRemaining - otherQuantity : 1))
                              : item.quantity
                            updateLoanItem(index, { bookId: book ? String(book.id) : '', bookSearch, quantity: String(quantity) })
                          }}
                        />
                        <datalist id={`checkout-books-${index}`}>
                          {options.map((book) => <option key={book.id} value={checkoutBookLabel(book)} />)}
                        </datalist>
                      </Field>
                      {selectedItem.book && <p className="text-[10px] text-[#8b968d]">{selectedItem.book.availableCopies} copies available · {selectedItem.book.category || 'Uncategorized'}</p>}
                      {selectedLoanMember?.memberType === 'Teacher' && selectedItem.book && (
                        <Field label="Number of copies">
                          <input required type="number" min="1" max={quantityLimit} value={item.quantity} onChange={(event) => updateLoanItem(index, { quantity: event.target.value })} />
                        </Field>
                      )}
                      <Field label="Copy code (optional)"><input maxLength="64" autoComplete="off" value={item.copyCode} onChange={(event) => updateLoanItem(index, { copyCode: event.target.value })} placeholder="Physical book copy / accession code" /></Field>
                    </section>
                  )
                })}
              </div>
              {selectedLoanMember?.memberType === 'Teacher' && <button type="button" disabled={!canAddLoanItem} onClick={() => setLoanForm((current) => ({ ...current, items: [...current.items, { bookId: '', bookSearch: '', quantity: '1', copyCode: '' }] }))} className="flex items-center gap-1.5 rounded-lg border border-[#e8ece6] px-3 py-2 text-[10px] font-bold text-[#52745b] hover:bg-[#f7f8f5] disabled:cursor-not-allowed disabled:opacity-50"><Plus size={13} /> Add another title</button>}
              {selectedLoanMember?.memberType === 'Teacher' && <p className="text-[10px] text-[#8b968d]">{selectedLoanQuantity} of {selectedMemberRemaining} remaining checkout copies selected.</p>}
              <Field label="Due date"><input required type="date" min={today()} value={loanForm.dueDate} onChange={(event) => setLoanForm({ ...loanForm, dueDate: event.target.value })} /></Field>
              <ModalActions onCancel={() => setModal(null)} busy={busy} submitLabel={`Check out ${selectedLoanQuantity} ${selectedLoanQuantity === 1 ? 'copy' : 'copies'}`} />
            </form>
          )}
        </Modal>
      )}

      {modal?.type === 'loanAction' && (
        <Modal
          title="Record book returns"
          subtitle="Enter returned and missing copies; anything left remains outstanding."
          onClose={() => setModal(null)}
        >
          <form className="space-y-4" onSubmit={saveLoanAction}>
            <div className="rounded-xl bg-[#f7f8f5] p-4 text-[11px] leading-relaxed text-[#748078]">
              <p className="font-bold text-[#46584b]">{modal.loan.bookTitle}</p>
              <p className="mt-1">{modal.loan.memberName} · {modal.loan.outstandingQuantity} outstanding {Number(modal.loan.outstandingQuantity) === 1 ? 'copy' : 'copies'}</p>
            </div>
            <Field label="Copies returned and available">
              <input autoFocus required type="number" min="0" max={modal.loan.outstandingQuantity} value={loanActionQuantities.returned} onChange={(event) => setLoanActionQuantities((current) => ({ ...current, returned: event.target.value }))} />
            </Field>
            <Field label="Copies missing">
              <input required type="number" min="0" max={modal.loan.outstandingQuantity} value={loanActionQuantities.missed} onChange={(event) => setLoanActionQuantities((current) => ({ ...current, missed: event.target.value }))} />
            </Field>
            <p className="rounded-lg bg-[#f3f6f1] px-3 py-2 text-[11px] text-[#607667]">
              {Math.max(0, Number(modal.loan.outstandingQuantity) - (Number(loanActionQuantities.returned) || 0) - (Number(loanActionQuantities.missed) || 0))} copies will remain outstanding after this update.
            </p>
            <ModalActions onCancel={() => setModal(null)} busy={busy} submitLabel="Save return details" />
          </form>
        </Modal>
      )}

      {modal?.type === 'returnComplete' && (
        <Modal
          title="Return details recorded"
          subtitle="Send the member a summary of what was returned, what is missing, and what remains."
          onClose={() => setModal(null)}
        >
          <div className="space-y-4">
            <div className="rounded-xl bg-[#f7f8f5] p-4 text-[11px] leading-relaxed text-[#748078]">
              <p className="font-bold text-[#46584b]">{modal.memberName}</p>
              <p className="mt-1">{modal.membershipNumber} · {modal.bookTitle} · Grade {modal.bookGrade || 'not recorded'}</p>
              <ul className="mt-3 space-y-1">
                <li>Returned now: {modal.returnedThisTime}</li>
                <li>Missing now: {modal.missingThisTime}</li>
                <li>Still outstanding for this title: {modal.outstandingQuantity}</li>
                <li>Total returned: {modal.totalReturned} · Total missing: {modal.totalMissing}</li>
              </ul>
              <p className="mt-3 font-bold">All books still outstanding ({modal.totalOutstanding} {modal.totalOutstanding === 1 ? 'copy' : 'copies'}):</p>
              {modal.outstandingLoans.length > 0 ? (
                <ul className="mt-1 space-y-1">
                  {modal.outstandingLoans.map((loan) => (
                    <li key={loan.id}>{loan.bookTitle} · Grade {loan.grade || 'not recorded'} · {loan.outstandingQuantity} {Number(loan.outstandingQuantity) === 1 ? 'copy' : 'copies'} · due {loan.dueDate}</li>
                  ))}
                </ul>
              ) : <p className="mt-1">None</p>}
            </div>
            {modal.email || whatsappNumber(modal.phone) ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {modal.email && (
                  <a
                    href={gmailComposeUrl(modal.email, 'GS Busanza Library return update', returnSummaryMessage(modal))}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#315c46] px-4 py-3 text-[11px] font-bold text-white hover:bg-[#284a39]"
                  >
                    Open Gmail: return summary
                  </a>
                )}
                {whatsappNumber(modal.phone) && (
                  <a
                    href={`https://wa.me/${whatsappNumber(modal.phone)}?text=${encodeURIComponent(returnSummaryMessage(modal))}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#e8f4eb] px-4 py-3 text-[11px] font-bold text-[#28644b] hover:bg-[#dceee1]"
                  >
                    <MessageCircle size={14} /> WhatsApp return summary
                  </a>
                )}
              </div>
            ) : (
              <p className="rounded-lg bg-[#f7f8f5] px-3 py-2 text-[11px] text-[#748078]">This member has no saved email address or valid WhatsApp number. Add contact details to their member profile to prepare a message.</p>
            )}
            <button type="button" onClick={() => setModal(null)} className="w-full rounded-xl border border-[#e8ece6] px-4 py-2.5 text-[11px] font-bold text-[#738077] hover:bg-[#f7f8f5]">Done</button>
            <p className="text-center text-[10px] text-[#929d94]">Messages open in your email or WhatsApp app for you to review and send.</p>
          </div>
        </Modal>
      )}

      {modal?.type === 'checkoutComplete' && (
        <Modal
          title="Checkout complete"
          subtitle="Send the member a copy of the books borrowed in this checkout."
          onClose={() => setModal(null)}
        >
          <div className="space-y-4">
            <div className="rounded-xl bg-[#f7f8f5] p-4 text-[11px] leading-relaxed text-[#748078]">
              <p className="font-bold text-[#46584b]">{modal.memberName}</p>
              <p className="mt-1">{modal.membershipNumber}{modal.email ? ` · ${modal.email}` : ''}</p>
              <ul className="mt-3 space-y-1.5">
                {modal.loans.map((loan) => (
                  <li key={loan.id}>{loan.bookTitle} · Grade {loan.grade || 'not recorded'} · {loan.quantity} {Number(loan.quantity) === 1 ? 'copy' : 'copies'} · due {modal.dueDate}</li>
                ))}
              </ul>
            </div>
            {modal.email || whatsappNumber(modal.phone) ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {modal.email && (
                  <a
                    href={gmailComposeUrl(modal.email, 'GS Busanza Library checkout receipt', checkoutReceiptMessage(modal))}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#315c46] px-4 py-3 text-[11px] font-bold text-white hover:bg-[#284a39]"
                  >
                    Open Gmail: checkout copy
                  </a>
                )}
                {whatsappNumber(modal.phone) && (
                  <a
                    href={`https://wa.me/${whatsappNumber(modal.phone)}?text=${encodeURIComponent(checkoutReceiptMessage(modal))}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#e8f4eb] px-4 py-3 text-[11px] font-bold text-[#28644b] hover:bg-[#dceee1]"
                  >
                    <MessageCircle size={14} /> WhatsApp checkout copy
                  </a>
                )}
              </div>
            ) : (
              <p className="rounded-lg bg-[#f7f8f5] px-3 py-2 text-[11px] text-[#748078]">This member has no saved email address or valid WhatsApp number. Add contact details to their member profile to prepare a message.</p>
            )}
            <button type="button" onClick={() => setModal(null)} className="w-full rounded-xl border border-[#e8ece6] px-4 py-2.5 text-[11px] font-bold text-[#738077] hover:bg-[#f7f8f5]">Done</button>
            <p className="text-center text-[10px] text-[#929d94]">Email opens in Gmail in a new tab; review and press Send. WhatsApp opens separately.</p>
          </div>
        </Modal>
      )}

      {modal?.type === 'reminders' && (
        <Modal
          title="Return reminders"
          subtitle="Borrowers with books due today or overdue can receive a prepared Gmail or WhatsApp reminder."
          onClose={() => setModal(null)}
        >
          {dueReminderRecipients.length === 0 ? (
            <p className="rounded-xl bg-[#f7f8f5] p-4 text-[11px] text-[#748078]">No books are due today or overdue.</p>
          ) : (
            <div className="max-h-[60vh] space-y-3 overflow-y-auto">
              {dueReminderRecipients.map((recipient) => {
                const reminderLines = recipient.loans
                  .map((loan) => {
                    const dueLabel = loan.dueDate < today() ? `overdue since ${loan.dueDate}` : 'due today'
                    return `• ${loan.bookTitle} (${loan.outstandingQuantity} ${Number(loan.outstandingQuantity) === 1 ? 'copy' : 'copies'}, ${dueLabel})`
                  })
                  .join('\n')
                const message = `Hello ${recipient.name}, this is a friendly reminder from GS Busanza Library. Please return these book${recipient.loans.length === 1 ? '' : 's'}:\n${reminderLines}\n\nThank you!`
                const emailMessage = `Hello ${recipient.name},\n\nThis is a friendly reminder from GS Busanza Library to return these books:\n${reminderLines}\n\nThank you!`
                const chatUrl = recipient.messagingNumber
                  ? `https://wa.me/${recipient.messagingNumber}?text=${encodeURIComponent(message)}`
                  : ''
                return (
                  <article key={recipient.id} className="rounded-xl border border-[#e9ede7] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold text-[#46584b]">{recipient.name}</p>
                        <p className="mt-1 text-[10px] text-[#8a958d]">{recipient.email || 'No email saved'} · {recipient.phone || 'No phone number saved'}</p>
                      </div>
                      <div className="flex shrink-0 flex-wrap justify-end gap-2">
                        {recipient.email && <a href={gmailComposeUrl(recipient.email, 'GS Busanza Library book return reminder', emailMessage)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-[#f8eee9] px-3 py-2 text-[10px] font-bold text-[#8c5945] hover:bg-[#f3e4de]">Open Gmail</a>}
                        {chatUrl && <a href={chatUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-[#e8f4eb] px-3 py-2 text-[10px] font-bold text-[#28644b] hover:bg-[#dceee1]"><MessageCircle size={13} /> Open WhatsApp</a>}
                      </div>
                    </div>
                    {!recipient.email && !chatUrl && <p className="mt-2 text-[10px] text-[#929d94]">Add an email address or valid international phone number to prepare a reminder.</p>}
                    <p className="mt-2 whitespace-pre-line text-[10px] leading-relaxed text-[#748078]">{reminderLines}</p>
                  </article>
                )
              })}
            </div>
          )}
        </Modal>
      )}

      {modal?.type === 'smsReminders' && (
        <Modal
          title="SMS reminders for tomorrow"
          subtitle={`These borrowers have books due ${dateInDays(1)}. Open a prepared text message to remind them before the books become overdue.`}
          onClose={() => setModal(null)}
        >
          {tomorrowSmsRecipients.length === 0 ? (
            <p className="rounded-xl bg-[#f7f8f5] p-4 text-[11px] text-[#748078]">No books are due tomorrow.</p>
          ) : (
            <div className="max-h-[60vh] space-y-3 overflow-y-auto">
              {tomorrowSmsRecipients.map((recipient) => {
                const reminderLines = recipient.loans
                  .map((loan) => `• ${loan.bookTitle} (${loan.outstandingQuantity} ${Number(loan.outstandingQuantity) === 1 ? 'copy' : 'copies'})`)
                  .join('\n')
                const message = `Hello ${recipient.name}, this is a friendly reminder from GS Busanza Library that these books are due tomorrow (${dateInDays(1)}):\n${reminderLines}\nPlease return them on time. Thank you!`
                const emailMessage = `Hello ${recipient.name},\n\nThis is a friendly reminder from GS Busanza Library that these books are due tomorrow (${dateInDays(1)}):\n${reminderLines}\n\nPlease return them on time. Thank you!`
                const smsUrl = recipient.messagingNumber
                  ? `sms:+${recipient.messagingNumber}?body=${encodeURIComponent(message)}`
                  : ''
                return (
                  <article key={recipient.id} className="rounded-xl border border-[#e9ede7] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold text-[#46584b]">{recipient.name}</p>
                        <p className="mt-1 text-[10px] text-[#8a958d]">{recipient.email || 'No email saved'} · {recipient.phone || 'No phone number saved'}</p>
                      </div>
                      <div className="flex shrink-0 flex-wrap justify-end gap-2">
                        {recipient.email && <a href={gmailComposeUrl(recipient.email, 'GS Busanza Library reminder: books due tomorrow', emailMessage)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-[#f8eee9] px-3 py-2 text-[10px] font-bold text-[#8c5945] hover:bg-[#f3e4de]">Open Gmail</a>}
                        {smsUrl && <a href={smsUrl} className="inline-flex items-center gap-1.5 rounded-lg bg-[#edf4ed] px-3 py-2 text-[10px] font-bold text-[#28644b] hover:bg-[#dceee1]"><MessageSquareText size={13} /> Prepare SMS</a>}
                      </div>
                    </div>
                    {!recipient.email && !smsUrl && <p className="mt-2 text-[10px] text-[#929d94]">Add an email address or valid international phone number to prepare a reminder.</p>}
                    <p className="mt-2 whitespace-pre-line text-[10px] leading-relaxed text-[#748078]">{reminderLines}</p>
                  </article>
                )
              })}
            </div>
          )}
          <p className="mt-4 text-center text-[10px] text-[#929d94]">Gmail opens in a new tab; review and press Send. Review and send each SMS yourself; carrier charges may apply.</p>
        </Modal>
      )}

      {modal?.type === 'borrowerMessages' && (
        <Modal
          title="Messages for borrowers"
          subtitle="Select up to 10 members with outstanding books. Open each prepared Gmail or WhatsApp message separately and send it yourself."
          onClose={() => setModal(null)}
        >
          <div className="space-y-4">
            <Field label="Find borrower">
              <input value={borrowerSearch} onChange={(event) => setBorrowerSearch(event.target.value)} placeholder="Search name, membership number, email, or phone…" />
            </Field>
            <p className="text-[10px] font-semibold text-[#748078]">{selectedBorrowerIds.length} of 10 selected · {activeBorrowerRecipients.length} borrowers have books outstanding</p>
            {activeBorrowerRecipients.length === 0 ? (
              <p className="rounded-xl bg-[#f7f8f5] p-4 text-[11px] text-[#748078]">No members currently have books outstanding.</p>
            ) : (
              <div className="max-h-[34vh] space-y-2 overflow-y-auto">
                {activeBorrowerRecipients
                  .filter((recipient) => (
                    [recipient.name, recipient.membershipNumber, recipient.email, recipient.phone]
                      .join(' ')
                      .toLowerCase()
                      .includes(borrowerSearch.trim().toLowerCase())
                  ))
                  .map((recipient) => {
                    const selected = selectedBorrowerIds.includes(Number(recipient.id))
                    const atLimit = selectedBorrowerIds.length >= 10
                    return (
                      <label key={recipient.id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-[#e9ede7] p-3">
                        <input
                          type="checkbox"
                          className="mt-0.5 accent-[#315c46]"
                          checked={selected}
                          disabled={!selected && atLimit}
                          onChange={() => setSelectedBorrowerIds((current) => (
                            selected
                              ? current.filter((id) => id !== Number(recipient.id))
                              : current.length < 10 ? [...current, Number(recipient.id)] : current
                          ))}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[11px] font-bold text-[#46584b]">{recipient.name}</span>
                          <span className="mt-1 block text-[10px] text-[#8a958d]">{recipient.email || 'No email'} · {recipient.phone || 'No phone'}</span>
                          <span className="mt-2 block text-[10px] leading-relaxed text-[#748078]">
                            {recipient.loans.map((loan) => `${loan.bookTitle} · Grade ${loan.grade || 'not recorded'} · ${loan.outstandingQuantity} out · due ${loan.dueDate}`).join('; ')}
                          </span>
                        </span>
                      </label>
                    )
                  })}
              </div>
            )}
            {selectedBorrowerIds.length > 0 && (
              <div className="max-h-[34vh] space-y-3 overflow-y-auto border-t border-[#edf0eb] pt-4">
                <p className="text-[11px] font-bold text-[#56665a]">Prepared messages</p>
                {activeBorrowerRecipients
                  .filter((recipient) => selectedBorrowerIds.includes(Number(recipient.id)))
                  .map((recipient) => {
                    const message = borrowerBooksMessage({ memberName: recipient.name, loans: recipient.loans })
                    return (
                      <article key={recipient.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[#f7f8f5] p-3">
                        <div className="min-w-0">
                          <p className="truncate text-[11px] font-bold text-[#46584b]">{recipient.name}</p>
                          <p className="mt-1 text-[10px] text-[#8a958d]">{recipient.loans.length} active {recipient.loans.length === 1 ? 'title' : 'titles'}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {recipient.email && (
                            <a href={gmailComposeUrl(recipient.email, 'GS Busanza Library: your borrowed books', message)} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-[#315c46] px-3 py-2 text-[10px] font-bold text-white hover:bg-[#284a39]">Open Gmail</a>
                          )}
                          {recipient.messagingNumber && (
                            <a href={`https://wa.me/${recipient.messagingNumber}?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-[#e8f4eb] px-3 py-2 text-[10px] font-bold text-[#28644b] hover:bg-[#dceee1]"><MessageCircle size={13} /> Open WhatsApp</a>
                          )}
                          {!recipient.email && !recipient.messagingNumber && <span className="text-[10px] text-[#929d94]">Add email or international phone</span>}
                        </div>
                      </article>
                    )
                  })}
              </div>
            )}
            <button type="button" onClick={() => setModal(null)} className="w-full rounded-xl border border-[#e8ece6] px-4 py-2.5 text-[11px] font-bold text-[#738077] hover:bg-[#f7f8f5]">Done</button>
            <p className="text-center text-[10px] text-[#929d94]">No messages are sent automatically. Gmail opens a draft; WhatsApp opens a chat for each selected member.</p>
          </div>
        </Modal>
      )}

      {toast && <div role="status" className="fixed bottom-5 right-5 z-50 flex max-w-[calc(100vw-2.5rem)] items-center gap-2 rounded-xl bg-[#263b31] px-4 py-3 text-sm font-medium text-white shadow-xl"><Check size={16} className="shrink-0 text-[#9cd0a5]" />{toast}</div>}
    </div>
  )
}

function Brand({ compact = false }) {
  return (
    <div className="flex items-center gap-3">
      <img src="/gs-busanza-crest.png" alt="GS Busanza crest" className={`${compact ? 'size-12' : 'size-16'} shrink-0 rounded-xl object-contain`} />
      {!compact && <div><p className="text-[18px] font-extrabold tracking-[-.045em]">GS Busanza</p><p className="mt-0.5 text-[11px] font-medium text-[#929d94]">School library</p></div>}
    </div>
  )
}

function SchoolContact({ className = 'text-[#65756a]' }) {
  return (
    <div className={`space-y-1.5 text-[10px] leading-relaxed ${className}`}>
      <p><span className="font-semibold">Headteacher:</span> MUKESHIMANA Vestine</p>
      <p><span className="font-semibold">Librarian:</span> NSHIMIYIMANA Yves</p>
      <p><span className="font-semibold">Telephone:</span> <a href="tel:+250791756160" className="underline underline-offset-2">+250 791 756 160</a></p>
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

function Login({ form, setForm, mode, onModeChange, resetToken, resetForm, setResetForm, onSubmit, onRequestReset, onCompleteReset, busy, toast }) {
  const [showPassword, setShowPassword] = useState(false)
  const [showResetPassword, setShowResetPassword] = useState(false)
  const isReset = mode === 'reset'
  const isForgot = mode === 'forgot' || mode === 'forgot-sent'
  const openForgotPassword = () => {
    setForm((current) => ({ ...current, password: '' }))
    onModeChange('forgot')
  }

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
        <SchoolContact className="relative text-white/85" />
      </section>
      <section className="flex min-h-screen items-center justify-center px-6 py-12 sm:px-10">
        <div className="w-full max-w-[380px]">
          <div className="mb-11 lg:hidden"><Brand /></div>
          <p className="text-[11px] font-bold uppercase tracking-[.17em] text-[#79917e]">{isReset ? 'Password recovery' : isForgot ? 'Forgot password' : 'Welcome back'}</p>
          <h2 className="mt-3 text-[32px] font-bold tracking-[-.055em]">{isReset ? 'Choose a new password' : mode === 'forgot-sent' ? 'Check your email' : isForgot ? 'Reset your password' : 'Sign in to your library'}</h2>
          <p className="mt-2 text-[13px] leading-6 text-[#8b958e]">
            {isReset
              ? resetToken ? 'Choose a new password for your librarian account.' : 'This reset link is missing. Request a new link below.'
              : mode === 'forgot-sent'
                ? 'If the librarian username matches, a one-time reset link will be sent to the configured mailbox.'
                : isForgot
                  ? 'Enter your librarian username and we’ll email a one-time reset link.'
                  : 'A good day to discover something new.'}
          </p>
          {isReset ? (
            resetToken ? (
              <form onSubmit={onCompleteReset} className="mt-8 space-y-5">
                <Field label="New password"><div className="relative"><input required autoComplete="new-password" minLength={12} maxLength={72} type={showResetPassword ? 'text' : 'password'} value={resetForm.password} onChange={(event) => setResetForm({ ...resetForm, password: event.target.value })} /><button type="button" onClick={() => setShowResetPassword((visible) => !visible)} aria-label={showResetPassword ? 'Hide password' : 'Show password'} className="absolute inset-y-0 right-3 text-[#77847b]">{showResetPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></Field>
                <Field label="Confirm new password"><input required autoComplete="new-password" minLength={12} maxLength={72} type={showResetPassword ? 'text' : 'password'} value={resetForm.confirmPassword} onChange={(event) => setResetForm({ ...resetForm, confirmPassword: event.target.value })} /></Field>
                <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#315c46] px-4 py-3.5 text-[13px] font-bold text-white transition hover:bg-[#284a39] disabled:cursor-wait disabled:opacity-70">{busy ? 'Resetting password…' : 'Set new password'} <ArrowRight size={15} /></button>
              </form>
            ) : (
              <button type="button" onClick={() => onModeChange('forgot')} className="mt-8 w-full rounded-xl bg-[#315c46] px-4 py-3.5 text-[13px] font-bold text-white">Request a new reset link</button>
            )
          ) : isForgot ? (
            mode === 'forgot-sent' ? (
              <button type="button" onClick={() => onModeChange('signin')} className="mt-8 w-full rounded-xl border border-[#e5eae3] px-4 py-3 text-[12px] font-semibold text-[#536258] hover:bg-[#f7f8f5]">Back to sign in</button>
            ) : (
              <form onSubmit={onRequestReset} className="mt-8 space-y-5">
                <Field label="Username"><input required autoComplete="username" type="text" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field>
                <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#315c46] px-4 py-3.5 text-[13px] font-bold text-white transition hover:bg-[#284a39] disabled:cursor-wait disabled:opacity-70">{busy ? 'Sending link…' : 'Email reset link'} <ArrowRight size={15} /></button>
                <button type="button" onClick={() => onModeChange('signin')} disabled={busy} className="w-full rounded-xl border border-[#e5eae3] px-4 py-3 text-[12px] font-semibold text-[#536258] hover:bg-[#f7f8f5] disabled:opacity-60">Back to sign in</button>
              </form>
            )
          ) : (
            <form onSubmit={onSubmit} className="mt-8 space-y-5">
              <Field label="Username"><input required autoComplete="username" type="text" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field>
              <Field label="Password"><div className="relative"><input required autoComplete="current-password" type={showPassword ? 'text' : 'password'} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /><button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'} className="absolute inset-y-0 right-3 text-[#77847b]">{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></Field>
              <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#315c46] px-4 py-3.5 text-[13px] font-bold text-white transition hover:bg-[#284a39] disabled:cursor-wait disabled:opacity-70">{busy ? 'Signing you in…' : 'Sign in'} <ArrowRight size={15} /></button>
              <button type="button" onClick={openForgotPassword} className="w-full text-[12px] font-semibold text-[#536b5a] hover:underline">Forgot password?</button>
            </form>
          )}
          <div className="mt-8 rounded-xl border border-[#e9ede7] bg-[#fafbf9] p-4"><SchoolContact /></div>
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-[#e9ede7] bg-white p-4">
            <img src="/librarian-photo.jpg" alt="NSHIMIYIMANA Yves" className="size-14 shrink-0 rounded-full object-cover" />
            <div className="min-w-0">
              <p className="text-[10px] font-medium text-[#8b958e]">Developed by</p>
              <p className="truncate text-[12px] font-bold text-[#34443b]">NSHIMIYIMANA Yves</p>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[#65756a]">
                <a href="mailto:nshimiyeyves12@gmail.com" className="underline underline-offset-2">nshimiyeyves12@gmail.com</a>
                <a href="tel:+250791756160" className="underline underline-offset-2">+250791756160</a>
                <a href="https://wa.me/250791756160" target="_blank" rel="noreferrer" className="underline underline-offset-2">WhatsApp</a>
              </div>
            </div>
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

function ActionButton({ children, onClick, secondary = false, icon: Icon = Plus, type = 'button', disabled = false }) {
  return <button type={type} onClick={onClick} disabled={disabled} className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[11px] font-bold transition disabled:cursor-wait disabled:opacity-60 ${secondary ? 'border border-[#e5eae3] bg-white text-[#536258] hover:bg-[#f7f8f5]' : 'bg-[#315c46] text-white hover:bg-[#284a39]'}`}><Icon size={14} />{children}</button>
}

function Dashboard({ user, dashboard, books, loans, activity, onNavigate, onIssue }) {
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
      <PageHeading
        eyebrow="Your school librarian"
        title={<span className="flex items-center gap-4"><img src="/librarian-photo.jpg" alt="Librarian portrait" className="size-14 shrink-0 rounded-full border-2 border-white object-cover shadow-sm" /><span>{timeGreeting()}</span></span>}
        description={`Welcome back, ${user.name}. Here’s what’s happening around the library today.`}
      >
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

function Catalog({ books, search, setSearch, importResult, busy, onImport, onAdd, onEdit, onDelete, onExport, canManage }) {
  return (
    <>
      <PageHeading eyebrow="Manage and import library books" title="Book collection" description={`${books.length} title${books.length === 1 ? '' : 's'} to explore`}>
        <SearchBox value={search} onChange={setSearch} placeholder="Search title, author, ISBN…" />
        <ActionButton secondary icon={Download} onClick={onExport}>Export CSV</ActionButton>
        <ActionButton onClick={onAdd}>Add a book</ActionButton>
      </PageHeading>
      <section className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-[#e9ede7] bg-white p-4">
        <div className="mr-auto"><p className="text-[11px] font-bold">Import books from CSV</p><p className="mt-1 text-[10px] text-[#929d94]">Upload one row per title with copy count, delivery and publication dates, grade, and shelf.</p></div>
        <button onClick={downloadBookTemplate} className="flex items-center gap-1.5 rounded-lg border border-[#e8ece6] px-3 py-2 text-[10px] font-bold text-[#607667] hover:bg-[#f7f8f5]"><Download size={13} /> CSV template</button>
        <label className={`flex cursor-pointer items-center gap-1.5 rounded-lg bg-[#edf4ed] px-3 py-2 text-[10px] font-bold text-[#52745b] hover:bg-[#e3eee4] ${busy ? 'pointer-events-none opacity-50' : ''}`}>
          <Upload size={13} /> Import books
          <input type="file" accept=".csv,text/csv" className="sr-only" disabled={busy} onChange={(event) => { onImport(event.target.files?.[0]); event.target.value = '' }} />
        </label>
      </section>
      {importResult && <section role="status" className="mb-4 rounded-xl border border-[#dce8dc] bg-[#f2f7f1] px-4 py-3 text-[11px] text-[#526c58]">
        <p className="font-bold">Book import: {importResult.imported} titles added, {importResult.skipped.length} duplicates skipped, {importResult.invalid.length} invalid rows.</p>
        {[...importResult.skipped, ...importResult.invalid].slice(0, 5).map((row) => <p key={`${row.line}-${row.reason}`} className="mt-1">Row {row.line}: {row.reason}</p>)}
      </section>}
      <section className="overflow-hidden rounded-2xl border border-[#e9ede7] bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] text-left">
            <thead><tr className="border-b border-[#edf0eb] bg-[#fbfcfa] text-[9px] font-bold uppercase tracking-[.12em] text-[#929d94]"><th className="px-5 py-3.5">Book</th><th className="px-4 py-3.5">ISBN</th><th className="px-4 py-3.5">Publisher</th><th className="px-4 py-3.5">Grade</th><th className="px-4 py-3.5">Copies</th><th className="px-4 py-3.5">Delivered</th><th className="px-4 py-3.5">Published</th><th className="px-4 py-3.5">Shelf</th><th className="px-5 py-3.5 text-right">Actions</th></tr></thead>
            <tbody className="divide-y divide-[#f0f2ee]">
              {books.map((book, index) => <tr key={book.id} className="transition hover:bg-[#fcfdfa]"><td className="px-5 py-3"><div className="flex items-center gap-3"><BookCover index={index} /><div><p className="max-w-[220px] truncate text-[11px] font-bold">{book.title}</p><p className="mt-1 text-[10px] text-[#8b968d]">{book.author || book.category || 'Book'}</p></div></div></td><td className="px-4 py-3 text-[10px] text-[#748078]">{book.isbn || '—'}</td><td className="px-4 py-3 text-[10px] text-[#748078]">{book.publisher || '—'}</td><td className="px-4 py-3 text-[10px] text-[#748078]">{book.grade || '—'}</td><td className="px-4 py-3 text-[10px] text-[#748078]">{book.availableCopies} / {book.totalCopies}</td><td className="px-4 py-3 text-[10px] text-[#748078]">{book.deliveredOn || '—'}</td><td className="px-4 py-3 text-[10px] text-[#748078]">{book.publicationYear || '—'}</td><td className="px-4 py-3 text-[10px] text-[#748078]">{book.shelf}</td><td className="px-5 py-3 text-right"><button disabled={busy} onClick={() => onEdit(book)} className="rounded-lg px-2.5 py-1.5 text-[10px] font-bold text-[#58745e] hover:bg-[#edf4ed] disabled:opacity-50">Edit</button>{canManage && <button disabled={busy} onClick={() => onDelete(book)} className="ml-1 rounded-lg px-2 py-1.5 text-[10px] font-semibold text-[#a57665] hover:bg-[#f9eee9] disabled:opacity-50">Delete</button>}</td></tr>)}
              {books.length === 0 && <EmptyRow colSpan={9} message="No books found. Try another search, import a CSV, or add a title to your collection." />}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-[#edf0eb] px-5 py-3"><span className="text-[10px] text-[#929d94]">Showing {books.length} {books.length === 1 ? 'book' : 'books'}</span><div className="flex gap-1"><button disabled aria-label="Previous page" className="rounded-lg border border-[#edf0eb] p-1.5 text-[#9ca69e] disabled:opacity-50"><ChevronLeft size={14} /></button><button disabled aria-label="Next page" className="rounded-lg border border-[#edf0eb] p-1.5 text-[#9ca69e] disabled:opacity-50"><ChevronRight size={14} /></button></div></div>
      </section>
    </>
  )
}

function Members({ members, search, setSearch, typeFilter, setTypeFilter, classFilter, setClassFilter, importResult, busy, onImport, onExport, onAdd, onEdit, onDelete, canManage }) {
  return (
    <>
      <PageHeading eyebrow="GS Busanza school directory" title="Students & teachers" description={`${members.length} people match your directory filters`}>
        <SearchBox value={search} onChange={setSearch} placeholder="Search members…" />
        <ActionButton secondary icon={Download} onClick={onExport}>Export CSV</ActionButton>
        {canManage && <ActionButton onClick={onAdd}><Plus size={14} /> Add person</ActionButton>}
      </PageHeading>
      <section className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-[#e9ede7] bg-white p-4">
        <label className="text-[10px] font-semibold text-[#78847c]">Type <select className="ml-2 rounded-lg border border-[#e8ece6] bg-white px-2 py-2 text-[10px]" value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); if (event.target.value !== 'Student') setClassFilter('All') }}><option>All</option><option>Student</option><option>Teacher</option></select></label>
        {typeFilter !== 'Teacher' && <label className="text-[10px] font-semibold text-[#78847c]">Class <select className="ml-2 rounded-lg border border-[#e8ece6] bg-white px-2 py-2 text-[10px]" value={classFilter} onChange={(event) => setClassFilter(event.target.value)}><option>All</option>{schoolClasses.map((section) => <option key={section}>{section}</option>)}</select></label>}
        <div className="ml-auto flex flex-wrap gap-2">
          <button onClick={() => downloadMemberTemplate('Student')} className="flex items-center gap-1.5 rounded-lg border border-[#e8ece6] px-3 py-2 text-[10px] font-bold text-[#607667] hover:bg-[#f7f8f5]"><Download size={13} /> Student CSV template</button>
          <button onClick={() => downloadMemberTemplate('Teacher')} className="flex items-center gap-1.5 rounded-lg border border-[#e8ece6] px-3 py-2 text-[10px] font-bold text-[#607667] hover:bg-[#f7f8f5]"><Download size={13} /> Teacher CSV template</button>
          <label className={`flex cursor-pointer items-center gap-1.5 rounded-lg bg-[#edf4ed] px-3 py-2 text-[10px] font-bold text-[#52745b] hover:bg-[#e3eee4] ${busy ? 'pointer-events-none opacity-50' : ''}`}>
            <Upload size={13} /> Import students
            <input type="file" accept=".csv,text/csv" className="sr-only" disabled={busy} onChange={(event) => { onImport(event.target.files?.[0], 'Student'); event.target.value = '' }} />
          </label>
          <label className={`flex cursor-pointer items-center gap-1.5 rounded-lg bg-[#edf4ed] px-3 py-2 text-[10px] font-bold text-[#52745b] hover:bg-[#e3eee4] ${busy ? 'pointer-events-none opacity-50' : ''}`}>
            <Upload size={13} /> Import teachers
            <input type="file" accept=".csv,text/csv" className="sr-only" disabled={busy} onChange={(event) => { onImport(event.target.files?.[0], 'Teacher'); event.target.value = '' }} />
          </label>
        </div>
      </section>
      {importResult && <section role="status" className="mb-4 rounded-xl border border-[#dce8dc] bg-[#f2f7f1] px-4 py-3 text-[11px] text-[#526c58]">
        <p className="font-bold">{importResult.memberType} import: {importResult.imported} added, {importResult.skipped.length} duplicates skipped, {importResult.invalid.length} invalid rows.</p>
        {[...importResult.skipped, ...importResult.invalid].slice(0, 5).map((row) => <p key={`${row.line}-${row.reason}`} className="mt-1">Row {row.line}: {row.reason}</p>)}
      </section>}
      <section className="overflow-hidden rounded-2xl border border-[#e9ede7] bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left">
            <thead><tr className="border-b border-[#edf0eb] bg-[#fbfcfa] text-[9px] font-bold uppercase tracking-[.12em] text-[#929d94]"><th className="px-5 py-3.5">Student or teacher</th><th className="px-4 py-3.5">Type / class</th><th className="px-4 py-3.5">Membership no.</th><th className="px-4 py-3.5">Email</th><th className="px-4 py-3.5">Books out</th><th className="px-4 py-3.5">Status</th><th className="px-5 py-3.5 text-right">Actions</th></tr></thead>
            <tbody className="divide-y divide-[#f0f2ee]">
              {members.map((member, index) => <tr key={member.id} className="transition hover:bg-[#fcfdfa]"><td className="px-5 py-4"><div className="flex items-center gap-3"><div className={`flex size-9 items-center justify-center rounded-full text-[10px] font-bold ${['bg-[#edf2e9] text-[#6b846c]', 'bg-[#f2ede6] text-[#a17e5c]', 'bg-[#eeebf4] text-[#7e719a]', 'bg-[#f4ece8] text-[#a67762]'][index % 4]}`}>{initials(member.name)}</div><div><p className="text-[11px] font-bold">{member.name}</p><p className="mt-1 text-[9px] text-[#99a29b]">{member.joinedAt ? `Joined ${member.joinedAt}` : 'School member'}</p></div></div></td><td className="px-4 py-4"><span className="text-[10px] font-semibold">{member.memberType}</span><p className="mt-1 text-[9px] text-[#929d94]">{member.classSection || '—'}</p></td><td className="px-4 py-4 text-[10px] text-[#748078]">{member.membershipNumber}</td><td className="px-4 py-4 text-[10px] text-[#748078]">{member.email || '—'}<p className="mt-1 text-[9px] text-[#929d94]">{member.phone || 'No phone provided'}</p></td><td className="px-4 py-4"><span className={`text-[10px] font-bold ${member.activeLoans ? 'text-[#a86b4d]' : 'text-[#748078]'}`}>{member.activeLoans || 0}</span><span className="ml-1 text-[9px] text-[#929d94]">active · {member.totalLoans || 0} total</span></td><td className="px-4 py-4"><span className={`rounded-full px-2.5 py-1 text-[9px] font-bold ${member.status === 'Active' ? 'bg-[#edf4ed] text-[#66826b]' : 'bg-[#f8eee9] text-[#ad755d]'}`}>{member.status}</span></td><td className="px-5 py-4 text-right">{canManage && <><button disabled={busy} onClick={() => onEdit(member)} className="rounded-lg px-2.5 py-1.5 text-[10px] font-bold text-[#58745e] hover:bg-[#edf4ed] disabled:opacity-50">Edit</button><button disabled={busy} onClick={() => onDelete(member)} className="ml-1 rounded-lg px-2 py-1.5 text-[10px] font-semibold text-[#a57665] hover:bg-[#f9eee9] disabled:opacity-50">Delete</button></>}</td></tr>)}
              {members.length === 0 && <EmptyRow colSpan={7} message="No students or teachers match these filters. Import a CSV or add a person." />}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

function downloadMemberTemplate(memberType) {
  const classSection = memberType === 'Teacher' ? '' : 'S1A'
  const content = `${memberCsvHeaders}\nExample ${memberType.toLowerCase()},${memberType},${classSection},,,\n`
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `gs-busanza-${memberType.toLowerCase()}-template.csv`
  link.click()
  URL.revokeObjectURL(url)
}

function downloadBookTemplate() {
  const content = `${bookCsvHeaders}\nExample book,9780000000000,Example Publisher,Example Author,1,2026-10-16,2020,S1,A1-04,Textbook\n`
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'gs-busanza-book-template.csv'
  link.click()
  URL.revokeObjectURL(url)
}

function Reports({ filters, setFilters, kind, setKind, report, busy, onRun, onExport }) {
  const update = (key, value) => setFilters((current) => ({ ...current, [key]: value }))
  const readyReport = report?.kind === kind && JSON.stringify(report.filters) === JSON.stringify(filters) ? report.data : null
  const reportOptions = [
    ['loans', 'Loan activity'],
    ['overdue', 'Overdue loans'],
    ['returned', 'Returned-loan history'],
    ['missed', 'Missed books'],
    ['people', 'Student & teacher borrowing'],
    ['nonBorrowers', 'Members who have never borrowed'],
    ['classes', 'Class borrowing'],
    ['popular', 'Most-borrowed books'],
    ['books', 'Book inventory'],
    ['availability', 'Book availability'],
  ]
  return (
    <>
      <PageHeading eyebrow="Choose exactly what to generate" title="Reports" description="Generate filtered borrowing, member, class, and book reports.">
        <div className="flex flex-wrap gap-2">
          <ActionButton secondary icon={Download} onClick={() => onExport('csv')} disabled={!readyReport}>CSV</ActionButton>
          <ActionButton secondary icon={Download} onClick={() => onExport('pdf')} disabled={!readyReport}>PDF</ActionButton>
          <ActionButton secondary icon={Download} onClick={() => onExport('excel')} disabled={!readyReport}>Excel</ActionButton>
        </div>
        <ActionButton onClick={onRun} disabled={busy}>{busy ? 'Generating…' : 'Generate report'}</ActionButton>
      </PageHeading>
      <section className="mb-5 grid gap-3 rounded-2xl border border-[#e9ede7] bg-white p-5 sm:grid-cols-2 xl:grid-cols-3">
        <Field label="Report type"><select value={kind} onChange={(event) => setKind(event.target.value)}>{reportOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        {kind !== 'classes' && <Field label={['books', 'availability', 'popular'].includes(kind) ? 'Search title, author, ISBN or book' : 'Search name or membership number'}><input value={filters.search} onChange={(event) => update('search', event.target.value)} placeholder="Enter a name, number, title, ISBN or code" /></Field>}
        {['loans', 'overdue', 'returned', 'missed', 'people', 'nonBorrowers', 'popular'].includes(kind) && <Field label="Member type"><select value={filters.memberType} onChange={(event) => update('memberType', event.target.value)}><option>All</option><option>Student</option><option>Teacher</option></select></Field>}
        {['loans', 'overdue', 'returned', 'missed', 'people', 'nonBorrowers', 'popular'].includes(kind) && <Field label="Class"><select value={filters.classSection} onChange={(event) => update('classSection', event.target.value)}><option>All</option>{schoolClasses.map((section) => <option key={section}>{section}</option>)}</select></Field>}
        {kind === 'loans' && <Field label="Loan status"><select value={filters.status} onChange={(event) => update('status', event.target.value)}><option>All</option><option>Active</option><option>Overdue</option><option>Returned</option><option>Missed</option></select></Field>}
        {kind === 'availability' && <Field label="Availability"><select value={filters.availability} onChange={(event) => update('availability', event.target.value)}><option>All</option><option>Available</option><option>Out of stock</option></select></Field>}
        {['loans', 'overdue', 'returned', 'missed', 'classes', 'popular'].includes(kind) && <Field label="From date"><input type="date" value={filters.from} onChange={(event) => update('from', event.target.value)} /></Field>}
        {['loans', 'overdue', 'returned', 'missed', 'classes', 'popular'].includes(kind) && <Field label="To date"><input type="date" value={filters.to} onChange={(event) => update('to', event.target.value)} /></Field>}
      </section>
      {!readyReport ? <section className="rounded-2xl border border-dashed border-[#dfe6dd] bg-white p-10 text-center text-sm text-[#829087]">Choose a report type and filters, then generate it.</section> : <>
        {kind === 'loans' && <>
        <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
          {[
            ['Total copies loaned', readyReport.summary.totalLoans],
            ['Active copies', readyReport.summary.activeLoans],
            ['Overdue copies', readyReport.summary.overdueLoans],
            ['Returned copies', readyReport.summary.returnedLoans],
            ['Missed copies', readyReport.summary.missedLoans],
            ['Student copies', readyReport.summary.studentLoans],
            ['Teacher copies', readyReport.summary.teacherLoans],
          ].map(([label, value]) => <article key={label} className="rounded-2xl border border-[#e9ede7] bg-white p-4"><p className="text-[10px] font-semibold text-[#7c887f]">{label}</p><p className="mt-2 text-2xl font-bold">{Number(value).toLocaleString()}</p></article>)}
        </section>
        <section className="overflow-hidden rounded-2xl border border-[#e9ede7] bg-white">
          <div className="border-b border-[#edf0eb] px-5 py-4"><h2 className="text-sm font-bold">Loan activity</h2><p className="mt-1 text-[10px] text-[#929d94]">{readyReport.rows.length.toLocaleString()} records{readyReport.truncated ? ' (showing first 20,000; narrow filters to view fewer)' : ''}</p></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-left text-[10px]"><thead className="bg-[#fbfcfa] text-[9px] uppercase tracking-wide text-[#929d94]"><tr><th className="px-5 py-3">Borrower</th><th className="px-4 py-3">Type / class</th><th className="px-4 py-3">Book / copy code</th><th className="px-4 py-3">Out / due</th><th className="px-4 py-3">Copies: total / returned / missed / out</th><th className="px-5 py-3">Status</th></tr></thead><tbody className="divide-y divide-[#f0f2ee]">{readyReport.rows.map((row) => <tr key={row.id}><td className="px-5 py-3"><span className="font-bold">{row.memberName}</span><span className="ml-2 text-[#929d94]">{row.membershipNumber}</span></td><td className="px-4 py-3">{row.memberType} · {row.classSection || '—'}</td><td className="px-4 py-3">{row.bookTitle}<p className="mt-1 text-[#929d94]">{row.copyCode || 'No copy code'} · ISBN {row.isbn || '—'}</p></td><td className="px-4 py-3">{row.issuedAt} / {row.dueDate}</td><td className="px-4 py-3">{row.quantity} / {row.returnedQuantity} / {row.missedQuantity} / {row.outstandingQuantity}</td><td className="px-5 py-3">{row.status}</td></tr>)}{readyReport.rows.length === 0 && <EmptyRow colSpan={6} message="No loan records match these filters." />}</tbody></table></div>
        </section>
        </>}
        {kind === 'people' && <section className="overflow-hidden rounded-2xl border border-[#e9ede7] bg-white"><div className="border-b border-[#edf0eb] px-5 py-4"><h2 className="text-sm font-bold">Student & teacher borrowing</h2><p className="mt-1 text-[10px] text-[#929d94]">{readyReport.length} people</p></div><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-[10px]"><thead className="bg-[#fbfcfa] text-[9px] uppercase text-[#929d94]"><tr><th className="px-5 py-3">Name</th><th className="px-4 py-3">Type / class</th><th className="px-4 py-3">Membership</th><th className="px-4 py-3">Total loans</th><th className="px-5 py-3">Active / overdue</th></tr></thead><tbody className="divide-y divide-[#f0f2ee]">{readyReport.map((person) => <tr key={person.id}><td className="px-5 py-3 font-bold">{person.name}</td><td className="px-4 py-3">{person.memberType} · {person.classSection || '—'}</td><td className="px-4 py-3">{person.membershipNumber}</td><td className="px-4 py-3">{person.totalLoans}</td><td className="px-5 py-3">{person.activeLoans} / {person.overdueLoans}</td></tr>)}{readyReport.length === 0 && <EmptyRow colSpan={5} message="No borrowers match these filters." />}</tbody></table></div></section>}
        {kind === 'classes' && <section className="overflow-hidden rounded-2xl border border-[#e9ede7] bg-white"><div className="border-b border-[#edf0eb] px-5 py-4"><h2 className="text-sm font-bold">Class borrowing summary</h2><p className="mt-1 text-[10px] text-[#929d94]">Student counts and loans for all 23 classes.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[580px] text-left text-[10px]"><thead className="bg-[#fbfcfa] text-[9px] uppercase text-[#929d94]"><tr><th className="px-5 py-3">Class</th><th className="px-4 py-3">Students</th><th className="px-4 py-3">Loans</th><th className="px-4 py-3">Active</th><th className="px-5 py-3">Overdue</th></tr></thead><tbody className="divide-y divide-[#f0f2ee]">{readyReport.map((row) => <tr key={row.classSection}><td className="px-5 py-3 font-bold">{row.classSection}</td><td className="px-4 py-3">{row.students}</td><td className="px-4 py-3">{row.totalLoans}</td><td className="px-4 py-3">{row.activeLoans}</td><td className="px-5 py-3">{row.overdueLoans}</td></tr>)}</tbody></table></div></section>}
        {kind === 'books' && <section className="overflow-hidden rounded-2xl border border-[#e9ede7] bg-white"><div className="border-b border-[#edf0eb] px-5 py-4"><h2 className="text-sm font-bold">Book inventory</h2><p className="mt-1 text-[10px] text-[#929d94]">{readyReport.length} titles</p></div><div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-left text-[10px]"><thead className="bg-[#fbfcfa] text-[9px] uppercase text-[#929d94]"><tr><th className="px-5 py-3">Title</th><th className="px-4 py-3">ISBN</th><th className="px-4 py-3">Publisher</th><th className="px-4 py-3">Grade</th><th className="px-4 py-3">Shelf</th><th className="px-4 py-3">Copies available / total</th><th className="px-4 py-3">Delivered</th><th className="px-5 py-3">Publication year</th></tr></thead><tbody className="divide-y divide-[#f0f2ee]">{readyReport.map((book) => <tr key={book.id}><td className="px-5 py-3 font-bold">{book.title}<p className="mt-1 font-normal text-[#929d94]">{book.author || book.category}</p></td><td className="px-4 py-3">{book.isbn || '—'}</td><td className="px-4 py-3">{book.publisher || '—'}</td><td className="px-4 py-3">{book.grade || '—'}</td><td className="px-4 py-3">{book.shelf}</td><td className="px-4 py-3">{book.availableCopies} / {book.totalCopies}</td><td className="px-4 py-3">{book.deliveredOn || '—'}</td><td className="px-5 py-3">{book.publicationYear || '—'}</td></tr>)}{readyReport.length === 0 && <EmptyRow colSpan={8} message="No books match this search." />}</tbody></table></div></section>}
        {['overdue', 'returned', 'missed'].includes(kind) && <section className="overflow-hidden rounded-2xl border border-[#e9ede7] bg-white"><div className="border-b border-[#edf0eb] px-5 py-4"><h2 className="text-sm font-bold">{kind === 'overdue' ? 'Overdue loans' : kind === 'returned' ? 'Returned-loan history' : 'Missed books'}</h2><p className="mt-1 text-[10px] text-[#929d94]">{readyReport.rows.length.toLocaleString()} records{readyReport.truncated ? ' (showing first 20,000; narrow filters to view fewer)' : ''}</p></div><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-[10px]"><thead className="bg-[#fbfcfa] text-[9px] uppercase text-[#929d94]"><tr><th className="px-5 py-3">Borrower</th><th className="px-4 py-3">Type / class</th><th className="px-4 py-3">Book / copy code</th><th className="px-4 py-3">Issued / due</th>{kind === 'returned' && <th className="px-4 py-3">Returned</th>}{kind === 'missed' && <th className="px-4 py-3">Marked missed</th>}<th className="px-5 py-3">Status</th></tr></thead><tbody className="divide-y divide-[#f0f2ee]">{readyReport.rows.map((row) => <tr key={row.id}><td className="px-5 py-3"><span className="font-bold">{row.memberName}</span><span className="ml-2 text-[#929d94]">{row.membershipNumber}</span></td><td className="px-4 py-3">{row.memberType} · {row.classSection || '—'}</td><td className="px-4 py-3">{row.bookTitle}<p className="mt-1 text-[#929d94]">{row.copyCode || 'No copy code'} · ISBN {row.isbn}</p></td><td className="px-4 py-3">{row.issuedAt} / {row.dueDate}</td>{kind === 'returned' && <td className="px-4 py-3">{row.returnedAt}</td>}{kind === 'missed' && <td className="px-4 py-3">{row.missedAt}</td>}<td className="px-5 py-3">{row.status}</td></tr>)}{readyReport.rows.length === 0 && <EmptyRow colSpan={kind === 'returned' || kind === 'missed' ? 6 : 5} message={kind === 'overdue' ? 'No overdue loans match these filters.' : kind === 'returned' ? 'No returned loans match these filters.' : 'No missed books match these filters.'} />}</tbody></table></div></section>}
        {kind === 'nonBorrowers' && <section className="overflow-hidden rounded-2xl border border-[#e9ede7] bg-white"><div className="border-b border-[#edf0eb] px-5 py-4"><h2 className="text-sm font-bold">Members who have never borrowed</h2><p className="mt-1 text-[10px] text-[#929d94]">{readyReport.length.toLocaleString()} members</p></div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-[10px]"><thead className="bg-[#fbfcfa] text-[9px] uppercase text-[#929d94]"><tr><th className="px-5 py-3">Name</th><th className="px-4 py-3">Type / class</th><th className="px-4 py-3">Membership</th><th className="px-4 py-3">Contact</th><th className="px-5 py-3">Status</th></tr></thead><tbody className="divide-y divide-[#f0f2ee]">{readyReport.map((person) => <tr key={person.id}><td className="px-5 py-3 font-bold">{person.name}</td><td className="px-4 py-3">{person.memberType} · {person.classSection || '—'}</td><td className="px-4 py-3">{person.membershipNumber}</td><td className="px-4 py-3">{person.email || person.phone || '—'}</td><td className="px-5 py-3">{person.status}</td></tr>)}{readyReport.length === 0 && <EmptyRow colSpan={5} message="Every matching member has borrowed a book." />}</tbody></table></div></section>}
        {kind === 'popular' && <section className="overflow-hidden rounded-2xl border border-[#e9ede7] bg-white"><div className="border-b border-[#edf0eb] px-5 py-4"><h2 className="text-sm font-bold">Most-borrowed books</h2><p className="mt-1 text-[10px] text-[#929d94]">{readyReport.length.toLocaleString()} titles sorted by total checkouts</p></div><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-[10px]"><thead className="bg-[#fbfcfa] text-[9px] uppercase text-[#929d94]"><tr><th className="px-5 py-3">Title</th><th className="px-4 py-3">ISBN</th><th className="px-4 py-3">Category / shelf</th><th className="px-4 py-3">Total loans</th><th className="px-5 py-3">Unique borrowers</th></tr></thead><tbody className="divide-y divide-[#f0f2ee]">{readyReport.map((book) => <tr key={book.id}><td className="px-5 py-3 font-bold">{book.title}<p className="mt-1 font-normal text-[#929d94]">{book.author}</p></td><td className="px-4 py-3">{book.isbn}</td><td className="px-4 py-3">{book.category} · {book.shelf}</td><td className="px-4 py-3">{book.totalLoans}</td><td className="px-5 py-3">{book.uniqueBorrowers}</td></tr>)}{readyReport.length === 0 && <EmptyRow colSpan={5} message="No borrowing records match these filters." />}</tbody></table></div></section>}
        {kind === 'availability' && <section className="overflow-hidden rounded-2xl border border-[#e9ede7] bg-white"><div className="border-b border-[#edf0eb] px-5 py-4"><h2 className="text-sm font-bold">Books available in the library</h2><p className="mt-1 text-[10px] text-[#929d94]">{readyReport.length.toLocaleString()} books{filters.availability !== 'All' ? ` · ${filters.availability}` : ''}</p></div><div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-[10px]"><thead className="bg-[#fbfcfa] text-[9px] uppercase text-[#929d94]"><tr><th className="px-5 py-3">Title</th><th className="px-4 py-3">ISBN</th><th className="px-4 py-3">Category / shelf</th><th className="px-4 py-3">Available / total</th><th className="px-5 py-3">Availability</th></tr></thead><tbody className="divide-y divide-[#f0f2ee]">{readyReport.map((book) => <tr key={book.id}><td className="px-5 py-3 font-bold">{book.title}<p className="mt-1 font-normal text-[#929d94]">{book.author}</p></td><td className="px-4 py-3">{book.isbn}</td><td className="px-4 py-3">{book.category} · {book.shelf}</td><td className="px-4 py-3">{book.availableCopies} / {book.totalCopies}</td><td className="px-5 py-3">{book.availability}</td></tr>)}{readyReport.length === 0 && <EmptyRow colSpan={5} message="No books match this availability filter." />}</tbody></table></div></section>}
      </>}
    </>
  )
}

function LibraryAttendance({ members, books, visits, summary, date, setDate, form, setForm, attendanceSearch, setAttendanceSearch, busy, onRecord, onExport }) {
  const activeMembers = members.filter((member) => member.status === 'Active')
  const memberOptions = activeMembers.map((member) => ({
    id: String(member.id),
    label: `${member.name} · ${member.memberType}${member.classSection ? ` · ${member.classSection}` : ''} · ${member.membershipNumber}`,
    search: `${member.name} ${member.memberType} ${member.classSection || ''} ${member.membershipNumber}`,
  }))
  const bookOptions = books.map((book) => ({
    id: String(book.id),
    label: `${book.title}${book.isbn ? ` · ISBN ${book.isbn}` : ''} · ${book.shelf || 'No shelf'} · #${book.id}`,
    search: `${book.title} ${book.isbn || ''} ${book.author || ''} ${book.publisher || ''} ${book.shelf || ''}`,
  }))
  const visibleMembers = memberOptions.filter((member) => !form.memberSearch || member.search.toLowerCase().includes(form.memberSearch.toLowerCase()))
  const visibleBooks = bookOptions.filter((book) => !form.bookSearch || book.search.toLowerCase().includes(form.bookSearch.toLowerCase()))
  const filteredVisits = visits.filter((visit) => (
    `${visit.memberName} ${visit.memberType} ${visit.classSection || ''} ${visit.membershipNumber} ${visit.bookTitle || ''}`
      .toLowerCase()
      .includes(attendanceSearch.trim().toLowerCase())
  ))

  function updateSearch(field, options, value) {
    const selected = options.find((option) => option.label.toLowerCase() === value.trim().toLowerCase())
    setForm((current) => ({
      ...current,
      [field === 'memberSearch' ? 'memberId' : 'bookId']: selected?.id || '',
      [field]: value,
    }))
  }

  return (
    <>
      <PageHeading eyebrow="Record each library visit" title="Library attendance" description="Check in students and teachers, note what they are reading, and see your most frequent visitors.">
        <ActionButton secondary icon={Download} onClick={onExport}>Download attendance CSV</ActionButton>
      </PageHeading>
      <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['Visits today', summary?.visitsToday ?? '—'],
          ['Different visitors today', summary?.uniqueVisitorsToday ?? '—'],
          ['Visits in last 30 days', summary?.periodVisits ?? '—'],
          ['Different visitors · 30 days', summary?.periodUniqueVisitors ?? '—'],
        ].map(([label, value]) => <article key={label} className="rounded-2xl border border-[#e9ede7] bg-white p-4"><p className="text-[10px] font-semibold text-[#7c887f]">{label}</p><p className="mt-2 text-2xl font-bold">{typeof value === 'number' ? value.toLocaleString() : value}</p></article>)}
      </section>
      <section className="mb-5 rounded-2xl border border-[#e9ede7] bg-white p-5">
        <div className="mb-4"><h3 className="text-sm font-bold">Check in a library visitor</h3><p className="mt-1 text-[10px] text-[#929d94]">This records attendance and reading activity only; it does not check a book out.</p></div>
        <form className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[1.3fr_1.3fr_1fr_auto]" onSubmit={onRecord}>
          <Field label="Student or teacher">
            <input required list="attendance-members" autoComplete="off" placeholder="Search student or teacher…" value={form.memberSearch} onChange={(event) => updateSearch('memberSearch', memberOptions, event.target.value)} />
            <datalist id="attendance-members">{visibleMembers.map((member) => <option key={member.id} value={member.label} />)}</datalist>
            {form.memberId && <span className="mt-1 block text-[9px] text-[#587461]">Visitor selected</span>}
          </Field>
          <Field label="Book being read (optional)">
            <input list="attendance-books" autoComplete="off" placeholder="Search book title, ISBN, author…" value={form.bookSearch} onChange={(event) => updateSearch('bookSearch', bookOptions, event.target.value)} />
            <datalist id="attendance-books">{visibleBooks.map((book) => <option key={book.id} value={book.label} />)}</datalist>
            <span className="mt-1 block text-[9px] text-[#929d94]">{form.bookId ? 'Book selected' : 'Optional — leave blank if needed'}</span>
          </Field>
          <Field label="Visit date"><input required type="date" max={today()} value={date} onChange={(event) => setDate(event.target.value)} /></Field>
          <ActionButton type="submit" disabled={busy} icon={ClipboardCheck}>{busy ? 'Recording…' : 'Record visit'}</ActionButton>
        </form>
      </section>
      <section className="mb-5 grid gap-5 xl:grid-cols-[1.35fr_1fr]">
        <article className="overflow-hidden rounded-2xl border border-[#e9ede7] bg-white">
          <div className="border-b border-[#edf0eb] px-5 py-4"><h3 className="text-sm font-bold">Most frequent library users</h3><p className="mt-1 text-[10px] text-[#929d94]">Ranked by visits during the last 30 days.</p></div>
          {summary?.frequentUsers?.length ? <div className="divide-y divide-[#f0f2ee]">
            {summary.frequentUsers.map((member, index) => <div key={member.memberId} className="flex items-center gap-3 px-5 py-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#edf4ed] text-[11px] font-bold text-[#52745b]">{index + 1}</span>
              <div className="min-w-0 flex-1"><p className="truncate text-[11px] font-bold">{member.name}</p><p className="mt-1 text-[9px] text-[#8c978f]">{member.memberType}{member.classSection ? ` · ${member.classSection}` : ''} · visited {member.daysVisited} days · last {member.lastVisit}</p></div>
              <span className="rounded-full bg-[#f3f6f1] px-2.5 py-1 text-[10px] font-bold text-[#587461]">{member.visitCount} visits</span>
            </div>)}
          </div> : <p className="px-5 py-10 text-center text-[11px] text-[#829087]">No visits recorded in the last 30 days yet.</p>}
        </article>
        <article className="overflow-hidden rounded-2xl border border-[#e9ede7] bg-white">
          <div className="border-b border-[#edf0eb] px-5 py-4"><h3 className="text-sm font-bold">Books being read</h3><p className="mt-1 text-[10px] text-[#929d94]">Most frequently recorded in the last 30 days.</p></div>
          {summary?.popularBooks?.length ? <div className="divide-y divide-[#f0f2ee]">
            {summary.popularBooks.map((book, index) => <div key={book.bookId} className="flex items-center gap-3 px-5 py-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-[#f3f6f1] text-[#69846d]"><BookOpen size={15} /></div>
              <div className="min-w-0 flex-1"><p className="truncate text-[11px] font-bold">{book.title}</p><p className="mt-1 text-[9px] text-[#8c978f]">Reading record #{index + 1}</p></div>
              <span className="text-[10px] font-bold text-[#587461]">{book.readingCount} visits</span>
            </div>)}
          </div> : <p className="px-5 py-10 text-center text-[11px] text-[#829087]">Record a book with a visit to see reading trends.</p>}
        </article>
      </section>
      <section className="overflow-hidden rounded-2xl border border-[#e9ede7] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#edf0eb] px-5 py-4">
          <div><h3 className="text-sm font-bold">Visit register</h3><p className="mt-1 text-[10px] text-[#929d94]">{date} · {filteredVisits.length}{attendanceSearch.trim() ? ` of ${visits.length}` : ''} {filteredVisits.length === 1 ? 'visit' : 'visits'}</p></div>
          <div className="flex flex-wrap items-center gap-2">
            <SearchBox value={attendanceSearch} onChange={setAttendanceSearch} placeholder="Search names or books…" />
            <button onClick={onExport} className="flex items-center gap-1.5 rounded-lg border border-[#e8ece6] px-3 py-2 text-[10px] font-bold text-[#607667] hover:bg-[#f7f8f5]"><Download size={13} /> Download this day</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead><tr className="border-b border-[#edf0eb] bg-[#fbfcfa] text-[9px] font-bold uppercase tracking-[.12em] text-[#929d94]"><th className="px-5 py-3">Time</th><th className="px-4 py-3">Visitor</th><th className="px-4 py-3">Type / class</th><th className="px-4 py-3">Membership no.</th><th className="px-5 py-3">Reading</th></tr></thead>
            <tbody className="divide-y divide-[#f0f2ee]">
              {filteredVisits.map((visit) => <tr key={visit.id}><td className="px-5 py-3 text-[10px] text-[#748078]">{visit.visitTime}</td><td className="px-4 py-3 text-[11px] font-bold">{visit.memberName}</td><td className="px-4 py-3 text-[10px] text-[#748078]">{visit.memberType}{visit.classSection ? ` · ${visit.classSection}` : ''}</td><td className="px-4 py-3 text-[10px] text-[#748078]">{visit.membershipNumber}</td><td className="px-5 py-3 text-[10px] text-[#748078]">{visit.bookTitle || 'Not recorded'}</td></tr>)}
              {filteredVisits.length === 0 && <EmptyRow colSpan={5} message={visits.length === 0 ? 'No visits recorded for this date. Check in the next visitor above.' : 'No visits match this name or book search.'} />}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

function Loans({ loans, search, setSearch, filter, setFilter, onIssue, onReturn, onMissed, reminders, onOpenReminders, smsReminders, onOpenSmsReminders, activeBorrowers, onOpenBorrowerMessages, busy }) {
  return (
    <>
      <PageHeading eyebrow="Every story has a return date" title="Loans & returns" description="Keep track of books finding their way back home.">
        <ActionButton secondary icon={UsersRound} onClick={onOpenBorrowerMessages}>Message borrowers ({activeBorrowers.length})</ActionButton>
        <ActionButton secondary icon={MessageCircle} onClick={onOpenReminders}>WhatsApp reminders ({reminders.length})</ActionButton>
        <ActionButton secondary icon={MessageSquareText} onClick={onOpenSmsReminders}>SMS due tomorrow ({smsReminders.length})</ActionButton>
        <ActionButton onClick={onIssue}>Check out a book</ActionButton>
      </PageHeading>
      <section className="overflow-hidden rounded-2xl border border-[#e9ede7] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#edf0eb] px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 rounded-xl bg-[#f5f7f3] p-1">
              {['All', 'Active', 'Overdue', 'Missed', 'Returned'].map((status) => <button key={status} onClick={() => setFilter(status)} className={`rounded-lg px-3 py-1.5 text-[10px] font-bold transition ${filter === status ? 'bg-white text-[#415b48] shadow-sm' : 'text-[#8a958c] hover:text-[#46584b]'}`}>{status}</button>)}
            </div>
            <SearchBox value={search} onChange={setSearch} placeholder="Search members or books…" />
          </div>
          <span className="text-[10px] text-[#929d94]">{loans.length} {loans.length === 1 ? 'record' : 'records'}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] text-left">
            <thead><tr className="border-b border-[#edf0eb] bg-[#fbfcfa] text-[9px] font-bold uppercase tracking-[.12em] text-[#929d94]"><th className="px-5 py-3.5">Book</th><th className="px-4 py-3.5">Member</th><th className="px-4 py-3.5">Checked out</th><th className="px-4 py-3.5">Due date</th><th className="px-4 py-3.5">Status & copies</th><th className="px-5 py-3.5 text-right">Action</th></tr></thead>
            <tbody className="divide-y divide-[#f0f2ee]">
              {loans.map((loan, index) => {
                const active = Number(loan.outstandingQuantity) > 0
                const statusClass = loan.status === 'Returned'
                  ? 'bg-[#f1f2ef] text-[#858f87]'
                  : loan.status === 'Missed'
                    ? 'bg-[#f8e8e4] text-[#a34d37]'
                    : loan.status === 'Overdue'
                      ? 'bg-[#f9eee9] text-[#b46d53]'
                      : 'bg-[#edf4ed] text-[#64846b]'
                return <tr key={loan.id} className="transition hover:bg-[#fcfdfa]"><td className="px-5 py-4"><div className="flex items-center gap-3"><BookCover index={index} /><div><p className="text-[11px] font-bold">{loan.bookTitle}</p><p className="mt-1 text-[9px] text-[#929d94]">ISBN {loan.isbn || 'not recorded'} · Copy {loan.copyCode || 'not recorded'}</p></div></div></td><td className="px-4 py-4"><p className="text-[10px] font-semibold">{loan.memberName}</p><p className="mt-1 text-[9px] text-[#929d94]">{loan.membershipNumber}</p></td><td className="px-4 py-4 text-[10px] text-[#748078]">{loan.issuedAt}</td><td className="px-4 py-4 text-[10px] text-[#748078]">{loan.dueDate}</td><td className="px-4 py-4"><span className={`rounded-full px-2.5 py-1 text-[9px] font-bold ${statusClass}`}>{loan.status}</span><p className="mt-1.5 whitespace-nowrap text-[9px] text-[#929d94]">{loan.outstandingQuantity} out · {loan.returnedQuantity} returned · {loan.missedQuantity} missed</p></td><td className="space-x-1 px-5 py-4 text-right">{active && <><button disabled={busy} onClick={() => onMissed(loan)} className="rounded-lg bg-[#f8e8e4] px-3 py-2 text-[10px] font-bold text-[#a34d37] hover:bg-[#f2d9d2] disabled:opacity-50">Mark missed</button><button disabled={busy} onClick={() => onReturn(loan)} className="rounded-lg bg-[#edf4ed] px-3 py-2 text-[10px] font-bold text-[#52745b] hover:bg-[#e3eee4] disabled:opacity-50">Mark returned</button></>}{!active && <span className="text-[10px] text-[#a0aaa2]">{loan.status === 'Missed' ? 'Marked missed' : <>All done <Check className="ml-1 inline" size={12} /></>}</span>}</td></tr>
              })}
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
