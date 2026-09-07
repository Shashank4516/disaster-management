export const sparkGray = [
  [0, 9],
  [1, 7],
  [2, 4],
  [3, 8],
  [4, 4],
  [5, 12],
  [6, 4],
  [7, 6],
  [8, 5],
  [9, 10],
  [10, 4],
  [11, 5],
  [12, 10],
  [13, 2],
  [14, 6],
]

export function sparkOptions(color, values = []) {
  const min = values.length ? Math.min(...values) : 0
  const max = values.length ? Math.max(...values) : 1
  const pad = Math.max((max - min) * 0.45, Math.max(max * 0.12, 1))

  return {
    chart: {
      parentHeightOffset: 0,
      sparkline: { enabled: true },
      animations: { enabled: false },
      toolbar: { show: false },
    },
    grid: { show: false, padding: { left: 0, right: 0, top: 4, bottom: 0 } },
    colors: [color],
    stroke: {
      curve: 'smooth',
      width: 2,
    },
    fill: {
      type: 'gradient',
      gradient: {
        shadeIntensity: 1,
        opacityFrom: 0.28,
        opacityTo: 0.02,
        stops: [0, 100],
      },
    },
    dataLabels: { enabled: false },
    markers: { size: 0, hover: { size: 0 } },
    tooltip: { enabled: false },
    xaxis: {
      labels: { show: false },
      axisBorder: { show: false },
      axisTicks: { show: false },
      crosshairs: { show: false },
    },
    yaxis: {
      show: false,
      labels: { show: false },
      axisBorder: { show: false },
      axisTicks: { show: false },
      min: Math.max(0, min - pad),
      max: max + pad,
    },
  }
}

export function toPairs(values) {
  return values.map((v, i) => [i, v])
}

/** Last N points for a compact sparkline. */
export function sparkSeries(values, fallback, points = 12) {
  const source = values.length > 1 ? values : fallback
  const sliced = source.slice(-points)
  return {
    series: [{ name: 'trend', data: toPairs(sliced) }],
    values: sliced,
  }
}
