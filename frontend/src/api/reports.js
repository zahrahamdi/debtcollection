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

export async function fetchFunnelReport(filters = {}) {
  const { data } = await client.get('/reports/funnel', { params: cleanParams(filters) })
  return data?.data ?? { total_cases: 0, legal_cases: 0, steps: [] }
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

/** @deprecated use fetchCasesReport */
export async function fetchReportsSummary(filters = {}) {
  const { data } = await client.get('/reports/summary', { params: cleanParams(filters) })
  return data?.data ?? null
}

/** @deprecated */
export async function fetchActionConversion(filters = {}) {
  const { data } = await client.get('/reports/action-conversion', { params: cleanParams(filters) })
  return data?.data ?? []
}

/** @deprecated */
export async function fetchAbTestResults(filters = {}) {
  const { data } = await client.get('/reports/ab-tests', { params: cleanParams(filters) })
  return data?.data ?? []
}
