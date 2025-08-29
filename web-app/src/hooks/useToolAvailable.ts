import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { localStorageKey } from '@/constants/localStorage'
import { MCPTool } from '@/types/completion'
import { useAssistant } from './useAssistant'
import { useAppState } from './useAppState'

type ToolDisabledState = {
  // Track disabled tools per thread
  disabledTools: Record<string, string[]> // threadId -> toolNames[]
  // Global default disabled tools (for new threads/index page)
  defaultDisabledTools: string[]

  // Actions
  setToolDisabledForThread: (
    threadId: string,
    toolName: string,
    available: boolean
  ) => void
  isToolDisabled: (threadId: string, toolName: string) => boolean
  isToolLocked: (threadId: string, toolName: string) => boolean
  getDisabledToolsForThread: (threadId: string) => string[]
  setDefaultDisabledTools: (toolNames: string[]) => void
  getDefaultDisabledTools: () => string[]
  // Initialize thread tools from default or existing thread settings
  initializeThreadTools: (threadId: string, allTools: MCPTool[]) => void
}

export const useToolAvailable = create<ToolDisabledState>()(
  persist(
    (set, get) => ({
      disabledTools: {},
      defaultDisabledTools: [],

      setToolDisabledForThread: (
        threadId: string,
        toolName: string,
        available: boolean
      ) => {
        // Check if tool configuration is locked by assistant
        const assistantState = useAssistant.getState()
        const currentAssistant = assistantState.currentAssistant
        
        if (currentAssistant?.lockToolConfiguration) {
          console.warn(`Tool configuration is locked by assistant: ${currentAssistant.name}`)
          return
        }

        set((state) => {
          const currentTools = state.disabledTools[threadId] || []
          let updatedTools: string[]

          if (available) {
            // Remove disabled tool
            updatedTools = [...currentTools.filter((tool) => tool !== toolName)]
          } else {
            // Disable tool
            updatedTools = [...currentTools, toolName]
          }

          return {
            disabledTools: {
              ...state.disabledTools,
              [threadId]: updatedTools,
            },
          }
        })
      },

      isToolDisabled: (threadId: string, toolName: string) => {
        const assistantState = useAssistant.getState()
        const currentAssistant = assistantState.currentAssistant
        
        // If assistant has locked tool configuration, use that
        if (currentAssistant?.lockToolConfiguration && currentAssistant?.enabledMCPTools) {
          // Tool is disabled if it's NOT in the enabled list
          return !currentAssistant.enabledMCPTools.includes(toolName)
        }
        
        // Normal behavior when not locked
        const state = get()
        if (!state.disabledTools[threadId]) {
          return state.defaultDisabledTools.includes(toolName)
        }
        return state.disabledTools[threadId]?.includes(toolName) || false
      },

      isToolLocked: (_threadId: string, _toolName: string) => {
        const assistantState = useAssistant.getState()
        const currentAssistant = assistantState.currentAssistant
        
        // If assistant has lockToolConfiguration set to true, all tools are locked
        return currentAssistant?.lockToolConfiguration === true
      },

      getDisabledToolsForThread: (threadId: string) => {
        const assistantState = useAssistant.getState()
        const currentAssistant = assistantState.currentAssistant
        
        // If assistant has locked tool configuration, calculate disabled tools from enabled list
        if (currentAssistant?.lockToolConfiguration && currentAssistant?.enabledMCPTools) {
          // Get all available tools to determine which ones are not enabled
          const { tools } = useAppState.getState()
          
          const disabledTools = tools
            .filter(tool => !currentAssistant.enabledMCPTools!.includes(tool.name))
            .map(tool => tool.name)
          
          return disabledTools
        }
        
        // Normal behavior when not locked
        const state = get()
        if (!state.disabledTools[threadId]) {
          return state.defaultDisabledTools
        }
        return state.disabledTools[threadId] || []
      },

      setDefaultDisabledTools: (toolNames: string[]) => {
        set({ defaultDisabledTools: toolNames })
      },

      getDefaultDisabledTools: () => {
        return get().defaultDisabledTools
      },

      initializeThreadTools: (threadId: string, allTools: MCPTool[]) => {
        const assistantState = useAssistant.getState()
        const currentAssistant = assistantState.currentAssistant
        
        // If assistant has locked tool configuration, don't initialize thread-specific settings
        if (currentAssistant?.lockToolConfiguration) {
          return
        }
        
        const state = get()
        // If thread already has settings, don't override
        if (state.disabledTools[threadId]) {
          return
        }

        // Initialize with default tools only
        const initialTools = state.defaultDisabledTools.filter((toolName) =>
          allTools.some((tool) => tool.name === toolName)
        )

        set((currentState) => ({
          disabledTools: {
            ...currentState.disabledTools,
            [threadId]: initialTools,
          },
        }))
      },
    }),
    {
      name: localStorageKey.toolAvailability,
      storage: createJSONStorage(() => localStorage),
      // Persist all state
      partialize: (state) => ({
        disabledTools: state.disabledTools,
        defaultDisabledTools: state.defaultDisabledTools,
      }),
    }
  )
)