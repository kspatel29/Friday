import { useToolApproval } from '@/hooks/useToolApproval'
import { Switch } from '@/components/ui/switch'
import { useTranslation } from '@/i18n'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Info } from 'lucide-react'
const AllowAllMCPSwitch = () => {
  const { t } = useTranslation()
  const { allowAllMCPPermissions, setAllowAllMCPPermissions } =
    useToolApproval()
  return (
    <div className="flex items-center gap-2 ml-4">
      <span className="text-sm text-main-view-fg/80">Trust MCP Tools </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="text-main-view-fg/50 hover:text-main-view-fg/80 transition-colors"
          >
            <Info size={14} />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="top"
          align="start"
          className="max-w-xs text-sm leading-relaxed"
        >
          {t('mcp-servers:allowPermissionsDesc')}
        </TooltipContent>
      </Tooltip>

      <Switch
        checked={allowAllMCPPermissions}
        onCheckedChange={setAllowAllMCPPermissions}
      />
    </div>
  )
}
export default AllowAllMCPSwitch
