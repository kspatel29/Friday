/**
 * LangGraph Server API Type Definitions
 * 
 * These types match the LangGraph Server API for threads, runs, and interrupts.
 * Reference: https://docs.langchain.com/langsmith/server-api-ref
 */

// =============================================================================
// Thread Types
// =============================================================================

/**
 * Thread status in LangGraph
 */
export type ThreadStatus = 'idle' | 'busy' | 'interrupted' | 'error'

/**
 * Thread object returned from LangGraph API
 */
export interface LangGraphThread {
    thread_id: string
    created_at: string
    updated_at: string
    metadata: Record<string, unknown>
    status: ThreadStatus
    config: Record<string, unknown>
    values: Record<string, unknown>  // Current state of the graph
    interrupts: Record<string, (InterruptData | LangGraphInterruptItem)[]>
}

/**
 * Payload for creating a new thread
 */
export interface CreateThreadPayload {
    thread_id?: string  // Optional, will be auto-generated if not provided
    metadata?: Record<string, unknown>
    if_exists?: 'raise' | 'do_nothing'
}

// =============================================================================
// Interrupt Types (matches your external_tool wrapper)
// =============================================================================

/**
 * Interrupt data structure - matches the payload from your interrupt() call
 */
export interface InterruptData {
    id: string
    type: 'function'
    function: {
        name: string
        arguments: string  // JSON string of the tool arguments
    }
    metadata?: Record<string, unknown>
}

/**
 * Parsed interrupt for easier handling
 */
export interface ParsedInterrupt {
    interruptId: string  // The LangGraph interrupt ID (for resuming)
    toolCallId: string
    toolName: string
    arguments: Record<string, unknown>
    metadata?: Record<string, unknown>
}

// =============================================================================
// Run Types
// =============================================================================

/**
 * Run status in LangGraph
 */
export type RunStatus = 'pending' | 'running' | 'error' | 'success' | 'timeout' | 'interrupted'

/**
 * Run object from LangGraph API
 */
export interface LangGraphRun {
    run_id: string
    thread_id: string
    assistant_id: string
    created_at: string
    updated_at: string
    status: RunStatus
    metadata: Record<string, unknown>
    kwargs: Record<string, unknown>
    multitask_strategy: 'reject' | 'rollback' | 'interrupt' | 'enqueue'
}

/**
 * Message format for LangGraph input
 */
export interface LangGraphMessage {
    role: 'user' | 'assistant' | 'system' | 'tool'
    content: string
    tool_call_id?: string
    tool_calls?: Array<{
        id: string
        type: 'function'
        function: {
            name: string
            arguments: string
        }
    }>
}

/**
 * Command object for controlling graph execution
 * 
 * For resuming interrupts:
 * - Single interrupt: { resume: value }
 * - Multiple interrupts: { resume: { [interrupt_id]: value, ... } }
 * 
 * Reference: LangGraph API OpenAPI schema
 */
export interface ResumeCommand {
    resume?: unknown  // For single interrupt: the value; for multiple: dict mapping interrupt_id to value
    update?: Record<string, unknown>
    goto?: string | { node: string; input?: unknown }
}

/**
 * Payload for creating a run
 */
export interface CreateRunPayload {
    assistant_id: string
    input?: {
        messages: LangGraphMessage[]
    }
    // Command is a single object with resume, update, goto fields
    // For multiple interrupts, resume is a dict: { [interrupt_id]: value }
    command?: ResumeCommand
    metadata?: Record<string, unknown>
    config?: {
        tags?: string[]
        recursion_limit?: number
        configurable?: Record<string, unknown>
    }
    stream_mode?: StreamMode[]
    interrupt_before?: string[]
    interrupt_after?: string[]
    multitask_strategy?: 'reject' | 'rollback' | 'interrupt' | 'enqueue'
    if_not_exists?: 'create' | 'reject'
    on_disconnect?: 'cancel' | 'continue'
}

/**
 * Stream modes available
 */
