import {
  AIEngine,
  chatCompletion,
  chatCompletionChunk,
  chatCompletionRequest,
  modelInfo,
  SessionInfo,
  UnloadResult,
} from '@janhq/core'
import { useModelProvider } from '@/hooks/useModelProvider'
import { ChatCompletionMessageToolCall } from 'openai/resources'
import { ulid } from 'ulidx'
import { getServiceHub } from '@/hooks/useServiceHub'

type ToolCallResult =
  | string
  | {
      content?: string | Array<string | { text?: string } | Record<string, unknown>>
      error?: string
      [key: string]: unknown
    }

type AgentMapping = { type: 'team' | 'agent'; id: string }

/**
 * Agno Agent Engine wired to new Supabase proxy backend.
 */
export class AgnoAgentEngine extends AIEngine {
  readonly provider = 'gamewave-agent'

  private baseUrl: string
  private apiKey?: string
  private loadedModels = new Set<string>()
  private sessionMap = new Map<string, string>()
  private runMap = new Map<string, string>()
  private agentMap = new Map<string, AgentMapping>()
  private processedToolCalls = new Set<string>()
  private pendingToolMetadata = new Map<
    string,
    Array<{
      tool_call_id: string
      tool_name: string
      tool_args: Record<string, unknown>
    }>
  >()
  private continuationChunkQueues = new Map<string, chatCompletionChunk[]>()

  constructor(baseUrl: string, apiKey?: string) {
    super('gamewave-agent', '1.0.0')
    this.baseUrl = baseUrl
    this.apiKey = apiKey
    console.log('AgnoAgentEngine initialized with baseUrl:', baseUrl)
  }

  updateConfig(baseUrl?: string, apiKey?: string) {
    if (typeof baseUrl === 'string' && baseUrl.trim()) {
      this.baseUrl = baseUrl
    }
    if (apiKey !== undefined) {
      this.apiKey = apiKey?.trim() ? apiKey : undefined
    }
  }

  private enqueueToolMetadata(
    sessionId: string,
    tool: {
      tool_call_id: string
      tool_name: string
      tool_args: Record<string, unknown>
    }
  ) {
    const queue = this.pendingToolMetadata.get(sessionId) ?? []
    queue.push(tool)
    this.pendingToolMetadata.set(sessionId, queue)
  }

  private dequeueToolMetadata(
    sessionId: string
  ): Array<{
    tool_call_id: string
    tool_name: string
    tool_args: Record<string, unknown>
  }> {
    const queue = this.pendingToolMetadata.get(sessionId) ?? []
    this.pendingToolMetadata.delete(sessionId)
    return queue
  }

  private enqueueContinuationChunk(
    sessionId: string,
    chunk: chatCompletionChunk
  ) {
    const queue = this.continuationChunkQueues.get(sessionId) ?? []
    queue.push(chunk)
    this.continuationChunkQueues.set(sessionId, queue)
  }

  private drainContinuationChunks(sessionId: string): chatCompletionChunk[] {
    const queue = this.continuationChunkQueues.get(sessionId)
    if (!queue || queue.length === 0) {
      return []
    }
    this.continuationChunkQueues.delete(sessionId)
    return queue
  }

  onUnload(): void {
    this.loadedModels.clear()
    this.sessionMap.clear()
    this.runMap.clear()
    this.agentMap.clear()
    this.processedToolCalls.clear()
    this.pendingToolMetadata.clear()
    this.continuationChunkQueues.clear()
  }

  async list(): Promise<modelInfo[]> {
    return [
      {
        id: 'Agent',
        name: 'GameWave Agent',
        description: 'Can perform actions in your unreal engine',
        capabilities: ['completion', 'tools'],
        version: '1.0',
        providerId: 'gamewave-agent',
        port: 0,
        sizeBytes: 0,
      },
      {
        id: 'Ask',
        name: 'GameWave Ask',
        description: 'Cannot perform actions in your unreal engine',
        capabilities: ['completion'],
        version: '1.0',
        providerId: 'gamewave-agent',
        port: 0,
        sizeBytes: 0,
      },
    ]
  }

  async load(modelId: string): Promise<SessionInfo> {
    this.loadedModels.add(modelId)
    return {
      pid: Date.now(),
      port: 0,
      model_id: modelId,
      model_path: '',
      api_key: this.resolveApiKey() || '',
    }
  }

