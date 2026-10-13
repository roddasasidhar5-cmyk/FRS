import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
})

// Do NOT auto-redirect on 401 — let AuthContext handle it via user state.
// A hard window.location redirect causes full-page reload loops.

export default api
