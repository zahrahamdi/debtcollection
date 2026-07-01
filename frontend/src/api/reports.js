import client from './client'

function cleanParams(filters = {}) {
  const params = { ...filters }
  Object.keys(params).forEach((k) => {
    if (params[k] === '' || params[k] == null) delete params[k]
  })
  return params
}

export async function fetchReportsSummary(filters = {}) {
  const { data } = await client.get('/reports/summary', { params: cleanParams(filters) })
  return data?.data ?? null
}

export async function fetchActionConversion(filters = {}) {
  const { data } = await client.get('/reports/action-conversion', { params: cleanParams(filters) })
  return data?.data ?? []
}

export async function fetchAbTestResults(filters = {}) {
  const { data } = await client.get('/reports/ab-tests', { params: cleanParams(filters) })
  return data?.data ?? []
}
