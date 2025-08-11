// static/js/minimal.js
import { initCommon } from './resume-common.js';

document.addEventListener('DOMContentLoaded', () => {
  const root = document.querySelector('.resume.resume--minimal');
  if (!root) return;
  initCommon(root);
  // minimal-only behavior here…
});

