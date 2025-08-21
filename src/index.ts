import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import dotenv from 'dotenv'

import { ElasticsearchService } from './services/elasticsearchService'
import { MessageQueueService } from './services/messageQueueService'
import { SearchController } from './controllers/searchController'
import { authMiddleware, requireRole } from './middleware/authMiddleware'
import { logger } from './services/loggerService'

// Load environment variables
dotenv.config()

class SearchServiceApp {
  private app: express.Application
  private elasticsearchService: ElasticsearchService
  private messageQueueService: MessageQueueService
  private searchController: SearchController
  private port: number

  constructor() {
    this.port = parseInt(process.env.PORT || '3006')
    this.app = express()

    // Initialize services
    this.elasticsearchService = new ElasticsearchService()
    this.messageQueueService = new MessageQueueService(this.elasticsearchService)
    this.searchController = new SearchController(this.elasticsearchService)

    this.setupMiddleware()
    this.setupRoutes()
  }

  private setupMiddleware(): void {
    this.app.use(helmet())
    this.app.use(cors({
      origin: process.env.CORS_ORIGIN || "http://localhost:3000",
      credentials: true
    }))
    this.app.use(express.json({ limit: '10mb' }))
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }))

    // Request logging
    this.app.use((req, res, next) => {
      logger.info(`${req.method} ${req.path}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent')
      })
      next()
    })
  }

  private setupRoutes(): void {
    // Public health check
    this.app.get('/health', this.searchController.health)

    // API routes with authentication
    const apiRouter = express.Router()
    
    // Apply authentication to all API routes
    apiRouter.use(authMiddleware)

    // Search endpoints
    apiRouter.post('/search', this.searchController.search)
    apiRouter.get('/suggest', this.searchController.suggest)
    
    // Admin endpoints
    apiRouter.get('/stats', requireRole(['admin', 'CEO', 'President']), this.searchController.stats)
    apiRouter.post('/index', requireRole(['admin', 'CEO', 'President']), this.searchController.indexDocument)

    // Mount API router
    this.app.use('/api', apiRouter)

    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({
        success: false,
        error: 'Endpoint not found'
      })
    })

    // Error handler
    this.app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      logger.error('Unhandled error', {
        error: error.message,
        stack: error.stack,
        path: req.path,
        method: req.method
      })

      res.status(500).json({
        success: false,
        error: 'Internal server error'
      })
    })
  }

  async start(): Promise<void> {
    try {
      // Connect to Elasticsearch
      await this.elasticsearchService.connect()

      // Connect to message queue
      await this.messageQueueService.connect()

      // Start HTTP server
      this.app.listen(this.port, () => {
        logger.info(`Search service started on port ${this.port}`)
      })

      // Setup graceful shutdown
      this.setupGracefulShutdown()

    } catch (error) {
      logger.error('Failed to start search service', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      process.exit(1)
    }
  }

  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down gracefully`)
      
      try {
        // Close message queue connection
        await this.messageQueueService.disconnect()
        
        logger.info('Search service shut down')
        process.exit(0)
      } catch (error) {
        logger.error('Error during shutdown', {
          error: error instanceof Error ? error.message : 'Unknown error'
        })
        process.exit(1)
      }
    }

    process.on('SIGTERM', () => shutdown('SIGTERM'))
    process.on('SIGINT', () => shutdown('SIGINT'))
  }
}

// Start the service
const service = new SearchServiceApp()
service.start().catch((error) => {
  logger.error('Failed to start service', {
    error: error instanceof Error ? error.message : 'Unknown error'
  })
  process.exit(1)
})
