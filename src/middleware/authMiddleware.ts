import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { logger } from '../services/loggerService'

interface JWTPayload {
  userId: string
  email: string
  name: string
  role: string
  tenantId: string
  iat?: number
  exp?: number
}

declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload
    }
  }
}

export const authMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  try {
    const authHeader = req.headers.authorization
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        error: 'Authorization header required'
      })
      return
    }

    const token = authHeader.substring(7) // Remove 'Bearer ' prefix
    const jwtSecret = process.env.JWT_SECRET || 'htma-search-secret-key'

    try {
      const payload = jwt.verify(token, jwtSecret) as JWTPayload
      
      // Add user info to request
      req.user = payload
      
      logger.debug('User authenticated', {
        userId: payload.userId,
        role: payload.role,
        tenantId: payload.tenantId
      })

      next()
    } catch (jwtError) {
      logger.warn('Invalid JWT token', {
        error: jwtError instanceof Error ? jwtError.message : 'Unknown error'
      })

      res.status(401).json({
        success: false,
        error: 'Invalid or expired token'
      })
    }

  } catch (error) {
    logger.error('Authentication middleware error', {
      error: error instanceof Error ? error.message : 'Unknown error'
    })

    res.status(500).json({
      success: false,
      error: 'Authentication error'
    })
  }
}

export const requireRole = (allowedRoles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user

    if (!user) {
      res.status(401).json({
        success: false,
        error: 'Authentication required'
      })
      return
    }

    if (!allowedRoles.includes(user.role)) {
      logger.warn('Insufficient permissions', {
        userId: user.userId,
        userRole: user.role,
        requiredRoles: allowedRoles
      })

      res.status(403).json({
        success: false,
        error: 'Insufficient permissions'
      })
      return
    }

    next()
  }
}

export const requireSameTenant = (req: Request, res: Response, next: NextFunction): void => {
  const user = req.user
  const { tenantId } = req.params

  if (!user) {
    res.status(401).json({
      success: false,
      error: 'Authentication required'
    })
    return
  }

  if (tenantId && user.tenantId !== tenantId) {
    logger.warn('Cross-tenant access attempt', {
      userId: user.userId,
      userTenant: user.tenantId,
      requestedTenant: tenantId
    })

    res.status(403).json({
      success: false,
      error: 'Access denied'
    })
    return
  }

  next()
}
