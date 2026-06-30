import axios from 'axios'

// اتصال به backend دیجی‌پی
const client = axios.create({
  baseURL: 'http://localhost:3000/api',
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 15000,
})

export default client
