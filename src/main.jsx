import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import 'remixicon/fonts/remixicon.css'
import './assets/dashbyte/style.min.css'
import './assets/dashbyte/app.css'
import App from './App.jsx'
import './index.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <TooltipProvider>
      <App />
      <Toaster richColors closeButton position="top-right" />
    </TooltipProvider>
  </StrictMode>,
)
