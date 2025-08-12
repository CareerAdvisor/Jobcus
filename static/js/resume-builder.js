// keep your fetch-credentials shim

document.addEventListener('DOMContentLoaded', () => {
  // Tabs / sections
  const tabs = document.querySelectorAll('.rb-tabs button');
  tabs.forEach(btn => btn.addEventListener('click', () => {
    tabs.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.rb-step').forEach(s => s.hidden = true);
    document.querySelector(btn.dataset.target).hidden = false;
  }));

  // Step footer nav
  const steps = Array.from(document.querySelectorAll('.rb-step'));
  let stepIndex = 0;
  const backBtn = document.getElementById('rb-back');
  const nextBtn = document.getElementById('rb-next');
  function showStep(i){
    stepIndex = Math.max(0, Math.min(i, steps.length-1));
    steps.forEach((s, idx) => s.hidden = idx !== stepIndex);
    tabs.forEach((t, idx) => t.classList.toggle('active', idx === stepIndex));
    backBtn.disabled = stepIndex === 0;
    nextBtn.disabled = stepIndex === steps.length-1;
  }
  backBtn?.addEventListener('click', () => showStep(stepIndex-1));
  nextBtn?.addEventListener('click', () => showStep(stepIndex+1));
  showStep(0);

  // Repeater helpers (experience / education)
  function addFromTemplate(btnAttr, listId, tplId){
    const list = document.getElementById(listId);
    const tpl  = document.getElementById(tplId);
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.querySelector('.rb-remove').addEventListener('click', () => node.remove());
    list.appendChild(node);
  }
  document.querySelector('[data-add="experience"]')?.addEventListener('click', () => addFromTemplate('experience','exp-list','tpl-experience'));
  document.querySelector('[data-add="education"]')?.addEventListener('click', () => addFromTemplate('education','edu-list','tpl-education'));
  // start with one block for each
  addFromTemplate('experience','exp-list','tpl-experience');
  addFromTemplate('education','edu-list','tpl-education');

  // Chips input for skills
  const skillInput = document.getElementById('skillInput');
  const skillChips = document.getElementById('skillChips');
  const skillsHidden = document.querySelector('input[name="skills"]');
  const skills = new Set();
  function refreshChips(){
    skillChips.innerHTML = '';
    skillsHidden.value = Array.from(skills).join(',');
    skills.forEach(s => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.innerHTML = `${s} <button type="button" aria-label="remove">×</button>`;
      chip.querySelector('button').onclick = () => { skills.delete(s); refreshChips(); };
      skillChips.appendChild(chip);
    });
  }
  skillInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && skillInput.value.trim()){
      e.preventDefault();
      skills.add(skillInput.value.trim());
      skillInput.value = '';
      refreshChips();
    }
  });

  // Compose contact → single string for template
  function contactString(f){
    const parts = [];
    const loc = [f.city.value, f.country.value].filter(Boolean).join(', ');
    if (loc) parts.push(loc);
    if (f.phone.value) parts.push(f.phone.value);
    if (f.email.value) parts.push(f.email.value);
    return parts.join(' | ');
  }

  // Replace your old coerce with this:
  window.coerceFormToTemplateContext = function(){
    const f = document.getElementById('resumeForm');

    const name = [f.firstName.value, f.lastName.value].filter(Boolean).join(' ').trim();
    const links = f.portfolio.value ? [{ url: f.portfolio.value, label: 'Portfolio' }] : [];

    // experience[]
    const exp = Array.from(document.querySelectorAll('#exp-list .rb-item')).map(node => {
      const g = name => node.querySelector(`[name="${name}"]`);
      const bullets = (g('bullets').value || '')
        .split('\n').map(t => t.replace(/^•\s*/,'').trim()).filter(Boolean);
      return {
        role: g('role').value, company: g('company').value,
        location: g('location').value, start: g('start').value, end: g('end').value,
        bullets
      };
    });

    // education[]
    const edu = Array.from(document.querySelectorAll('#edu-list .rb-item')).map(node => {
      const g = name => node.querySelector(`[name="${name}"]`);
      return {
        degree: g('degree').value,
        school: g('school').value,
        location: g('location').value,
        graduated: g('graduated').value || g('graduatedStart').value
      };
    });

    const skillsArr = (f.skills.value || '').split(',').map(s => s.trim()).filter(Boolean);

    return {
      name,
      title: f.title.value.trim(),
      contact: contactString(f),
      summary: f.summary.value.trim(),
      links,
      experience: exp,
      education: edu,
      skills: skillsArr
    };
  };

  /* —— keep the rest of your existing preview / PDF logic —— */
});
