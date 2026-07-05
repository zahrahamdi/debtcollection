import client from './client'

export async function uploadCases(file) {
  const formData = new FormData()
  formData.append('file', file)

  const { data } = await client.post('/bulk/upload-cases', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  })
  return data
}

export async function uploadPayments(file) {
  const formData = new FormData()
  formData.append('file', file)

  const { data } = await client.post('/bulk/upload-payments', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  })
  return data
}

export async function assignCases(file) {
  const formData = new FormData()
  formData.append('file', file)

  const { data } = await client.post('/bulk/assign-cases', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  })
  return data
}

export async function reassignCases(file) {
  const formData = new FormData()
  formData.append('file', file)

  const { data } = await client.post('/bulk/reassign-cases', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  })
  return data
}

export async function fetchBulkHistory() {
  const { data } = await client.get('/bulk/history')
  return data.data
}

export function errorReportUrl(bulkId) {
  return `${client.defaults.baseURL}/bulk/error-report/${bulkId}`
}
