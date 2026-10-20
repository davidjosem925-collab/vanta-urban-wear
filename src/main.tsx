import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import './app/styles.css'
import './features/cart/cart.css'
import './features/catalog/size-guide.css'
import './features/checkout/checkout.css'
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
