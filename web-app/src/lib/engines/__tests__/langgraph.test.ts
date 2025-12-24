/**
 * LangGraph Engine Tests
 * 
 * Tests for the LangGraph engine, focusing on:
 * - Thread management
 * - Interrupt handling (single and multiple)
 * - Resume with tool results
 * - Partial result accumulation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock the dependencies
vi.mock('@tauri-apps/plugin-http', () => ({
    fetch: vi.fn()
}))

vi.mock('ulidx', () => ({
    ulid: () => 'test-ulid-' + Math.random().toString(36).substr(2, 9)
}))

import { LangGraphEngine } from '../langgraph'
import { fetch as fetchTauri } from '@tauri-apps/plugin-http'

const mockFetch = fetchTauri as ReturnType<typeof vi.fn>

describe('LangGraphEngine', () => {
    let engine: LangGraphEngine

    beforeEach(() => {
        vi.clearAllMocks()
        engine = new LangGraphEngine('http://localhost:8123', undefined, 'test-agent')
    })

    afterEach(() => {
        engine.onUnload()
    })

    describe('constructor', () => {
        it('should initialize with correct properties', () => {
            expect(engine.provider).toBe('langgraph')
            expect(engine.baseUrl).toBe('http://localhost:8123')
        })

        it('should remove trailing slash from baseUrl', () => {
            const engineWithSlash = new LangGraphEngine('http://localhost:8123/', undefined, 'agent')
            expect(engineWithSlash.baseUrl).toBe('http://localhost:8123')
        })
    })

    describe('extractToolResults', () => {
        it('should extract tool results from messages', () => {
            const messages = [
                { role: 'user', content: 'Hello' },
                { role: 'assistant', content: 'Hi there' },
                { role: 'tool', content: 'Tool result 1', tool_call_id: 'call_1' },
                { role: 'tool', content: 'Tool result 2', tool_call_id: 'call_2' },
            ]

            // Access private method via any cast
            const results = (engine as any).extractToolResults(messages)

            expect(results).toHaveLength(2)
            expect(results[0]).toEqual({ toolCallId: 'call_1', result: 'Tool result 1' })
            expect(results[1]).toEqual({ toolCallId: 'call_2', result: 'Tool result 2' })
        })

        it('should filter out messages without tool_call_id', () => {
            const messages = [
                { role: 'tool', content: 'No ID' },
                { role: 'tool', content: 'Has ID', tool_call_id: 'call_1' },
            ]

            const results = (engine as any).extractToolResults(messages)

            expect(results).toHaveLength(1)
            expect(results[0].toolCallId).toBe('call_1')
        })
    })

    describe('resumeRun with multiple interrupts', () => {
        it('should store partial results when not all interrupts are resolved', async () => {
            const context = {
                langGraphThreadId: 'thread-123',
                status: 'interrupted' as const,
                pendingInterrupts: [
                    {
                        interruptId: 'interrupt-1',
                        toolCallId: 'call_1',
                        toolName: 'tool_a',
                        arguments: { arg: 'value1' },
                    },
                    {
                        interruptId: 'interrupt-2',
                        toolCallId: 'call_2',
                        toolName: 'tool_b',
                        arguments: { arg: 'value2' },
                    },
                ],
                lastRunId: 'run-123',
            }

            // Only provide one tool result
            const toolResults = [
                { toolCallId: 'call_1', result: 'Result 1' }
            ]

            const generator = await (engine as any).resumeRun(context, toolResults, {}, undefined)
            
            // Consume the generator
            const chunks: Array<{ choices?: Array<{ delta?: { content?: string } }> }> = []
            for await (const chunk of generator) {
                chunks.push(chunk as { choices?: Array<{ delta?: { content?: string } }> })
            }

            // Should have stored partial results
            expect((engine as any).partialToolResults?.get('thread-123')).toBeDefined()
            expect((engine as any).partialToolResults?.get('thread-123')).toHaveLength(1)
            
            // Should emit waiting message, not tool calls
            expect(chunks.some((c: { choices?: Array<{ delta?: { content?: string } }> }) => 
                c.choices?.[0]?.delta?.content?.includes('Waiting')
            )).toBe(true)
        })

        it('should merge stored partial results when all interrupts are resolved', async () => {
            // First, store a partial result (simulating first tool result already received)
            ;(engine as any).partialToolResults = new Map([
                ['thread-123', [{ interrupt_id: 'interrupt-1', value: 'Result 1' }]]
            ])

            // Context with only ONE remaining pending interrupt (the one we haven't resolved yet)
            // This simulates the state after the first tool result was stored
            const context = {
                langGraphThreadId: 'thread-123',
                status: 'interrupted' as const,
                pendingInterrupts: [
                    {
                        interruptId: 'interrupt-2',
                        toolCallId: 'call_2',
                        toolName: 'tool_b',
                        arguments: { arg: 'value2' },
                    },
                ],
                lastRunId: 'run-123',
            }

            // Mock the fetch for streaming
            mockFetch.mockResolvedValueOnce({
                ok: true,
                body: {
                    getReader: () => ({
                        read: vi.fn()
                            .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('event: end\ndata: null\n\n') })
                            .mockResolvedValueOnce({ done: true, value: undefined }),
                        releaseLock: vi.fn()
                    })
                }
            })

            // Provide the second tool result
            const toolResults = [
                { toolCallId: 'call_2', result: 'Result 2' }
            ]

            const generator = await (engine as any).resumeRun(context, toolResults, {}, undefined)
            
            // Consume the generator
            for await (const _ of generator) {
                // Just consume
            }

            // Partial results should be cleared after successful resume
            expect((engine as any).partialToolResults?.get('thread-123')).toBeUndefined()
        })

        it('should use array format with interrupt_id for multiple interrupts', async () => {
            let capturedPayload: any = null

            mockFetch.mockImplementation(async (url: string, options: any) => {
                if (url.includes('/runs/stream')) {
                    capturedPayload = JSON.parse(options.body)
                    return {
                        ok: true,
                        body: {
                            getReader: () => ({
                                read: vi.fn()
                                    .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('event: end\ndata: {}\n\n') })
                                    .mockResolvedValueOnce({ done: true, value: undefined }),
                                releaseLock: vi.fn()
                            })
                        }
                    }
                }
                return { ok: false }
            })

            const context = {
                langGraphThreadId: 'thread-123',
                status: 'interrupted' as const,
                pendingInterrupts: [
                    {
                        interruptId: 'interrupt-1',
                        toolCallId: 'call_1',
                        toolName: 'tool_a',
                        arguments: {},
                    },
                    {
                        interruptId: 'interrupt-2',
                        toolCallId: 'call_2',
                        toolName: 'tool_b',
                        arguments: {},
                    },
                ],
                lastRunId: 'run-123',
            }

            // Provide both tool results at once
            const toolResults = [
                { toolCallId: 'call_1', result: 'Result 1' },
                { toolCallId: 'call_2', result: 'Result 2' },
            ]

            const generator = await (engine as any).resumeRun(context, toolResults, {}, undefined)
            
            // Consume the generator
            for await (const _ of generator) {
                // Just consume
            }

            // Check that the command is a single object with resume as a dict mapping interrupt_id to value
            expect(capturedPayload).not.toBeNull()
            expect(capturedPayload.command).toHaveProperty('resume')
            expect(typeof capturedPayload.command.resume).toBe('object')
            expect(capturedPayload.command.resume).toHaveProperty('interrupt-1')
            expect(capturedPayload.command.resume).toHaveProperty('interrupt-2')
            expect(capturedPayload.command.resume['interrupt-1']).toBe('Result 1')
            expect(capturedPayload.command.resume['interrupt-2']).toBe('Result 2')
        })

        it('should use simple format for single interrupt', async () => {
            let capturedPayload: any = null

            mockFetch.mockImplementation(async (url: string, options: any) => {
                if (url.includes('/runs/stream')) {
                    capturedPayload = JSON.parse(options.body)
                    return {
                        ok: true,
                        body: {
                            getReader: () => ({
                                read: vi.fn()
                                    .mockResolvedValueOnce({ done: true, value: undefined }),
                                releaseLock: vi.fn()
                            })
                        }
                    }
                }
                return { ok: false }
            })

            const context = {
                langGraphThreadId: 'thread-123',
                status: 'interrupted' as const,
                pendingInterrupts: [
                    {
                        interruptId: 'interrupt-1',
                        toolCallId: 'call_1',
                        toolName: 'tool_a',
                        arguments: {},
                    },
                ],
                lastRunId: 'run-123',
            }

            const toolResults = [
                { toolCallId: 'call_1', result: 'Result 1' },
            ]

            const generator = await (engine as any).resumeRun(context, toolResults, {}, undefined)
            
            for await (const _ of generator) {
                // Just consume
            }

            // Check that the command is an object (not array) for single interrupt
            // Format: { resume: value }
            expect(capturedPayload).toBeDefined()
            expect(capturedPayload.command).not.toBeInstanceOf(Array)
            expect(capturedPayload.command.resume).toBe('Result 1')
        })
    })

    describe('getOrCreateThread with partial results', () => {
        it('should skip server refresh when partial results exist', async () => {
            // Setup: create a thread context and store partial results
            const mockThread = {
                thread_id: 'lg-thread-123',
                status: 'interrupted',
                interrupts: {}
            }

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: () => Promise.resolve(mockThread)
            })

            // First call creates the thread
            const context1 = await (engine as any).getOrCreateThread('friday-thread-1')
            expect(context1.langGraphThreadId).toBe('lg-thread-123')

            // Store partial results
            ;(engine as any).partialToolResults = new Map([
                ['lg-thread-123', [{ interrupt_id: 'int-1', value: 'partial' }]]
            ])

            // Reset mock to track if it's called again
            mockFetch.mockClear()

            // Second call should NOT fetch from server
            const context2 = await (engine as any).getOrCreateThread('friday-thread-1')
            
            expect(mockFetch).not.toHaveBeenCalled()
            expect(context2).toBe(context1) // Same context object
        })
    })

    describe('clearPartialResults', () => {
        it('should clear partial results for a specific thread', () => {
            ;(engine as any).partialToolResults = new Map([
                ['thread-1', [{ interrupt_id: 'int-1', value: 'v1' }]],
                ['thread-2', [{ interrupt_id: 'int-2', value: 'v2' }]],
            ])

            engine.clearPartialResults('thread-1')

            expect((engine as any).partialToolResults.has('thread-1')).toBe(false)
            expect((engine as any).partialToolResults.has('thread-2')).toBe(true)
        })
    })
})