export type StreamMode = 'values' | 'messages' | 'messages-tuple' | 'tasks' | 'checkpoints' | 'updates' | 'events' | 'debug' | 'custom'

// =============================================================================
// SSE Event Types from LangGraph Stream
// =============================================================================

/**
 * Base SSE event structure
 */
export interface BaseStreamEvent {
    event: string
    data: unknown
}

/**
 * Metadata event - sent at start of stream
 */
export interface MetadataEvent extends BaseStreamEvent {
    event: 'metadata'
    data: {
        run_id: string
        attempt: number
    }
}

/**
 * Messages partial event - streaming message content
 */
export interface MessagesPartialEvent extends BaseStreamEvent {
    event: 'messages/partial'
    data: Array<{
        type: 'ai' | 'human' | 'tool'
        content: string
        tool_calls?: Array<{
            id: string
            name: string
            args: Record<string, unknown>
        }>
        id?: string
        response_metadata?: Record<string, unknown>
    }>
}

/**
 * Messages complete event - final message content
 */
export interface MessagesCompleteEvent extends BaseStreamEvent {
    event: 'messages/complete'
    data: Array<{
        type: 'ai' | 'human' | 'tool'
        content: string
        tool_calls?: Array<{
            id: string
            name: string
            args: Record<string, unknown>
        }>
        id?: string
    }>
}

/**
 * Updates event - state updates from the graph
 */
export interface UpdatesEvent extends BaseStreamEvent {
    event: 'updates'
    data: Record<string, unknown>
}

/**
 * Values event - full state snapshot
 */
export interface ValuesEvent extends BaseStreamEvent {
    event: 'values'
    data: Record<string, unknown>
}

/**
 * End event - stream completed
 */
export interface EndEvent extends BaseStreamEvent {
    event: 'end'
    data: null
}

/**
 * Error event
 */
export interface ErrorEvent extends BaseStreamEvent {
    event: 'error'
    data: {
        message: string
        code?: string
    }
}

/**
 * Union of all stream events
 */
export type StreamEvent =
    | MetadataEvent
    | MessagesPartialEvent
    | MessagesCompleteEvent
    | UpdatesEvent
    | ValuesEvent
    | EndEvent
    | ErrorEvent

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Interrupt item wrapper from LangGraph
 */
export interface LangGraphInterruptItem {
    value: InterruptData
    [key: string]: unknown
}

/**
 * Parse interrupt data into a more usable format
 */
export function parseInterrupt(interrupt: InterruptData | LangGraphInterruptItem): ParsedInterrupt {
    // Handle the nested structure from LangGraph: { value: InterruptData, id: string }
    const payload = 'value' in interrupt ? interrupt.value : interrupt
    const interruptId = 'id' in interrupt && typeof interrupt.id === 'string' ? interrupt.id : ''
    
    console.log('parseInterrupt input:', JSON.stringify(interrupt, null, 2))
    console.log('parseInterrupt payload:', JSON.stringify(payload, null, 2))
    console.log('parseInterrupt interruptId:', interruptId)
    console.log('parseInterrupt payload.metadata:', payload.metadata)

    const result: ParsedInterrupt = {
        interruptId,  // The LangGraph interrupt ID
        toolCallId: payload.id,  // The tool call ID
        toolName: payload.function.name,
        arguments: typeof payload.function.arguments === 'string'
            ? JSON.parse(payload.function.arguments)
            : payload.function.arguments,
        metadata: payload.metadata
    }
    
    console.log('parseInterrupt result:', JSON.stringify(result, null, 2))
    return result
}

/**
 * Check if a thread has pending interrupts
 */
export function hasInterrupts(thread: LangGraphThread): boolean {
    return thread.status === 'interrupted' &&
        Object.keys(thread.interrupts).length > 0
}

/**
 * Get all interrupts from a thread as a flat array
 */
export function getAllInterrupts(thread: LangGraphThread): (InterruptData | LangGraphInterruptItem)[] {
    return Object.values(thread.interrupts).flat()
}
