import { ExtensionManager } from '@/lib/extension'
import { AgnoAgentEngine } from './agui'

/**
 * Register the Agno Agent Engine with the application
 */
export function registerAgnoAgent(baseUrl: string = 'http://localhost:8000', apiKey?: string) {
  try {
    console.log('AgnoAgentEngine constructed with baseUrl:', baseUrl)
    const agnoEngine = new AgnoAgentEngine(baseUrl, apiKey)
    
    // Wait for window.core to be available
    const registerEngine = () => {
      if (typeof window !== 'undefined' && window.core?.extensionManager) {
        const extensionManager = ExtensionManager.getInstance()
        
        // Register the engine using the standard register method
        // This will automatically register it in the engines map since AgnoAgentEngine has a provider property
        extensionManager.register('agno-agent', agnoEngine)
        
        console.log('Agno Agent Engine registered successfully')
        // Test that the engine can be retrieved
        const retrievedEngine = extensionManager.getEngine('agno-agent')
        console.log('Retrieved engine:', retrievedEngine ? 'Found' : 'Not found')
        
        return agnoEngine
      } else {
        // Retry after a short delay
        setTimeout(registerEngine, 100)
        return null
      }
    }
    
    return registerEngine()
  } catch (error) {
    console.error('Failed to register Agno Agent Engine:', error)
    return null
  }
}

// Auto-register the engine when the module loads
if (typeof window !== 'undefined') {
  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => registerAgnoAgent())
  } else {
    registerAgnoAgent()
  }
}