  async unload(sessionId: string): Promise<UnloadResult> {
    this.loadedModels.delete(sessionId)
    this.sessionMap.delete(sessionId)
    this.runMap.delete(sessionId)
    this.agentMap.delete(sessionId)
    return { success: true }
  }

  async getLoadedModels(): Promise<string[]> {
    return Array.from(this.loadedModels)
  }

  async isToolSupported(): Promise<boolean> {
    return true
  }

  async chat(
    opts: chatCompletionRequest,
    abortController?: AbortController
  ): Promise<chatCompletion | AsyncIterable<chatCompletionChunk>> {
    console.log('Chat initiated with opts:', opts)

    const conversationKey =
      (opts as any).conversationId || (opts as any).threadId || opts.model

    let sessionId = this.sessionMap.get(conversationKey)
    if (!sessionId) {
      sessionId = ulid()
      this.sessionMap.set(conversationKey, sessionId)
      console.log(`Created new session ${sessionId} for conversation ${conversationKey}`)
    }

    const modelMap: Record<string, AgentMapping> = {
      Agent: { type: 'team', id: 'unreal_team' },
      Ask: { type: 'team', id: 'unreal_ask_team' },
    }

    const mapping = modelMap[opts.model] || { type: 'team', id: opts.model }
    this.agentMap.set(sessionId, mapping)

    const formData = new FormData()

    const lastUserMessage = this.getLastUserMessage(opts)
    if (!lastUserMessage) {
      throw new Error('No valid user message found to send to backend')
    }

    formData.append('message', lastUserMessage)
    formData.append('session_id', sessionId)
    formData.append('stream', opts.stream === false ? 'false' : 'true')

    const url = new URL(this.baseUrl)
    if (mapping.type === 'team') {
      url.searchParams.set('team_id', mapping.id)
    }

    if (opts.stream !== false) {
      return this.streamResponse(url.toString(), formData, sessionId, mapping.id, abortController)
    }

    formData.set('stream', 'false')
    return this.nonStreamResponse(url.toString(), formData, mapping.id, abortController)
  }

  private async *streamResponse(
    url: string,
    formData: FormData,
    sessionId: string,
    modelId: string,
    abortController?: AbortController
  ): AsyncIterable<chatCompletionChunk> {
    const pendingToolTasks: Promise<void>[] = []
    const bufferedChunks: chatCompletionChunk[] = []
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: formData,
        signal: abortController?.signal,
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error(`Request failed: ${response.status} - ${errorText}`)
        throw new Error(`Request failed: ${response.status} - ${errorText}`)
      }

      reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''
      const messageId = ulid()
      let isFirstChunk = true
      let completed = false

