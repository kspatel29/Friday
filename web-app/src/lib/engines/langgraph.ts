/**
 * LangGraph Engine Implementation
 * 
 * Integrates with LangGraph Server API for stateful agent conversations.
 * Handles thread management, run streaming, and interrupt/resume for human-in-the-loop.
 * 
 * Reference: https://docs.langchain.com/langsmith/server-api-ref
 */

import {
    AIEngine,
    chatCompletionRequest,
    chatCompletion,
    chatCompletionChunk,
    SessionInfo,
    UnloadResult,
    modelInfo
} from '@janhq/core'
import { ulid } from 'ulidx'
import { fetch as fetchTauri } from '@tauri-apps/plugin-http'
import {
    LangGraphThread,
    LangGraphMessage,
    CreateRunPayload,
    InterruptData,
    LangGraphInterruptItem,
    parseInterrupt,
    ParsedInterrupt,
} from '@/types/langgraph'

/**
 * Extended chat completion chunk with interrupt data
 */
interface LangGraphChatCompletionChunk extends chatCompletionChunk {
    langgraph?: {
        thread_id?: string
        run_id?: string
        interrupted?: boolean
        interrupts?: ParsedInterrupt[]
    }
}

/**
 * Thread context for managing stateful conversations
 */
interface ThreadContext {
    langGraphThreadId: string
    status: 'idle' | 'busy' | 'interrupted' | 'error'
    pendingInterrupts: ParsedInterrupt[]
    lastRunId?: string
}

/**
 * LangGraph Engine - Communicates with LangGraph Server API
 * 
 * Key features:
 * - Thread-based stateful conversations
 * - SSE streaming for run output
 * - Interrupt/resume for human-in-the-loop tool execution
 */
export class LangGraphEngine extends AIEngine {
    readonly provider = 'langgraph'

    // Made public for config updates - need to preserve thread contexts
    public baseUrl: string
    public apiKey?: string
    private assistantId: string
    private loadedModels = new Set<string>()

    // Maps Friday thread IDs to LangGraph thread contexts
    private threadContexts = new Map<string, ThreadContext>()

    constructor(baseUrl: string, apiKey?: string, assistantId: string = 'agent') {
        super('langgraph', '1.0.0')
        this.baseUrl = baseUrl.replace(/\/$/, '')  // Remove trailing slash
        this.apiKey = apiKey
        this.assistantId = assistantId
        console.log('LangGraphEngine initialized:', { baseUrl: this.baseUrl, assistantId })
    }

    /**
     * Update the assistant ID (useful for switching between graphs)
     */
    setAssistantId(assistantId: string): void {
        this.assistantId = assistantId
    }

    /**
     * On extension unload
     */
    onUnload(): void {
        this.loadedModels.clear()
        this.threadContexts.clear()
        this.partialToolResults?.clear()
    }

    /**
     * Clear partial tool results for a specific thread
     * Call this on error or abort to reset the state
     */
    clearPartialResults(langGraphThreadId: string): void {
        this.partialToolResults?.delete(langGraphThreadId)
    }

    /**
     * List available models/assistants
     */
    async list(): Promise<modelInfo[]> {
        try {
            // Try to fetch assistants from the server
            const response = await this.fetch('/assistants/search', {
                method: 'POST',
                body: JSON.stringify({ limit: 100 })
            })

            if (response.ok) {
                const assistants = await response.json()
                return assistants.map((a: { assistant_id: string; name?: string; graph_id?: string }) => ({
                    id: a.assistant_id,
                    name: a.name || a.graph_id || a.assistant_id,
                    providerId: this.provider,
                    port: 0,
                    sizeBytes: 0,
                    tags: ['langgraph', 'agent'],
                }))
            }
        } catch (error) {
            console.warn('Failed to fetch assistants from LangGraph server:', error)
        }

        // Return default if fetch fails
        return [{
            id: this.assistantId,
            name: 'LangGraph Agent',
            providerId: this.provider,
            port: 0,
            sizeBytes: 0,
            tags: ['langgraph', 'agent'],
        }]
    }

