export type ToolCall = {
  tool: {
    id?: number | string
    tool_call_id?: string
    external_execution_required?: boolean
    function?: {
      name?: string
      arguments?: string | Record<string, unknown>
    }
  }
  response?: unknown
  state?: string
}
