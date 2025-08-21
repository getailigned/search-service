import { Request, Response } from 'express'
import { ElasticsearchService } from '../services/elasticsearchService'
import { SearchQuery } from '../types'
import { logger } from '../services/loggerService'
import { z } from 'zod'

const SearchQuerySchema = z.object({
  query: z.string().optional().default(''),
  filters: z.object({
    type: z.array(z.string()).optional(),
    workItemType: z.array(z.string()).optional(),
    status: z.array(z.string()).optional(),
    priority: z.array(z.string()).optional(),
    assignedTo: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    dateRange: z.object({
      field: z.string(),
      from: z.string().optional(),
      to: z.string().optional()
    }).optional()
  }).optional(),
  sort: z.array(z.object({
    field: z.string(),
    order: z.enum(['asc', 'desc'])
  })).optional(),
  pagination: z.object({
    from: z.number().min(0).default(0),
    size: z.number().min(1).max(100).default(20)
  }).optional()
})

export class SearchController {
  constructor(private elasticsearchService: ElasticsearchService) {}

  /**
   * Perform search across all indexed content
   */
  search = async (req: Request, res: Response): Promise<void> => {
    try {
      const validatedQuery = SearchQuerySchema.parse(req.body)
      
      // Extract user info from JWT (set by auth middleware)
      const user = (req as any).user
      if (!user) {
        res.status(401).json({ error: 'Authentication required' })
        return
      }

      const searchQuery: SearchQuery = {
        ...validatedQuery,
        tenantId: user.tenantId,
        userId: user.userId,
        userRole: user.role
      }

      const results = await this.elasticsearchService.search(searchQuery)

      res.json({
        success: true,
        data: results
      })

      logger.info('Search completed', {
        userId: user.userId,
        query: searchQuery.query,
        results: results.documents.length,
        executionTime: results.executionTime
      })

    } catch (error) {
      logger.error('Search failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })

      if (error instanceof z.ZodError) {
        res.status(400).json({
          success: false,
          error: 'Invalid search parameters',
          details: error.errors
        })
      } else {
        res.status(500).json({
          success: false,
          error: 'Search failed'
        })
      }
    }
  }

  /**
   * Get search suggestions
   */
  suggest = async (req: Request, res: Response): Promise<void> => {
    try {
      const { q } = req.query
      const user = (req as any).user

      if (!user) {
        res.status(401).json({ error: 'Authentication required' })
        return
      }

      if (!q || typeof q !== 'string') {
        res.status(400).json({ error: 'Query parameter "q" is required' })
        return
      }

      const suggestions = await this.elasticsearchService.getSuggestions(q, user.tenantId)

      res.json({
        success: true,
        data: suggestions
      })

    } catch (error) {
      logger.error('Suggestions failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })

      res.status(500).json({
        success: false,
        error: 'Failed to get suggestions'
      })
    }
  }

  /**
   * Get index statistics
   */
  stats = async (req: Request, res: Response): Promise<void> => {
    try {
      const user = (req as any).user

      if (!user) {
        res.status(401).json({ error: 'Authentication required' })
        return
      }

      // Only allow admins to see stats
      if (!['admin', 'CEO', 'President'].includes(user.role)) {
        res.status(403).json({ error: 'Insufficient permissions' })
        return
      }

      const stats = await this.elasticsearchService.getIndexStats()

      res.json({
        success: true,
        data: stats
      })

    } catch (error) {
      logger.error('Stats retrieval failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })

      res.status(500).json({
        success: false,
        error: 'Failed to get statistics'
      })
    }
  }

  /**
   * Manual document indexing endpoint (for admin use)
   */
  indexDocument = async (req: Request, res: Response): Promise<void> => {
    try {
      const { indexName, document } = req.body
      const user = (req as any).user

      if (!user) {
        res.status(401).json({ error: 'Authentication required' })
        return
      }

      // Only allow admins to manually index
      if (!['admin', 'CEO', 'President'].includes(user.role)) {
        res.status(403).json({ error: 'Insufficient permissions' })
        return
      }

      if (!indexName || !document) {
        res.status(400).json({ error: 'indexName and document are required' })
        return
      }

      await this.elasticsearchService.indexDocument(indexName, document)

      res.json({
        success: true,
        message: 'Document indexed successfully'
      })

      logger.info('Manual document indexed', {
        userId: user.userId,
        indexName,
        documentId: document.id
      })

    } catch (error) {
      logger.error('Manual indexing failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })

      res.status(500).json({
        success: false,
        error: 'Indexing failed'
      })
    }
  }

  /**
   * Health check endpoint
   */
  health = async (req: Request, res: Response): Promise<void> => {
    try {
      const stats = await this.elasticsearchService.getIndexStats()
      
      res.json({
        status: 'healthy',
        service: 'search-service',
        timestamp: new Date().toISOString(),
        elasticsearch: {
          connected: true,
          indices: stats.length
        }
      })

    } catch (error) {
      logger.error('Health check failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })

      res.status(503).json({
        status: 'unhealthy',
        service: 'search-service',
        timestamp: new Date().toISOString(),
        elasticsearch: {
          connected: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      })
    }
  }
}
