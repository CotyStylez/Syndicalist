// Tiny DOM helper to keep the UI modules readable without a framework.

export function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (key === 'class') el.className = value;
    else if (key === 'html') el.innerHTML = value;
    else if (key === 'value') el.value = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value !== undefined && value !== null && value !== false) {
      el.setAttribute(key, value === true ? '' : value);
    }
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const kid of kids) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function mount(parent, ...children) {
  clear(parent);
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(child);
  }
}
