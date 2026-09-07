import { FlameIcon, WavesIcon, WindIcon } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'

const meta = [
  { key: 'flood', label: 'Flood', icon: WavesIcon },
  { key: 'fire', label: 'Forest Fire', icon: FlameIcon },
  { key: 'pollution', label: 'Air Pollution', icon: WindIcon },
]

export function HazardBreakdown({ nodes }) {
  const total = nodes.length || 1

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Hazard coverage</CardTitle>
        <CardDescription>Nodes by environmental risk type</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {meta.map((item) => {
          const count = nodes.filter((n) => n.hazard === item.key).length
          const critical = nodes.filter((n) => n.hazard === item.key && n.risk === 'CRITICAL').length
          const pct = Math.round((count / total) * 100)
          const Icon = item.icon
          return (
            <div key={item.key} className="rounded-xl border bg-muted/40 p-3.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <Icon className="text-foreground" />
                  <span className="text-sm font-semibold">{item.label}</span>
                </div>
                <span className="text-sm font-semibold tabular-nums">{count} nodes</span>
              </div>
              <Progress value={pct} className="mt-3" />
              <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
                <span>{pct}% of network</span>
                <span>{critical} critical</span>
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
