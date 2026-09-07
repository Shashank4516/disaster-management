import Chart from 'react-apexcharts'

const ChartComponent = Chart?.default ?? Chart

export default function ApexChart(props) {
  return <ChartComponent {...props} />
}
