import { useEffect, useState, useCallback } from 'react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useThreads } from '@/hooks/useThreads'
import { useModelProvider } from '@/hooks/useModelProvider'

type DropdownModelProviderProps = {
  useLastUsedModel?: boolean
}

// The id needs to be changed based on requirement.
const PROVIDER_NAME = 'gamewave-agent' // add near top

const ASK_MODEL = { id: 'Ask', label: 'Ask' }
const AGENT_MODEL = { id: 'Agent', label: 'Agent' }

const ModeDropdownProvider = ({
  // useLastUsedModel = false,
}: DropdownModelProviderProps) => {
  const { selectModelProvider, selectedModel, registeredEngines } =
    useModelProvider()
  const isEngineReady = registeredEngines[PROVIDER_NAME]
  const { updateCurrentThreadModel } = useThreads()

  const [open, setOpen] = useState(false)
  const [displayModel, setDisplayModel] = useState<string>('')

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

  return (
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
  )
}

export default ModeDropdownProvider
