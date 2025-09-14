import { AIEngine, chatCompletionRequest, chatCompletion, chatCompletionChunk, SessionInfo, UnloadResult, modelInfo } from '@janhq/core'
import { ulid } from 'ulidx'

// Types from @ag-ui/core
interface RunAgentInput {
  threadId: string
  runId: string
  state: any
  messages: Message[]
  tools: Tool[]
  context: Context[]
  forwardedProps: any
}

interface Message {
  id: string
  role: "developer" | "system" | "assistant" | "user" | "tool"
  content?: string
  name?: string
  toolCalls?: ToolCall[]
  toolCallId?: string
  error?: string
}

interface ToolCall {
  id: string
  type: "function"
  function: FunctionCall
}

interface FunctionCall {
  name: string
  arguments: string
}

interface Tool {
  name: string
  description: string
  parameters: any // JSON Schema
}

interface Context {
  description: string
  value: string
}

// Event types from @ag-ui/core
enum EventType {
  TEXT_MESSAGE_START = "TEXT_MESSAGE_START",
  TEXT_MESSAGE_CONTENT = "TEXT_MESSAGE_CONTENT",
  TEXT_MESSAGE_END = "TEXT_MESSAGE_END",
  TOOL_CALL_START = "TOOL_CALL_START",
  TOOL_CALL_ARGS = "TOOL_CALL_ARGS",
  TOOL_CALL_END = "TOOL_CALL_END",
  TOOL_CALL_RESULT = "TOOL_CALL_RESULT",
  STATE_SNAPSHOT = "STATE_SNAPSHOT",
  STATE_DELTA = "STATE_DELTA",
  MESSAGES_SNAPSHOT = "MESSAGES_SNAPSHOT",
  RAW = "RAW",
  CUSTOM = "CUSTOM",
  RUN_STARTED = "RUN_STARTED",
  RUN_FINISHED = "RUN_FINISHED",
  RUN_ERROR = "RUN_ERROR",
  STEP_STARTED = "STEP_STARTED",
  STEP_FINISHED = "STEP_FINISHED",
}

interface BaseEvent {
  type: EventType
  timestamp?: number
  rawEvent?: any
}

interface TextMessageStartEvent extends BaseEvent {
  type: EventType.TEXT_MESSAGE_START
  messageId: string
  role: "assistant"
}

interface TextMessageContentEvent extends BaseEvent {
  type: EventType.TEXT_MESSAGE_CONTENT
  messageId: string
  delta: string
}

interface TextMessageEndEvent extends BaseEvent {
  type: EventType.TEXT_MESSAGE_END
  messageId: string
}

interface ToolCallStartEvent extends BaseEvent {
  type: EventType.TOOL_CALL_START
  toolCallId: string
  toolCallName: string
  parentMessageId?: string
}

interface ToolCallArgsEvent extends BaseEvent {
  type: EventType.TOOL_CALL_ARGS
  toolCallId: string
  delta: string
}

interface ToolCallEndEvent extends BaseEvent {
  type: EventType.TOOL_CALL_END
  toolCallId: string
}

interface ToolCallResultEvent extends BaseEvent {
  type: EventType.TOOL_CALL_RESULT
  messageId: string
  toolCallId: string
  content: string
  role?: "tool"
}

interface RunStartedEvent extends BaseEvent {
  type: EventType.RUN_STARTED
  threadId: string
  runId: string
}

interface RunFinishedEvent extends BaseEvent {
  type: EventType.RUN_FINISHED
  threadId: string
  runId: string
  result?: any
}

interface RunErrorEvent extends BaseEvent {
  type: EventType.RUN_ERROR
  message: string
  code?: string
}

type AgentEvent =
  | TextMessageStartEvent
  | TextMessageContentEvent
  | TextMessageEndEvent
  | ToolCallStartEvent
  | ToolCallArgsEvent
  | ToolCallEndEvent
  | ToolCallResultEvent
  | RunStartedEvent
  | RunFinishedEvent
  | RunErrorEvent

/**
 * Agno Agent Engine Implementation
 * Integrates with @ag-ui/client to communicate with your Agno agent backend
 */
export class AgnoAgentEngine extends AIEngine {
  readonly provider = 'agno-agent'

  private baseUrl: string
  private apiKey?: string
  private loadedModels = new Set<string>()

  constructor(baseUrl: string, apiKey?: string) {
    super('agno-agent', '1.0.0')
    this.baseUrl = baseUrl
    this.apiKey = apiKey
    console.log('AgnoAgentEngine constructed with baseUrl:', baseUrl)
  }

  /**
   * On extension unload
   */
  onUnload(): void {
    // Cleanup any resources if needed
    this.loadedModels.clear()
  }

  /**
   * List available models/agents
   */
  async list(): Promise<modelInfo[]> {
    // Return the predefined model from the provider configuration
    // instead of trying to fetch from backend endpoint
    return [
      {
        id: 'agno-agent-default',
        name: 'Agno Agent',
        providerId: this.provider,
        port: 0, // Not applicable for remote agents
        sizeBytes: 0, // Not applicable for remote agents
        tags: ['agno', 'agent', 'custom'],
      }
    ]
  }

