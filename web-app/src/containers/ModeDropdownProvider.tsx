import { useEffect, useState, useCallback } from 'react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useThreads } from '@/hooks/useThreads'
import { useModelProvider } from '@/hooks/useModelProvider'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { RefreshCw } from 'lucide-react'
import { useServiceHub } from '@/hooks/useServiceHub'

type DropdownModelProviderProps = {
  useLastUsedModel?: boolean
}

// The id needs to be changed based on requirement.
const PROVIDER_NAME = 'gamewave-agent' // add near top

const ASK_MODEL = { id: 'ask', label: 'Ask' }
const AGENT_MODEL = { id: 'agent', label: 'Agent' }

const ModeDropdownProvider = ({
  // useLastUsedModel = false,
}: DropdownModelProviderProps) => {
  const { selectModelProvider, selectedModel, registeredEngines, setEngineRegistered } =
    useModelProvider()
  const isEngineReady = registeredEngines[PROVIDER_NAME]
  const serviceHub = useServiceHub()

  useEffect(() => {
    if (!isEngineReady) {
      setEngineRegistered(PROVIDER_NAME, true)
    }
  }, [isEngineReady, setEngineRegistered])

  const { updateCurrentThreadModel } = useThreads()

  const [open, setOpen] = useState(false)
  const [displayModel, setDisplayModel] = useState<string>('')
  const [refreshing, setRefreshing] = useState(false)

  // Initialize display model based on selected, default to Ask if none
  useEffect(() => {
    if (!isEngineReady) return
    if (selectedModel?.id) {
      setDisplayModel(
        selectedModel.id === ASK_MODEL.id ? ASK_MODEL.label : AGENT_MODEL.label
      )
    } else {
      selectModelProvider(PROVIDER_NAME, ASK_MODEL.id)
      updateCurrentThreadModel({ id: ASK_MODEL.id, provider: PROVIDER_NAME })
      setDisplayModel(ASK_MODEL.label)
    }
  }, [
    isEngineReady,
    selectModelProvider,
    updateCurrentThreadModel,
    selectedModel,
  ])

  // Sync displayModel with selectedModel changes
  useEffect(() => {
    if (selectedModel?.id) {
      setDisplayModel(
        selectedModel.id === ASK_MODEL.id ? ASK_MODEL.label : AGENT_MODEL.label
      )
    }
  }, [selectedModel])

  // Handle selection
  const handleSelect = useCallback(
    (option: typeof ASK_MODEL | typeof AGENT_MODEL) => {
      selectModelProvider(PROVIDER_NAME, option.id)
      updateCurrentThreadModel({ id: option.id, provider: PROVIDER_NAME })
      setDisplayModel(option.label)
      setOpen(false)
    },
    [selectModelProvider, updateCurrentThreadModel]
  )

  const handleRefresh = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await serviceHub.mcp().restartMCPServers()
    } catch (error) {
      console.error('Failed to refresh MCP connections:', error)
    } finally {
      setRefreshing(false)
    }
  }, [refreshing, serviceHub])

  return (
    <div className="flex items-center gap-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <div className="bg-main-view-fg/5 hover:bg-main-view-fg/8 px-2 py-1 flex items-center gap-1.5 rounded-sm">
          <PopoverTrigger asChild>
            <button
              title={displayModel}
              className="font-medium cursor-pointer flex items-center gap-1.5 disabled:cursor-not-allowed"
              disabled={!isEngineReady}
            >
              <span
                className={cn(
                  'text-main-view-fg/80 truncate leading-normal',
                  !selectedModel?.id && 'text-main-view-fg/50'
                )}
              >
                {isEngineReady ? displayModel || 'Select Mode' : 'Loading...'}
              </span>
            </button>
          </PopoverTrigger>
        </div>

        <PopoverContent
          className="w-40 p-0 backdrop-blur-2xl"
          align="start"
          sideOffset={10}
        >
          <div className="flex flex-col">
            {[ASK_MODEL, AGENT_MODEL].map((option) => {
              const isSelected = selectedModel?.id === option.id
              return (
                <div
                  key={option.id}
                  onClick={() => handleSelect(option)}
                  className={cn(
                    'px-3 py-2 cursor-pointer text-sm hover:bg-main-view-fg/4',
                    isSelected && 'bg-main-view-fg/8 font-medium'
                  )}
                >
                  {option.label}
                </div>
              )
            })}
          </div>
        </PopoverContent>
      </Popover>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={cn(
                'p-1.5 rounded-sm text-main-view-fg/60 hover:bg-main-view-fg/8 transition-colors',
                (!isEngineReady || refreshing) && 'opacity-60 cursor-not-allowed'
              )}
              onClick={handleRefresh}
              disabled={!isEngineReady || refreshing}
            >
              <RefreshCw
                className={cn('size-4', refreshing && 'animate-spin')}
              />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Refresh MCP connections</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  )
}

export default ModeDropdownProvider
