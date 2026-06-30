import client from './client'

export async function uploadCases(file, userName) {
  const formData = new FormData()
  formData.append('file', file)
  if (userName) formData.append('user_name', userName)

  const { data } = await client.post('/bulk/upload-cases', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  })
  return data
}

export async function fetchBulkHistory(userName) {
  const params = userName ? { user_name: userName } : {}
  const { data } = await client.get('/bulk/history', { params })
  return data.data
}

export function errorReportUrl(bulkId) {
  return `${client.defaults.baseURL}/bulk/error-report/${bulkId}`
}
