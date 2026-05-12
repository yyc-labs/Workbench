import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../stores/appStore'

export function SettingsPage() {
  const navigate = useNavigate()
  const config = useAppStore((s) => s.config)
  const [theme, setTheme] = useState(config.theme)

  useEffect(() => {
    setTheme(config.theme)
  }, [config.theme])

  const handleThemeChange = async (
    newTheme: 'system' | 'light' | 'dark'
  ) => {
    setTheme(newTheme)
    await window.electronAPI.setConfig({ theme: newTheme })
    document.documentElement.setAttribute('data-theme', newTheme)
  }

  return (
    <div className="settings-page">
      <header className="settings-header">
        <button className="btn btn-ghost" onClick={() => navigate('/')}>
          &larr; Back
        </button>
        <h1>Settings</h1>
      </header>

      <section className="settings-section">
        <h2>Appearance</h2>
        <div className="setting-row">
          <label>Theme</label>
          <select
            value={theme}
            onChange={(e) =>
              handleThemeChange(
                e.target.value as 'system' | 'light' | 'dark'
              )
            }
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
      </section>

      <section className="settings-section">
        <h2>Rule Table</h2>
        <p className="text-secondary">
          Project types are detected by matching files in the project
          directory. Higher priority rules are checked first.
        </p>
      </section>

      <section className="settings-section">
        <h2>About</h2>
        <p className="text-secondary">Project Launcher v1.0.0</p>
      </section>
    </div>
  )
}
