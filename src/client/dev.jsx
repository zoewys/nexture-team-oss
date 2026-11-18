import React from 'react'
import {createRoot} from 'react-dom/client'
import TeamApp from './App.jsx'
import {installStyles} from './style.mjs'
installStyles()
const unbound=new URLSearchParams(window.location.search).has('unbound')
createRoot(document.getElementById('root')).render(<TeamApp preview sourceSession={unbound?undefined:window.__TEAM_DEV__?.sourceSession} sourceProject={unbound?undefined:window.__TEAM_DEV__?.project}/> )