    /**
     * Load a model/agent (no-op for remote agents)
     */
    async load(modelId: string, _settings?: unknown): Promise<SessionInfo> {
        this.loadedModels.add(modelId)
        return {
            pid: Date.now(),
            port: 0,
            model_id: modelId,
            model_path: '',
            api_key: this.apiKey || '',
        }
    }

    /**
     * Unload a model/agent
     */
    async unload(sessionId: string): Promise<UnloadResult> {
        this.loadedModels.delete(sessionId)
        return { success: true }
    }

    /**
     * Get currently loaded models
     */
    async getLoadedModels(): Promise<string[]> {
        return Array.from(this.loadedModels)
    }

    /**
     * Check if tools are supported
     */
    async isToolSupported(_modelId: string): Promise<boolean> {
        return true  // LangGraph agents support tools
    }

    // ===========================================================================
    // Thread Management
    // ===========================================================================

    /**
     * Get or create a LangGraph thread for a Friday thread
     */
    async getOrCreateThread(fridayThreadId: string): Promise<ThreadContext> {
        // Check if we already have a context
        let context = this.threadContexts.get(fridayThreadId)

        if (context) {
            // Check if we have partial results stored - if so, don't refresh from server
            // as we're in the middle of collecting tool results
            const hasPartialResults = this.partialToolResults?.has(context.langGraphThreadId)
            
            if (hasPartialResults) {
                console.log('Has partial results stored, skipping server refresh')
                return context
            }

            // Refresh thread status from server
            try {
                const thread = await this.fetchThread(context.langGraphThreadId)
                context.status = thread.status

                // Check for pending interrupts
                if (thread.status === 'interrupted') {
                    const interrupts = Object.values(thread.interrupts).flat()
                    context.pendingInterrupts = interrupts.map(i => parseInterrupt(i))
                    console.log('Refreshed pending interrupts from server:', context.pendingInterrupts.length)
                }
            } catch (error) {
                console.warn('Failed to refresh thread status:', error)
            }

            return context
        }

        // Create new LangGraph thread
        const thread = await this.createThread()

        context = {
            langGraphThreadId: thread.thread_id,
            status: thread.status,
            pendingInterrupts: [],
        }

        this.threadContexts.set(fridayThreadId, context)
        console.log('Created LangGraph thread:', { fridayThreadId, langGraphThreadId: thread.thread_id })

        return context
    }

    /**
     * Create a new thread on the LangGraph server
     */
    private async createThread(): Promise<LangGraphThread> {
        const response = await this.fetch('/threads', {
            method: 'POST',
            body: JSON.stringify({})
        })

        if (!response.ok) {
            throw new Error(`Failed to create thread: ${response.statusText}`)
        }

        return response.json()
    }

    /**
     * Fetch thread details from the server
     */
    private async fetchThread(threadId: string): Promise<LangGraphThread> {
        const response = await this.fetch(`/threads/${threadId}`)

        if (!response.ok) {
            throw new Error(`Failed to fetch thread: ${response.statusText}`)
        }

        return response.json()
    }

    // ===========================================================================
    // Main Chat Method
    // ===========================================================================

