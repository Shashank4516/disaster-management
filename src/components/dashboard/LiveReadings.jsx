import { BatteryIcon, SignalIcon } from 'lucide-react'
import { HAZARDS, formatRelative, readingSummary } from '@/data/mockData'
import { riskVariant } from '@/lib/risk'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'

export function LiveReadings({ nodes }) {
  const live = [...nodes]
    .filter((n) => n.status !== 'offline')
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 4)

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Highest risk readings</CardTitle>
        <CardDescription>Edge scores updating live (mock)</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {live.map((node) => (
          <div key={node.id} className="rounded-xl border p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">{node.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {HAZARDS[node.hazard].label} · {node.region}
                </p>
              </div>
              <Badge variant={riskVariant(node.risk)}>{node.risk}</Badge>
            </div>
            <p className="mt-2 text-sm font-medium tabular-nums">{readingSummary(node)}</p>
            <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <SignalIcon /> Score {Math.round(node.riskScore)}
              </span>
              <span className="inline-flex items-center gap-1">
                <BatteryIcon /> {node.battery}%
              </span>
              <span className="ml-auto">{formatRelative(node.lastSeen)}</span>
            </div>
            <Progress value={Math.min(100, node.riskScore)} className="mt-2" />
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
