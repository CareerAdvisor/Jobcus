
// static/js/modern.js
import { initCommon } from './resume-common.js';

document.addEventListener('DOMContentLoaded', () => {
  const root = document.querySelector('.resume.resume--modern');
  if (!root) return;          // don’t run on other pages
  initCommon(root);
  // modern-only behavior here…
});
