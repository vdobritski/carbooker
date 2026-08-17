import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { apply, readPreference } from './lib/theme'
import './styles.css'

// Before the first render, and not inside the navbar: sign-in and the public trip page have
// no navbar, and would otherwise sit on whatever the stylesheet defaults to.
apply(readPreference())

const root = document.getElementById('root')
if (!root) throw new Error('No #root element in index.html')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
