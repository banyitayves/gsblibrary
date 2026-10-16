import jwt from 'jsonwebtoken'
import { config, requireJwtSecret } from './config.js'

export function authenticate(req, res, next) {
  const authorization = req.get('authorization')
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null
  if (!token) {
    return res.status(401).json({ error: 'Sign in to continue.' })
  }

  try {
    requireJwtSecret()
    req.user = jwt.verify(token, config.jwtSecret)
    return next()
  } catch {
    return res.status(401).json({ error: 'Your session has expired. Please sign in again.' })
  }
}

export function allowRoles(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({ error: 'You do not have permission to perform this action.' })
    }
    return next()
  }
}