  /**
   * Load a model/agent (for Agno agents, this is typically a no-op)
   */
  async load(modelId: string, _settings?: any): Promise<SessionInfo> {
    // For remote agents, "loading" is typically just marking as available
    this.loadedModels.add(modelId)

    return {
      pid: Date.now(), // Use timestamp as pseudo-PID
      port: 0, // Not applicable for remote agents
      model_id: modelId,
      model_path: '', // Not applicable for remote agents
      api_key: this.apiKey || '',
    }
  }

  /**
   * Unload a model/agent
   */
  async unload(sessionId: string): Promise<UnloadResult> {
    // Extract model ID from session (in real implementation, you'd track this properly)
    this.loadedModels.delete(sessionId)

    return {
      success: true,
    }
  }

  /**
   * Get currently loaded models
   */
  async getLoadedModels(): Promise<string[]> {
    return Array.from(this.loadedModels)
  }

  /**
   * Check if tools are supported (Agno agents typically support tools)
   */
  async isToolSupported(_modelId: string): Promise<boolean> {
    return true // Agno agents support tools via the @ag-ui framework
  }

  /**
   * Main chat method - handles communication with Agno agent
   */
  async chat(
    opts: chatCompletionRequest,
    abortController?: AbortController
  ): Promise<chatCompletion | AsyncIterable<chatCompletionChunk>> {
    console.log('AgnoAgentEngine.chat called with opts:', opts)
    console.log('Tools received:', opts.tools)
    console.log('Tools length:', opts.tools?.length || 0)

    const runId = ulid()
    const threadId = opts.messages?.[0]?.role === 'system' ? ulid() : ulid()

    // Convert OpenAI format to Agno agent format
    const convertedTools = this.convertToolsToAgentFormat(opts.tools || [])
    console.log('Converted tools for agent:', convertedTools)

    const agentInput: RunAgentInput = {
      threadId,
      runId,
      state: {}, // You can customize this based on your agent's state needs
      messages: this.convertMessagesToAgentFormat(opts.messages || []),
      tools: convertedTools,
      context: [], // Add context if needed
      forwardedProps: opts, // Forward original request
    }

    console.log('Full agent input being sent:', JSON.stringify(agentInput, null, 2))

    if (opts.stream !== false) {
      return this.createStreamingResponse(agentInput, abortController)
    } else {
      return this.createNonStreamingResponse(agentInput, abortController)
    }
  }