    /**
     * Main chat method - handles communication with LangGraph agent
     */
    async chat(
        opts: chatCompletionRequest,
        abortController?: AbortController
    ): Promise<chatCompletion | AsyncIterable<chatCompletionChunk>> {
        console.log('LangGraphEngine.chat called:', {
            messageCount: opts.messages?.length,
            stream: opts.stream,
        })

        // Extract Friday thread ID from the request (we'll use a convention)
        // The thread ID should be passed in the configurable or we generate one
        const fridayThreadId = (opts as unknown as { threadId?: string }).threadId || ulid()
        
        console.log('Using Friday thread ID:', fridayThreadId)
        console.log('Has tool messages:', opts.messages?.some(m => m.role === 'tool'))

        // Get or create LangGraph thread
        const context = await this.getOrCreateThread(fridayThreadId)
        
        console.log('LangGraph thread context:', {
            langGraphThreadId: context.langGraphThreadId,
            status: context.status,
            pendingInterruptsCount: context.pendingInterrupts.length
        })

        // Check if we have pending interrupts to resume
        if (context.status === 'interrupted' && context.pendingInterrupts.length > 0) {
            console.log('Thread is interrupted, checking for tool results to resume')

            // Look for tool result messages in the input
            const toolResults = this.extractToolResults(opts.messages || [])

            if (toolResults.length > 0) {
                // Resume the interrupted run with tool results
                return this.resumeRun(context, toolResults, opts, abortController)
            }
        }

        // Convert messages to LangGraph format
        const messages = this.convertMessages(opts.messages || [])

        // Create a new run
        const payload: CreateRunPayload = {
            assistant_id: this.assistantId,
            input: { messages },
            stream_mode: ['messages', 'values'],
            on_disconnect: 'cancel',
        }

        if (opts.stream !== false) {
            return this.streamRun(context, payload, abortController)
        } else {
            return this.waitForRun(context, payload, abortController)
        }
    }

    /**
     * Resume an interrupted run with tool results
     * 
     * IMPORTANT: When there are multiple pending interrupts, LangGraph requires
     * ALL interrupts to be resolved in a single resume call, with each result
     * specifying its interrupt_id. Partial resumes are not supported.
     * 
     * Reference: https://docs.langchain.com/oss/python/langgraph/add-human-in-the-loop#resume-multiple-interrupts-with-one-invocation
     */
    async resumeRun(
        context: ThreadContext,
        toolResults: Array<{ toolCallId: string; result: string }>,
        _opts: chatCompletionRequest,
        abortController?: AbortController
    ): Promise<AsyncIterable<chatCompletionChunk>> {
        console.log('Resuming interrupted run with tool results:', toolResults)
        console.log('Resuming on thread:', context.langGraphThreadId)
        console.log('Pending interrupts:', context.pendingInterrupts)

        // Match tool results to interrupts by tool call ID
        const resumeCommands: Array<{ interrupt_id: string; value: unknown }> = []
        const matchedToolCallIds = new Set<string>()
        
        for (const toolResult of toolResults) {
            const matchingInterrupt = context.pendingInterrupts.find(
                i => i.toolCallId === toolResult.toolCallId
            )
            
            if (matchingInterrupt) {
                // Parse the result if it's JSON
                let value: unknown
                try {
                    value = JSON.parse(toolResult.result)
                } catch {
                    value = toolResult.result
                }
                
                resumeCommands.push({
                    interrupt_id: matchingInterrupt.interruptId,
                    value
                })
                matchedToolCallIds.add(toolResult.toolCallId)
                
                console.log('Matched tool result to interrupt:', {
                    toolCallId: toolResult.toolCallId,
                    interruptId: matchingInterrupt.interruptId,
                    toolName: matchingInterrupt.toolName
                })
            } else {
                console.warn('No matching interrupt found for tool call:', toolResult.toolCallId)
            }
        }

        if (resumeCommands.length === 0) {
            console.error('No matching interrupts found for tool results!')
            throw new Error('Cannot resume: no matching interrupts found')
        }

        // Check if we have results for ALL pending interrupts
        const pendingCount = context.pendingInterrupts.length
        const resolvedCount = resumeCommands.length
        
        if (resolvedCount < pendingCount) {
            // Not all interrupts have results yet - we need to wait for more
            const missingInterrupts = context.pendingInterrupts.filter(
                i => !matchedToolCallIds.has(i.toolCallId)
            )
            console.log(`Waiting for more tool results: ${resolvedCount}/${pendingCount} resolved`)
            console.log('Missing tool results for:', missingInterrupts.map(i => ({
                toolName: i.toolName,
                toolCallId: i.toolCallId
            })))
            
            // Store the partial results for later and return an async generator that yields nothing
            // The next call with more results will complete the resume
            if (!this.partialToolResults) {
                this.partialToolResults = new Map()
            }
            
            // Store results keyed by thread ID
            const existingResults = this.partialToolResults.get(context.langGraphThreadId) || []
            for (const cmd of resumeCommands) {
                // Only add if not already stored
                if (!existingResults.some(r => r.interrupt_id === cmd.interrupt_id)) {
                    existingResults.push(cmd)
                }
            }
            this.partialToolResults.set(context.langGraphThreadId, existingResults)
            
            console.log('Stored partial results, total stored:', existingResults.length)
            
            // Return empty generator - we're waiting for more results
            return this.createWaitingGenerator(context, missingInterrupts)
        }

        // Check if we have stored partial results to merge
        if (this.partialToolResults?.has(context.langGraphThreadId)) {
            const storedResults = this.partialToolResults.get(context.langGraphThreadId) || []
            for (const stored of storedResults) {
                if (!resumeCommands.some(r => r.interrupt_id === stored.interrupt_id)) {
                    resumeCommands.push(stored)
                }
            }
            // Clear stored results
            this.partialToolResults.delete(context.langGraphThreadId)
            console.log('Merged stored partial results, total commands:', resumeCommands.length)
        }

        console.log('Resume commands:', JSON.stringify(resumeCommands, null, 2))

        // Build the resume payload
        // The `command` field is a single Command object with { resume, update, goto } fields
        // For multiple interrupts, the `resume` value is a DICT mapping interrupt_id to value
        // For single interrupt, `resume` can be just the value directly
        // Reference: LangGraph API OpenAPI schema - Command has resume: Any (object|array|number|string|boolean|null)
        
        let commandValue: unknown
        if (pendingCount === 1 && resumeCommands.length === 1) {
            // Single interrupt - resume is just the value
            commandValue = {
                resume: resumeCommands[0].value
            }
        } else {
            // Multiple interrupts - resume is a dict mapping interrupt_id to value
            const resumeDict: Record<string, unknown> = {}
            for (const cmd of resumeCommands) {
                resumeDict[cmd.interrupt_id] = cmd.value
            }
            commandValue = {
                resume: resumeDict
            }
        }

        console.log('Command payload:', JSON.stringify(commandValue, null, 2))

        const payload: CreateRunPayload = {
            assistant_id: this.assistantId,
            command: commandValue as CreateRunPayload['command'],
            stream_mode: ['messages', 'values'],
            on_disconnect: 'cancel',
        }

        // Clear all pending interrupts since we're resuming with all results
        context.pendingInterrupts = []
        context.status = 'busy'

        return this.streamRun(context, payload, abortController)
    }

