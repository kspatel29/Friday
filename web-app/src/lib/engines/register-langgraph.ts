/**
 * LangGraph Engine Registration
 * 
 * Registers the LangGraph engine with Friday's extension system.
 * This file is auto-executed on import to ensure the engine is available.
 */

import { ExtensionManager } from '@/lib/extension'
import { LangGraphEngine } from './langgraph'

// Store the engine instance for dynamic configuration updates
let langGraphEngineInstance: LangGraphEngine | null = null

/**
 * Get or create the LangGraph engine singleton
 * 
 * This ensures we only have one engine instance that can be reconfigured
 */
export function getLangGraphEngine(): LangGraphEngine | null {
    return langGraphEngineInstance
}

/**
 * Register the LangGraph Engine with the application
 * 
 * @param baseUrl - Base URL of the LangGraph server (default: http://localhost:8123)
 * @param apiKey - Optional API key for authentication
 * @param assistantId - The graph name or assistant ID to use (default: 'agent')
 */
export function registerLangGraphEngine(
    baseUrl: string = 'http://localhost:8123',
    apiKey?: string,
    assistantId: string = 'agent'
): LangGraphEngine | null {
    try {
        console.log('Registering LangGraph Engine:', { baseUrl, assistantId })

        const engine = new LangGraphEngine(baseUrl, apiKey, assistantId)
        langGraphEngineInstance = engine

        const extensionManager = ExtensionManager.getInstance()

        // Register the engine using the standard register method
        extensionManager.register('langgraph', engine)

        console.log('LangGraph Engine registered successfully')

        return engine
    } catch (error) {
        console.error('Failed to register LangGraph Engine:', error)
        return null
    }
}

/**
 * Update the LangGraph engine configuration
 * Called when provider settings change
 */
export function updateLangGraphConfig(baseUrl: string, apiKey?: string, assistantId?: string): void {
    try {
        // Check if window.core is ready
        if (typeof window === 'undefined' || !window.core?.extensionManager) {
            console.warn('ExtensionManager not ready, registering directly')
        }

        console.log('Updating LangGraph Engine config:', { baseUrl, assistantId })
        
        // If we already have an engine instance, update its configuration instead of creating a new one
        // This preserves the thread contexts across config updates
        if (langGraphEngineInstance) {
            console.log('Updating existing LangGraph engine instance')
            // Update the internal properties directly to preserve thread state
            ;(langGraphEngineInstance as any).baseUrl = baseUrl.replace(/\/$/, '')
            ;(langGraphEngineInstance as any).apiKey = apiKey
            if (assistantId) {
                langGraphEngineInstance.setAssistantId(assistantId)
            }
        } else {
            // Create new engine if none exists
            const engine = new LangGraphEngine(baseUrl, apiKey, assistantId || 'agent')
            langGraphEngineInstance = engine

            const extensionManager = ExtensionManager.getInstance()
            extensionManager.register('langgraph', engine)
        }
    } catch (error) {
        console.error('Failed to update LangGraph config:', error)
    }
}

/**
 * Create a LangGraph engine instance without registering
 * Useful for testing or manual integration
 */
export function createLangGraphEngine(
    baseUrl: string = 'http://localhost:8123',
    apiKey?: string,
    assistantId: string = 'agent'
): LangGraphEngine {
    return new LangGraphEngine(baseUrl, apiKey, assistantId)
}

// Auto-register on import when the window is ready
// This uses a default configuration that can be updated later
function initializeLangGraphEngine(): void {
    if (typeof window === 'undefined') return

    // Wait for core to be ready
    const checkAndRegister = (): void => {
        if (window.core?.extensionManager) {
            // Use default values initially - these will be updated when provider settings are loaded
            registerLangGraphEngine('http://localhost:8123', undefined, 'agent')
        } else {
            // Retry after a short delay
            setTimeout(checkAndRegister, 100)
        }
    }

    // Start checking
    if (document.readyState === 'complete') {
        checkAndRegister()
    } else {
        window.addEventListener('load', checkAndRegister)
    }
}

// Initialize on import
initializeLangGraphEngine()
