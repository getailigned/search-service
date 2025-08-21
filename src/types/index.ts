// Search service types
export interface SearchDocument {
  id: string
  type: 'work_item' | 'user' | 'project' | 'template'
  tenantId: string
  title: string
  content: string
  tags: string[]
  metadata: Record<string, any>
  createdAt: string
  updatedAt: string
  createdBy: string
  permissions: string[]
}

export interface WorkItemDocument extends SearchDocument {
  type: 'work_item'
  workItemType: 'objective' | 'strategy' | 'initiative' | 'task' | 'subtask'
  status: string
  priority: string
  assignedTo?: string
  parentId?: string
  dueDate?: string
  progress?: number
  dependencies: string[]
  lineage: string[]
}

export interface SearchQuery {
  query: string
  filters?: {
    type?: string[]
    workItemType?: string[]
    status?: string[]
    priority?: string[]
    assignedTo?: string[]
    tags?: string[]
    dateRange?: {
      field: string
      from?: string
      to?: string
    }
  }
  sort?: {
    field: string
    order: 'asc' | 'desc'
  }[]
  pagination?: {
    from: number
    size: number
  }
  tenantId: string
  userId: string
  userRole: string
}

export interface SearchResult {
  documents: SearchDocument[]
  total: number
  aggregations?: Record<string, any>
  suggestions?: string[]
  executionTime: number
}

export interface IndexStats {
  name: string
  documentCount: number
  size: string
  health: 'green' | 'yellow' | 'red'
  lastUpdated: string
}

export interface SearchSuggestion {
  text: string
  score: number
  type: 'completion' | 'correction' | 'expansion'
}
