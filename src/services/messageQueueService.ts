import amqp, { Connection, Channel, Message } from 'amqplib'
import { ElasticsearchService } from './elasticsearchService'
import { logger } from './loggerService'

export class MessageQueueService {
  private connection: Connection | null = null
  private channel: Channel | null = null
  private elasticsearchService: ElasticsearchService

  constructor(elasticsearchService: ElasticsearchService) {
    this.elasticsearchService = elasticsearchService
  }

  async connect(): Promise<void> {
    try {
      const rabbitUrl = process.env.RABBITMQ_URL || 'amqp://localhost:5672'
      this.connection = await amqp.connect(rabbitUrl)
      this.channel = await this.connection.createChannel()

      // Setup error handling
      this.connection.on('error', (error) => {
        logger.error('RabbitMQ connection error', { error: error.message })
      })

      this.connection.on('close', () => {
        logger.warn('RabbitMQ connection closed')
      })

      await this.setupQueues()
      await this.setupConsumers()

      logger.info('Search service message queue connected')
    } catch (error) {
      logger.error('Failed to connect to message queue', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw error
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.channel) {
        await this.channel.close()
      }
      if (this.connection) {
        await this.connection.close()
      }
      logger.info('Search service message queue disconnected')
    } catch (error) {
      logger.error('Failed to disconnect from message queue', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }

  private async setupQueues(): Promise<void> {
    if (!this.channel) return

    // Setup exchanges
    await this.channel.assertExchange('htma.events', 'topic', { durable: true })

    // Setup queues for search service
    await this.channel.assertQueue('search.work_items', { durable: true })
    await this.channel.assertQueue('search.users', { durable: true })
    await this.channel.assertQueue('search.reindex', { durable: true })

    // Bind queues to exchanges
    await this.channel.bindQueue('search.work_items', 'htma.events', 'work_item.*')
    await this.channel.bindQueue('search.users', 'htma.events', 'user.*')
    await this.channel.bindQueue('search.reindex', 'htma.events', 'search.reindex.*')

    logger.info('Search service queues setup complete')
  }

  private async setupConsumers(): Promise<void> {
    if (!this.channel) return

    // Consume work item events for indexing
    await this.channel.consume('search.work_items', async (msg) => {
      if (msg) {
        await this.handleWorkItemEvent(msg)
        this.channel!.ack(msg)
      }
    })

    // Consume user events for indexing
    await this.channel.consume('search.users', async (msg) => {
      if (msg) {
        await this.handleUserEvent(msg)
        this.channel!.ack(msg)
      }
    })

    // Consume reindex requests
    await this.channel.consume('search.reindex', async (msg) => {
      if (msg) {
        await this.handleReindexRequest(msg)
        this.channel!.ack(msg)
      }
    })

    logger.info('Search service consumers setup complete')
  }

  private async handleWorkItemEvent(msg: Message): Promise<void> {
    try {
      const eventData = JSON.parse(msg.content.toString())
      const routingKey = msg.fields.routingKey

      switch (routingKey) {
        case 'work_item.created':
        case 'work_item.updated':
          await this.elasticsearchService.reindexWorkItem(eventData.workItem)
          logger.info('Work item indexed', {
            workItemId: eventData.workItem.id,
            event: routingKey
          })
          break

        case 'work_item.deleted':
          await this.elasticsearchService.deleteDocument('work_items', eventData.workItemId)
          logger.info('Work item removed from index', {
            workItemId: eventData.workItemId
          })
          break

        case 'work_item.status_changed':
          await this.elasticsearchService.updateDocument('work_items', eventData.workItemId, {
            status: eventData.newStatus,
            updatedAt: new Date().toISOString()
          })
          logger.info('Work item status updated in index', {
            workItemId: eventData.workItemId,
            newStatus: eventData.newStatus
          })
          break
      }
    } catch (error) {
      logger.error('Failed to handle work item event', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }

  private async handleUserEvent(msg: Message): Promise<void> {
    try {
      const eventData = JSON.parse(msg.content.toString())
      const routingKey = msg.fields.routingKey

      switch (routingKey) {
        case 'user.created':
        case 'user.updated':
          const userDocument = {
            id: eventData.user.id,
            type: 'user' as const,
            tenantId: eventData.user.tenant_id,
            title: eventData.user.name,
            content: `${eventData.user.name} ${eventData.user.email} ${eventData.user.role}`,
            email: eventData.user.email,
            role: eventData.user.role,
            department: eventData.user.department,
            tags: eventData.user.tags || [],
            permissions: [`tenant:${eventData.user.tenant_id}`, `user:${eventData.user.id}`],
            createdAt: eventData.user.created_at,
            updatedAt: eventData.user.updated_at || new Date().toISOString(),
            createdBy: eventData.user.created_by || 'system',
            metadata: {
              lastLogin: eventData.user.last_login,
              isActive: eventData.user.is_active
            }
          }

          await this.elasticsearchService.indexDocument('users', userDocument)
          logger.info('User indexed', {
            userId: eventData.user.id,
            event: routingKey
          })
          break

        case 'user.deleted':
          await this.elasticsearchService.deleteDocument('users', eventData.userId)
          logger.info('User removed from index', {
            userId: eventData.userId
          })
          break
      }
    } catch (error) {
      logger.error('Failed to handle user event', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }

  private async handleReindexRequest(msg: Message): Promise<void> {
    try {
      const requestData = JSON.parse(msg.content.toString())
      const routingKey = msg.fields.routingKey

      switch (routingKey) {
        case 'search.reindex.all':
          logger.info('Starting full reindex')
          // In a real implementation, this would trigger a full reindex
          // For now, just log the request
          break

        case 'search.reindex.tenant':
          logger.info('Starting tenant reindex', { tenantId: requestData.tenantId })
          // Implement tenant-specific reindex
          break

        case 'search.reindex.type':
          logger.info('Starting type reindex', { type: requestData.type })
          // Implement type-specific reindex
          break
      }
    } catch (error) {
      logger.error('Failed to handle reindex request', {
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }
}