    // Storage for partial tool results when waiting for multiple interrupt resolutions
    private partialToolResults?: Map<string, Array<{ interrupt_id: string; value: unknown }>>

    /**
     * Create an async generator that signals we're waiting for more tool results
     * 
     * This is called when we receive partial tool results for a multi-interrupt scenario.
     * We store the partial results and signal to the client that we're still waiting.
     * The client should NOT re-execute tools - we're just waiting for more results to arrive.
     */
    private async *createWaitingGenerator(
        context: ThreadContext,
        missingInterrupts: ParsedInterrupt[]
    ): AsyncIterable<LangGraphChatCompletionChunk> {
        const messageId = ulid()
        
        // Log what we're waiting for
        console.log('Waiting for remaining tool results:', missingInterrupts.map(i => ({
            toolName: i.toolName,
            toolCallId: i.toolCallId
        })))

        // Emit a status message indicating we're waiting for more results
        // We do NOT re-emit tool calls to avoid duplicate execution
        yield {
            ...this.createChunk(
                messageId, 
                `Waiting for ${missingInterrupts.length} more tool result(s)...`, 
                null,
                undefined,
                'assistant'
            ),
            langgraph: {
                thread_id: context.langGraphThreadId,
                interrupted: true,
                interrupts: missingInterrupts,
            }
        }

        // Final chunk with 'stop' finish reason (not 'tool_calls' to avoid re-execution)
        // The client should send the remaining tool results in the next message
        yield {
            ...this.createChunk(messageId, '', 'stop'),
            langgraph: {
                thread_id: context.langGraphThreadId,
                interrupted: true,
                interrupts: missingInterrupts,
            }
        }
    }

