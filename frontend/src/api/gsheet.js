import client from './client'

// تست اتصال (صحت آدرس) Google Sheet
export async function testGsheetConnection(url) {
  const { data } = await client.post('/gsheet/test', { url })
  return data
}
