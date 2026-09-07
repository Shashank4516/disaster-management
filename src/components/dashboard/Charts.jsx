import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from '@/components/ui/chart'

export function AreaSpark({ data, dataKey = 'v', color = 'var(--chart-1)', height = 64 }) {
  const config = { [dataKey]: { label: 'Value', color } }
  return (
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height }} initialDimension={{ width: 240, height }}>
      <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`fill-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={`var(--color-${dataKey})`} stopOpacity={0.35} />
            <stop offset="95%" stopColor={`var(--color-${dataKey})`} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey={dataKey}
          stroke={`var(--color-${dataKey})`}
          fill={`url(#fill-${dataKey})`}
          strokeWidth={2}
          dot={false}
        />
      </AreaChart>
    </ChartContainer>
  )
}

export function MiniBars({ data, dataKey = 'v', color = 'var(--chart-1)', height = 72 }) {
  const config = { [dataKey]: { label: 'Value', color } }
  return (
    <ChartContainer config={config} className="aspect-auto w-full" style={{ height }} initialDimension={{ width: 180, height }}>
      <BarChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
        <Bar dataKey={dataKey} fill={`var(--color-${dataKey})`} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  )
}

export function RiskAreaChart({ data }) {
  const config = {
    risk: { label: 'Risk index', color: 'var(--chart-1)' },
  }
  return (
    <ChartContainer config={config} className="aspect-[16/7] w-full" initialDimension={{ width: 520, height: 220 }}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <defs>
          <linearGradient id="fill-risk" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-risk)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="var(--color-risk)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="hour" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} tickMargin={8} width={36} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Area
          type="monotone"
          dataKey="risk"
          stroke="var(--color-risk)"
          fill="url(#fill-risk)"
          strokeWidth={2.5}
        />
      </AreaChart>
    </ChartContainer>
  )
}

export function PerformanceBarChart({ data }) {
  const config = {
    flood: { label: 'Flood', color: '#2563eb' },
    fire: { label: 'Fire', color: '#60a5fa' },
    pollution: { label: 'Pollution', color: '#93c5fd' },
  }
  return (
    <ChartContainer config={config} className="aspect-[16/8] w-full" initialDimension={{ width: 520, height: 260 }}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} width={36} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="flood" fill="var(--color-flood)" radius={[4, 4, 0, 0]} stackId="a" />
        <Bar dataKey="fire" fill="var(--color-fire)" radius={[4, 4, 0, 0]} stackId="a" />
        <Bar dataKey="pollution" fill="var(--color-pollution)" radius={[4, 4, 0, 0]} stackId="a" />
      </BarChart>
    </ChartContainer>
  )
}

export function HazardDonut({ data }) {
  const config = {
    flood: { label: 'Flood', color: '#2563eb' },
    fire: { label: 'Fire', color: '#60a5fa' },
    pollution: { label: 'Pollution', color: '#93c5fd' },
  }
  const total = data.reduce((sum, d) => sum + d.value, 0)
  return (
    <div className="relative">
      <ChartContainer config={config} className="mx-auto aspect-square max-h-[220px]" initialDimension={{ width: 220, height: 220 }}>
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent hideLabel />} />
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={58} outerRadius={84} strokeWidth={3}>
            {data.map((entry) => (
              <Cell key={entry.name} fill={entry.fill} />
            ))}
          </Pie>
        </PieChart>
      </ChartContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-semibold tabular-nums">{total}%</span>
        <span className="text-xs text-muted-foreground">coverage</span>
      </div>
    </div>
  )
}