    /**
     * Stream a run and yield completion chunks
     */
    private async *streamRun(
        context: ThreadContext,
        payload: CreateRunPayload,
        abortController?: AbortController
    ): AsyncIterable<LangGraphChatCompletionChunk> {
        const url = `/threads/${context.langGraphThreadId}/runs/stream`

        try {
            const response = await this.fetch(url, {
                method: 'POST',
                body: JSON.stringify(payload),
                signal: abortController?.signal,
            })

            if (!response.ok) {
                const errorText = await response.text()
                throw new Error(`Run failed: ${response.status} ${errorText}`)
            }

            const reader = response.body?.getReader()
            if (!reader) {
                throw new Error('No response body reader')
            }

            const decoder = new TextDecoder()
            let buffer = ''
            let messageId = ulid()
            let accumulatedContent = ''
            let runId: string | undefined
            let isInterrupted = false
            let interrupts: ParsedInterrupt[] = []

            try {
                while (true) {
                    const { done, value } = await reader.read()

                    if (done) break
                    if (abortController?.signal.aborted) break

                    buffer += decoder.decode(value, { stream: true })
                    const lines = buffer.split('\n')
                    buffer = lines.pop() || ''

                    for (const line of lines) {
                        if (!line.trim()) continue

                        // Parse SSE format: "event: <type>" followed by "data: <json>"
                        if (line.startsWith('event:')) {
                            // Event type line - we'll get the data in the next line
                            continue
                        }

                        if (line.startsWith('data:')) {
                            const dataStr = line.slice(5).trim()
                            if (!dataStr || dataStr === '[DONE]') continue

                            try {
                                const data = JSON.parse(dataStr)
                                
                                // Skip null or undefined data
                                if (data == null) continue
                                
                                // Debug: Log all incoming data that has __interrupt__ or messages
                                if (data.__interrupt__ || data.interrupts || (data.messages && !Array.isArray(data))) {
                                    console.log('LangGraph SSE data with potential interrupt/state:', JSON.stringify(data, null, 2))
                                }

                                // Handle different event types based on data structure
                                if (data.run_id) {
                                    runId = data.run_id
                                    context.lastRunId = runId
                                }

                                // Handle messages/partial or messages/complete
                                if (Array.isArray(data) && data.length > 0) {
                                    const lastMessage = data[data.length - 1]

                                    if (lastMessage.type === 'ai' || lastMessage.role === 'assistant') {
                                        const content = lastMessage.content || ''

                                        // Calculate delta (new content since last update)
                                        if (content.length > accumulatedContent.length) {
                                            const delta = content.slice(accumulatedContent.length)
                                            accumulatedContent = content

                                            yield this.createChunk(messageId, delta, null, undefined,
                                                accumulatedContent.length === delta.length ? 'assistant' : undefined)
                                        }

                                        // Handle tool calls - WE DO NOT STREAM THEM IMMEDIATELY
                                        // We only emit tool calls that come from interrupts to ensure internal tools are ignored
                                    }
                                }

                                // Handle interrupt data in values event
                                // LangGraph uses __interrupt__ key for interrupt data
                                const interruptKey = data.__interrupt__ || data.interrupts
                                if (interruptKey) {
                                    const interruptArray = Array.isArray(interruptKey) 
                                        ? interruptKey 
                                        : Object.values(interruptKey).flat()
                                    if (interruptArray.length > 0) {
                                        isInterrupted = true
                                        // Accumulate interrupts instead of overwriting
                                        const newInterrupts = (interruptArray as (InterruptData | LangGraphInterruptItem)[]).map(i => parseInterrupt(i))
                                        for (const newInt of newInterrupts) {
                                            // Only add if not already present (by interruptId)
                                            if (!interrupts.some(existing => existing.interruptId === newInt.interruptId)) {
                                                interrupts.push(newInt)
                                            }
                                        }
                                        context.pendingInterrupts = interrupts
                                        context.status = 'interrupted'
                                        console.log('Detected interrupts from stream:', newInterrupts.map(i => ({ name: i.toolName, interruptId: i.interruptId })))
                                        console.log('Total accumulated interrupts:', interrupts.length)
                                    }
                                }

                                // Handle thread status updates
                                if (data.status === 'interrupted') {
                                    isInterrupted = true
                                    context.status = 'interrupted'
                                }

                            } catch (parseError) {
                                console.warn('Failed to parse SSE data:', dataStr, parseError)
                            }
                        }
                    }
                }
            } finally {
                reader.releaseLock()
            }

            // Fallback: If interrupted but we didn't capture interrupts from the stream, fetch them from thread
            if (isInterrupted && interrupts.length === 0) {
                console.log('Run interrupted but no interrupts in stream, fetching thread state...')
                try {
                    const thread = await this.fetchThread(context.langGraphThreadId)
                    if (thread.interrupts) {
                        const interruptList = Object.values(thread.interrupts).flat() as (InterruptData | LangGraphInterruptItem)[]
                        interrupts = interruptList.map(i => parseInterrupt(i))
                        console.log('Fetched interrupts from thread:', interrupts)
                    }
                } catch (err) {
                    console.error('Failed to fetch thread state after interrupt:', err)
                }
            }

            // Filter for external tool calls only
            console.log('All interrupts before filtering:', interrupts.map(i => ({
                toolName: i.toolName,
                toolCallId: i.toolCallId,
                metadata: i.metadata,
                hasMetadata: !!i.metadata,
                isExternal: i.metadata?.type === 'external'
            })))
            
            const externalInterrupts = interrupts.filter(i =>
                i.metadata && i.metadata.type === 'external'
            )
            
            console.log('External interrupts after filtering:', externalInterrupts.length)

            // If we have interrupts but none are external, we should treat this as a normal stop
            // to avoid showing internal tool calls to the user or getting stuck
            if (isInterrupted && interrupts.length > 0 && externalInterrupts.length === 0) {
                console.log('Ignoring internal interrupts:', interrupts.map(i => i.toolName))
                isInterrupted = false
            }

            // If interrupted (and we have valid external calls), we emit them
            if (isInterrupted && externalInterrupts.length > 0) {
                console.log('Emitting external tool calls:', externalInterrupts.map(i => i.toolName))
                const interruptToolCalls = externalInterrupts.map((i, index) => ({
                    index,
                    id: i.toolCallId,
                    type: 'function' as const,
                    function: {
                        name: i.toolName,
                        arguments: JSON.stringify(i.arguments)
                    }
                }))

                // Emit the tool calls chunk
                yield this.createChunk(messageId, '', null, interruptToolCalls)
            }

            // Send final chunk with appropriate finish reason
            // Only 'tool_calls' if we actually emitted interrupts
            const finishReason = isInterrupted ? 'tool_calls' : 'stop'

            const finalChunk: LangGraphChatCompletionChunk = {
                ...this.createChunk(messageId, '', finishReason),
                langgraph: {
                    thread_id: context.langGraphThreadId,
                    run_id: runId,
                    interrupted: isInterrupted,
                    interrupts: isInterrupted ? externalInterrupts : undefined,
                }
            }

            yield finalChunk

        } catch (error) {
            if (abortController?.signal.aborted) {
                return
            }

            console.error('LangGraph stream error:', error)
            yield this.createErrorChunk(error instanceof Error ? error.message : 'Unknown error')
        }
    }

