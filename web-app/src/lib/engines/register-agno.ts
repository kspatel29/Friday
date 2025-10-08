import { ExtensionManager } from '@/lib/extension'
import { AgnoAgentEngine } from './agui'
import { useModelProvider } from '@/hooks/useModelProvider'

/**
 * Register the Agno Agent Engine with the application
 */
export function registerAgnoAgent(
  baseUrl: string = 'https://mowbjvvzgrerertijhql.supabase.co/functions/v1/friday-agent-proxy',
  apiKey?: string
) {
  try {
    console.log('AgnoAgentEngine constructed with baseUrl:', baseUrl)

    // Wait for window.core to be available
    const registerEngine = (): AgnoAgentEngine | null => {
      if (typeof window !== 'undefined' && window.core?.extensionManager) {
        const extensionManager = ExtensionManager.getInstance()

        const existingEngine = extensionManager.getEngine<AgnoAgentEngine>('gamewave-agent')
        if (existingEngine instanceof AgnoAgentEngine) {
          existingEngine.updateConfig(baseUrl, apiKey)
          console.log('Agno Agent Engine config refreshed')
          useModelProvider.getState().setEngineRegistered('gamewave-agent', true)
          return existingEngine
        }

        const agnoEngine = new AgnoAgentEngine(baseUrl, apiKey)

        // Register the engine using the standard register method
        // This will automatically register it in the engines map since AgnoAgentEngine has a provider property
        extensionManager.register('gamewave-agent', agnoEngine)

        console.log('Agno Agent Engine registered successfully')

        useModelProvider.getState().setEngineRegistered('gamewave-agent', true)

        const retrievedEngine = extensionManager.getEngine('gamewave-agent')
        console.log('Retrieved engine:', retrievedEngine ? 'Found' : 'Not found')

        return agnoEngine
      }

      // Retry after a short delay
      setTimeout(registerEngine, 100)
      return null
    }

    return registerEngine()
  } catch (error) {
    console.error('Failed to register Agno Agent Engine:', error)
    return null
  }
}

// Auto-register the engine when the module loads, delayed to avoid UI conflicts
if (typeof window !== 'undefined') {
  // Wait for DOM to be ready and core to initialize
  const initRegistration = () => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', delayedRegister)
    } else {
      delayedRegister()
    }
  }

  const delayedRegister = () => {
    // Delay to ensure providers UI is initialized
    setTimeout(() => {
      console.log('Attempting auto-registration of AgnoAgentEngine')
      const result = registerAgnoAgent()
      if (result) {
        console.log('Auto-registration successful')
      } else {
        console.log('Auto-registration failed, will retry on settings load')
      }
    }, 2000) // 2 second delay
  }
  initRegistration()
}
