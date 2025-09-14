// File: c:\Users\Kush2\Desktop\Unreal-Projects\Friday\web-app\src\components\SketchViewer.tsx

import React, { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { SketchData, renderSketchToSvg } from '@/utils/sketchRenderer'
import { Button } from '@/components/ui/button'
import { Download, Grid3X3, Spline } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export interface SketchViewerProps {
  sketchData: SketchData
  className?: string
  title?: string
}

export const SketchViewer: React.FC<SketchViewerProps> = ({ 
  sketchData, 
  className,
  title = "Sketch"
}) => {
  const [showGrid, setShowGrid] = useState(false)
  const [smooth, setSmooth] = useState(false)

  const svgContent = useMemo(() => {
    return renderSketchToSvg(sketchData, {
      gridRes: 64,
      canvasPx: 512,
      showGrid,
      smooth
    })
  }, [sketchData, showGrid, smooth])

  const handleDownload = () => {
    const blob = new Blob([svgContent], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${title.toLowerCase().replace(/\s+/g, '_')}.svg`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <div className={cn("sketch-viewer bg-white rounded-lg border border-main-view-fg/10 p-4", className)}>
      {/* Controls */}
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-medium text-main-view-fg/80">{title}</h4>
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={showGrid ? "default" : "link"}
                size="sm"
                onClick={() => setShowGrid(!showGrid)}
                className="h-8 w-8 p-0"
              >
                <Grid3X3 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Toggle grid</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={smooth ? "default" : "link"}
                size="sm"
                onClick={() => setSmooth(!smooth)}
                className="h-8 w-8 p-0"
              >
                <Spline className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Toggle smooth curves</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="link"
                size="sm"
                onClick={handleDownload}
                className="h-8 w-8 p-0"
              >
                <Download className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Download SVG</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* SVG Display */}
      <div className="sketch-display bg-gray-50 rounded border border-main-view-fg/5 p-2">
        <div 
          className="w-full max-w-md mx-auto"
          dangerouslySetInnerHTML={{ __html: svgContent }}
        />
      </div>

      {/* Stroke Count Info */}
      <div className="mt-2 text-xs text-main-view-fg/60">
        {sketchData.strokes?.length || 0} stroke(s)
      </div>
    </div>
  )
}