      while (!completed) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const rawLine of lines) {
          const line = rawLine.trim()
          if (!line) continue

          let eventData = ''
          if (line.startsWith('data: ')) {
            eventData = line.slice(6).trim()
          } else if (line.startsWith('{')) {
            eventData = line
          }

          if (!eventData || eventData === '[DONE]') continue

          try {
            const event = JSON.parse(eventData)
            const eventName = typeof event.event === 'string' ? event.event : undefined

            if (event.run_id) {
              const agentId = event.agent_id || event.agentId || event.agent?.id
              const isAgentRun = typeof agentId === 'string' && agentId.trim().length > 0

              if (isAgentRun && (eventName === 'RunStarted' || eventName === 'RunPaused' || eventName === 'RunContent')) {
                this.runMap.set(sessionId, event.run_id)
                console.log(`Updated agent run_id ${event.run_id} for session ${sessionId}`)
              } else if (!this.runMap.has(sessionId)) {
                this.runMap.set(sessionId, event.run_id)
                console.log(`Stored initial run_id ${event.run_id} for session ${sessionId}`)
              }
            }

            const agentId = event.agent_id || event.agentId || event.agent?.id
            if (typeof agentId === 'string' && agentId.trim()) {
              this.agentMap.set(sessionId, { type: 'agent', id: agentId })
            }

            let handledTool = false
            if (Array.isArray(event.tools)) {
              const toolEventNames = new Set(['ToolCall', 'RunPaused', 'AgentRunPaused', 'AgentToolCall'])

              if (!eventName || toolEventNames.has(eventName)) {
                for (const tool of event.tools) {
                  if (tool?.external_execution_required !== true) continue

                  const toolCallId = tool.tool_call_id || tool.id
                  if (!toolCallId) continue

                  const dedupKey = `${sessionId}:${toolCallId}`
                  if (this.processedToolCalls.has(dedupKey)) continue
                  this.processedToolCalls.add(dedupKey)

                  if (isFirstChunk) {
                    yield this.createChunk(messageId, { role: 'assistant' }, null, modelId)
                    isFirstChunk = false
                  }

                  yield this.createToolCallChunk(messageId, toolCallId, tool.tool_name, tool.tool_args || {}, modelId)

                  this.enqueueToolMetadata(sessionId, {
                    tool_call_id: toolCallId,
                    tool_name: tool.tool_name,
                    tool_args: tool.tool_args || {},
                  })

                  const toolTask = this.executeAndContinueTool(
                    toolCallId,
                    tool.tool_name,
                    tool.tool_args || {},
                    sessionId,
                    dedupKey,
                    abortController
                  ).catch((err) => console.error('Tool execution failed:', err))

                  pendingToolTasks.push(toolTask)
                  handledTool = true
                }
              }
            }

            if (handledTool) continue

            if (typeof event.content === 'string' && event.content.trim()) {
              const delta: Record<string, unknown> = {}
              if (isFirstChunk) {
                delta.role = 'assistant'
                isFirstChunk = false
              }
              delta.content = event.content
              const metadataToolCalls = this.dequeueToolMetadata(sessionId)
              if (metadataToolCalls.length) {
                delta.metadata = {
                  tool_calls: metadataToolCalls.map((tool) => ({
                    tool,
                    state: 'pending',
                  })),
                }
              }
              yield this.createChunk(messageId, delta, null, modelId)
            }

            if (event.event === 'TeamRunCompleted' || event.event === 'RunCompleted') {
              const finalDelta: Record<string, unknown> = {}
              if (typeof event.content === 'string' && event.content.trim()) {
                finalDelta.content = event.content
              }

              bufferedChunks.push(...this.drainContinuationChunks(sessionId))
              bufferedChunks.push(this.createChunk(messageId, finalDelta, 'stop', modelId))
              completed = true
              break
            }
          } catch (error) {
            console.warn('Failed to parse SSE event:', eventData.substring(0, 100), error)
          }
        }
      }

      if (!completed) {
        bufferedChunks.push(...this.drainContinuationChunks(sessionId))
      }
    } catch (error) {
      console.error('Streaming error:', error)
      bufferedChunks.push(
        this.createChunk(
          ulid(),
          { role: 'assistant', content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` },
          'stop',
          modelId
        )
      )
    } finally {
      if (pendingToolTasks.length) {
        await Promise.allSettled(pendingToolTasks)
      }
      if (reader) {
        reader.releaseLock()
      }
      bufferedChunks.push(...this.drainContinuationChunks(sessionId))
    }

    for (const chunk of bufferedChunks) {
      yield chunk
    }
  }


  private async nonStreamResponse(
    url: string,
    formData: FormData,
    modelId: string,
    abortController?: AbortController
  ): Promise<chatCompletion> {
    const response = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: formData,
      signal: abortController?.signal,
    })
  
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Request failed: ${response.status} - ${errorText}`)
    }
  
    const result = await response.json()
  
    return {
      id: result.run_id || ulid(),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: modelId,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: result.content || null,
          },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }
  }
  
  private async executeAndContinueTool(
    toolCallId: string,
    toolName: string,
    toolArgs: Record<string, unknown>,
    sessionId: string,
    dedupKey: string,
    abortController?: AbortController
  ) {
    try {
      const { promise } = getServiceHub().mcp().callToolWithCancellation({
        toolName,
        arguments: toolArgs,
      })

      const result = await promise
      const output = this.normalizeToolResult(result as ToolCallResult)

      await this.sendToolResult(sessionId, toolCallId, output, false, abortController)
    } catch (error) {
      console.error(`Tool ${toolName} execution failed:`, error)
      const message = error instanceof Error ? error.message : String(error)
      await this.sendToolResult(sessionId, toolCallId, message, true, abortController)
    } finally {
      this.processedToolCalls.delete(dedupKey)
    }
  }

  private async sendToolResult(
    sessionId: string,
    toolCallId: string,
    output: string,
    isError: boolean,
    abortController?: AbortController
  ) {
    const runId = this.runMap.get(sessionId)
    let agentInfo = this.agentMap.get(sessionId)

    if (!runId || !agentInfo || agentInfo.type !== 'agent') {
      console.error('Missing run_id or agent info for continue request')
      return
    }

    const url = new URL(this.baseUrl)
    url.searchParams.set('agent_id', agentInfo.id)
    url.searchParams.set('run_id', runId)
    url.searchParams.set('continue', 'true')

    const toolsPayload = [
      {
        tool_call_id: toolCallId,
        output,
        is_error: isError,
      },
    ]

    const body = new URLSearchParams()
    body.append('tools', JSON.stringify(toolsPayload))
    body.append('session_id', sessionId)
    body.append('stream', 'true')

    console.log(`Sending tool result to continue endpoint: ${url.toString()}`)

    const pendingToolTasks: Promise<void>[] = []

    try {
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: this.getHeaders('application/x-www-form-urlencoded'),
        body,
        signal: abortController?.signal,
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error(`Tool result submission failed: ${response.status} - ${errorText}`)
        return
      }

      const reader = response.body?.getReader()
      if (reader) {
        const decoder = new TextDecoder()
        let buffer = ''
        const messageId = ulid()
        let isFirstChunk = true
        let currentAgentInfo = agentInfo

        try {
          processing: while (true) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue

              const data = line.slice(6).trim()
              if (!data || data === '[DONE]') {
                continue
              }

              try {
                const event = JSON.parse(data)
                console.log(`Continue response event: ${event.event || 'unknown'}`)
                const eventName = typeof event.event === 'string' ? event.event : undefined

                if (event.run_id) {
                  const eventAgentId = event.agent_id || event.agentId || event.agent?.id
                  const isAgentRun = typeof eventAgentId === 'string' && eventAgentId.trim().length > 0

                  if (
                    isAgentRun &&
                    (eventName === 'RunStarted' || eventName === 'RunPaused' || eventName === 'RunContent')
                  ) {
                    this.runMap.set(sessionId, event.run_id)
                  } else if (!this.runMap.has(sessionId)) {
                    this.runMap.set(sessionId, event.run_id)
                  }
                }

                const agentId = event.agent_id || event.agentId || event.agent?.id
                if (typeof agentId === 'string' && agentId.trim()) {
                  const updatedAgent: AgentMapping = { type: 'agent', id: agentId }
                  this.agentMap.set(sessionId, updatedAgent)
                  currentAgentInfo = updatedAgent
                }

                let handledTool = false

                if (event.event === 'RunContinued') {
                  continue
                }

                if (Array.isArray(event.tools)) {
                  const toolEventNames = new Set(['ToolCall', 'RunPaused', 'AgentRunPaused', 'AgentToolCall'])

                  if (!eventName || toolEventNames.has(eventName)) {
                    for (const tool of event.tools) {
                      if (tool?.external_execution_required !== true) continue

                      const toolCallId = tool.tool_call_id || tool.id
                      if (!toolCallId) continue

                      const dedupKey = `${sessionId}:${toolCallId}`
                      if (this.processedToolCalls.has(dedupKey)) continue
                      this.processedToolCalls.add(dedupKey)

                      const toolName = tool.tool_name || ''
                      const toolArgs = tool.tool_args || {}

                      this.enqueueToolMetadata(sessionId, {
                        tool_call_id: toolCallId,
                        tool_name: toolName,
                        tool_args: toolArgs,
                      })

                      this.enqueueContinuationChunk(
                        sessionId,
                        this.createToolCallChunk(
                          messageId,
                          toolCallId,
                          toolName,
                          toolArgs,
                          currentAgentInfo.id
                        )
                      )

                      isFirstChunk = false

                      const toolTask = this.executeAndContinueTool(
                        toolCallId,
                        toolName,
                        toolArgs,
                        sessionId,
                        dedupKey,
                        abortController
                      ).catch((err) => console.error('Tool execution failed:', err))

                      pendingToolTasks.push(toolTask)
                      handledTool = true
                    }
                  } else {
                    for (const tool of event.tools) {
                      if (!tool?.tool_call_id) continue
                      this.enqueueToolMetadata(sessionId, {
                        tool_call_id: tool.tool_call_id,
                        tool_name: tool.tool_name || '',
                        tool_args: tool.tool_args || {},
                      })
                    }
                  }
                }

                if (handledTool) {
                  continue
                }

                if (typeof event.content === 'string' && event.content.trim()) {
                  const delta: Record<string, unknown> = {}
                  if (isFirstChunk) {
                    delta.role = 'assistant'
                    isFirstChunk = false
                  }
                  delta.content = event.content
                  const metadataToolCalls = this.dequeueToolMetadata(sessionId)
                  if (metadataToolCalls.length) {
                    delta.metadata = {
                      tool_calls: metadataToolCalls.map((tool) => ({
                        tool,
                        state: 'pending',
                      })),
                    }
                  }

                  this.enqueueContinuationChunk(
                    sessionId,
                    this.createChunk(
                      messageId,
                      delta,
                      event.event === 'RunCompleted' ? 'stop' : null,
                      agentInfo.id
                    )
                  )

                  if (event.event === 'RunCompleted') {
                    break processing
                  }
                }
              } catch (error) {
                // Ignore parse errors
              }
            }
          }
        } finally {
          reader.releaseLock()
        }
      }
    } catch (error) {
      console.error('Failed to send tool result:', error)
    } finally {
      if (pendingToolTasks.length) {
        await Promise.allSettled(pendingToolTasks)
      }
    }
  }

  private normalizeToolResult(result: ToolCallResult): string {
    if (result == null) return ''
    if (typeof result === 'string') return result

    if (typeof result === 'object') {
      const content = result.content

      if (typeof content === 'string') {
        return content
      }

      if (Array.isArray(content)) {
        return content
          .map((item) => {
            if (typeof item === 'string') return item
            if (item && typeof item === 'object' && 'text' in item) {
              return String((item as { text?: string }).text ?? '')
            }
            return JSON.stringify(item ?? '')
          })
          .filter(Boolean)
          .join('\n')
      }

      if (typeof result.error === 'string') {
        return result.error
      }

      return JSON.stringify(result)
    }

    return String(result)
  }

  private getHeaders(contentType?: string): Record<string, string> {
    const headers: Record<string, string> = {}

    if (contentType) {
      headers['Content-Type'] = contentType
    }

    const apiKey = this.resolveApiKey()
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`
      headers['x-api-key'] = apiKey
    }

    return headers
  }

  private resolveApiKey(): string | undefined {
    if (this.apiKey?.trim()) {
      return this.apiKey
    }

    if (typeof window !== 'undefined') {
      const providerState = useModelProvider.getState()
      const provider = providerState.getProviderByName?.('gamewave-agent')
      const storedKey = provider?.api_key
      if (storedKey && typeof storedKey === 'string' && storedKey.trim()) {
        return storedKey
      }
    }

    return undefined
  }

  private getLastUserMessage(opts: chatCompletionRequest): string | undefined {
    for (let i = opts.messages.length - 1; i >= 0; i -= 1) {
      const message = opts.messages[i]
      if (message.role !== 'user') continue

      if (typeof message.content === 'string') {
        if (message.content.trim()) return message.content
        continue
      }

      if (Array.isArray(message.content)) {
        const aggregated = message.content
          .map((part) => {
            if (typeof part === 'string') return part
            if (part && typeof part === 'object' && 'text' in part) {
              return String((part as { text?: string }).text ?? '')
            }
            return ''
          })
          .filter(Boolean)
          .join('\n')

        if (aggregated.trim()) {
          return aggregated
        }
      }
    }
    return undefined
  }

  private createToolCallChunk(
    messageId: string,
    toolCallId: string,
    toolName: string,
    toolArgs: Record<string, unknown>,
    modelId: string
  ): chatCompletionChunk {
    const toolCall: ChatCompletionMessageToolCall = {
      id: toolCallId,
      type: 'function',
      function: {
        name: toolName,
        arguments: JSON.stringify(toolArgs),
      },
    }

    return this.createChunk(
      messageId,
      {
        role: 'assistant',
        tool_calls: [toolCall],
      },
      'tool_calls',
      modelId
    )
  }

  private createChunk(
    id: string,
    delta: Record<string, unknown>,
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'function_call' | null,
    model: string
  ): chatCompletionChunk {
    return {
      id,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          delta,
          finish_reason,
        },
      ],
    }
  }

  async delete(modelId: string): Promise<void> {
    console.log(`Delete ${modelId} - not implemented`)
  }

  async import(modelId: string, _opts: any): Promise<void> {
    console.log(`Import ${modelId} - not implemented`)
  }

  async abortImport(modelId: string): Promise<void> {
    console.log(`Abort import ${modelId} - not implemented`)
  }
}