    /**
     * Wait for a run to complete (non-streaming)
     */
    private async waitForRun(
        context: ThreadContext,
        payload: CreateRunPayload,
        abortController?: AbortController
    ): Promise<chatCompletion> {
        const url = `/threads/${context.langGraphThreadId}/runs/wait`

        const response = await this.fetch(url, {
            method: 'POST',
            body: JSON.stringify(payload),
            signal: abortController?.signal,
        })

        if (!response.ok) {
            throw new Error(`Run failed: ${response.statusText}`)
        }

        const result = await response.json()

        // Extract the last AI message
        const messages = result.values?.messages || []
        const lastAIMessage = [...messages].reverse().find(
            (m: { type?: string; role?: string }) => m.type === 'ai' || m.role === 'assistant'
        )

        return {
            id: ulid(),
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: this.assistantId,
            choices: [{
                index: 0,
                message: {
                    role: 'assistant',
                    content: lastAIMessage?.content || '',
                    tool_calls: lastAIMessage?.tool_calls?.map((tc: { id: string; name: string; args: unknown }) => ({
                        id: tc.id,
                        type: 'function',
                        function: {
                            name: tc.name,
                            arguments: typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args)
                        }
                    }))
                },
                finish_reason: result.status === 'interrupted' ? 'tool_calls' : 'stop',
            }],
            usage: {
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0,
            }
        }
    }

    // ===========================================================================
    // Helper Methods
    // ===========================================================================

    /**
     * Convert OpenAI-style messages to LangGraph format
     */
    private convertMessages(messages: chatCompletionRequest['messages']): LangGraphMessage[] {
        return (messages || []).map(msg => ({
            role: msg.role as 'user' | 'assistant' | 'system' | 'tool',
            content: typeof msg.content === 'string'
                ? msg.content
                : JSON.stringify(msg.content),
            tool_call_id: (msg as { tool_call_id?: string }).tool_call_id,
            tool_calls: (msg as { tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }> }).tool_calls?.map(tc => ({
                id: tc.id,
                type: 'function' as const,
                function: tc.function
            }))
        }))
    }

    /**
     * Extract tool results from messages (for resuming interrupted runs)
     */
    private extractToolResults(messages: chatCompletionRequest['messages']): Array<{ toolCallId: string; result: string }> {
        return (messages || [])
            .filter(msg => msg.role === 'tool')
            .map(msg => ({
                toolCallId: (msg as { tool_call_id?: string }).tool_call_id || '',
                result: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
            }))
            .filter(r => r.toolCallId)
    }

    /**
     * Create a completion chunk
     */
    private createChunk(
        messageId: string,
        content: string | null,
        finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null,
        toolCalls?: Array<{
            index: number
            id?: string
            type?: 'function'
            function?: { name?: string; arguments?: string }
        }>,
        role?: 'assistant'
    ): chatCompletionChunk {
        return {
            id: messageId,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: this.assistantId,
            choices: [{
                index: 0,
                delta: {
                    ...(role && { role }),
                    ...(content && { content }),
                    ...(toolCalls && { tool_calls: toolCalls }),
                },
                finish_reason: finishReason,
            }],
        }
    }

    /**
     * Create an error chunk
     */
    private createErrorChunk(errorMessage: string): chatCompletionChunk {
        return this.createChunk(
            ulid(),
            `Error: ${errorMessage}`,
            'stop',
            undefined,
            'assistant'
        )
    }

    /**
     * Fetch wrapper with authentication and base URL
     */
    private async fetch(path: string, options: RequestInit = {}): Promise<Response> {
        const url = `${this.baseUrl}${path}`
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...(options.headers as Record<string, string> || {}),
        }

        if (this.apiKey) {
            headers['X-Api-Key'] = this.apiKey
            headers['Authorization'] = `Bearer ${this.apiKey}`
        }

        // Use Tauri's fetch to bypass CORS
        return fetchTauri(url, {
            ...options,
            headers,
        })
    }

    // Required abstract method implementations
    async delete(_modelId: string): Promise<void> {
        // No-op for remote agents
    }

    async import(_modelId: string, _opts: unknown): Promise<void> {
        // No-op for remote agents
    }

    async abortImport(_modelId: string): Promise<void> {
        // No-op for remote agents
    }
}
