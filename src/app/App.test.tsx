import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from './App'
describe('Pantalla inicial', () => {
  it('presenta la marca y aclara que las compras no están habilitadas', () => {
    render(<App />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Presencia')
    expect(screen.getAllByRole('article')).toHaveLength(3)
    expect(screen.getByText(/todavía no acepta compras/)).toBeVisible()
    expect(screen.queryByRole('button', { name: /comprar|carrito/i })).not.toBeInTheDocument()
  })
})
