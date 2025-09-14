// File: c:\Users\Kush2\Desktop\Unreal-Projects\Friday\web-app\src\utils\sketchRenderer.ts

export interface SketchPoint {
  x: number
  y: number
}

export interface SketchStroke {
  points: string[]
}

export interface SketchData {
  strokes: SketchStroke[]
}

export interface RenderOptions {
  gridRes?: number
  canvasPx?: number
  showGrid?: boolean
  smooth?: boolean
}

/**
 * Parse a point token like 'x10y20' into {x: 10, y: 20}
 */
function parsePoint(token: string): SketchPoint {
  const cleanToken = token.trim().toLowerCase()
  if (!cleanToken.startsWith('x') || !cleanToken.includes('y')) {
    throw new Error(`Invalid point token: ${token}`)
  }
  
  try {
    const [xStr, yStr] = cleanToken.split('y', 2)
    const x = parseInt(xStr.slice(1)) // Remove leading 'x'
    const y = parseInt(yStr)
    return { x, y }
  } catch (error) {
    throw new Error(`Invalid point format: ${token}`)
  }
}

/**
 * Map grid coordinates to pixel coordinates in SVG canvas
 */
function gridToPx(x: number, y: number, gridRes: number, canvasPx: number): SketchPoint {
  if (gridRes < 2) gridRes = 2
  const step = canvasPx / (gridRes - 1)
  const px = (x - 1) * step
  const py = canvasPx - (y - 1) * step // Invert Y for visual intuition
  return { x: px, y: py }
}

/**
 * Check if a path is closed (first and last points are the same)
 */
function isClosed(points: SketchPoint[]): boolean {
  if (points.length < 2) return false
  const first = points[0]
  const last = points[points.length - 1]
  return Math.abs(first.x - last.x) < 1e-6 && Math.abs(first.y - last.y) < 1e-6
}

/**
 * Calculate Euclidean distance between two points
 */
function distance(p1: SketchPoint, p2: SketchPoint): number {
  return Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2)
}

/**
 * Improved Catmull-Rom to Bezier converter that adapts tension at sharp corners
 */
function adaptiveCatmullRomToBezier(pixelPoints: SketchPoint[], closed: boolean): string {
  const n = pixelPoints.length
  if (n < 2) return ''
  
  const points = closed && n > 1 ? pixelPoints.slice(0, -1) : pixelPoints
  const numPoints = points.length
  
  if (numPoints < 2) {
    const pathParts = [`M ${pixelPoints[0].x.toFixed(2)} ${pixelPoints[0].y.toFixed(2)}`]
    for (let i = 1; i < pixelPoints.length; i++) {
      const point = pixelPoints[i]
      pathParts.push(`L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    }
    return pathParts.join(' ')
  }

  function getPoint(i: number): SketchPoint {
    if (closed) {
      return points[((i % numPoints) + numPoints) % numPoints]
    }
    return points[Math.max(0, Math.min(i, numPoints - 1))]
  }

  const pathParts = [`M ${pixelPoints[0].x.toFixed(2)} ${pixelPoints[0].y.toFixed(2)}`]
  const lastSegment = closed ? numPoints : numPoints - 1

  for (let i = 0; i < lastSegment; i++) {
    const p0 = getPoint(i - 1)
    const p1 = getPoint(i)
    const p2 = getPoint(i + 1)
    const p3 = getPoint(i + 2)

    let tension = 0.5
    const dist1 = distance(p0, p1)
    const dist2 = distance(p1, p2)
    const dist3 = distance(p2, p3)

    if (dist1 > 0 && dist3 > 0) {
      if (dist2 < (dist1 + dist3) * 0.15) {
        tension = 0.05
      }
    }

    const c1x = p1.x + (p2.x - p0.x) / 3.0 * tension
    const c1y = p1.y + (p2.y - p0.y) / 3.0 * tension
    const c2x = p2.x - (p3.x - p1.x) / 3.0 * tension
    const c2y = p2.y - (p3.y - p1.y) / 3.0 * tension

    pathParts.push(
      `C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
    )
  }

  if (closed) {
    pathParts.push('Z')
  }
  
  return pathParts.join(' ')
}

/**
 * Convert strokes to SVG shapes (paths and circles)
 */
function strokesToSvgShapes(
  strokes: SketchStroke[], 
  gridRes: number, 
  canvasPx: number, 
  smooth: boolean = false
): { paths: string[], circles: SketchPoint[] } {
  const paths: string[] = []
  const circles: SketchPoint[] = []
  
  for (const stroke of strokes) {
    const points = stroke.points || []
    if (points.length === 0) continue
    
    const pixelPoints = points.map(p => {
      const parsed = parsePoint(p)
      return gridToPx(parsed.x, parsed.y, gridRes, canvasPx)
    })
    
    if (pixelPoints.length === 0) continue
    
    if (pixelPoints.length === 1) {
      circles.push(pixelPoints[0])
      continue
    }
    
    const closed = isClosed(pixelPoints)
    
    if (smooth && pixelPoints.length >= 2) {
      const pathData = adaptiveCatmullRomToBezier(pixelPoints, closed)
      paths.push(pathData)
    } else {
      const pathParts = [`M ${pixelPoints[0].x.toFixed(2)} ${pixelPoints[0].y.toFixed(2)}`]
      for (let i = 1; i < pixelPoints.length; i++) {
        const point = pixelPoints[i]
        pathParts.push(`L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
      }
      if (closed) {
        pathParts.push('Z')
      }
      paths.push(pathParts.join(' '))
    }
  }
  
  return { paths, circles }
}

/**
 * Render sketch data to SVG string
 */
export function renderSketchToSvg(sketch: SketchData, options: RenderOptions = {}): string {
  const {
    gridRes = 64,
    canvasPx = 512,
    showGrid = false,
    smooth = false
  } = options

  const strokes = sketch.strokes || []
  const { paths, circles } = strokesToSvgShapes(strokes, gridRes, canvasPx, smooth)

  const svgParts = [
    `<svg xmlns='http://www.w3.org/2000/svg' width='${canvasPx}' height='${canvasPx}' viewBox='0 0 ${canvasPx} ${canvasPx}'>`,
    "  <rect width='100%' height='100%' fill='white'/>",
  ]

  if (showGrid) {
    const step = canvasPx / (gridRes - 1 > 0 ? gridRes - 1 : 1)
    for (let i = 0; i < gridRes; i++) {
      const x = i * step
      const y = i * step
      svgParts.push(`  <line x1='${x.toFixed(2)}' y1='0' x2='${x.toFixed(2)}' y2='${canvasPx}' stroke='#eee' stroke-width='1' />`)
      svgParts.push(`  <line x1='0' y1='${y.toFixed(2)}' x2='${canvasPx}' y2='${y.toFixed(2)}' stroke='#eee' stroke-width='1' />`)
    }
  }

  for (const pathData of paths) {
    svgParts.push(`  <path d='${pathData}' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' />`)
  }

  for (const circle of circles) {
    svgParts.push(`  <circle cx='${circle.x.toFixed(2)}' cy='${circle.y.toFixed(2)}' r='3' fill='black' />`)
  }

  svgParts.push('</svg>')

  return svgParts.join('\n')
}