  /**
   * Create streaming response using Server-Sent Events
   */
  private async *createStreamingResponse(
    agentInput: RunAgentInput,
    abortController?: AbortController
  ): AsyncIterable<chatCompletionChunk> {
    try {
      const response = await fetch(`${this.baseUrl}/agui`, {
        method: 'POST',
        headers: {
          ...this.getHeaders(),
          'Accept': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
        body: JSON.stringify(agentInput),
        signal: abortController?.signal,
      })

      if (!response.ok) {
        throw new Error(`Agent request failed: ${response.statusText}`)
      }

      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('No response body reader available')
      }

      const decoder = new TextDecoder()
      let buffer = ''
      let messageId = ulid()
      let toolCalls: any[] = []

      try {
        while (true) {
          const { done, value } = await reader.read()

          if (done) break
          if (abortController?.signal.aborted) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const eventData = line.slice(6)

              if (eventData === '[DONE]') {
                // This case is unlikely to be hit if RUN_FINISHED is used, but good for safety
                const finishReason = toolCalls.length > 0 ? 'tool_calls' : 'stop'
                yield this.createCompletionChunk(messageId, '', finishReason, undefined)
                return
              }

              try {
                const event: AgentEvent = JSON.parse(eventData)
                // Pass toolCalls by reference so it can be modified
                const chunk = this.handleAgentEvent(event, messageId, toolCalls)

                if (chunk) {
                   yield chunk
                }

              } catch (parseError) {
                 // The error from your screenshot is likely a server-side or client-side JSON parsing issue
                 // unrelated to the streaming logic itself. This log can help debug it.
                console.warn('Failed to parse SSE event JSON:', eventData, parseError)

                // Check for common non-JSON data that might cause this
                if (eventData.includes("SyntaxError")) {
                    yield this.createErrorChunk("Received a SyntaxError from the server stream.");
                }
              }
            }
          }
        }
      } finally {
        reader.releaseLock()
      }
    } catch (error) {
      if (abortController?.signal.aborted) {
        return
      }

      console.error('Streaming request failed:', error)

      // Yield error chunk
      yield this.createErrorChunk(error instanceof Error ? error.message : 'Unknown error')
    }
  }

  /**
   * Handle individual agent events and convert to OpenAI completion chunks
   */
  private handleAgentEvent(
    event: AgentEvent,
    messageId: string,
    toolCalls: any[] // Modified in place
  ): chatCompletionChunk | null {

    switch (event.type) {
      case EventType.TEXT_MESSAGE_START:
        return this.createCompletionChunk(messageId, '', null, undefined, 'assistant')

      case EventType.TEXT_MESSAGE_CONTENT:
        return this.createCompletionChunk(messageId, event.delta, null)

      case EventType.TOOL_CALL_START: {
        const toolCall = {
          index: toolCalls.length,
          id: event.toolCallId,
          type: 'function' as const,
          function: {
            name: event.toolCallName,
            arguments: '',
          },
        }
        toolCalls.push(toolCall)
        // Send the tool call structure itself
        return this.createCompletionChunk(messageId, '', null, [toolCall])
      }

      case EventType.TOOL_CALL_ARGS: {
        if (toolCalls.length > 0) {
          const lastToolCall = toolCalls[toolCalls.length - 1]
          lastToolCall.function.arguments += event.delta

          // Send the arguments delta
          return this.createCompletionChunk(messageId, '', null, [{
            index: toolCalls.length - 1,
            function: {
              arguments: event.delta,
            },
          }])
        }
        break
      }
      
      // TOOL_CALL_END, TEXT_MESSAGE_END, and RUN_STARTED are transitional; no chunk needed.
      case EventType.TOOL_CALL_END:
      case EventType.TEXT_MESSAGE_END:
      case EventType.RUN_STARTED:
          return null

      // =================================================================
      // CORE LOGIC FIX IS HERE
      // =================================================================
      case EventType.RUN_FINISHED: {
        // When the run finishes, decide the *real* finish reason.
        // If we have started tool calls, the reason is 'tool_calls'.
        // Otherwise, it's a normal 'stop'.
        const finishReason = toolCalls.length > 0 ? 'tool_calls' : 'stop'
        return this.createCompletionChunk(messageId, '', finishReason, undefined)
      }
      // =================================================================

      case EventType.RUN_ERROR:
        // Agent error
        return this.createErrorChunk(event.message)

      default:
        // Handle other events as needed
        return null
    }
    return null
  }

  /**
   * Create non-streaming response
   */
  private async createNonStreamingResponse(
    agentInput: RunAgentInput,
    abortController?: AbortController
  ): Promise<chatCompletion> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/agui`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(agentInput),
        signal: abortController?.signal,
      })

      if (!response.ok) {
        throw new Error(`Agent request failed: ${response.statusText}`)
      }

      const result = await response.json()

      // Convert agent response to OpenAI format
      return {
        id: ulid(),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: agentInput.forwardedProps.model || 'agno-agent',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: result.content || null, // content can be null if only tool calls are made
            tool_calls: result.toolCalls || undefined,
          },
          finish_reason: result.toolCalls ? 'tool_calls' : 'stop',
        }],
        usage: {
          prompt_tokens: 0, // Would need to calculate or get from agent
          completion_tokens: 0, // Would need to calculate or get from agent
          total_tokens: 0,
        },
      }
    } catch (error) {
      console.error('Non-streaming request failed:', error)
      throw error
    }
  }

  /**
   * Helper method to create completion chunks
   */
  private createCompletionChunk(
    messageId: string,
    content: string | null,
    finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null,
    toolCalls?: any[],
    role?: 'assistant'
  ): chatCompletionChunk {
    return {
      id: messageId,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'agno-agent',
      choices: [{
        index: 0,
        delta: {
          ...(role && { role }), // Only add role for the first chunk
          ...(content && { content }), // Only add content if it's not empty
          ...(toolCalls && { tool_calls: toolCalls }),
        },
        finish_reason: finishReason,
      }],
    }
  }

  /**
   * Helper method to create error chunks
   */
  private createErrorChunk(errorMessage: string): chatCompletionChunk {
    // Return an error message in the content of the stream
    return this.createCompletionChunk(
        ulid(),
        `An error occurred: ${errorMessage}`,
        'stop',
        undefined,
        'assistant'
    );
  }


  /**
   * Convert OpenAI messages to agent format
   */
  private convertMessagesToAgentFormat(messages: any[]): Message[] {
    return messages.map(msg => ({
      id: ulid(),
      role: msg.role,
      content: msg.content || undefined,
      name: msg.name,
      toolCalls: msg.tool_calls?.map((tc: any) => ({
        id: tc.id,
        type: tc.type,
        function: tc.function,
      })),
      toolCallId: msg.tool_call_id,
    }))
  }

  /**
   * Convert OpenAI tools to agent format
   */
  private convertToolsToAgentFormat(tools: any[]): Tool[] {
    return tools.map(tool => ({
      name: tool.function?.name || '',
      description: tool.function?.description || '',
      parameters: tool.function?.parameters || {},
    }))
  }

  /**
   * Get request headers
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`
    }

    return headers
  }

  // Required abstract methods with basic implementations
  async delete(modelId: string): Promise<void> {
    console.log(`Delete model ${modelId} - not implemented`)
  }

  async import(modelId: string, _opts: any): Promise<void> {
    console.log(`Import model ${modelId} - not implemented`)
  }

  async abortImport(modelId: string): Promise<void> {
    console.log(`Abort import ${modelId} - not implemented`)
  }
}