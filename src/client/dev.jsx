import React from 'react'
import {createRoot} from 'react-dom/client'
import TeamApp from './App.jsx'
import {installStyles} from './style.mjs'
installStyles()
createRoot(document.getElementById('root')).render(<TeamApp preview sourceSession={window.__TEAM_DEV__?.sourceSession} sourceProject={window.__TEAM_DEV__?.project}/> )
