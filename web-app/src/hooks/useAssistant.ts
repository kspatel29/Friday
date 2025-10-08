import { getServiceHub } from '@/hooks/useServiceHub'
import { Assistant as CoreAssistant } from '@janhq/core'
import { create } from 'zustand'
import { localStorageKey } from '@/constants/localStorage'

interface AssistantState {
  assistants: Assistant[]
  currentAssistant: Assistant
  addAssistant: (assistant: Assistant) => void
  updateAssistant: (assistant: Assistant) => void
  deleteAssistant: (id: string) => void
  setCurrentAssistant: (assistant: Assistant, saveToStorage?: boolean) => void
  setAssistants: (assistants: Assistant[]) => void
  getLastUsedAssistant: () => string | null
  setLastUsedAssistant: (assistantId: string) => void
  initializeWithLastUsed: () => void
}

// Helper functions for localStorage
const getLastUsedAssistantId = (): string | null => {
  try {
    return localStorage.getItem(localStorageKey.lastUsedAssistant)
  } catch (error) {
    console.debug('Failed to get last used assistant from localStorage:', error)
    return null
  }
}

const setLastUsedAssistantId = (assistantId: string) => {
  try {
    localStorage.setItem(localStorageKey.lastUsedAssistant, assistantId)
  } catch (error) {
    console.debug('Failed to set last used assistant in localStorage:', error)
  }
}

export const defaultAssistant: Assistant = {
  id: 'Friday',
  name: 'Friday',
  created_at: 1747029866.542,
  parameters: {},
  avatar: '🎮',
  description:
    'Friday is an expert in game development that will save you some serious time and boost your productivity 10 folds.',
  instructions:
    ``,
}

// Test assistant with locked tool configuration
export const testLockedAssistant: Assistant = {
  id: 'test-locked-assistant',
  name: 'Locked Tools Assistant',
  created_at: Date.now(),
  parameters: {},
  avatar: '🔒',
  description: 'A test assistant with predefined tool configuration that cannot be modified.',
  instructions: 'I am a test assistant with locked tool configuration. I can only use specific predefined tools.',
  lockToolConfiguration: true,
  enabledMCPTools: [
    'get_actors_in_level',
    'spawn_actor',
    'set_actor_transform',
    'fetch',
    'get_scene_info'
  ],
}

export const testHiddenSettingsAssistant: Assistant = {
  id: 'test-hidden-settings-assistant',
  name: 'Hidden Settings Assistant',
  created_at: Date.now(),
  parameters: {},
  avatar: '🔐',
  description: 'A test assistant whose settings cannot be accessed or modified.',
  instructions: 'I am a test assistant with hidden settings. My configuration is locked and cannot be changed.',
  hideSettings: true,
}

export const useAssistant = create<AssistantState>()((set, get) => ({
  assistants: [defaultAssistant],
  currentAssistant: defaultAssistant,
  addAssistant: (assistant) => {
    set({ assistants: [...get().assistants, assistant] })
    getServiceHub().assistants().createAssistant(assistant as unknown as CoreAssistant).catch((error) => {
      console.error('Failed to create assistant:', error)
    })
  },
  updateAssistant: (assistant) => {
    const state = get()
    set({
      assistants: state.assistants.map((a) =>
        a.id === assistant.id ? assistant : a
      ),
      // Update currentAssistant if it's the same assistant being updated
      currentAssistant:
        state.currentAssistant.id === assistant.id
          ? assistant
          : state.currentAssistant,
    })
    // Create assistant already cover update logic
    getServiceHub().assistants().createAssistant(assistant as unknown as CoreAssistant).catch((error) => {
      console.error('Failed to update assistant:', error)
    })
  },
  deleteAssistant: (id) => {
    const state = get()
    getServiceHub().assistants().deleteAssistant(
      state.assistants.find((e) => e.id === id) as unknown as CoreAssistant
    ).catch((error) => {
      console.error('Failed to delete assistant:', error)
    })

    // Check if we're deleting the current assistant
    const wasCurrentAssistant = state.currentAssistant.id === id

    set({ assistants: state.assistants.filter((a) => a.id !== id) })

    // If the deleted assistant was current, fallback to default and update localStorage
    if (wasCurrentAssistant) {
      set({ currentAssistant: defaultAssistant })
      setLastUsedAssistantId(defaultAssistant.id)
    }
  },
  setCurrentAssistant: (assistant, saveToStorage = true) => {
    set({ currentAssistant: assistant })
    if (saveToStorage) {
      setLastUsedAssistantId(assistant.id)
    }
  },
  setAssistants: (assistants) => {
    set({ assistants })
  },
  getLastUsedAssistant: () => {
    return getLastUsedAssistantId()
  },
  setLastUsedAssistant: (assistantId) => {
    setLastUsedAssistantId(assistantId)
  },
  initializeWithLastUsed: () => {
    const lastUsedId = getLastUsedAssistantId()
    if (lastUsedId) {
      const lastUsedAssistant = get().assistants.find(
        (a) => a.id === lastUsedId
      )
      if (lastUsedAssistant) {
        set({ currentAssistant: lastUsedAssistant })
      } else {
        // Fallback to default if last used assistant was deleted
        set({ currentAssistant: defaultAssistant })
        setLastUsedAssistantId(defaultAssistant.id)
      }
    }
  },
}))
