import client from './client'

function cleanParams(filters = {}) {
  const params = { ...filters }
  Object.keys(params).forEach((k) => {
    if (params[k] === '' || params[k] == null) delete params[k]
  })
  return params
}

export async function fetchCasesReport(filters = {}) {
  const { data } = await client.get('/reports/cases', { params: cleanParams(filters) })
  return data?.data ?? null
}

export async function fetchStrategiesPerformance(filters = {}) {
  const { data } = await client.get('/reports/strategies/performance', {
    params: cleanParams(filters),
  })
  return data?.data ?? null
}

export async function fetchStrategiesCost(filters = {}) {
  const { data } = await client.get('/reports/strategies/cost', { params: cleanParams(filters) })
  return data?.data ?? null
}

export async function fetchNegotiatorsReport(filters = {}) {
  const { data } = await client.get('/reports/negotiators', { params: cleanParams(filters) })
  return data?.data ?? null
}

export async function fetchReportsMeta() {
  const { data } = await client.get('/reports/meta')
  return data?.data ?? { provinces: [] }
}
