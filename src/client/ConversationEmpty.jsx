import React from 'react'
import { Icon } from './icons.jsx'
export default function Empty({ title, children, onOverview }) {
  return (
    <div className="empty">
      <div className="e-ic">
        <Icon name="chat" size={26} />
      </div>
      <div className="t">{title}</div>
      <div className="d">{children}</div>
      {onOverview && (
        <button className="btn" onClick={onOverview}>
          查看团队 <Icon name="arrow" size={14} />
        </button>
      )}
    </div>
  )
}
