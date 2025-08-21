import { Client } from '@elastic/elasticsearch'
import { SearchDocument, WorkItemDocument, SearchQuery, SearchResult, IndexStats } from '../types'
import { logger } from './loggerService'

export class ElasticsearchService {
  private client: Client
  private indexPrefix: string

  constructor() {
    const elasticsearchUrl = process.env.ELASTICSEARCH_URL || 'http://localhost:9200'
    this.indexPrefix = process.env.INDEX_PREFIX || 'htma'
    
    this.client = new Client({
      node: elasticsearchUrl,
      auth: process.env.ELASTICSEARCH_USERNAME && process.env.ELASTICSEARCH_PASSWORD ? {
        username: process.env.ELASTICSEARCH_USERNAME,
        password: process.env.ELASTICSEARCH_PASSWORD
      } : undefined
    })
  }

  async connect(): Promise<void> {
    try {
      const health = await this.client.cluster.health()
      logger.info('Elasticsearch connected', {
        cluster: health.cluster_name,
        status: health.status
      })

      await this.setupIndices()
    } catch (error) {
      logger.error('Elasticsearch connection failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw error
    }
  }

  async setupIndices(): Promise<void> {
    const indices = [
      {
        name: `${this.indexPrefix}_work_items`,
        mapping: this.getWorkItemMapping()
      },
      {
        name: `${this.indexPrefix}_users`,
        mapping: this.getUserMapping()
      },
      {
        name: `${this.indexPrefix}_templates`,
        mapping: this.getTemplateMapping()
      }
    ]

    for (const index of indices) {
      try {
        const exists = await this.client.indices.exists({ index: index.name })
        
        if (!exists) {
          await this.client.indices.create({
            index: index.name,
            body: {
              settings: {
                number_of_shards: 1,
                number_of_replicas: 0,
                analysis: {
                  analyzer: {
                    htma_text_analyzer: {
                      type: 'custom',
                      tokenizer: 'standard',
                      filter: ['lowercase', 'stop', 'snowball']
                    },
                    htma_search_analyzer: {
                      type: 'custom',
                      tokenizer: 'standard',
                      filter: ['lowercase', 'stop']
                    }
                  }
                }
              },
              mappings: index.mapping
            }
          })
          
          logger.info('Index created', { index: index.name })
        }
      } catch (error) {
        logger.error('Failed to setup index', {
          index: index.name,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }
  }

  private getWorkItemMapping() {
    return {
      properties: {
        id: { type: 'keyword' },
        type: { type: 'keyword' },
        tenantId: { type: 'keyword' },
        title: {
          type: 'text',
          analyzer: 'htma_text_analyzer',
          search_analyzer: 'htma_search_analyzer',
          fields: {
            keyword: { type: 'keyword' },
            suggest: {
              type: 'completion',
              analyzer: 'simple'
            }
          }
        },
        content: {
          type: 'text',
          analyzer: 'htma_text_analyzer',
          search_analyzer: 'htma_search_analyzer'
        },
        workItemType: { type: 'keyword' },
        status: { type: 'keyword' },
        priority: { type: 'keyword' },
        assignedTo: { type: 'keyword' },
        parentId: { type: 'keyword' },
        tags: { type: 'keyword' },
        dependencies: { type: 'keyword' },
        lineage: { type: 'keyword' },
        permissions: { type: 'keyword' },
        progress: { type: 'integer' },
        createdAt: { type: 'date' },
        updatedAt: { type: 'date' },
        dueDate: { type: 'date' },
        createdBy: { type: 'keyword' },
        metadata: {
          type: 'object',
          dynamic: true
        }
      }
    }
  }

  private getUserMapping() {
    return {
      properties: {
        id: { type: 'keyword' },
        type: { type: 'keyword' },
        tenantId: { type: 'keyword' },
        title: {
          type: 'text',
          analyzer: 'htma_text_analyzer',
          fields: {
            keyword: { type: 'keyword' },
            suggest: { type: 'completion' }
          }
        },
        content: { type: 'text', analyzer: 'htma_text_analyzer' },
        email: { type: 'keyword' },
        role: { type: 'keyword' },
        department: { type: 'keyword' },
        tags: { type: 'keyword' },
        permissions: { type: 'keyword' },
        createdAt: { type: 'date' },
        updatedAt: { type: 'date' },
        metadata: { type: 'object', dynamic: true }
      }
    }
  }

  private getTemplateMapping() {
    return {
      properties: {
        id: { type: 'keyword' },
        type: { type: 'keyword' },
        tenantId: { type: 'keyword' },
        title: {
          type: 'text',
          analyzer: 'htma_text_analyzer',
          fields: {
            keyword: { type: 'keyword' },
            suggest: { type: 'completion' }
          }
        },
        content: { type: 'text', analyzer: 'htma_text_analyzer' },
        category: { type: 'keyword' },
        industry: { type: 'keyword' },
        complexity: { type: 'keyword' },
        tags: { type: 'keyword' },
        permissions: { type: 'keyword' },
        isPublic: { type: 'boolean' },
        usageCount: { type: 'integer' },
        createdAt: { type: 'date' },
        updatedAt: { type: 'date' },
        createdBy: { type: 'keyword' },
        metadata: { type: 'object', dynamic: true }
      }
    }
  }

  async indexDocument(indexName: string, document: SearchDocument): Promise<void> {
    try {
      const fullIndexName = `${this.indexPrefix}_${indexName}`
      
      await this.client.index({
        index: fullIndexName,
        id: document.id,
        body: document,
        refresh: 'wait_for'
      })

      logger.debug('Document indexed', {
        index: fullIndexName,
        id: document.id,
        type: document.type
      })
    } catch (error) {
      logger.error('Failed to index document', {
        index: indexName,
        documentId: document.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw error
    }
  }

  async updateDocument(indexName: string, documentId: string, updates: Partial<SearchDocument>): Promise<void> {
    try {
      const fullIndexName = `${this.indexPrefix}_${indexName}`
      
      await this.client.update({
        index: fullIndexName,
        id: documentId,
        body: {
          doc: {
            ...updates,
            updatedAt: new Date().toISOString()
          }
        },
        refresh: 'wait_for'
      })

      logger.debug('Document updated', {
        index: fullIndexName,
        id: documentId
      })
    } catch (error) {
      logger.error('Failed to update document', {
        index: indexName,
        documentId,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw error
    }
  }

  async deleteDocument(indexName: string, documentId: string): Promise<void> {
    try {
      const fullIndexName = `${this.indexPrefix}_${indexName}`
      
      await this.client.delete({
        index: fullIndexName,
        id: documentId,
        refresh: 'wait_for'
      })

      logger.debug('Document deleted', {
        index: fullIndexName,
        id: documentId
      })
    } catch (error) {
      logger.error('Failed to delete document', {
        index: indexName,
        documentId,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw error
    }
  }

  async search(query: SearchQuery): Promise<SearchResult> {
    const startTime = Date.now()
    
    try {
      const searchBody = this.buildSearchQuery(query)
      const indices = this.getSearchIndices(query.filters?.type)
      
      const response = await this.client.search({
        index: indices,
        body: searchBody
      })

      const documents = response.hits.hits.map((hit: any) => ({
        ...hit._source,
        _score: hit._score,
        _highlights: hit.highlight
      }))

      const result: SearchResult = {
        documents,
        total: typeof response.hits.total === 'number' 
          ? response.hits.total 
          : response.hits.total?.value || 0,
        aggregations: response.aggregations,
        executionTime: Date.now() - startTime
      }

      logger.debug('Search completed', {
        query: query.query,
        results: documents.length,
        total: result.total,
        executionTime: result.executionTime
      })

      return result
    } catch (error) {
      logger.error('Search failed', {
        query: query.query,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw error
    }
  }

  private buildSearchQuery(query: SearchQuery) {
    const mustClauses: any[] = []
    const filterClauses: any[] = []

    // Tenant isolation
    filterClauses.push({ term: { tenantId: query.tenantId } })

    // Main query
    if (query.query && query.query.trim()) {
      mustClauses.push({
        multi_match: {
          query: query.query,
          fields: ['title^3', 'content^2', 'tags^1.5'],
          type: 'best_fields',
          fuzziness: 'AUTO'
        }
      })
    } else {
      mustClauses.push({ match_all: {} })
    }

    // Filters
    if (query.filters) {
      const { filters } = query

      if (filters.type && filters.type.length > 0) {
        filterClauses.push({ terms: { type: filters.type } })
      }

      if (filters.workItemType && filters.workItemType.length > 0) {
        filterClauses.push({ terms: { workItemType: filters.workItemType } })
      }

      if (filters.status && filters.status.length > 0) {
        filterClauses.push({ terms: { status: filters.status } })
      }

      if (filters.priority && filters.priority.length > 0) {
        filterClauses.push({ terms: { priority: filters.priority } })
      }

      if (filters.assignedTo && filters.assignedTo.length > 0) {
        filterClauses.push({ terms: { assignedTo: filters.assignedTo } })
      }

      if (filters.tags && filters.tags.length > 0) {
        filterClauses.push({ terms: { tags: filters.tags } })
      }

      if (filters.dateRange) {
        const dateFilter: any = { range: {} }
        dateFilter.range[filters.dateRange.field] = {}
        
        if (filters.dateRange.from) {
          dateFilter.range[filters.dateRange.field].gte = filters.dateRange.from
        }
        if (filters.dateRange.to) {
          dateFilter.range[filters.dateRange.field].lte = filters.dateRange.to
        }
        
        filterClauses.push(dateFilter)
      }
    }

    // Build the main query
    const searchBody: any = {
      query: {
        bool: {
          must: mustClauses,
          filter: filterClauses
        }
      },
      highlight: {
        fields: {
          title: {},
          content: {}
        }
      },
      aggregations: {
        types: { terms: { field: 'type' } },
        statuses: { terms: { field: 'status' } },
        priorities: { terms: { field: 'priority' } }
      }
    }

    // Sorting
    if (query.sort && query.sort.length > 0) {
      searchBody.sort = query.sort.map(s => ({
        [s.field]: { order: s.order }
      }))
    } else {
      searchBody.sort = [{ _score: { order: 'desc' } }, { updatedAt: { order: 'desc' } }]
    }

    // Pagination
    if (query.pagination) {
      searchBody.from = query.pagination.from
      searchBody.size = query.pagination.size
    } else {
      searchBody.size = 20
    }

    return searchBody
  }

  private getSearchIndices(types?: string[]): string[] {
    const allIndices = ['work_items', 'users', 'templates']
    
    if (!types || types.length === 0) {
      return allIndices.map(index => `${this.indexPrefix}_${index}`)
    }

    const indices: string[] = []
    if (types.includes('work_item')) indices.push(`${this.indexPrefix}_work_items`)
    if (types.includes('user')) indices.push(`${this.indexPrefix}_users`)
    if (types.includes('template')) indices.push(`${this.indexPrefix}_templates`)

    return indices.length > 0 ? indices : allIndices.map(index => `${this.indexPrefix}_${index}`)
  }

  async getSuggestions(query: string, tenantId: string): Promise<string[]> {
    try {
      const response = await this.client.search({
        index: `${this.indexPrefix}_*`,
        body: {
          suggest: {
            title_suggest: {
              prefix: query,
              completion: {
                field: 'title.suggest',
                size: 10
              }
            }
          },
          query: {
            bool: {
              filter: [{ term: { tenantId } }]
            }
          },
          size: 0
        }
      })

      const suggestions = response.suggest?.title_suggest?.[0]?.options || []
      return suggestions.map((s: any) => s.text)
    } catch (error) {
      logger.error('Failed to get suggestions', {
        query,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      return []
    }
  }

  async getIndexStats(): Promise<IndexStats[]> {
    try {
      const indices = await this.client.cat.indices({
        index: `${this.indexPrefix}_*`,
        format: 'json'
      })

      return indices.map((index: any) => ({
        name: index.index,
        documentCount: parseInt(index['docs.count'] || '0'),
        size: index['store.size'] || '0b',
        health: index.health as 'green' | 'yellow' | 'red',
        lastUpdated: new Date().toISOString()
      }))
    } catch (error) {
      logger.error('Failed to get index stats', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      return []
    }
  }

  async reindexWorkItem(workItem: any): Promise<void> {
    const document: WorkItemDocument = {
      id: workItem.id,
      type: 'work_item',
      tenantId: workItem.tenant_id,
      title: workItem.title,
      content: workItem.description || '',
      workItemType: workItem.type,
      status: workItem.status,
      priority: workItem.priority,
      assignedTo: workItem.assigned_to,
      parentId: workItem.parent_id,
      tags: workItem.tags || [],
      dependencies: workItem.dependencies || [],
      lineage: workItem.lineage || [],
      progress: workItem.progress,
      createdAt: workItem.created_at,
      updatedAt: workItem.updated_at,
      dueDate: workItem.due_date,
      createdBy: workItem.created_by,
      permissions: this.calculatePermissions(workItem),
      metadata: {
        estimatedHours: workItem.estimated_hours,
        actualHours: workItem.actual_hours,
        completionDate: workItem.completion_date
      }
    }

    await this.indexDocument('work_items', document)
  }

  private calculatePermissions(workItem: any): string[] {
    const permissions = [`tenant:${workItem.tenant_id}`]
    
    if (workItem.assigned_to) {
      permissions.push(`user:${workItem.assigned_to}`)
    }
    
    if (workItem.created_by) {
      permissions.push(`user:${workItem.created_by}`)
    }

    // Add role-based permissions
    permissions.push('role:CEO', 'role:President', 'role:VP', 'role:Director', 'role:Manager')

    return permissions
  }
}
