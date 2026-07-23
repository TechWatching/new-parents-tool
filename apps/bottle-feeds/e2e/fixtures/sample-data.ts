import type { AppData, Feed, Weight } from '../../src/types'

const feedSchedule = [
  { date: '2026-07-13', times: ['00:30', '03:30', '06:30', '09:30', '12:30', '15:30', '18:30'], amounts: [50, 50, 55, 50, 55, 50, 55] },
  { date: '2026-07-14', times: ['00:15', '03:15', '06:15', '09:15', '12:15', '15:15', '18:15', '21:15'], amounts: [50, 55, 50, 55, 55, 50, 55, 50] },
  { date: '2026-07-15', times: ['00:00', '03:00', '06:00', '09:00', '12:00', '15:00', '18:00', '21:00'], amounts: [55, 50, 55, 55, 50, 55, 55, 50] },
  { date: '2026-07-16', times: ['00:30', '03:30', '06:30', '09:30', '12:30', '15:30', '18:30', '21:30'], amounts: [55, 55, 50, 60, 55, 55, 60, 55] },
  { date: '2026-07-17', times: ['00:15', '03:15', '06:15', '09:15', '12:15', '15:15', '18:15', '21:15', '23:45'], amounts: [55, 60, 55, 60, 55, 60, 60, 55, 50] },
  { date: '2026-07-18', times: ['00:00', '03:00', '06:00', '09:00', '12:00', '15:00', '18:00', '21:00'], amounts: [60, 55, 60, 60, 55, 60, 60, 55] },
  { date: '2026-07-19', times: ['00:30', '03:30', '06:30', '09:30', '12:30', '15:30', '18:30', '21:30'], amounts: [60, 60, 55, 65, 60, 60, 65, 60] },
  { date: '2026-07-20', times: ['00:15', '03:15', '06:15', '09:15', '12:15', '15:15', '18:15'], amounts: [60, 65, 60, 65, 60, 65, 60] },
  { date: '2026-07-21', times: ['00:00', '03:00', '06:00', '09:00', '12:00', '15:00', '18:00', '21:00'], amounts: [65, 60, 65, 65, 60, 65, 65, 60] },
  { date: '2026-07-22', times: ['00:30', '03:30', '06:30', '09:30', '12:30', '15:30', '18:30', '21:30'], amounts: [65, 65, 60, 70, 65, 65, 70, 65] },
] as const

export const sampleFeeds: Feed[] = feedSchedule.flatMap(({ date, times, amounts }) =>
  times.map((time, index) => {
    const occurredAt = `${date}T${time}:00.000Z`
    return {
      id: `sample-feed-${date}-${index + 1}`,
      amount: amounts[index]!,
      occurredAt,
      comment: '',
      updatedAt: occurredAt,
    }
  }),
)

export const sampleWeights: Weight[] = [
  { id: 'sample-weight-1', kilograms: 3.45, occurredAt: '2026-07-14T00:00:00.000Z', updatedAt: '2026-07-14T00:00:00.000Z' },
  { id: 'sample-weight-2', kilograms: 3.5, occurredAt: '2026-07-16T00:00:00.000Z', updatedAt: '2026-07-16T00:00:00.000Z' },
  { id: 'sample-weight-3', kilograms: 3.56, occurredAt: '2026-07-18T00:00:00.000Z', updatedAt: '2026-07-18T00:00:00.000Z' },
  { id: 'sample-weight-4', kilograms: 3.62, occurredAt: '2026-07-20T00:00:00.000Z', updatedAt: '2026-07-20T00:00:00.000Z' },
  { id: 'sample-weight-5', kilograms: 3.68, occurredAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-22T00:00:00.000Z' },
]

export const sampleAppData: AppData = {
  feeds: sampleFeeds,
  weights: sampleWeights,
}
